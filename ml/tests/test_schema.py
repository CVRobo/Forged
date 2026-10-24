import pytest
from pydantic import ValidationError

from ml.schema import BASE_FEATURES, FEATURES, LEVELS, MEMORY_FEATURES, Submission
from ml.tests.factories import invoice, submission


def test_invoice_amount_is_the_sum_of_line_items():
    assert invoice().amount == 1200


@pytest.mark.parametrize("origin", ["player_clone", "search_attacker"])
def test_origin_accepts_the_section_8_additions(origin):
    assert submission(origin=origin).origin == origin


def test_origin_rejects_unknown_values():
    with pytest.raises(ValidationError):
        submission(origin="intern")


def test_submission_adds_trick_id_and_train_weight():
    clone = submission(origin="player_clone", trick_id="sub0", train_weight=3.0)
    assert (clone.trick_id, clone.train_weight) == ("sub0", 3.0)
    assert (submission().trick_id, submission().train_weight) == (None, 1.0)


def test_submission_survives_a_json_round_trip():
    sub = submission()
    assert Submission.model_validate_json(sub.model_dump_json()) == sub


def test_memory_features_are_the_three_knn_features():
    assert MEMORY_FEATURES == ("knn_fraud_share", "knn_max_sim", "self_sim")


def test_feature_lists_have_no_overlap_or_duplicates():
    assert not set(BASE_FEATURES) & set(MEMORY_FEATURES)
    assert FEATURES == BASE_FEATURES + MEMORY_FEATURES
    assert len(set(FEATURES)) == len(FEATURES)


def test_levels_use_the_spec_5_3_settings():
    settings = {lid: (lvl.fpr_target, lvl.memory_enabled) for lid, lvl in LEVELS.items()}
    assert settings == {
        "sunny_diner": (0.03, False),
        "st_mercy": (0.05, False),
        "port_nocturne": (0.05, True),
        "neon_arcade": (0.08, True),
    }


# ---------- the realistic channel (docs/realistic-data-plan.md sections 2 and 3) ----------

from datetime import datetime  # noqa: E402

from ml.schema import BankChangeEvent, EmailMessage, VendorChangeRequest  # noqa: E402


def email(**overrides):
    fields = dict(message_id="<m1@petesflour.com>", from_name="Pancake Pete's Billing", from_addr="billing@petesflour.com",
                  subject="Invoice PP-0201", body="Invoice attached.", sent_at=datetime(2026, 10, 16, 10, 30))
    return EmailMessage(**{**fields, **overrides})


def test_email_world_fields_default_to_unknown_until_the_world_sets_them():
    m = email()
    assert (m.spf, m.dkim, m.dmarc, m.sender_identity) == ("none", "none", "none", None)
    assert m.reply_to is None and m.cc == [] and m.thread_id is None


def test_a_change_request_starts_unverified_and_unapplied():
    req = VendorChangeRequest(request_id="c1", vendor_id="petes", new_bank_account="7781", channel="email",
                              email=email(), requested_at=datetime(2026, 10, 14, 9, 0))
    assert (req.callback, req.callback_result, req.applied) == ("none", "not_called", False)


def test_an_invoice_can_carry_the_email_that_delivered_it():
    from ml.tests.factories import invoice
    assert invoice(email=email()).email.from_addr == "billing@petesflour.com"
    assert invoice().email is None


def test_the_case_file_keeps_a_vendor_master_change_log():
    from ml.tests.factories import case_file
    event = BankChangeEvent(vendor_id="petes", old_account="3321", new_account="7781",
                            changed_at=datetime(2026, 10, 14, 9, 0), request_id="c1", channel="email", verified=False)
    assert case_file(bank_changes=[event]).bank_changes[0].new_account == "7781"
    assert case_file().bank_changes == []
