"""Defender mode (docs/superpowers/specs/2026-10-24-defender-mode-design.md): shifts, callbacks, the reveal."""
import json
import math

import pytest

from ml import defender, store, training
from ml.defender import OWNER, SEED_BASE, build_shift, callback_line, find_window, reason_text
from ml.generate import simulate
from ml.payloads import payload_schemes
from ml.world import REGIONS

SCHEMES_WANTED = {"bank_switcheroo", "bank_change_fraud", "duplicate_dance", "padded_invoice", "phantom_supplier",
                  "boss_request", None}


@pytest.fixture(scope="module", autouse=True)
def model_dir(tmp_path_factory):
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("FORGED_MODEL_DIR", str(tmp_path_factory.mktemp("models")))
        store.clear_cache()
        yield
    store.clear_cache()
    training.forget_memory()


@pytest.fixture(scope="module")
def shift():
    return build_shift(1)


@pytest.fixture(scope="module")
def examples():
    """One (row, case file before it, truth) per scheme, plus a legit known-vendor row (key None)."""
    found = {}
    for i in range(60):
        run = simulate(SEED_BASE + 1, i, attack_rate=0.5, snapshots=True)
        for row, case in zip(run.rows, run.snapshots):
            if row.scheme_id not in found and (row.scheme_id or row.invoice.vendor_id):
                found[row.scheme_id] = (row, case, run.truth)
        if set(found) >= SCHEMES_WANTED:
            return found
    raise AssertionError(f"missing {SCHEMES_WANTED - set(found)}")


def test_simulate_snapshots_change_nothing():
    plain = simulate(3, 0, attack_rate=0.4)
    snapped = simulate(3, 0, attack_rate=0.4, snapshots=True)
    assert [r.model_dump() for r in snapped.rows] == [r.model_dump() for r in plain.rows]
    assert plain.snapshots is None and len(snapped.snapshots) == len(snapped.rows)
    for row, case in zip(snapped.rows, snapped.snapshots):
        assert row.invoice.invoice_id not in {p.invoice_id for p in case.paid_invoices}


def test_the_same_seed_gives_the_same_shift(shift):
    assert json.dumps(build_shift(1)) == json.dumps(shift)


def test_a_shift_mixes_real_invoices_and_two_to_four_schemes(shift):
    items = shift["items"]
    frauds = [i for i in items if i["truth"]["fraud"]]
    assert len(items) == defender.SHIFT_SIZE and len({i["id"] for i in items}) == len(items)
    assert defender.FRAUDS[0] <= len(frauds) <= defender.FRAUDS[1]
    assert len({i["truth"]["scheme"] for i in frauds}) >= defender.MIN_SCHEMES
    assert shift["callbacks"] == 2 and shift["inspector"]["version"] == store.current_version()


def test_every_item_is_labelled_by_the_payload_check_on_its_own_case_file(shift):
    run, start = find_window(1)
    for k, item in enumerate(shift["items"]):
        row, case = run.rows[start + k], run.snapshots[start + k]
        schemes = payload_schemes(row.invoice, case, run.truth)
        assert item["truth"]["fraud"] == bool(schemes) == row.is_fraud
        assert set(item["truth"]["schemes"]) == schemes
        assert item["case"]["vendors"][0]["bank_on_file"] == case.vendors[0].bank_account


def test_a_bank_change_fraud_matches_the_file_and_the_log(examples):
    row, case, truth = examples["bank_change_fraud"]
    item = defender._item("x", row, case, truth, store.load_detector(training.ensure_v1()), 0.5)
    vendor = next(v for v in item["case"]["vendors"] if v["vendor_id"] == row.invoice.vendor_id)
    change = next(c for c in item["case"]["bank_changes"] if c["vendor_id"] == vendor["vendor_id"])
    assert vendor["bank_on_file"] == item["invoice"]["bank_account"] == change["new_account"]
    assert change["old_account"] in item["callback"]["says"] and "never asked" in item["callback"]["says"]


@pytest.mark.parametrize("scheme", sorted(SCHEMES_WANTED, key=str))
def test_the_callback_names_the_fact_that_gives_it_away(examples, scheme):
    row, case, truth = examples[scheme]
    inv = row.invoice
    line = callback_line(inv, case, truth, payload_schemes(inv, case, truth), row.scheme_id)
    vendor = next((v for v in case.vendors if v.vendor_id == inv.vendor_id), None)
    if scheme in ("phantom_supplier", "boss_request"):
        assert line["who"] == OWNER and "Don't pay it" in line["says"]
        return
    assert line["who"] == f"{vendor.name} · {vendor.phone}"
    expected = {
        None: f"{inv.invoice_id} for ${inv.amount:,.2f} is ours",
        "bank_switcheroo": f"ending {vendor.bank_account}",
        "duplicate_dance": next((p.invoice_id for p in case.paid_invoices if defender._rebills(inv, p, vendor.cadence_days)), "?"),
        "padded_invoice": f"${truth.order_amounts[inv.order_number]:,.2f}, not ${inv.amount:,.2f}",
        "bank_change_fraud": "never asked",
    }[scheme]
    assert expected in line["says"]


def test_reasons_are_plain_words_with_a_region(shift):
    regions = set(REGIONS) | {"email", None}
    for item in shift["items"]:
        reasons = item["verdict"]["reasons"]
        assert len(reasons) <= defender.REASONS
        for r in reasons:
            assert r["region"] in regions and r["text"] and "{" not in r["text"]


def test_reason_wording_uses_the_invoices_own_numbers():
    assert reason_text("due_days", 4) == "payment due in 4 days"
    assert reason_text("log_domain_age", math.log1p(1)) == "a sender domain registered 1 day ago"
    assert reason_text("amount_z", 1966.2) == "an amount far above the vendor's usual"
    assert reason_text("bank_changed", 1) == "bank details that don't match the vendor on file"


def test_the_payload_is_plain_json_and_exports(shift, tmp_path):
    assert json.loads(json.dumps(shift)) == shift
    path = tmp_path / "shifts.json"
    defender.export_shifts(path, [1])
    assert json.loads(path.read_text())["shifts"] == [shift]
