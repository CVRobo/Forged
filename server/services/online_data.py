"""Typed-checkout submissions: ML prediction with browser-Gus fallback.

Every order a player sends becomes one row in server/data/ieee_rows.csv (or FORGED_DATA_DIR),
with the dataset's columns plus the game's own (session_id, verdict, score, ...).

The server tries its own ML detector first (ml.online). If no model is loaded, it falls
back to the browser's scripted Gus verdict. Player wins are buffered for retrain.
"""

from __future__ import annotations

import csv
import logging
import os
import threading
from pathlib import Path

from server.models.schemas import OnlineRecord, GusVerdict, SubmitResponse, Tell

logger = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("FORGED_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
ROWS_CSV = DATA_DIR / "ieee_rows.csv"
_lock = threading.Lock()

# How many player wins before we attempt a retrain
RETRAIN_THRESHOLD = 5

# When FORGED_USE_KAGGLE=1, use the Kaggle LightGBM model instead of the game LogReg
USE_KAGGLE = os.environ.get("FORGED_USE_KAGGLE", "").strip() in ("1", "true", "yes")

# the same columns, in the same order, as the game's CSV export (prototype/orders.js COLUMNS)
COLUMNS = [
    "TransactionID", "isFraud", "TransactionDT", "TransactionAmt", "ProductCD",
    *[f"card{i}" for i in range(1, 7)], "addr1", "addr2", "dist1", "dist2", "P_emaildomain", "R_emaildomain",
    *[f"C{i}" for i in range(1, 15)], *[f"D{i}" for i in range(1, 16)], *[f"M{i}" for i in range(1, 10)],
    *[f"V{i}" for i in range(1, 340)], *[f"id_{i:02d}" for i in range(1, 39)], "DeviceType", "DeviceInfo",
    "session_id", "origin", "level_id", "round_no", "scheme_id", "campaign_id", "step", "verdict", "score",
    "top_reasons", "detector_version", "cover_note", "player",
]


def save_rows(record: OnlineRecord, verdict: GusVerdict | None, round_id: str, player: str | None) -> int:
    """Append the record's rows to the CSV (434 dataset columns, then the game's)."""
    caught = verdict.caught if verdict else None
    reasons = [t[0] for t in (verdict.tells if verdict else [])][:3]
    rows = []
    for row in record.rows:
        row = dict(row)
        row.setdefault("session_id", round_id)
        if caught is not None:
            row["verdict"] = "DECLINED" if caught else "APPROVED"
            row["isFraud"] = 1  # every player order is fraud; legit rows come from the real dataset
            if not row.get("top_reasons"):
                row["top_reasons"] = "|".join(map(str, reasons))
        row["player"] = player or ""
        rows.append(row)
    if not rows:
        return 0
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _lock:
        new = not ROWS_CSV.exists() or ROWS_CSV.stat().st_size == 0
        with ROWS_CSV.open("a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
            if new:
                w.writeheader()
            w.writerows(rows)
    return len(rows)


def submit_online(record: OnlineRecord, verdict: GusVerdict | None, round_id: str, player: str | None) -> SubmitResponse:
    save_rows(record, verdict, round_id, player)

    # Try ML prediction on the order rows
    ml_result = _try_ml_predict(record, verdict)
    if ml_result is not None:
        return ml_result

    # Fall back: echo browser's scripted Gus
    return _echo_browser_verdict(verdict)


def _try_ml_predict(record: OnlineRecord, browser_verdict: GusVerdict | None) -> SubmitResponse | None:
    """Run the ML detector on the record's rows. Returns None if no model loaded."""
    try:
        if USE_KAGGLE:
            from ml.online import predict_kaggle as ml_predict
        else:
            from ml.online import predict as ml_predict
    except Exception:
        return None

    if not record.rows:
        return None

    # Score each row, aggregate: caught if ANY row is flagged
    all_tells: list[Tell] = []
    worst_score = 0.0
    worst_suspicion = 0.0
    caught = False
    version = 0

    for row_dict in record.rows:
        result = ml_predict(row_dict)
        if result is None:
            return None  # no model loaded
        version = result["version"]
        if result["score"] > worst_score:
            worst_score = result["score"]
            worst_suspicion = result["suspicion"]
        if result["flagged"]:
            caught = True
        all_tells.extend(result["tells"])

    # Deduplicate tells by tell_type, keeping the strongest
    tell_map: dict[str, Tell] = {}
    for t in all_tells:
        if t.tell_type not in tell_map or t.strength > tell_map[t.tell_type].strength:
            tell_map[t.tell_type] = t
    top_tells = sorted(tell_map.values(), key=lambda t: -t.strength)[:3]

    payout = 0
    if not caught:
        payout = int(browser_verdict.payout if browser_verdict else 0)
        # Buffer the winning rows for retrain
        _buffer_winning_rows(record.rows)
        new_version = _maybe_retrain()
        if new_version:
            version = new_version

    return SubmitResponse(
        verdict="DECLINED" if caught else "APPROVED",
        top_tells=top_tells,
        inspector_line="",
        payout=payout,
        new_version=version,
    )


def _buffer_winning_rows(rows: list[dict]) -> None:
    """Append winning orders to the retrain buffer."""
    try:
        from ml.online.store import append_to_buffer
        append_to_buffer([dict(r) for r in rows])
    except Exception:
        logger.warning("Failed to buffer winning rows", exc_info=True)


def _maybe_retrain() -> int | None:
    """If the buffer has enough wins, attempt a retrain. Returns new version or None."""
    try:
        from ml.online.store import load_buffer, drain_buffer
        from ml.online import retrain

        buf = load_buffer()
        if len(buf) < RETRAIN_THRESHOLD:
            return None

        fraud_rows = drain_buffer()
        new_version = retrain(fraud_rows)
        if new_version:
            logger.info("Online detector retrained to v%d from %d player wins",
                        new_version, len(fraud_rows))
        return new_version
    except Exception:
        logger.warning("Retrain attempt failed", exc_info=True)
        return None


def _echo_browser_verdict(verdict: GusVerdict | None) -> SubmitResponse:
    """Fall back to the browser's scripted Gus verdict."""
    caught = bool(verdict and verdict.caught)
    tells = [Tell(tell_type=str(t[0]), strength=float(t[1]) if len(t) > 1 else 1.0)
             for t in (verdict.tells if verdict else []) if t]
    return SubmitResponse(
        verdict="DECLINED" if caught else "APPROVED",
        top_tells=tells[:3],
        inspector_line="",
        payout=0 if caught else int(verdict.payout if verdict else 0),
        new_version=0,
    )
