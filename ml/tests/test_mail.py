"""The world sets each email's authentication results from how the sender got its address (plan section 2),
and the AP desk's callback decides whether a bank-change request goes through (plan section 3)."""
from datetime import datetime

import pytest

from ml.changes import apply_decision, assess_change_request
from ml.features import edit_distance
from ml.mail import realize_email, vendor_directory
from ml.schema import VendorChangeRequest
from ml.world import ATTACKER_ACCOUNTS, VENDOR_SPECS

PETES = VENDOR_SPECS["petes"]


def mail(identity, **kw):
    return realize_email(identity, "petes", from_name="Pancake Pete's Billing", subject="Bank update",
                         body="We changed banks.", sent_at=datetime(2026, 10, 14, 9, 30), **kw)


def test_the_real_vendor_passes_every_check_from_its_own_domain():
    m = mail("vendor_mailbox")
    assert m.from_addr.endswith("@petesflour.com") and (m.spf, m.dkim, m.dmarc) == ("pass", "pass", "pass")
    assert not m.first_time_sender and m.sender_domain_age_days > 1000


def test_a_compromised_mailbox_looks_exactly_like_the_vendor():
    real, stolen = mail("vendor_mailbox"), mail("compromised_mailbox")
    assert (stolen.from_addr, stolen.spf, stolen.dkim, stolen.dmarc, stolen.first_time_sender) == \
           (real.from_addr, real.spf, real.dkim, real.dmarc, real.first_time_sender)


def test_spoofing_the_real_domain_fails_dmarc():
    m = mail("spoofed_domain")
    assert m.from_addr.endswith("@petesflour.com") and (m.spf, m.dmarc) == ("fail", "fail")


def test_a_lookalike_domain_passes_its_own_checks_but_is_new_and_one_or_two_edits_off():
    m = mail("lookalike_domain")
    domain = m.from_addr.split("@")[1]
    assert 1 <= edit_distance(domain, PETES.domain) <= 2 and m.dmarc == "pass"
    assert m.first_time_sender and m.sender_domain_age_days <= 30
    assert mail("lookalike_domain", aged_domain=True).sender_domain_age_days >= 200


def test_free_mail_is_an_old_domain_and_a_first_time_sender():
    m = mail("free_mail")
    assert m.from_addr.endswith("@gmail.com") and m.first_time_sender and m.sender_domain_age_days > 5000


def test_replying_into_the_vendors_thread_keeps_the_thread_id():
    thread = vendor_directory()[0]["last_thread"]
    m = mail("compromised_mailbox", thread_id=thread["thread_id"], in_reply_to=thread["message_id"])
    assert (m.thread_id, m.in_reply_to) == (thread["thread_id"], thread["message_id"])


def test_the_directory_lists_level_1_vendors_with_the_number_on_file():
    names = {v["name"]: v for v in vendor_directory()}
    assert {"Pancake Pete's Flour Co.", "Bubbles Dish Soap Ltd.", "Existential Dread Consulting LLC"} <= set(names)
    assert names["Pancake Pete's Flour Co."]["phone"] == PETES.phone and names["Pancake Pete's Flour Co."]["bank_last4"] == "3321"


def request(new_account, phone=None, identity="lookalike_domain", rid="c1"):
    return VendorChangeRequest(request_id=rid, vendor_id="petes", new_bank_account=new_account, channel="email",
                               email=mail(identity), phone_number_given=phone, requested_at=datetime(2026, 10, 14, 9, 30))


def test_a_callback_to_the_number_on_file_exposes_a_mule_account():
    decision = apply_decision(request(ATTACKER_ACCOUNTS[0]), callback="number_on_file")
    assert (decision.callback_result, decision.applied) == ("vendor_denied", False)


def test_a_callback_to_the_number_in_the_email_reaches_the_attacker():
    decision = apply_decision(request(ATTACKER_ACCOUNTS[0], phone="(415) 555-0199"), callback="number_from_request")
    assert (decision.callback_result, decision.applied) == ("attacker_confirmed", True)


def test_no_callback_lets_any_change_through():
    assert apply_decision(request(ATTACKER_ACCOUNTS[0]), callback="none").applied


def test_a_real_vendors_change_is_confirmed_on_callback():
    decision = apply_decision(request("5050", identity="vendor_mailbox"), callback="number_on_file")
    assert (decision.callback_result, decision.applied) == ("vendor_confirmed", True)


def test_assessment_is_deterministic_per_request_and_returns_a_policy_reason():
    a = assess_change_request(request(ATTACKER_ACCOUNTS[0], rid="same"), level=1)
    b = assess_change_request(request(ATTACKER_ACCOUNTS[0], rid="same"), level=1)
    assert a == b and a.callback in ("none", "number_on_file", "number_from_request") and a.reason


@pytest.mark.parametrize("identity", ["spoofed_domain", "lookalike_domain"])
def test_suspicious_senders_get_called_back_on_later_levels(identity):
    decision = assess_change_request(request(ATTACKER_ACCOUNTS[0], identity=identity, rid=f"r-{identity}"), level=2)
    assert decision.callback == "number_on_file" and not decision.applied
