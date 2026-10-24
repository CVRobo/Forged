"""The attacks players found: families of tricks, what they were worth, and which version closes them.

    python -m ml.online.report [--players path.csv|.jsonl] [--json out.json]

A family is what a fraud analyst would call the trick: whose account, where it ships, where
the buyer hides, what they shop on. For each family: how many orders players tried, how many
got through (and the dollars), and each version's catch rate at the real-shop threshold.
"""
from __future__ import annotations

import argparse
import json

import numpy as np
import pandas as pd

from ml.online import features as F
from ml.online import game_rows as G
from ml.online import model as M
from ml.online.retrain import _read

FIXED_AT = 0.8  # a family counts as closed once a version catches this share of it


def _b(cond) -> np.ndarray:
    return pd.Series(cond).fillna(False).to_numpy(dtype=bool)


def family(rows: pd.DataFrame) -> pd.Series:
    x = F.frame(rows)
    account = np.select([_b(rows["M3"].eq("T")), _b(x["P_email"].eq("anonymous")), _b(rows["M2"].eq("T"))],
                        ["victim's account", "anonymous email", "lookalike email"], "new email")
    dist1 = pd.to_numeric(rows.get("dist1"), errors="coerce")
    digital = _b(rows["R_emaildomain"].notna() & dist1.isna() & rows["M5"].ne("T"))
    ship = np.select([digital, _b(rows["M6"].eq("T")), _b(dist1 >= 2500), _b(dist1 < 50), _b(dist1 >= 50)],
                     ["code by email", "their home", "abroad", "nearby drop", "far drop"], "other drop")
    hide = np.select([_b(x["proxy"].eq("anonymous")), _b(x["proxy"].eq("hidden")), _b(x["dist2"] > 500)],
                     ["Tor/free VPN", "VPN", "far away"], "local")
    device = np.where(_b(x["device"].isin(["firefox", "linux"]) & x["DeviceType"].eq("mobile")), "emulator", "real device")
    return pd.Series([" + ".join(p) for p in zip(account, ship, hide, device)], index=rows.index)


def report(players: pd.DataFrame) -> dict:
    players = players.reset_index(drop=True)
    players["family"] = family(players)
    players["through"] = players["verdict"].eq("APPROVED") if "verdict" in players else False
    versions = [r["version"] for r in M.registry() if r.get("promoted")]
    scored = {v: M.load(v) for v in versions}
    catch = {v: (m.scores(players) >= m.threshold) for v, m in scored.items()}
    out = []
    for fam, g in players.groupby("family"):
        idx = g.index
        rates = {v: round(float(catch[v][idx].mean()), 3) for v in versions}
        fixed = next((v for v in versions if rates[v] >= FIXED_AT), None)
        out.append({"family": fam, "tried": len(g), "got_through": int(g["through"].sum()),
                    "exposure": round(float(pd.to_numeric(g.loc[g["through"], "TransactionAmt"], errors="coerce").sum()), 2),
                    "catch_by_version": rates, "closed_in": fixed})
    out.sort(key=lambda r: -r["exposure"])
    return {"versions": [{k: r.get(k) for k in ("version", "promoted", "note", "test", "learned")} for r in M.registry()],
            "families": out, "orders": len(players), "got_through": int(players["through"].sum())}


def print_report(r: dict) -> None:
    vs = [v["version"] for v in r["versions"] if v["promoted"]]
    print(f"{r['orders']} player orders, {r['got_through']} got through\n")
    print(f"{'trick':62} {'tried':>5} {'through':>7} {'exposure':>10}  " + "  ".join(f"v{v:<3}" for v in vs) + "  closed")
    for f in r["families"][:15]:
        rates = "  ".join(f"{f['catch_by_version'][v]:>4.0%}" for v in vs)
        print(f"{f['family'][:62]:62} {f['tried']:>5} {f['got_through']:>7} {f['exposure']:>10,.0f}  {rates}  "
              f"{'v' + str(f['closed_in']) if f['closed_in'] else 'open'}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--players")
    ap.add_argument("--json")
    a = ap.parse_args()
    r = report(_read(a.players) if a.players else G.players())
    print_report(r)
    if a.json:
        with open(a.json, "w") as f:
            json.dump(r, f, indent=2, default=str)
