"""Typed-checkout submissions: Gus's verdict from the fraud model, and the rows kept for training.

Every order a player sends becomes one row in server/data/ieee_rows.csv (or FORGED_DATA_DIR),
with the dataset's columns plus the game's own (verdict, score, top_reasons, ...).

The verdict comes from the newest promoted version of the model in ml/online (LightGBM on
the IEEE-CIS data, retrained on players' orders). Without a trained model, or without its
packages, the server answers with the scripted Gus the browser sends, so the game still plays.
Every RETRAIN_EVERY orders that get through, a retrain runs in the background; the new
version goes live only if it passes the gate in ml/online/retrain.py.
"""

from __future__ import annotations

import csv
import logging
import os
import threading
from pathlib import Path

from server.models.schemas import GusVerdict, OnlineRecord, SubmitResponse, Tell

log = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("FORGED_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
ROWS_CSV = DATA_DIR / "ieee_rows.csv"
RETRAIN_EVERY = int(os.environ.get("FORGED_RETRAIN_EVERY", "25"))
_lock = threading.Lock()
_retrain = {"running": False, "evasions": 0}

# the same columns, in the same order, as the game's CSV export (prototype/orders.js COLUMNS)
COLUMNS = [
    "TransactionID", "isFraud", "TransactionDT", "TransactionAmt", "ProductCD",
    *[f"card{i}" for i in range(1, 7)], "addr1", "addr2", "dist1", "dist2", "P_emaildomain", "R_emaildomain",
    *[f"C{i}" for i in range(1, 15)], *[f"D{i}" for i in range(1, 16)], *[f"M{i}" for i in range(1, 10)],
    *[f"V{i}" for i in range(1, 340)], *[f"id_{i:02d}" for i in range(1, 39)], "DeviceType", "DeviceInfo",
    "session_id", "origin", "level_id", "round_no", "scheme_id", "campaign_id", "step", "verdict", "score",
    "top_reasons", "detector_version", "cover_note", "player",
]


def _model():
    try:
        from ml.online import model as M
        return M.load()
    except Exception as e:  # no packages, or no trained version yet
        log.info("fraud model unavailable, using the browser's Gus: %s", e)
        return None


def judge(record: OnlineRecord, gus: GusVerdict | None) -> dict:
    """Per order: declined or not, why, and the score. A flagged order blocks the card for the rest."""
    v = _model()
    if v is None:
        caught = bool(gus and gus.caught)
        tells = [[str(t[0]), float(t[1]) if len(t) > 1 else 1.0] for t in (gus.tells if gus else []) if t]
        return {"caught": caught, "results": None, "tells": tells, "version": 0, "source": "browser",
                "payout": int(gus.payout if gus else 0)}
    import pandas as pd
    rows = pd.DataFrame(record.rows)
    scores, why = v.scores(rows), v.explain(rows)
    cut = v.game_threshold(getattr(record, "rank", None))
    values = list(gus.values) if gus and gus.values else []
    results, stopped, payout = [], False, 0.0
    for i, (s, t) in enumerate(zip(scores, why)):
        flagged = bool(not stopped and float(s) >= cut)
        results.append({"declined": stopped or flagged, "reason": "flagged" if flagged else "card_blocked" if stopped else None,
                        "score": round(float(s), 4), "tells": t})
        if not (stopped or flagged) and i < len(values):
            payout += values[i]
        stopped = stopped or flagged
    caught = any(r["reason"] == "flagged" for r in results)
    flagged_tells = [t for r in results if r["reason"] == "flagged" for t in r["tells"]]
    tells = sorted(flagged_tells or [t for r in results for t in r["tells"]], key=lambda t: -t[1])
    return {"caught": caught, "results": results, "tells": tells, "version": v.version, "source": "model", "payout": int(payout)}


def save_rows(record: OnlineRecord, verdict: dict, round_id: str, player: str | None) -> int:
    """Append the record's rows to the CSV (434 dataset columns, then the game's). Returns how many got through."""
    rows = []
    for i, row in enumerate(record.rows):
        row = dict(row)
        row.setdefault("session_id", round_id)
        r = verdict["results"][i] if verdict["results"] else None
        declined = r["declined"] if r else verdict["caught"]
        row["isFraud"] = 1  # every player order is fraud; legit rows come from the real dataset
        row["verdict"] = ("BLOCKED" if r and r["reason"] == "card_blocked" else "DECLINED") if declined else "APPROVED"
        if r:
            row["score"] = r["score"]
        row["top_reasons"] = "|".join(str(t[0]) for t in (r["tells"] if r else verdict["tells"])[:3])
        row["detector_version"] = verdict["version"] or row.get("detector_version")
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
    return sum(r["verdict"] == "APPROVED" for r in rows)


def _maybe_retrain(evasions: int) -> None:
    """Gus learns from players' wins: a background retrain every RETRAIN_EVERY orders that got through."""
    with _lock:
        _retrain["evasions"] += evasions
        if _retrain["running"] or _retrain["evasions"] < RETRAIN_EVERY:
            return
        _retrain.update(running=True, evasions=0)

    def run():
        try:
            from ml.online.retrain import retrain
            log.info("retrain finished: %s", retrain())
        except Exception:
            log.exception("retrain failed")
        finally:
            _retrain["running"] = False
    threading.Thread(target=run, daemon=True).start()


def submit_online(record: OnlineRecord, gus: GusVerdict | None, round_id: str, player: str | None) -> SubmitResponse:
    verdict = judge(record, gus)
    evasions = save_rows(record, verdict, round_id, player)
    if verdict["source"] == "model":
        _maybe_retrain(evasions)
    return SubmitResponse(
        verdict="DECLINED" if verdict["caught"] else "APPROVED",
        top_tells=[Tell(tell_type=str(t[0]), strength=float(t[1])) for t in verdict["tells"][:3]],
        inspector_line="",  # the game writes Gus's line from the top tell
        payout=verdict["payout"],
        new_version=verdict["version"],
        results=verdict["results"],
    )
