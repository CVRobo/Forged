"""An AI fraud analyst: Claude reads the model's own numbers and writes a short briefing.

    python -m ml.online.briefing [--json out.json]

It takes the attack report (report.py), the day-by-day real-fraud eval (evaluate.py) and the
version history, and asks Claude for a few sentences a judge or a manager could read: what
players found, what the newest version fixed, and the cost in false alarms. No model call is
needed to run the game; this is a reporting layer. Without ANTHROPIC_API_KEY it falls back to
a plain template built from the same numbers, so the briefing always renders.

The report is data, not instructions: everything passed to Claude is numbers the pipeline
produced, and the prompt says to summarize only those.
"""
from __future__ import annotations

import argparse
import json
import os

from ml.online import evaluate as E
from ml.online import game_rows as G
from ml.online import model as M
from ml.online import report as R

MODEL = "claude-opus-5-5"

SYSTEM = (
    "You are a fraud-analytics lead writing a short briefing for non-technical teammates. "
    "You are given JSON: a fraud model's version history, a day-by-day evaluation on real "
    "transactions it never trained on, and the attack 'families' that players of a game found. "
    "Summarize ONLY what the numbers show. Do not invent figures, and do not describe how to "
    "commit fraud: name an attack family only by its label and its catch rate. "
    "Write 4-6 sentences, plain English, for a reader who doesn't know machine learning."
)


def gather() -> dict:
    players = G.players()
    return {
        "versions": [{k: r.get(k) for k in ("version", "promoted", "note", "learned")} for r in M.registry()],
        "real_fraud_eval": E.evaluate(),
        "attacks": R.report(players) if not players.empty else {"families": [], "orders": 0, "got_through": 0},
    }


def _fallback(data: dict) -> str:
    """A plain briefing built from the numbers, used when there's no API key."""
    ev = data["real_fraud_eval"]
    vs = ev["by_version"]
    live = M.current()
    out = []
    if live in vs:
        s = vs[live]
        out.append(f"The live model (v{live}) reviews the {ev['alerts_per_day']} riskiest orders a day and "
                   f"finds about {s['mean_precision'] * ev['alerts_per_day']:.0f} real frauds among them, "
                   f"catching {s['mean_recall']:.0%} of each day's fraud on {ev['test_days']} days it never trained on.")
    gated = [v for v, s in vs.items() if not s["promoted"]]
    if gated:
        out.append(f"{len(gated)} retrained version{'s were' if len(gated) > 1 else ' was'} tested on players' wins "
                   f"and held back by the safety gate for blocking too many honest customers.")
    a = data["attacks"]
    if a["orders"]:
        out.append(f"Players sent {a['orders']} orders; {a['got_through']} slipped past an earlier version.")
        openf = [f for f in a["families"] if f.get("closed_in") is None][:2]
        fixed = [f for f in a["families"] if f.get("closed_in")][:2]
        if fixed:
            out.append("Fixed since: " + "; ".join(f"{f['family']} (now caught)" for f in fixed) + ".")
        if openf:
            out.append("Still open: " + "; ".join(f"{f['family']}" for f in openf) + ".")
    return " ".join(out)


def briefing(data: dict | None = None) -> dict:
    data = data or gather()
    text, source = _fallback(data), "template"
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            import anthropic
            client = anthropic.Anthropic()
            msg = client.messages.create(
                model=MODEL, max_tokens=1000, system=SYSTEM,
                messages=[{"role": "user", "content": "Here is the report JSON:\n\n" + json.dumps(data, default=str)}],
            )
            if msg.stop_reason != "refusal":
                text = "".join(b.text for b in msg.content if b.type == "text").strip() or text
                source = MODEL
        except Exception as e:  # any API trouble: keep the template
            source = f"template (Claude unavailable: {type(e).__name__})"
    return {"briefing": text, "source": source, "data": data}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--html", action="store_true", help="write report.js next to report.html, for the report page")
    a = ap.parse_args()
    r = briefing()
    print(f"[{r['source']}]\n\n{r['briefing']}")
    if a.json:
        with open(a.json, "w") as f:
            json.dump(r, f, indent=2, default=str)
    if a.html:
        out = os.path.join(os.path.dirname(__file__), "report.js")
        with open(out, "w", encoding="utf-8") as f:
            f.write("window.FORGED_REPORT = " + json.dumps(r, default=str) + ";\n")
        print(f"\nwrote {out} — open ml/online/report.html")
