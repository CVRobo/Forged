"""Act 1: the AP desk decides whether a bank-change request goes into the vendor master
(docs/realistic-data-plan.md section 3).

A callback to the number on file reaches the real vendor: a mule account is exposed, a real
change is confirmed. A callback to a number offered in the request reaches whoever wrote it,
so the attacker confirms their own change. No callback lets any change through.

Sunny Diner calls back at a set rate. Later levels call the number on file when the request
looks suspicious. suspicion() is a hand-written stand-in for a trained change-request model;
note that a compromised mailbox scores 0 on it, as it would on real email checks.
"""
import random

from pydantic import BaseModel

from ml.features import edit_distance
from ml.schema import BankChangeEvent, VendorChangeRequest
from ml.world import FREE_MAIL_DOMAINS, VENDOR_SPECS, Truth

CALLBACK_RATE = {1: 0.5}       # Sunny Diner calls back on half of all change requests ...
OFFERED_NUMBER_RATE = 0.5      # ... and uses a number offered in the request half the time
SUSPICION_CALLBACK = 0.5       # later levels call the number on file at or above this suspicion


class ChangeDecision(BaseModel):
    request_id: str
    level: int
    score: float
    callback: str
    callback_result: str
    applied: bool
    reason: str


def assess_change_request(request: VendorChangeRequest, level: int = 1, truth: Truth | None = None) -> ChangeDecision:
    score = suspicion(request)
    rng = random.Random(f"callback:{request.request_id}")
    if level in CALLBACK_RATE:
        if rng.random() < CALLBACK_RATE[level]:
            offered = request.phone_number_given and rng.random() < OFFERED_NUMBER_RATE
            callback, reason = ("number_from_request" if offered else "number_on_file"), "random callback check"
        else:
            callback, reason = "none", "no callback this time"
    elif score >= SUSPICION_CALLBACK:
        callback, reason = "number_on_file", f"suspicious request ({score:.2f}): called the number on file"
    else:
        callback, reason = "none", f"looked routine ({score:.2f})"
    return apply_decision(request, callback, level=level, score=score, reason=reason, truth=truth)


def apply_decision(request: VendorChangeRequest, callback: str, level: int = 1, score: float | None = None,
                   reason: str = "", truth: Truth | None = None) -> ChangeDecision:
    to_mule = request.new_bank_account in (truth or Truth()).attacker_accounts
    if callback == "number_on_file":
        result, applied = ("vendor_denied", False) if to_mule else ("vendor_confirmed", True)
    elif callback == "number_from_request":
        result, applied = ("attacker_confirmed", True) if to_mule else ("vendor_confirmed", True)
    else:
        result, applied = "not_called", True
    return ChangeDecision(request_id=request.request_id, level=level,
                          score=suspicion(request) if score is None else score, callback=callback,
                          callback_result=result, applied=applied, reason=reason or callback)


def to_event(request: VendorChangeRequest, decision: ChangeDecision) -> BankChangeEvent | None:
    """The vendor-master change-log row for an applied change."""
    if not decision.applied:
        return None
    return BankChangeEvent(vendor_id=request.vendor_id, old_account=VENDOR_SPECS[request.vendor_id].bank,
                           new_account=request.new_bank_account, changed_at=request.requested_at,
                           request_id=request.request_id, channel=request.channel,
                           verified=decision.callback_result == "vendor_confirmed" and decision.callback == "number_on_file")


def suspicion(request: VendorChangeRequest) -> float:
    """What real email checks see on the request (0 to 1)."""
    spec, mail = VENDOR_SPECS[request.vendor_id], request.email
    score = 0.0
    if mail is not None:
        domain = mail.from_addr.split("@")[-1].lower()
        score += 0.5 * (mail.dmarc == "fail") + 0.2 * (mail.spf == "fail") + 0.15 * mail.first_time_sender
        score += 0.3 * ((mail.sender_domain_age_days or 9999) < 60) + 0.2 * (domain in FREE_MAIL_DOMAINS)
        score += 0.4 * (domain != spec.domain and edit_distance(domain, spec.domain) <= 2)
        if mail.reply_to:
            score += 0.15 * (mail.reply_to.split("@")[-1].lower() != domain)
    if request.phone_number_given and request.phone_number_given != spec.phone:
        score += 0.1
    return min(1.0, score)
