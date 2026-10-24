"""Typed-checkout submissions: keep the IEEE-CIS rows and answer with the browser's Gus.

Every order a player sends becomes one row in server/data/ieee_rows.csv (or FORGED_DATA_DIR),
with the dataset's columns plus the game's own (session_id, verdict, score, ...). The
verdict comes from the scripted Gus in the browser for now, so the game plays the same
online and offline; a model trained on these rows can replace it here later.
"""

from __future__ import annotations

import csv
import os
import threading
from pathlib import Path

from server.models.schemas import OnlineRecord, GusVerdict, SubmitResponse, Tell

DATA_DIR = Path(os.environ.get("FORGED_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
ROWS_CSV = DATA_DIR / "ieee_rows.csv"
_lock = threading.Lock()

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
    caught = bool(verdict and verdict.caught)
    tells = [Tell(tell_type=str(t[0]), strength=float(t[1]) if len(t) > 1 else 1.0)
             for t in (verdict.tells if verdict else []) if t]
    return SubmitResponse(
        verdict="DECLINED" if caught else "APPROVED",
        top_tells=tells[:3],
        inspector_line="",  # the game writes Gus's line from the top tell
        payout=0 if caught else int(verdict.payout if verdict else 0),
        new_version=0,  # Gus's version lives in the browser (he learns from wins there)
    )
