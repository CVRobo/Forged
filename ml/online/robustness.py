"""Red-team Gus to harden him: search the game's own answers for orders he misses, then retrain.

    python -m ml.online.robustness audit   [--rank 5] [--version N]
    python -m ml.online.robustness harden  [--rank 5]

This is an adversarial-robustness check on the project's OWN fraud model, the standard way to
stress-test a detector (cf. IBM's ART). It only ever searches the game's checkout answers
(item, who, device, where, delivery, timing) for the victims the game deals, converts them to
rows with the game's own code (rows.js), and scores them with the model. Everything it surfaces
is a trick the human-player path already produces and report.py already names; nothing here is a
real-world fraud recipe. Its purpose is the harden step: feed the weak spots back and retrain,
so Gus catches them next time. A hardened version still goes through retrain.py's gate, so it
only ships if it stays fair to honest customers.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd

from ml.online import model as M
from ml.online import report as R

ROWS_JS = Path(__file__).with_name("rows.js")
# (cardholder index, stolen card index) — the victims the game deals (prototype/orders.js)
VICTIMS = [(0, 1), (1, 0), (2, 2), (3, 1), (4, 0)]
RESTARTS = 3
PASSES = 3

# the checkout answers a player can type, by question; filled per victim in `_concrete`
OPTIONS = {
    "item": ["Coffee beans", "Espresso machine", "Vitamins 90 days", "PS5", "iPhone 15", "Gaming laptop", "$50 gift card", "$200 gift card"],
    "name": ["{name}", "{initial}"],
    "email": ["{email}", "{first}.{last}@gmail.com", "{last}.family@outlook.com"],
    "device": ["{usual}", "Windows laptop", "MacBook Air", "iPad tablet"],
    "where": ["{city}", "VPN in {city}", "{near}"],
    "ship": ["Their home", "PO box in {city}", "Cousin's garage in {city}", "Office in {city}", "Locker in {city}"],
    "when": ["Right now", "Tomorrow at lunch", "7pm", "Next week"],
    "repeat": ["1", "2"], "gap": ["3", "7"],
}
RANK_FIELDS = {1: ["item", "ship"], 2: ["name", "email"], 3: ["device", "where"], 4: ["when", "repeat", "gap"]}
HOLDERS = [("Pat Miller", "Columbus", "pat.miller@yahoo.com", "iphone"), ("Dee Alvarez", "Phoenix", "dee.alvarez@gmail.com", "iphone"),
           ("Sam Okoro", "Atlanta", "samokoro@hotmail.com", "android"), ("Lou Bennett", "Tampa", "lbennett@aol.com", "iphone"),
           ("Kim Tran", "Dallas", "kim.tran@comcast.net", "android")]
NEAR = {"Columbus": "Cincinnati", "Phoenix": "Tucson", "Atlanta": "Nashville", "Tampa": "Orlando", "Dallas": "Austin"}


def fields_for(rank: int) -> list[str]:
    return [f for r in range(1, rank + 1) for f in RANK_FIELDS.get(r, [])]


def _concrete(option: str, holder: int) -> str:
    name, city, email, phone = HOLDERS[holder]
    first, last = name.lower().split()
    return option.format(name=name, initial=f"{name[0]}. {last.title()}", email=email, first=first, last=last,
                         usual="iPhone 12" if phone == "iphone" else "Samsung Galaxy S9", city=city, near=NEAR[city])


def _score(candidates: list[dict], v: M.Version) -> pd.DataFrame:
    """candidates: [{holder, card, input, id}]. Returns one row per candidate (last order) with its model score."""
    payload = [{"holder": c["holder"], "card": c["card"], "input": c["input"], "session": c["id"]} for c in candidates]
    out = subprocess.run(["node", str(ROWS_JS)], input=json.dumps(payload), capture_output=True, text=True, check=True).stdout
    rows = pd.DataFrame(json.loads(l) for l in out.splitlines() if l)
    rows["score"] = v.scores(rows)
    # a campaign is caught on its first flagged order; the player keeps what cleared before that
    rows = rows.sort_values(["session_id", "step"])
    return rows


def hillclimb(v: M.Version, rank: int) -> tuple[list[dict], pd.DataFrame]:
    """Coordinate descent over the game's answers, per victim: lower Gus's score while the loot still reaches you.

    Returns the best order per victim, and every candidate scored along the way (the trajectory),
    so harden() can retrain on the whole set of weak spots the search exposed, not just the finals.
    """
    flds = fields_for(rank)
    found, trail = [], []
    for hi, ci in VICTIMS:
        best = None
        for r in range(RESTARTS):
            inp = {f: _concrete(np.random.choice(OPTIONS[f]), hi) for f in flds}
            for p in range(PASSES):
                for f in flds:
                    cands = []
                    for j, opt in enumerate(OPTIONS[f]):
                        trial = dict(inp, **{f: _concrete(opt, hi)})
                        cands.append({"holder": hi, "card": ci, "input": trial, "id": f"{hi}-{r}{p}-{f}-{j}", "_trial": trial})
                    rows = _score(cands, v)
                    trail.append(rows)
                    agg = rows.groupby("session_id").agg(score=("score", "max"), value=("value", "sum")).reset_index()
                    agg = agg[agg["value"] > 0]
                    if agg.empty:
                        continue
                    pick = agg.loc[agg["score"].idxmin(), "session_id"]
                    inp = next(c["_trial"] for c in cands if c["id"] == pick)
            final = _score([{"holder": hi, "card": ci, "input": inp, "id": f"final-{hi}-{r}"}], v)
            sc = float(final["score"].max())
            if best is None or sc < best["score"]:
                best = {"holder": hi, "card": ci, "input": inp, "score": sc, "rows": final}
        found.append(best)
    return found, pd.concat(trail, ignore_index=True)


def audit(v: M.Version | None = None, rank: int = 5) -> dict:
    v = v or M.load()
    cut = v.game_threshold(rank)
    found, trail = hillclimb(v, rank)
    rows = pd.concat([f["rows"] for f in found], ignore_index=True)  # the best order per victim
    trail = trail.drop_duplicates("session_id")
    rows["family"] = R.family(rows)
    trail["family"] = R.family(trail)
    by_fam = {}
    for fam, g in trail.groupby("family"):
        by_fam[fam] = {"tried": len(g), "evaded": int((g["score"] < cut).sum()), "min_score": round(float(g["score"].min()), 4)}
    return {"version": v.version, "rank": rank, "threshold": round(cut, 4), "victims": len(found),
            "evaded": int((rows["score"] < cut).sum()), "probed": len(trail),
            "worst": sorted(by_fam.items(), key=lambda kv: kv[1]["min_score"])[:8],
            "rows": rows, "trail": trail}


def harden(rank: int = 5) -> dict:
    """Retrain on the weak spots the search found, through retrain.py's gate."""
    from ml.online import retrain as RT
    v = M.load()
    a = audit(v, rank)
    probes = a["trail"].copy()  # every weak spot the search exposed, not just the finals
    probes["verdict"] = np.where(probes["score"] < a["threshold"], "APPROVED", "DECLINED")
    probes["origin"] = "robustness_probe"
    probes["player"] = "robustness"
    before = a
    result = RT.retrain(players=probes, force=False)
    after = audit(M.load(), rank)  # re-audit whatever is live now
    return {"search": {"version": before["version"], "evaded": before["evaded"], "worst": before["worst"][:4]},
            "retrain": result, "after": {"version": after["version"], "evaded": after["evaded"], "worst": after["worst"][:4]}}


def _print_audit(a: dict) -> None:
    print(f"v{a['version']}, rank {a['rank']} (Gus blocks score >= {a['threshold']}): "
          f"{a['evaded']} of {len(a['rows'])} probed orders evaded him.\n")
    print(f"{'weakest trick families':52} {'tried':>6} {'evaded':>7} {'min score':>10}")
    for fam, s in a["worst"]:
        print(f"{fam[:52]:52} {s['tried']:>6} {s['evaded']:>7} {s['min_score']:>10.3f}")


def _slim(a: dict) -> dict:
    return {k: a[k] for k in ("version", "rank", "threshold", "victims", "evaded", "probed", "worst")}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["audit", "harden"])
    ap.add_argument("--rank", type=int, default=5)
    ap.add_argument("--version", type=int)
    ap.add_argument("--json")
    a = ap.parse_args()
    if a.cmd == "audit":
        res = audit(M.load(a.version) if a.version else None, a.rank)
        _print_audit(res)
        if a.json:
            with open(a.json, "w") as f:
                json.dump(_slim(res), f, indent=2, default=str)
    else:
        r = harden(a.rank)
        print("Before hardening:"); _print_audit({**r["search"], "rank": a.rank, "threshold": 0, "rows": [], "worst": r["search"]["worst"]}) if False else None
        print(f"Search on v{r['search']['version']}: {r['search']['evaded']} orders evaded Gus.")
        print(f"Retrain: {r['retrain']}")
        print(f"After:   v{r['after']['version']} — {r['after']['evaded']} orders evade the live model now.")
