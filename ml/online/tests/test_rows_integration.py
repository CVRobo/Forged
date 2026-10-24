"""The game's own row builder (probe.js) produces well-formed IEEE-CIS rows.

Skipped when Node isn't on PATH, so the Python-only test run stays green.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

PROBE = Path(__file__).resolve().parents[1] / "probe.js"
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")


def _run(inputs):
    out = subprocess.run(["node", str(PROBE), json.dumps(inputs)], capture_output=True, text=True, check=True).stdout
    return [json.loads(l) for l in out.splitlines() if l]


def test_probe_builds_one_fraud_row_per_order():
    rows = _run([{"item": "PS5", "ship": "PO box in Columbus"}])
    assert len(rows) == 1
    r = rows[0]
    assert r["isFraud"] == 1            # every player order is fraud by construction
    assert r["TransactionAmt"] > 0
    assert r["ProductCD"]               # a product code is always set


def test_probe_repeat_makes_several_orders():
    rows = _run([{"item": "iPhone 15", "ship": "Their home", "repeat": "3"}])
    assert len(rows) == 3
    assert {r["step"] for r in rows} == {1, 2, 3}


def test_probe_abroad_sets_distance():
    rows = _run([{"item": "Rolex", "ship": "warehouse in Lagos"}])
    # abroad shipping records a real distance, not a blank (so the model doesn't read it as normal)
    assert rows[0]["dist1"] and rows[0]["dist1"] > 1000
