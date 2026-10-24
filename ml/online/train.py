"""Train and save v1: real transactions plus the game's simulated shoppers.

    python -m ml.online.train

v1 sees three kinds of rows:
  - real IEEE-CIS transactions (honest and fraud), the ground truth about the world;
  - simulated honest shoppers in the game's format, so "looks like the game" isn't a fraud signal;
  - simulated attackers in the game's format (scripted, like B's attackers), so v1 already
    knows the obvious tricks before any human plays.
Humans then teach it the rest (retrain.py).
"""
from __future__ import annotations

import shutil
import time

import numpy as np
import pandas as pd

from ml.online import features as F
from ml.online import game_rows as G
from ml.online import model as M

SIM = {"players": (1200, 7), "honest": (3000, 11)}
GAME_FRAUD_SHARE = 0.08  # the simulated attacks weigh as much as 8 % fraud among game-format orders, like the real online segment


def can_retrain() -> tuple[bool, str]:
    """Whether this machine has what training needs, and if not, what's missing: the Kaggle
    files (or their cache) and Node for the simulated shoppers (or theirs)."""
    real = (F.DATA_DIR / "real_identity.pkl").exists() or all(
        (F.DATA_DIR / f).exists() for f in ("train_transaction.csv", "train_identity.csv"))
    if not real:
        if any((F.DATA_DIR / f).exists() for f in ("test_transaction.csv", "test_identity.csv")):
            return False, ("ml/online/data/ has Kaggle's test files, which have no isFraud labels; training needs the "
                           "labeled train files (train_transaction.csv, train_identity.csv)")
        return False, "the Kaggle files (train_transaction.csv, train_identity.csv) aren't in ml/online/data/"
    simulated = all((F.DATA_DIR / f"simulated_{kind}_{n}_{seed}.jsonl").exists() for kind, (n, seed) in SIM.items())
    if not simulated and shutil.which("node") is None:
        return False, "Node isn't installed (the simulated shoppers come from the game's own code)"
    return True, ""


def base() -> dict[str, pd.DataFrame]:
    """The rows every version trains on, already split: {"train"|"val"|"test": {"real"|"honest"|"sim": df}}."""
    real = F.load_real()
    r_train, r_val, r_test = M.splits(real)
    honest = G.split(G.simulated("honest", *SIM["honest"]))
    sim = G.split(G.simulated("players", *SIM["players"]))
    return {k: {"real": r, "honest": honest[k], "sim": sim[k]}
            for k, r in (("train", r_train), ("val", r_val), ("test", r_test))}


def weights(train: dict[str, pd.DataFrame], extra: int = 0) -> np.ndarray:
    """Real and honest rows weigh 1; the simulated attacks together weigh GAME_FRAUD_SHARE of the game-format rows.
    `extra` trailing rows (player orders) get 1 here; retrain.py sets their weights."""
    n_h, n_s = len(train["honest"]), len(train["sim"])
    sim_w = GAME_FRAUD_SHARE * n_h / max(1, (1 - GAME_FRAUD_SHARE) * n_s)
    return np.concatenate([np.ones(len(train["real"]) + n_h), np.full(n_s, sim_w), np.ones(extra)])


def calibrate(v: M.Version, val: dict[str, pd.DataFrame]) -> None:
    """The threshold where TARGET_FPR of honest customers get blocked, real and game-format alike,
    and each rank's game threshold (never below it)."""
    legit = pd.concat([val["real"][val["real"]["isFraud"] == 0], val["honest"]], ignore_index=True)
    v.threshold = M.threshold_at(v.scores(legit))
    v.rank_thresholds = {r: max(v.threshold, cut) for r, cut in M.RANK_CUTOFF.items()}


def evaluate(v: M.Version, test: dict[str, pd.DataFrame], players: pd.DataFrame | None = None) -> dict:
    out = M.metrics(v, test["real"])
    out["game_fpr"] = round(float((v.scores(test["honest"]) >= v.threshold).mean()), 4)
    out["sim_catch"] = round(float((v.scores(test["sim"]) >= v.threshold).mean()), 4)
    if players is not None and len(players):
        out["player_catch"] = round(float((v.scores(players) >= v.threshold).mean()), 4)
    return out


def train_v1() -> M.Version:
    t0 = time.time()
    b = base()
    train = pd.concat([b["train"][k] for k in ("real", "honest", "sim")], ignore_index=True)
    mdl, voc = M.fit(train, weights(b["train"]))
    v = M.Version(1, mdl, voc, 0.0)
    calibrate(v, b["val"])
    v.meta = {"trained_on": {k: len(df) for k, df in b["train"].items()} | {"player": 0},
              "test": evaluate(v, b["test"]), "learned": [], "note": "v1: real transactions and simulated shoppers"}
    M.save(v, promoted=True)
    t = v.meta["test"]
    print(f"v1 trained on {len(train):,} rows in {time.time() - t0:.0f} s, threshold {v.threshold:.3f}")
    print(f"  real test: catches {t['recall']:.1%} of fraud, blocks {t['fpr']:.1%} of honest customers")
    print(f"  game format: blocks {t['game_fpr']:.1%} of honest shoppers, catches {t['sim_catch']:.1%} of simulated attacks")
    return v


if __name__ == "__main__":
    train_v1()
