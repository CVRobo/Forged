"""Learn from the players: retrain on their orders, promote only if the new version is better.

    python -m ml.online.retrain [--force] [--players path.csv|.jsonl]

Every player order is fraud by construction, so the labels are free and can't be poisoned
into "this is fine". The orders that got through (APPROVED) are the model's blind spots and
weigh EVASION_WEIGHT times more. One player can't own a retrain (PLAYER_CAP rows each).

The gate, on data no version trained on:
  1. real fraud: recall no more than RECALL_SLACK below the live version;
  2. real honest customers: blocked share no more than FPR_LIMIT;
  3. game-format honest shoppers: blocked share no more than GAME_FPR_LIMIT;
  4. held-out player orders (at least MIN_HELD of them): catches more of them than the live version.
A version that fails is saved (promoted: false) for the record, and the live one stays.
"""
from __future__ import annotations

import argparse
import time

import numpy as np
import pandas as pd

from ml.online import features as F
from ml.online import game_rows as G
from ml.online import model as M
from ml.online import train as T

EVASION_WEIGHT = 3.0
PLAYER_CAP = 300
RECALL_FLOOR_DROP = 0.05  # no version may catch more than this fraction below v1's real-fraud recall
RECALL_SLACK = 0.02       # fallback when v1's recall isn't on record
FPR_LIMIT = M.TARGET_FPR + 0.01
GAME_FPR_LIMIT = M.TARGET_FPR + 0.02
MIN_HELD = 30  # held-out player orders needed to show a new version is better


def _recall_floor(parent_recall: float) -> float:
    """An absolute real-fraud-recall floor anchored to v1, so the floor can't ratchet down.

    Each promotion makes `new` the next live version, so gating only against the immediate parent
    let real-fraud recall drift down ~RECALL_SLACK every promotion. Anchoring to v1's recall keeps
    a fixed floor no matter how many times the model is retrained on players.

    Note: `held` player orders are split by session, not by player identity, so a returning player
    can appear in both train and held — the player_catch check is session-level, mildly optimistic.
    """
    v1 = next((r for r in M.registry() if r.get("version") == 1), None)
    base = (v1 or {}).get("test", {}).get("recall")
    return base * (1 - RECALL_FLOOR_DROP) if base else parent_recall - RECALL_SLACK


def _capped(df: pd.DataFrame) -> pd.DataFrame:
    """At most PLAYER_CAP rows per player, the most recent ones."""
    if df.empty or "player" not in df:
        return df
    return df.groupby(df["player"].fillna(""), group_keys=False).tail(PLAYER_CAP)


def learned(old: M.Version, new: M.Version) -> list[str]:
    """The tells whose share of the model's attention grew most: the patch notes."""
    def share(v):
        g = pd.Series(v.model.booster_.feature_importance("gain"), index=F.FEATURES)
        g = g.groupby(g.index.map(lambda f: M.TELL_OF.get(f, f))).sum()
        return g / g.sum()
    d = (share(new) - share(old)).sort_values(ascending=False)
    return [t for t, x in d.items() if x > 0.005][:3]


def retrain(players: pd.DataFrame | None = None, force: bool = False) -> dict:
    t0 = time.time()
    live = M.load()
    players = G.players() if players is None else players
    if players.empty:
        return {"promoted": False, "reason": "no player orders yet", "version": live.version}
    players = players.copy()
    players["isFraud"] = 1
    p = G.split(players)
    b = T.base()

    # the blind spots: the orders that actually got past Gus in the game (verdict APPROVED).
    # Only these get the evasion up-weight — scoring against the strict real-shop line instead
    # flagged almost every order and dragged real-fraud recall down over successive retrains.
    tr = _capped(p["train"])
    if "verdict" in tr:
        got_through = tr["verdict"].eq("APPROVED")
    else:  # no recorded verdict (e.g. a raw import): fall back to the live model's own call
        got_through = pd.Series(live.scores(tr) < live.threshold, index=tr.index) if len(tr) else pd.Series([], dtype=bool)
    train = pd.concat([b["train"][k] for k in ("real", "honest", "sim")] + [tr], ignore_index=True)
    w = T.weights(b["train"], extra=len(tr))
    w[len(train) - len(tr):] = np.where(got_through.to_numpy(), EVASION_WEIGHT, 1.0)

    mdl, _ = M.fit(train, w, voc=live.vocab)  # the same vocabulary, so versions score alike
    new = M.Version((max(r["version"] for r in M.registry()) + 1), mdl, live.vocab, 0.0)
    T.calibrate(new, b["val"])

    held = pd.concat([p["val"], p["test"]], ignore_index=True)  # held-out player sessions (see note on _recall_floor)
    old_m, new_m = T.evaluate(live, b["test"], held), T.evaluate(new, b["test"], held)
    floor = _recall_floor(old_m["recall"])
    checks = {
        "real_recall": new_m["recall"] >= floor,
        "real_fpr": new_m["fpr"] <= FPR_LIMIT,
        "game_fpr": new_m["game_fpr"] <= GAME_FPR_LIMIT,
        "player_catch": len(held) >= MIN_HELD and new_m.get("player_catch", 0) > old_m.get("player_catch", 0),
    }
    promoted = force or all(checks.values())
    new.meta = {"parent": live.version, "trained_on": {k: len(df) for k, df in b["train"].items()} | {"player": len(tr)},
                "evasions": int(got_through.sum()), "test": new_m, "parent_test": old_m, "checks": checks,
                "forced": force and not all(checks.values()), "learned": learned(live, new),
                "note": f"retrained on {len(tr)} player orders ({int(got_through.sum())} got through)"}
    M.save(new, promoted)
    return {"version": new.version, "promoted": promoted, "checks": checks, "before": old_m, "after": new_m,
            "learned": new.meta["learned"], "seconds": round(time.time() - t0, 1)}


def _read(path: str) -> pd.DataFrame:
    df = pd.read_json(path, lines=True) if path.endswith(".jsonl") else pd.read_csv(path, low_memory=False)
    return df.assign(origin="player")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--players", help="player orders to learn from (default: the server's CSV)")
    a = ap.parse_args()
    r = retrain(_read(a.players) if a.players else None, a.force)
    print(r)
