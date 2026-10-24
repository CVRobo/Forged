"""Does the CRS identity check help? The same retrain, with and without the two CRS inputs.

    python -m ml.online.crs_ablation [players.jsonl]

Both models train on identical rows and weights (v2's blind spots up-weighted, like retrain.py),
are calibrated the same way, and are tested on held-out player sessions, split by victim: the
ones whose identity checks out with CRS and the ghosts (deceased, synthetic, someone else's SSN).
Nothing is saved.
"""
from __future__ import annotations

import json
import sys

import numpy as np
import pandas as pd

from ml.online import features as F
from ml.online import game_rows as G
from ml.online import model as M
from ml.online import retrain as R
from ml.online import train as T

GHOSTS = {"P12", "P13", "P14"}
STEP_UP = {"P16"}


def run(players: pd.DataFrame, parent: int = 2) -> dict:
    players = players.copy()
    players["isFraud"] = 1
    p, b, live = G.split(players), T.base(), M.load(parent)
    tr = R._capped(p["train"])
    got_through = live.scores(tr) < live.threshold
    train = pd.concat([b["train"][k] for k in ("real", "honest", "sim")] + [tr], ignore_index=True)
    w = T.weights(b["train"], extra=len(tr))
    w[len(train) - len(tr):] = np.where(got_through, R.EVASION_WEIGHT, 1.0)
    held = pd.concat([p["val"], p["test"]], ignore_index=True)
    groups = {"clean victims": ~held["crs_id"].isin(GHOSTS | STEP_UP), "fraud alert": held["crs_id"].isin(STEP_UP),
              "ghost identities": held["crs_id"].isin(GHOSTS)}
    out = {}
    for name, feats in (("without CRS", F.LEGACY_FEATURES), ("with CRS", F.FEATURES)):
        x = F.frame(train, feats)
        voc = {**F.vocab(x[train["origin"].eq("real")]), **live.vocab}
        mdl = M.lgb.LGBMClassifier(**M.PARAMS).fit(F.encode(x, voc), train["isFraud"].astype(int), sample_weight=w)
        v = M.Version(0, mdl, voc, 0.0, features=list(feats))
        T.calibrate(v, b["val"])
        m = T.evaluate(v, b["test"], held)
        caught = v.scores(held) >= v.threshold
        m |= {f"catch: {g}": round(float(caught[mask.to_numpy()].mean()), 4) for g, mask in groups.items()}
        m["identity_attention"] = round(float(v.attention().get("identity", 0.0)), 4)
        out[name] = m
    out["held_orders"] = {g: int(mask.sum()) for g, mask in groups.items()}
    return out


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "ml/online/data/clever_600_23.jsonl"
    print(json.dumps(run(R._read(path)), indent=1))
