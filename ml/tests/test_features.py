from datetime import date, datetime

import pytest

from ml.features import compute_features
from ml.schema import BASE_FEATURES, LineItem, OpenOrder, Stamp, ToolUse
from ml.tests.factories import case_file, history, invoice, vendors

LEVEL_MEAN = (1200 + 480 + 2000) / 3
LEVEL_STD = (150 + 60 + 300) / 3


def feats(inv=None, cf=None, hist=None):
    return compute_features(inv or invoice(), cf or case_file(), hist or history())


def one_line(amount, description="Delivery"):
    return [LineItem(description=description, quantity=1, unit_price=amount)]


def unknown_vendor(**overrides):
    fields = dict(vendor_id=None, vendor_name="Gary's Totally Real Plumbing", bank_account="7781",
                  sender_domain="garysplumbing.biz", letterhead_id="lh_gary", order_number=None)
    return invoice(**{**fields, **overrides})


# ---------- contract ----------

def test_returns_exactly_the_base_features_as_floats():
    f = feats()
    assert tuple(f) == BASE_FEATURES
    assert all(type(v) is float for v in f.values())


def test_clean_invoice_carries_no_tells():
    f = feats()
    assert f["bank_changed"] == f["domain_mismatch"] == f["vendor_unknown"] == f["no_open_order"] == 0
    assert f["domain_edit_distance"] == 0
    assert f["letterhead_match"] == f["stamp_matches_vendor"] == f["scan_quality"] == 1
    assert f["vendor_name_similarity"] == 1
    assert f["field_altered_count"] == f["copy_generation"] == f["max_illegibility"] == f["stamp_count"] == 0
    assert f["offhours_send"] == 0
    assert f["cadence_z"] == 0
    assert f["amount_z"] == 0


def test_same_inputs_give_the_same_features():
    assert feats() == feats()


# ---------- money ----------

def test_amount_z_uses_the_vendor_mean_and_std():
    assert feats(invoice(line_items=one_line(1500)))["amount_z"] == pytest.approx(2.0)


def test_amount_z_uses_the_level_average_for_unknown_vendors():
    amount = LEVEL_MEAN + LEVEL_STD
    assert feats(unknown_vendor(line_items=one_line(amount)))["amount_z"] == pytest.approx(1.0)


def test_amount_z_survives_a_zero_std_vendor():
    vs = vendors()
    vs[0].amount_std = 0
    assert feats(invoice(line_items=one_line(1300)), case_file(vendors=vs))["amount_z"] > 0


@pytest.mark.parametrize("amount, expected", [(1500, 1), (1238, 0), (1500.5, 0)])
def test_amount_is_round(amount, expected):
    assert feats(invoice(line_items=one_line(amount)))["amount_is_round"] == expected


def test_amount_to_limit_ratio():
    assert feats(invoice(line_items=one_line(1250)))["amount_to_limit_ratio"] == pytest.approx(0.5)


def test_bank_changed_when_the_account_differs_from_the_vendor_file():
    assert feats(invoice(bank_account="7781"))["bank_changed"] == 1


def test_bank_changed_is_1_for_unknown_vendors():
    assert feats(unknown_vendor())["bank_changed"] == 1


def test_order_amount_ratio_against_the_open_order():
    assert feats(invoice(line_items=one_line(1380)))["order_amount_ratio"] == pytest.approx(1.15)


def test_order_amount_ratio_is_0_without_an_open_order():
    assert feats(invoice(order_number=None))["order_amount_ratio"] == 0


def test_max_unit_price_ratio_finds_the_padded_line():
    padded = [LineItem(description="Flour, 50lb sack", quantity=12, unit_price=93),
              LineItem(description="Delivery", quantity=1, unit_price=76)]
    assert feats(invoice(line_items=padded))["max_unit_price_ratio"] == pytest.approx(1.5)


def test_max_unit_price_ratio_is_1_when_nothing_matches_the_catalog():
    assert feats(invoice(line_items=one_line(500, "Mystery fee")))["max_unit_price_ratio"] == 1
    assert feats(unknown_vendor())["max_unit_price_ratio"] == 1


# ---------- identity ----------

def test_vendor_unknown_without_an_approved_vendor_id():
    assert feats(unknown_vendor())["vendor_unknown"] == 1
    assert feats(invoice(vendor_id="not_on_file"))["vendor_unknown"] == 1


def test_vendor_name_similarity_is_high_but_not_1_for_a_lookalike():
    f = feats(unknown_vendor(vendor_name="Pancake Pete's Flour Co"))
    assert 0.9 < f["vendor_name_similarity"] < 1


def test_vendor_name_similarity_is_low_for_an_unrelated_name():
    assert feats(unknown_vendor(vendor_name="Quantum Napkin Partners"))["vendor_name_similarity"] < 0.6


def test_domain_mismatch_and_edit_distance_for_a_spoof():
    f = feats(invoice(sender_domain="petesfl0ur.com"))
    assert (f["domain_mismatch"], f["domain_edit_distance"]) == (1, 1)


def test_domain_edit_distance_is_to_the_nearest_known_domain():
    f = feats(invoice(sender_domain="bubblessoap.co"))  # Pete's invoice from another vendor's domain
    assert (f["domain_mismatch"], f["domain_edit_distance"]) == (1, 0)


def test_domain_edit_distance_is_large_for_a_made_up_domain():
    assert feats(unknown_vendor())["domain_edit_distance"] >= 5


def test_letterhead_match():
    assert feats(invoice(letterhead_id="lh_generic"))["letterhead_match"] == 0
    assert feats(unknown_vendor())["letterhead_match"] == 0


# ---------- process ----------

@pytest.mark.parametrize("order_number", [None, "", "PO-9999"])
def test_no_open_order(order_number):
    assert feats(invoice(order_number=order_number))["no_open_order"] == 1


def test_an_order_for_another_vendor_does_not_count():
    f = feats(invoice(order_number="PO-2001"))
    assert (f["no_open_order"], f["order_amount_ratio"]) == (1, 0)


def test_dup_similarity_is_1_for_an_exact_resend():
    resend = invoice(issue_date=date(2026, 10, 2), due_date=date(2026, 11, 1))
    assert feats(resend)["dup_similarity"] == pytest.approx(1.0)


def test_dup_similarity_is_high_for_a_recurring_legit_invoice():
    assert 0.5 < feats()["dup_similarity"] < 1


def test_dup_similarity_is_0_with_no_paid_invoices():
    assert feats(cf=case_file(paid_invoices=[]))["dup_similarity"] == 0


def test_cadence_z_is_negative_for_an_invoice_right_after_the_last_one():
    early = invoice(issue_date=date(2026, 10, 2), due_date=date(2026, 11, 1))
    assert feats(early)["cadence_z"] == pytest.approx(-4.0)  # 0 days vs 14, std 0.25 * 14


def test_cadence_z_is_0_with_no_earlier_invoice_or_vendor():
    assert feats(cf=case_file(paid_invoices=[]))["cadence_z"] == 0
    assert feats(unknown_vendor())["cadence_z"] == 0


def test_due_days():
    assert feats()["due_days"] == 30


@pytest.mark.parametrize("sent_at, expected", [
    (datetime(2026, 10, 16, 10, 30), 0),  # Friday morning
    (datetime(2026, 10, 16, 22, 0), 1),   # Friday night
    (datetime(2026, 10, 17, 11, 0), 1),   # Saturday
    (None, 0),
])
def test_offhours_send(sent_at, expected):
    assert feats(invoice(sent_at=sent_at))["offhours_send"] == expected


def test_line_item_count():
    assert feats()["line_item_count"] == 3


# ---------- text ----------

def test_vague_text_score_is_the_share_of_vague_line_item_words():
    lines = [LineItem(description="Consulting services", quantity=1, unit_price=900),
             LineItem(description="Flour", quantity=1, unit_price=300)]
    assert feats(invoice(line_items=lines))["vague_text_score"] == pytest.approx(2 / 3)
    assert feats()["vague_text_score"] == 0


def test_email_urgency_counts_distinct_urgency_terms():
    f = feats(invoice(cover_email="URGENT: please pay this immediately, it is overdue. Urgent!"))
    assert f["email_urgency"] == 3
    assert feats(invoice(cover_email="Thanks, invoice attached."))["email_urgency"] == 0


@pytest.mark.parametrize("email, expected", [
    ("Heads up, we changed banks. Please use our new account.", 1),
    ("New order attached, thanks!", 0),
    ("Please pay the account on file as usual.", 0),
])
def test_email_mentions_change(email, expected):
    assert feats(invoice(cover_email=email))["email_mentions_change"] == expected


def test_email_length_in_words():
    assert feats(invoice(cover_email="Invoice attached, thanks Marge"))["email_length"] == 4
    assert feats()["email_length"] == 0


# ---------- physical ----------

def test_field_altered_count_counts_distinct_fields_hit_by_whiteout_or_tape():
    uses = [ToolUse(tool="whiteout", target="amount"), ToolUse(tool="whiteout", target="amount"),
            ToolUse(tool="tape", target="bank"), ToolUse(tool="mug", target="items")]
    assert feats(invoice(tool_uses=uses))["field_altered_count"] == 2


def test_max_illegibility_adds_stains_per_region_and_takes_the_worst():
    uses = [ToolUse(tool="mug", target="items"), ToolUse(tool="mug", target="items"),
            ToolUse(tool="mug", target="header", params={"strength": 0.5})]
    assert feats(invoice(tool_uses=uses))["max_illegibility"] == pytest.approx(0.7)


def test_max_illegibility_is_capped_at_1():
    uses = [ToolUse(tool="mug", target="bank", params={"strength": 0.7})] * 2
    assert feats(invoice(tool_uses=uses))["max_illegibility"] == 1


def test_photocopies_raise_generation_and_lower_scan_quality():
    two = feats(invoice(tool_uses=[ToolUse(tool="photocopier")] * 2))
    assert (two["copy_generation"], two["scan_quality"]) == (2, pytest.approx(0.56))
    assert feats(invoice(tool_uses=[ToolUse(tool="photocopier")] * 5))["scan_quality"] == 0


def test_stamp_count():
    stamps = [Stamp(kind="RECEIVED", x=0.8, y=0.1), Stamp(kind="PAID", x=0.2, y=0.9)]
    assert feats(invoice(stamps=stamps))["stamp_count"] == 2


@pytest.mark.parametrize("kinds, expected", [(["RECEIVED"], 1), (["URGENT"], 0), (["RECEIVED", "URGENT"], 0)])
def test_stamp_matches_vendor_habits(kinds, expected):
    stamps = [Stamp(kind=k, x=0.5, y=0.5) for k in kinds]
    assert feats(invoice(stamps=stamps))["stamp_matches_vendor"] == expected


def test_any_stamp_on_an_unknown_vendor_does_not_match():
    assert feats(unknown_vendor(stamps=[Stamp(kind="APPROVED", x=0.5, y=0.5)]))["stamp_matches_vendor"] == 0


# ---------- session ----------

def salami(name, amount):
    return unknown_vendor(vendor_name=name, line_items=one_line(amount))


def test_window_links_rotating_vendor_names_by_bank_account():
    hist = history(round_no=6, entries=[
        (1, salami("Old Slice LLC", 900)),         # outside the 5-round window
        (3, salami("Slice One LLC", 800)),
        (5, salami("Slice Two LLC", 700)),
        (5, invoice(line_items=one_line(300))),   # Pete's: another source
    ])
    f = feats(salami("Slice Three LLC", 600), hist=hist)
    assert (f["window_count"], f["window_sum"]) == (3, 2100)


def test_window_counts_only_the_current_invoice_with_no_history():
    f = feats()
    assert (f["window_count"], f["window_sum"]) == (1, 1200)


def test_session_features_ignore_rounds_after_the_current_one():
    hist = history(round_no=2, entries=[(4, salami("Future LLC", 500))])
    f = feats(salami("Future LLC", 600), hist=hist)
    assert (f["window_count"], f["vendor_age_rounds"]) == (1, 0)


def test_vendor_age_rounds_for_an_approved_vendor():
    assert feats(hist=history(round_no=3))["vendor_age_rounds"] == 23  # first seen in round -20


def test_vendor_age_rounds_for_a_new_vendor_counts_from_its_first_appearance():
    hist = history(round_no=4, entries=[(1, salami("Patient Paper Co.", 90))])
    assert feats(salami("Patient Paper Co.", 1800), hist=hist)["vendor_age_rounds"] == 3
    assert feats(salami("Never Seen Inc.", 100), hist=hist)["vendor_age_rounds"] == 0


def test_amount_jump_ratio_against_the_largest_earlier_paid_invoice():
    assert feats(invoice(line_items=one_line(2400)))["amount_jump_ratio"] == pytest.approx(2.0)


def test_amount_jump_ratio_is_1_with_no_earlier_paid_invoice():
    assert feats(unknown_vendor())["amount_jump_ratio"] == 1
