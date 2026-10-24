"""Rebuild orders.json: named checkouts turned into rows by the game's own code (ml/online/rows.js).

    python ml/online/tests/fixtures/make_orders.py

Unset answers take the Rookie starter kit, like the game: the cardholder's login, phone and city.
Holders and cards index prototype/orders.js HOLDERS (0 = Pat Miller, Columbus) and CARDS
(0 fresh_visa, 1 aged_mc, 2 amex, 3 foreign_visa).
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
CAREFUL = {"item": "Flour, 50 lb sack", "name": "Pat Miller", "email": "pat.miller1@gmail.com", "device": "iPhone 12",
           "where": "next door", "ship": "Cousin's garage in Columbus", "when": "2 PM"}
CHECKOUTS = {
    "rookie_kit": {"card": 1, "input": {"item": "Flour, 50 lb sack", "ship": "Cousin's garage in Columbus"}},
    "careful_local": {"card": 1, "input": CAREFUL},
    "ghost_gift_card": {"card": 3, "input": {"item": "Gift card $500", "name": "Alex Smith", "email": "quickdeals@protonmail.com",
                                             "device": "Android emulator", "where": "Tor", "when": "3 AM"}},
    "reshipper": {"card": 0, "input": {"item": "Gaming laptop", "ship": "Warehouse in Rotterdam"}},
    "night_order": {"card": 1, "input": {**CAREFUL, "when": "3 AM"}},
    "burst": {"card": 1, "input": {**CAREFUL, "repeat": "3"}},
    "week_apart": {"card": 1, "input": {**CAREFUL, "repeat": "2", "gap": "7"}},
    "hijack_gift_card": {"card": 1, "input": {"item": "$200 Steam gift card"}},
}

items = [{**c, "holder": 0, "level": 1, "session": f"fixture-{name}"} for name, c in CHECKOUTS.items()]
out = subprocess.run(["node", str(ROOT / "ml" / "online" / "rows.js")], input=json.dumps(items),
                     capture_output=True, text=True, check=True).stdout
rows = [json.loads(line) for line in out.splitlines() if line]
orders = {name: {"rows": [r for r in rows if r["attack"] == i], "values": [r["value"] for r in rows if r["attack"] == i]}
          for i, name in enumerate(CHECKOUTS)}
(Path(__file__).with_name("orders.json")).write_text(json.dumps(orders, indent=1) + "\n")
print({name: len(o["rows"]) for name, o in orders.items()})
