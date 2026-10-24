"""The game's InvoiceRecord (prototype record(), server/models/schemas.py) becomes the model's Invoice."""
from datetime import date
from types import SimpleNamespace

from ml.adapter import serving_case_file, to_invoice
from ml.features import compute_features
from ml.schema import SessionHistory


def record(**overrides):
    """What the prototype sends for an untouched Pancake Pete's invoice."""
    fields = dict(
        level=1, scheme="changed_bank", vendor="Pancake Pete's Flour Co.", amount=1200, bank_account="••••3321",
        sender_domain="petesflour.com", invoice_no="PP-0412", po_number="PO-4821", date="Fri, Oct 16",
        line_items=["Flour, 50lb sack ×12 @ 62", "Pancake mix, bulk ×4 @ 95", "Delivery ×1 @ 76"],
        field_altered=[], legibility={"header": 1, "meta": 1, "items": 1, "bank": 1, "footer": 1},
        scan_quality=1.0, copy_generation=0, stamp_type=[], stamp_position=[], domain_mismatch=False,
        letterhead_match=True, cover_email="", heat=0,
    )
    return {**fields, **overrides}


def features(rec):
    inv = to_invoice(rec)
    return compute_features(inv, serving_case_file(inv), SessionHistory(session_id="s", round_no=1))


def test_parses_vendor_lines_bank_and_date():
    inv = to_invoice(record())
    assert (inv.vendor_id, inv.bank_account, inv.issue_date, inv.order_number) == ("petes", "3321", date(2026, 10, 16), "PO-4821")
    assert [(li.description, li.quantity, li.unit_price) for li in inv.line_items][0] == ("Flour, 50lb sack", 12, 62)
    assert inv.amount == 1200


def test_an_untouched_vendor_invoice_carries_no_tells():
    f = features(record())
    assert f["bank_changed"] == f["domain_mismatch"] == f["vendor_unknown"] == f["no_open_order"] == 0
    assert f["field_altered_count"] == f["copy_generation"] == f["max_illegibility"] == 0
    assert f["letterhead_match"] == 1 and abs(f["cadence_z"]) < 1


def test_tape_on_the_bank_and_whiteout_become_tool_uses_but_pen_edits_do_not():
    inv = to_invoice(record(bank_account="••••7781", field_altered=["bank", "invoiceNo", "domain", "letterhead"]))
    assert sorted((u.tool, u.target) for u in inv.tool_uses) == [("tape", "bank"), ("whiteout", "invoiceNo")]


def test_stains_and_copies_become_tool_uses():
    f = features(record(legibility={"header": 1, "meta": 1, "items": 0.3, "bank": 0.65, "footer": 1}, copy_generation=2))
    assert round(f["max_illegibility"], 2) == 0.7 and f["copy_generation"] == 2


def test_an_edited_total_keeps_the_amount_the_player_asked_for():
    inv = to_invoice(record(amount=1500))
    assert round(inv.amount, 2) == 1500 and inv.line_items[-1].description == "Adjustment"


def test_a_phantom_vendor_is_unknown_with_its_own_letterhead():
    f = features(record(scheme="phantom", vendor="Gary's Totally Real Plumbing", sender_domain="garystotallyre.biz",
                        bank_account="••••7781", letterhead_match=False, po_number="PO-1234"))
    assert (f["vendor_unknown"], f["letterhead_match"], f["no_open_order"]) == (1, 0, 1)


def test_night_shift_sends_after_hours():
    assert features(record(after_hours=True))["offhours_send"] == 1


def test_accepts_the_servers_pydantic_object_as_well_as_a_dict():
    assert to_invoice(SimpleNamespace(**record())) == to_invoice(record())


def test_a_weekend_date_moves_to_monday_instead_of_reading_as_after_hours():
    # The prototype prints a random "Fri, Oct N", and Oct 10 2026 is a Saturday.
    assert to_invoice(record(date="Fri, Oct 10")).issue_date == date(2026, 10, 12)
    assert features(record(date="Fri, Oct 10"))["offhours_send"] == 0
