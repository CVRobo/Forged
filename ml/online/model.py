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
import numpy as np
import pandas as pd

from ml.online import features as F
from ml.online.lgbm import load_lightgbm

lgb = load_lightgbm()  # also on Macs without Homebrew's libomp (see lgbm.py)

MODEL_DIR = Path(__file__).resolve().parent / "models"
TARGET_FPR = 0.03  # share of honest customers a version may block: the real-world standard, used in reports and the gate
# in the game, Gus is more lenient at low ranks: he only blocks orders he's at least this sure are fraud
# (Mastermind faces the real-shop threshold). As versions learn from wins, the same tricks score higher.
RANK_CUTOFF = {1: 0.9, 2: 0.8, 3: 0.65, 4: 0.5, 5: 0.0}
PARAMS = dict(n_estimators=500, learning_rate=0.04, num_leaves=63, min_child_samples=40, subsample=0.8, subsample_freq=1,
              colsample_bytree=0.8, reg_lambda=1.0, verbose=-1, random_state=0)

# the tell family each feature belongs to, for the patch notes (retrain.learned groups the model's
# attention by it); an order's own reasons go through tell_for, which reads the order's values
TELL_OF = {
    "TransactionAmt": "amount_unusual", "hour": "night", "dist1": "far_ship", "dist2": "ip_far",
    "C1": "new_card", "C6": "velocity", "C2": "new_address", "C14": "new_address", "D15": "new_address",
    "C11": "device_reuse", "C13": "new_account", "D4": "new_account", "D1": "new_card", "D3": "velocity",
    "D10": "new_device", "ProductCD": "gift_card", "card4": "new_card", "card6": "new_card",
    "P_email": "email_risky", "R_email": "email_risky", "M4": "foreign_card", "M5": "new_address", "M6": "new_address",
    "id_12": "new_device", "id_16": "new_device", "proxy": "proxy", "os": "new_device", "browser": "new_device",
    "DeviceType": "new_device", "device": "new_device",
}

# the lines tell_for draws, in the game's terms
FAR_SHIP_MILES = 100   # a drop farther than this was shipped far; a nearer one is a new address
FAR_IP_MILES = 300     # shopping this far from the billing address (the scripted Gus's ip_far line)
BIG_AMOUNT = 250       # more than people usually spend at the game's shops
NEW_DAYS = 30          # a card, account, device or address younger than this is new
NIGHT_END = 6          # midnight to 6 AM
COMMON_EMAIL = {"gmail", "yahoo", "hotmail", "outlook", "aol", "icloud", "comcast", "live", "msn", "att",
                "verizon.net", "sbcglobal.net", "me.com", "mac.com", "ymail.com", "bellsouth.net", "cox.net",
                "optonline.net", "charter.net", "earthlink.net"}


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")


def _str(v) -> str | None:
    return None if v is None or pd.isna(v) else str(v)


def _away(x: pd.Series) -> bool:
    """Goods shipped somewhere other than the billing address (M5)."""
    return _str(x.get("M5")) == "T"


def _burst(x: pd.Series) -> bool:
    """More than one order on this card today (C6)."""
    return _num(x.get("C6")) >= 2


def _email(v, x) -> str | None:
    v = _str(v)
    return None if v is None else "email_risky" if v == "anonymous" else None if v in COMMON_EMAIL else "odd_domain"


def _device(v, x) -> str | None:
    if bool(F.is_emulator(x.to_frame().T).iloc[0]):
        return "emulator"
    return "new_device" if _num(x.get("D10")) < NEW_DAYS else None


_RULES = {
    "TransactionAmt": lambda v, x: "amount_unusual" if _num(v) >= BIG_AMOUNT else None,
    "hour": lambda v, x: "night" if _num(v) < NIGHT_END else None,
    "dist1": lambda v, x: "far_ship" if _num(v) >= FAR_SHIP_MILES else "new_address" if _num(v) > 0 else None,
    "dist2": lambda v, x: "ip_far" if _num(v) >= FAR_IP_MILES else None,
    # C1 counts the card's orders ever: a burst today, a brand-new card, or an old card shipping somewhere new
    "C1": lambda v, x: "velocity" if _burst(x) else "new_card" if _num(v) <= 2 else "new_address" if _away(x) else None,
    "C2": lambda v, x: "new_address" if _away(x) else None,
    "C6": lambda v, x: "velocity" if _burst(x) else None,
    "C11": lambda v, x: "device_reuse" if _num(v) >= 2 else None,
    "C13": lambda v, x: "new_account" if _num(v) <= 1 else None,
    "C14": lambda v, x: "new_address" if _away(x) else None,
    "D1": lambda v, x: "new_card" if _num(v) < NEW_DAYS else None,
    "D3": lambda v, x: "velocity" if _num(v) < 1 else None,
    "D4": lambda v, x: "new_account" if _num(v) < NEW_DAYS else None,
    "D10": lambda v, x: "new_device" if _num(v) < NEW_DAYS else None,
    "D15": lambda v, x: "new_address" if _away(x) and _num(v) < NEW_DAYS else None,
    "ProductCD": lambda v, x: "gift_card" if _str(v) == "C" else None,
    "P_email": _email,
    "R_email": _email,
    "M4": lambda v, x: {"M2": "foreign_card", "M1": "ip_far"}.get(_str(v)),
    "M5": lambda v, x: "new_address" if _away(x) else None,
    "M6": lambda v, x: "new_address" if _str(v) == "F" and _away(x) else None,
    "id_12": lambda v, x: "new_device" if _str(v) == "NotFound" else None,
    "id_16": lambda v, x: "new_device" if _str(v) in ("NotFound", "New") else None,
    "proxy": lambda v, x: "proxy" if _str(v) else None,
    "os": _device, "browser": _device, "DeviceType": _device, "device": _device,
}
TELLS = {"amount_unusual", "night", "far_ship", "new_address", "ip_far", "velocity", "new_card", "device_reuse",
         "new_account", "new_device", "gift_card", "email_risky", "odd_domain", "foreign_card", "proxy", "emulator"}


def tell_for(feature: str, x: pd.Series) -> str | None:
    """The game tell a feature's contribution speaks for, given the order's values (one framed row).
    None when the value shows nothing a player would recognize: a long card history, a common email,
    the card's brand."""
    rule = _RULES.get(feature)
    return rule(x.get(feature), x) if rule else None


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
        """Each row's top tells: [[tell, weight], ...], weight in Gus's suspicion points (log-odds × 10).
        A feature's push toward fraud counts for the tell its value shows (tell_for), or for none."""
        raw = F.frame(rows)
        x = F.encode(raw, self.vocab)
        contrib = self.model.predict(x, pred_contrib=True)[:, :-1]  # last column is the bias
        out = []
        for i in range(len(x)):
            row, per = raw.iloc[i], {}
            for name, c in zip(F.FEATURES, contrib[i]):
                tell = tell_for(name, row) if c > 0 else None
                if tell:
                    per[tell] = per.get(tell, 0.0) + float(c)
            out.append([[t, round(w * 10, 1)] for t, w in sorted(per.items(), key=lambda kv: -kv[1])[:k]])
        return out


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
