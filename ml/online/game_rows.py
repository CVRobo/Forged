"""Rows in the game's format: simulated (simulate.js) and real player orders (the server's CSV).

Game rows are split by session, so one player's or customer's orders never land in both
training and test (70 % train, 15 % validation, 15 % test).
"""
from __future__ import annotations

import hashlib
import os
import subprocess
from pathlib import Path

import pandas as pd

from ml.online.features import DATA_DIR

ROOT = Path(__file__).resolve().parents[2]
PLAYER_CSV = Path(os.environ.get("FORGED_DATA_DIR", ROOT / "server" / "data")) / "ieee_rows.csv"


def simulated(kind: str, sessions: int, seed: int) -> pd.DataFrame:
    """kind "players" (attacks) or "honest" (the cardholders themselves). Generated once, then cached."""
    path = DATA_DIR / f"simulated_{kind}_{sessions}_{seed}.jsonl"
    if not path.exists():
        rows = subprocess.run(["node", str(Path(__file__).with_name("simulate.js")), str(sessions), str(seed), kind],
                              capture_output=True, text=True, check=True).stdout
        path.write_text(rows, encoding="utf-8")
    return pd.read_json(path, lines=True)


def players(path: Path = PLAYER_CSV) -> pd.DataFrame:
    """Every order real players sent (all fraud by construction)."""
    if not path.exists() or path.stat().st_size == 0:
        return pd.DataFrame()
    df = pd.read_csv(path, low_memory=False)
    df["isFraud"] = 1
    df["origin"] = "player"
    return df


def part(session_id) -> str:
    h = int(hashlib.md5(str(session_id).encode()).hexdigest()[:8], 16) % 100
    return "train" if h < 70 else "val" if h < 85 else "test"


def split(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    if df.empty:
        return {k: df for k in ("train", "val", "test")}
    p = df["session_id"].map(part)
    return {k: df[p == k] for k in ("train", "val", "test")}
