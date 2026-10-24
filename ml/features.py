"""compute_features: the one function that turns an invoice into model inputs.

Training, serving and the generators all call it, so the model sees the same
numbers everywhere (Appendix A feature table). It returns BASE_FEATURES only;
the kNN memory features come from the vector index (spec 2.3).

Pass the case file and history as they stood *before* this invoice: paid_invoices
must not contain it yet, and history entries after the current round are ignored.

The email features read invoice.email, the message that delivered the invoice, and the
change features read case_file.bank_changes, the vendor master's change log. Without an
email they take neutral values, except the two that only need the sender's domain.
"""
import math
import re
from difflib import SequenceMatcher

from ml.schema import BASE_FEATURES, CaseFile, Invoice, SessionHistory, VendorProfile

WINDOW_ROUNDS = 5         # window_count / window_sum: this round and the 4 before it
COPY_DEGRADATION = 0.22   # scan quality lost per photocopy (same as the prototype)
DEFAULT_STAIN = 0.35      # legibility lost per mug stain (same as the prototype)
CADENCE_CV = 0.25         # cadence std as a share of cadence_days (VendorProfile has no std)
DUP_DATE_SCALE_DAYS = 30  # invoices this many days apart score 0 on date similarity
BUSINESS_HOURS = (9, 17)  # weekdays only
FREE_MAIL_DOMAINS = ("gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "aol.com", "icloud.com", "proton.me")
NEUTRAL_DOMAIN_AGE_DAYS = 3650  # log_domain_age without an email: an established domain
CHANGE_HORIZON_DAYS = 365       # days_since_bank_change with no change on file
NEW_ACCOUNT_DAYS = 60           # new_account_payment: the account was changed less than this many days ago
NO_EMAIL = {  # what an invoice without an email gets (from_domain_known and free_mail_sender read the sender domain)
    "reply_to_mismatch": False, "display_name_spoof": False, "cc_lookalike": False, "dmarc_fail": False,
    "spf_fail": False, "log_domain_age": math.log1p(NEUTRAL_DOMAIN_AGE_DAYS), "first_time_sender": False,
    "new_thread_for_payment": False,
}
NO_CHANGE = {"days_since_bank_change": CHANGE_HORIZON_DAYS, "bank_change_via_email": False,
             "bank_change_verified": False, "change_request_offered_phone": False, "new_account_payment": False}

URGENCY_TERMS = (
    "urgent", "urgently", "asap", "immediately", "right away", "as soon as possible",
    "overdue", "past due", "final notice", "deadline", "time sensitive", "time-sensitive",
    "rush", "end of day", "eod",
)
VAGUE_WORDS = frozenset((
    "services", "service", "consulting", "consultation", "advisory", "strategy", "strategic",
    "support", "misc", "miscellaneous", "various", "general", "solutions", "optimization",
    "alignment", "synergy", "engagement", "deliverables", "facilitation", "management",
    "professional", "assessment", "review", "fees", "fee", "other",
))
BANK_WORDS = frozenset(("bank", "banks", "banking", "account", "accounts", "routing", "remittance", "remit", "wire", "iban"))
CHANGE_WORDS = frozenset((
    "change", "changed", "changes", "changing", "new", "update", "updated", "updating",
    "switch", "switched", "switching", "moved", "different",
))


def compute_features(invoice: Invoice, case_file: CaseFile, session_history: SessionHistory) -> dict[str, float]:
    vendor = find_vendor(invoice, case_file)
    vendor_paid = [p for p in case_file.paid_invoices if _same_vendor(p, invoice)]
    f = {
        **_money(invoice, vendor, case_file),
        **_identity(invoice, vendor, case_file),
        **_process(invoice, vendor, case_file, vendor_paid),
        **_text(invoice),
        **_physical(invoice, vendor),
        **_session(invoice, vendor, session_history, vendor_paid),
        **_email(invoice, vendor, case_file, vendor_paid),
        **_changes(invoice, vendor, case_file),
    }
    return {name: float(f[name]) for name in BASE_FEATURES}


# ---------- feature groups ----------

def _money(inv: Invoice, vendor: VendorProfile | None, cf: CaseFile) -> dict:
    amount = inv.amount
    if vendor:
        mean, std = vendor.amount_mean, vendor.amount_std
    else:
        mean, std = _mean(v.amount_mean for v in cf.vendors), _mean(v.amount_std for v in cf.vendors)
    order = open_order(inv, cf)
    catalog = {_norm(k): p for k, p in vendor.catalog.items()} if vendor else {}
    price_ratios = [li.unit_price / catalog[_norm(li.description)]
                    for li in inv.line_items if catalog.get(_norm(li.description), 0) > 0]
    return {
        "amount_z": (amount - mean) / max(std, 1.0),
        "amount_is_round": amount > 0 and abs(amount - round(amount)) < 1e-6 and round(amount) % 100 == 0,
        "amount_to_limit_ratio": amount / cf.approval_limit if cf.approval_limit > 0 else 0.0,
        "bank_changed": vendor is None or inv.bank_account != vendor.bank_account,
        "order_amount_ratio": amount / order.amount if order and order.amount > 0 else 0.0,
        "max_unit_price_ratio": max(price_ratios, default=1.0),
    }


def _identity(inv: Invoice, vendor: VendorProfile | None, cf: CaseFile) -> dict:
    name, domain = _norm(inv.vendor_name), _norm(inv.sender_domain)
    return {
        "vendor_unknown": vendor is None,
        "vendor_name_similarity": max((SequenceMatcher(None, name, _norm(v.name)).ratio() for v in cf.vendors), default=0.0),
        "domain_mismatch": vendor is None or domain != _norm(vendor.sender_domain),
        "domain_edit_distance": min((edit_distance(domain, _norm(v.sender_domain)) for v in cf.vendors), default=len(domain)),
        "letterhead_match": vendor is not None and inv.letterhead_id == vendor.letterhead_id,
    }


def _process(inv: Invoice, vendor: VendorProfile | None, cf: CaseFile, vendor_paid: list[Invoice]) -> dict:
    cadence_z = 0.0
    if vendor and vendor_paid:
        last = max(vendor_paid, key=lambda p: p.issue_date)
        days = (inv.issue_date - last.issue_date).days
        cadence_z = (days - vendor.cadence_days) / max(CADENCE_CV * vendor.cadence_days, 1.0)
    sent = inv.sent_at
    return {
        "no_open_order": open_order(inv, cf) is None,
        "dup_similarity": max((_dup_similarity(inv, p) for p in cf.paid_invoices), default=0.0),
        "cadence_z": cadence_z,
        "due_days": (inv.due_date - inv.issue_date).days,
        "offhours_send": sent is not None and (sent.weekday() >= 5 or not BUSINESS_HOURS[0] <= sent.hour < BUSINESS_HOURS[1]),
        "line_item_count": len(inv.line_items),
    }


def _text(inv: Invoice) -> dict:
    line_words = _words(" ".join(li.description for li in inv.line_items))
    email = inv.cover_email.lower()
    email_words = set(_words(email))
    return {
        "vague_text_score": sum(w in VAGUE_WORDS for w in line_words) / len(line_words) if line_words else 0.0,
        "email_urgency": sum(bool(re.search(rf"\b{re.escape(t)}\b", email)) for t in URGENCY_TERMS),
        "email_mentions_change": bool(email_words & BANK_WORDS) and bool(email_words & CHANGE_WORDS),
        "email_length": len(inv.cover_email.split()),
    }


def _physical(inv: Invoice, vendor: VendorProfile | None) -> dict:
    stain_loss: dict[str | None, float] = {}
    for use in inv.tool_uses:
        if use.tool == "mug":
            stain_loss[use.target] = stain_loss.get(use.target, 0.0) + float(use.params.get("strength", DEFAULT_STAIN))
    copies = sum(use.tool == "photocopier" for use in inv.tool_uses)
    usual_stamps = set(vendor.usual_stamps) if vendor else set()
    return {
        "field_altered_count": len({use.target for use in inv.tool_uses if use.tool in ("whiteout", "tape")}),
        "max_illegibility": min(1.0, max(stain_loss.values(), default=0.0)),
        "copy_generation": copies,
        "scan_quality": max(0.0, 1 - COPY_DEGRADATION * copies),
        "stamp_count": len(inv.stamps),
        "stamp_matches_vendor": all(s.kind in usual_stamps for s in inv.stamps),
    }


def _session(inv: Invoice, vendor: VendorProfile | None, hist: SessionHistory, vendor_paid: list[Invoice]) -> dict:
    now = hist.round_no
    earlier = [e for e in hist.entries if e.round_no <= now]
    window = [e.invoice for e in earlier if e.round_no > now - WINDOW_ROUNDS and _same_source(e.invoice, inv)]
    if vendor:
        age = now - vendor.first_seen_round
    else:
        seen = [e.round_no for e in earlier if _same_vendor(e.invoice, inv)]
        age = now - min(seen) if seen else 0
    biggest_paid = max((p.amount for p in vendor_paid), default=0.0)
    return {
        "window_count": 1 + len(window),
        "window_sum": inv.amount + sum(w.amount for w in window),
        "vendor_age_rounds": age,
        "amount_jump_ratio": inv.amount / biggest_paid if biggest_paid > 0 else 1.0,
    }


def _email(inv: Invoice, vendor: VendorProfile | None, cf: CaseFile, vendor_paid: list[Invoice]) -> dict:
    mail = inv.email
    domain = email_domain(mail.from_addr) if mail else _norm(inv.sender_domain)
    known = {_norm(p.sender_domain) for p in vendor_paid} | ({_norm(vendor.sender_domain)} if vendor else set())
    f = {
        "from_domain_known": domain in known,  # the vendor's domain on file, or one its paid invoices came from
        "free_mail_sender": domain in FREE_MAIL_DOMAINS,
        **NO_EMAIL,
    }
    if mail is None:
        return f
    vendor_domains = [_norm(v.sender_domain) for v in cf.vendors]
    age = mail.sender_domain_age_days
    return {**f,
        "reply_to_mismatch": bool(mail.reply_to) and email_domain(mail.reply_to) != domain,
        "display_name_spoof": any(name_like(mail.from_name, v.name) and domain != _norm(v.sender_domain) for v in cf.vendors),
        "cc_lookalike": any(1 <= min((edit_distance(email_domain(c), d) for d in vendor_domains), default=0) <= 2
                            for c in mail.cc),
        "dmarc_fail": mail.dmarc == "fail",
        "spf_fail": mail.spf == "fail",
        "log_domain_age": math.log1p(max(0, age)) if age is not None else f["log_domain_age"],
        "first_time_sender": mail.first_time_sender,
        "new_thread_for_payment": mail.thread_id is None and mail.in_reply_to is None,
    }


def _changes(inv: Invoice, vendor: VendorProfile | None, cf: CaseFile) -> dict:
    """The vendor's latest bank-data change. The issue date can't hide one: a change after it counts as 0 days."""
    events = [e for e in cf.bank_changes if vendor and e.vendor_id == vendor.vendor_id]
    if not events:
        return dict(NO_CHANGE)
    last = max(events, key=lambda e: e.changed_at)
    days = min(CHANGE_HORIZON_DAYS, max(0, (inv.issue_date - last.changed_at.date()).days))
    recent = days < CHANGE_HORIZON_DAYS
    return {
        "days_since_bank_change": days,
        "bank_change_via_email": recent and last.channel == "email",
        "bank_change_verified": recent and last.verified,
        "change_request_offered_phone": recent and last.offered_phone,
        "new_account_payment": inv.bank_account == last.new_account and days < NEW_ACCOUNT_DAYS,
    }


def backfill(features: dict[str, float], invoice: Invoice) -> dict[str, float]:
    """A row stored before the realistic channel, with the values an email-less invoice and an empty
    change log give the features it lacks."""
    if all(n in features for n in BASE_FEATURES):
        return features
    channel = {**NO_EMAIL, **NO_CHANGE, "from_domain_known": not features.get("domain_mismatch", 0.0),
               "free_mail_sender": _norm(invoice.sender_domain) in FREE_MAIL_DOMAINS}
    return {**{n: float(v) for n, v in channel.items()}, **features}


# ---------- helpers ----------

def email_domain(address: str) -> str:
    return _norm(address.rpartition("@")[2].strip(" >"))


def name_like(display: str, vendor_name: str) -> bool:
    """A display name that reads as this vendor: its first two words, or a close match to the whole name."""
    d, v = _plain(display), _plain(vendor_name)
    core = " ".join(v.split()[:2])
    return bool(d) and (core in d or SequenceMatcher(None, d, v).ratio() >= 0.8)


def find_vendor(inv: Invoice, cf: CaseFile) -> VendorProfile | None:
    return next((v for v in cf.vendors if v.vendor_id == inv.vendor_id), None) if inv.vendor_id else None


def open_order(inv: Invoice, cf: CaseFile):
    # An order only counts for the vendor it was issued to.
    if not inv.order_number:
        return None
    return next((o for o in cf.open_orders if o.order_number == inv.order_number and o.vendor_id == inv.vendor_id), None)


def _same_vendor(a: Invoice, b: Invoice) -> bool:
    if a.vendor_id and b.vendor_id:
        return a.vendor_id == b.vendor_id
    return _norm(a.vendor_name) == _norm(b.vendor_name)


def _same_source(a: Invoice, b: Invoice) -> bool:
    # Same vendor, or the same payee account under a different name (Salami Slicer rotating names).
    return _same_vendor(a, b) or a.bank_account == b.bank_account


def _dup_similarity(a: Invoice, b: Invoice) -> float:
    """Mean of vendor, amount, line-item and date similarity, each 0..1."""
    vendor = 1.0 if _same_vendor(a, b) else 0.0
    top = max(a.amount, b.amount)
    amount = max(0.0, 1 - abs(a.amount - b.amount) / top) if top > 0 else 1.0
    la, lb = {_norm(li.description) for li in a.line_items}, {_norm(li.description) for li in b.line_items}
    lines = len(la & lb) / len(la | lb) if la | lb else 1.0
    when = max(0.0, 1 - abs((a.issue_date - b.issue_date).days) / DUP_DATE_SCALE_DAYS)
    return (vendor + amount + lines + when) / 4


def edit_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z]+", text.lower())


def _norm(s: str) -> str:
    return s.strip().lower()


def _plain(s: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9 ]", "", s.lower()).split())


def _mean(values) -> float:
    values = list(values)
    return sum(values) / len(values) if values else 0.0
