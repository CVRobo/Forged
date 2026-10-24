"""Day-by-day evaluation, the way fraud teams measure in production.

    python -m ml.online.evaluate [--alerts 100]

Fraud is confirmed late, so a model is judged on days it never trained on, one day at a time.
Analysts can only review so many alerts a day, so the headline number is "of the ALERTS riskiest
orders each day, how many were really fraud" (precision@k) and "what share of the day's fraud
that caught" (recall@k). This is the Fraud Detection Handbook's measure, and it's what a shop
cares about: not a percentage on paper, but fraud caught per 100 reviews.

Every promoted version is scored on the same days, so you can see whether learning from
players kept the model working on real transactions it never saw.
"""
from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from ml.online import features as F
from ml.online import model as M

ALERTS_PER_DAY = 100


def by_day(v: M.Version, test: pd.DataFrame, alerts: int = ALERTS_PER_DAY) -> pd.DataFrame:
    """For each day: the day's fraud, and how much of it the top `alerts` scored orders catch."""
    df = pd.DataFrame({"day": (test["TransactionDT"] // 86400).to_numpy(),
                       "fraud": test["isFraud"].to_numpy().astype(bool), "score": v.scores(test)})
    rows = []
    for day, g in df.groupby("day"):
        top = g.nlargest(min(alerts, len(g)), "score")
        caught = int(top["fraud"].sum())
        rows.append({"day": int(day), "orders": len(g), "fraud": int(g["fraud"].sum()), "alerts": len(top),
                     "caught": caught, "precision": caught / len(top), "recall": caught / max(1, int(g["fraud"].sum()))})
    return pd.DataFrame(rows)


def evaluate(alerts: int = ALERTS_PER_DAY, promoted_only: bool = False) -> dict:
    real = F.load_real()
    _, _, test = M.splits(real)
    reg = {r["version"]: r for r in M.registry()}
    versions = [v for v, r in reg.items() if r.get("promoted") or not promoted_only]
    series = {}
    for v in sorted(versions):
        d = by_day(M.load(v), test, alerts)
        series[v] = {"promoted": bool(reg[v].get("promoted")), "days": d["day"].tolist(),
                     "precision": d["precision"].round(4).tolist(), "recall": d["recall"].round(4).tolist(),
                     "mean_precision": round(float(d["precision"].mean()), 4),
                     "mean_recall": round(float(d["recall"].mean()), 4),
                     "fraud_caught": int(d["caught"].sum()), "fraud_total": int(d["fraud"].sum())}
    first = next(iter(series.values()), None)
    return {"alerts_per_day": alerts, "test_days": len(first["days"]) if first else 0, "by_version": series}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--alerts", type=int, default=ALERTS_PER_DAY)
    a = ap.parse_args()
    r = evaluate(a.alerts)
    print(f"Real fraud, {r['test_days']} unseen days, {r['alerts_per_day']} alerts reviewed per day:\n")
    print(f"{'version':>8} {'fraud found / 100 alerts':>26} {'of the day’s fraud':>20} {'fraud caught':>14}")
    for v, s in r["by_version"].items():
        print(f"{'v' + str(v):>8} {s['mean_precision'] * r['alerts_per_day']:>25.1f} {s['mean_recall']:>19.0%} "
              f"{s['fraud_caught']:>7}/{s['fraud_total']}")
