"""Gus's brain: a LightGBM model on the real dataset, saved as numbered versions.

v1 trains on real IEEE-CIS transactions only. Later versions add player orders (see
retrain.py). Every version keeps its threshold, set so that a fixed share of real,
honest customers would be blocked (TARGET_FPR): a model that blocks everyone would
catch every fraud and ruin a real shop.

Splits are by time, like the real problem: train on the first 70 % of the dataset's
days, set the threshold on the next 15 % (validation), report on the last 15 % (test).
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd

from ml.online import features as F

MODEL_DIR = Path(__file__).resolve().parent / "models"
TARGET_FPR = 0.03  # share of honest customers a version may block: the real-world standard, used in reports and the gate
# in the game, Gus is more lenient at low ranks: he only blocks orders he's at least this sure are fraud
# (Mastermind faces the real-shop threshold). As versions learn from wins, the same tricks score higher.
RANK_CUTOFF = {1: 0.9, 2: 0.8, 3: 0.65, 4: 0.5, 5: 0.0}
PARAMS = dict(n_estimators=500, learning_rate=0.04, num_leaves=63, min_child_samples=40, subsample=0.8, subsample_freq=1,
              colsample_bytree=0.8, reg_lambda=1.0, verbose=-1, random_state=0)

# which game tell each feature speaks for (the game's TELL_LABELS turn them into Gus's words)
TELL_OF = {
    "TransactionAmt": "amount_unusual", "hour": "night", "dist1": "far_ship", "dist2": "ip_far",
    "C1": "velocity", "C6": "velocity", "C2": "new_address", "C14": "new_address", "D15": "new_address",
    "C11": "device_reuse", "C13": "email_risky", "D4": "email_risky", "D1": "new_card", "D3": "velocity",
    "D10": "new_device", "ProductCD": "gift_card", "card4": "new_card", "card6": "new_card",
    "P_email": "email_risky", "R_email": "email_risky", "M4": "foreign_card", "M5": "far_ship", "M6": "new_address",
    "id_12": "new_device", "id_16": "new_device", "proxy": "proxy", "os": "new_device", "browser": "new_device",
    "DeviceType": "new_device", "device": "new_device",
}


@dataclass
class Version:
    version: int
    model: lgb.LGBMClassifier
    vocab: dict
    threshold: float
    meta: dict = field(default_factory=dict)
    rank_thresholds: dict = field(default_factory=dict)  # {rank: threshold}, see RANK_CUTOFF

    def game_threshold(self, rank: int | None) -> float:
        return self.rank_thresholds.get(int(rank or 1), self.threshold)

    def scores(self, rows: pd.DataFrame) -> np.ndarray:
        return self.model.predict_proba(F.encode(F.frame(rows), self.vocab))[:, 1]

    def explain(self, rows: pd.DataFrame, k: int = 3) -> list[list[list]]:
        """Each row's top tells: [[tell, weight], ...], weight in Gus's suspicion points (log-odds × 10)."""
        x = F.encode(F.frame(rows), self.vocab)
        contrib = self.model.predict(x, pred_contrib=True)[:, :-1]  # last column is the bias
        raw = F.frame(rows)
        out = []
        for i in range(len(x)):
            per = {}
            for name, c in zip(F.FEATURES, contrib[i]):
                if c > 0:
                    tell = TELL_OF.get(name, name)
                    if tell == "new_device" and _emulator(raw.iloc[i]):
                        tell = "emulator"
                    per[tell] = per.get(tell, 0.0) + float(c)
            out.append([[t, round(w * 10, 1)] for t, w in sorted(per.items(), key=lambda kv: -kv[1])[:k]])
        return out


def _emulator(r) -> bool:
    # what the game's emulator looks like: a "mobile" with a desktop Firefox build string on Linux
    return r.get("DeviceType") == "mobile" and (r.get("device") in ("firefox", "linux", "emulator") or r.get("os") == "linux")


def splits(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Time split of the real data: 70 % train, 15 % validation, 15 % test."""
    a, b = int(len(df) * 0.70), int(len(df) * 0.85)
    return df.iloc[:a], df.iloc[a:b], df.iloc[b:]


def fit(train: pd.DataFrame, weights: np.ndarray | None = None, voc: dict | None = None) -> tuple[lgb.LGBMClassifier, dict]:
    x = F.frame(train)
    voc = voc or F.vocab(x[train["origin"].eq("real")] if "origin" in train else x)
    model = lgb.LGBMClassifier(**PARAMS)
    model.fit(F.encode(x, voc), train["isFraud"].astype(int), sample_weight=weights)
    return model, voc


def threshold_at(scores_legit: np.ndarray, fpr: float = TARGET_FPR) -> float:
    return float(np.quantile(scores_legit, 1 - fpr))


def metrics(v: Version, real: pd.DataFrame, player: pd.DataFrame | None = None) -> dict:
    s = v.scores(real)
    y = real["isFraud"].to_numpy().astype(bool)
    m = {"recall": float((s[y] >= v.threshold).mean()), "fpr": float((s[~y] >= v.threshold).mean())}
    if player is not None and len(player):
        m["player_catch"] = float((v.scores(player) >= v.threshold).mean())
    return {k: round(val, 4) for k, val in m.items()}


# ---------------- saved versions ----------------

def registry() -> list[dict]:
    p = MODEL_DIR / "versions.json"
    return json.loads(p.read_text()) if p.exists() else []


def current() -> int | None:
    live = [r["version"] for r in registry() if r.get("promoted")]
    return max(live) if live else None


def save(v: Version, promoted: bool) -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": v.model, "vocab": v.vocab, "threshold": v.threshold, "rank_thresholds": v.rank_thresholds},
                MODEL_DIR / f"v{v.version}.joblib")
    reg = [r for r in registry() if r["version"] != v.version]
    reg.append({"version": v.version, "promoted": promoted, "created_at": time.time(), "threshold": v.threshold, **v.meta})
    (MODEL_DIR / "versions.json").write_text(json.dumps(sorted(reg, key=lambda r: r["version"]), indent=2))
    _cache.pop(v.version, None)


_cache: dict[int, Version] = {}


def load(version: int | None = None) -> Version:
    version = version or current()
    if version is None:
        raise FileNotFoundError("no trained version yet: run python -m ml.online.train")
    if version not in _cache:
        d = joblib.load(MODEL_DIR / f"v{version}.joblib")
        meta = next((r for r in registry() if r["version"] == version), {})
        _cache[version] = Version(version, d["model"], d["vocab"], d["threshold"], meta, d.get("rank_thresholds", {}))
    return _cache[version]
