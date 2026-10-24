"""Scripted attackers: one per scheme, with random lever sampling and a fixed-lever mode (spec 2.2).

Every lever costs something in the features ("suspicion is conserved"): taping in a
mule account raises field_altered_count, reprinting the invoice needs a spoofed domain
one or two edits away, a photocopy raises copy_generation. That is how the detector
can still catch maxed camouflage once the payload feature alone no longer decides.

Every attack arrives by email (docs/realistic-data-plan.md section 2), and how the sender
got its address costs something too: a lookalike or new domain is days old unless it was
bought aged, free mail is free mail, spoofing the vendor's own domain fails DMARC. Only a
compromised vendor mailbox passes every check, and it's the rarest choice.

Bank Change Fraud is the two-act attack (section 3): change_request() asks the AP desk to
move a vendor's payments to a mule account, and if the desk applies it,
bank_change_invoice() later sends an ordinary invoice that pays the account now on file.
"""
import math
import random
from datetime import datetime, time, timedelta
from typing import Literal

from pydantic import BaseModel

from ml.mail import sender_email, vendor_thread
from ml.schema import EmailMessage, Invoice, LineItem, ToolUse, VendorChangeRequest
from ml.text import CHANGE_SUBJECTS, EMAIL_RATE, TONES, change_request_text, cover_email, invoice_subject
from ml.world import (APPROVAL_LIMIT, ATTACKER_ACCOUNTS, BOSS_DOMAINS, BOSS_LINES, BOSS_NAMES, CONTACT_NAMES,
                      FREE_MAIL_DOMAINS, NEW_VENDOR_NAMES, REGIONS, VENDOR_SPECS, VENDORS, VendorSpec, ad_hoc_lines,
                      business_day, catalog_lines, domain_for, lookalike_domain, lookalike_name, order_amount_for,
                      scale_lines, sent_time, set_total, slug, stamps_for, weighted)

KNOWN_VENDOR_SCHEMES = ("bank_switcheroo", "duplicate_dance", "padded_invoice", "bank_change_fraud")
Sender = Literal["auto", "lookalike_domain", "free_mail", "spoofed_domain", "compromised_mailbox", "new_domain"]
# The senders each paper identity allows, cleanest first: copy keeps the vendor's own domain, lookalike
# and fresh don't. A paper-mode record has no email, so it reads like the cleanest sender.
SENDERS = {
    "copy": ("compromised_mailbox", "spoofed_domain"),
    "lookalike": ("lookalike_domain", "free_mail"),
    "fresh": ("new_domain", "free_mail"),
}
SENDER_ODDS = {
    "copy": {"spoofed_domain": 0.6, "compromised_mailbox": 0.4},  # a compromised mailbox is an unlock
    "lookalike": {"lookalike_domain": 0.75, "free_mail": 0.25},
    "fresh": {"new_domain": 0.8, "free_mail": 0.2},
}
FAKE_PHONES = ("(415) 555-0199", "(628) 555-0134", "(510) 555-0188", "(925) 555-0111")  # the attacker's numbers


class Levers(BaseModel):
    """Every choice a scripted attacker makes. Fixed levers replay one trick on new vendors, amounts and dates."""
    scheme_id: str
    identity: Literal["copy", "lookalike", "fresh"]  # copy: edit the vendor's own paper; lookalike: reprint
                                                      # with a spoofed domain; fresh: a brand-new payee name
    amount: Literal["typical", "under_limit", "round", "inflated"]
    timing: Literal["on_cadence", "right_after", "random"]
    letterhead: Literal["match", "generic"] = "match"
    pad_method: Literal["price", "quantity", "fee"] = "price"  # padded_invoice
    dup_change: Literal["number", "date", "line"] = "number"   # duplicate_dance
    photocopies: int = 0
    stains: int = 0
    stamp: Literal["none", "habit", "random"] = "none"
    tone: Literal["none", "plain", "chatty", "apologetic", "urgent"] = "none"  # none: an email with no message
    mention_change: bool = False
    send: Literal["business", "offhours"] = "business"
    due: Literal["normal", "short"] = "normal"
    reuse_payee: bool = False  # phantom and boss: reuse this run's last fake payee
    # the email (section 2)
    sender: Sender = "auto"    # auto: the identity's cleanest sender (see sender_for)
    aged_domain: bool = False  # a lookalike or new domain bought years old
    display: Literal["vendor", "person"] = "vendor"  # the From display name: the vendor's, or a person's
    reply_to: Literal["none", "attacker"] = "none"   # replies go to another attacker address
    cc: bool = False                                 # CC a lookalike of the vendor's domain
    thread: Literal["new", "reply"] = "new"          # reply into the vendor's billing thread
    # act 1 of bank_change_fraud (section 3)
    channel: Literal["email", "phone"] = "email"
    offer_phone: bool = False  # give a number "for verification": a callback to it reaches the attacker


CARE = (0.5, 1.0)  # scripted attackers range from sloppy to careful, like players


def sender_for(lv: Levers) -> str:
    """The sender this setting uses: its own if the identity allows it, else the identity's cleanest one."""
    allowed = SENDERS[lv.identity]
    return lv.sender if lv.sender in allowed else allowed[0]


def sample_levers(rng: random.Random, scheme_id: str, care: float | None = None) -> Levers:
    """care: the chance each optional lever stays at its clean, legit-looking setting.

    The rest are drawn uniformly, so sloppy attacks stack tells and careful ones
    carry only their payload and the conserved cost of faking it.
    """
    care = rng.uniform(*CARE) if care is None else care

    def lever(clean, options):
        return clean if rng.random() < care else rng.choice(options)

    if rng.random() < EMAIL_RATE:
        tone = lever(weighted(rng, {"plain": .55, "chatty": .25, "apologetic": .20}), TONES)
    else:
        tone = "none"
    identity = rng.choice(("copy", "lookalike") if scheme_id in KNOWN_VENDOR_SCHEMES else ("lookalike", "fresh"))
    sender = weighted(rng, SENDER_ODDS[identity])
    return Levers(
        scheme_id=scheme_id,
        identity=identity,
        amount=lever("typical", ("typical", "under_limit", "round", "inflated")),
        timing=lever("on_cadence", ("on_cadence", "right_after", "random")),
        letterhead=lever("match", ("match", "generic")),
        pad_method=rng.choice(("price", "quantity", "fee")),
        dup_change=weighted(rng, {"line": .5, "date": .25, "number": .25}),
        photocopies=lever(0, (0, 1, 2)),
        stains=lever(0, (0, 1, 2)),
        stamp=lever("none", ("none", "habit", "random")),
        tone=tone,
        mention_change=tone != "none" and rng.random() < (0.6 if scheme_id == "bank_switcheroo" else 0.03),
        send=lever("business", ("business", "offhours")),
        due=lever("normal", ("normal", "short")),
        reuse_payee=rng.random() < 0.4,
        sender=sender,
        aged_domain=rng.random() < 0.7 * care,
        display="person" if rng.random() < 0.5 * care else "vendor",
        reply_to=lever("none", ("none", "attacker")),
        cc=lever(False, (False, True)),
        thread="reply" if rng.random() < (0.7 if sender == "compromised_mailbox" else 0.35) else "new",
        channel="phone" if rng.random() < 0.2 else "email",
        offer_phone=rng.random() < 0.6,
    )


def attack_invoice(run, lv: Levers) -> Invoice:
    """run: a generate.Run (rng, clock, case file, open orders, paid invoices)."""
    return {
        "bank_switcheroo": _bank_switcheroo, "duplicate_dance": _duplicate_dance, "padded_invoice": _padded_invoice,
        "phantom_supplier": _phantom_supplier, "boss_request": _boss_request,
    }[lv.scheme_id](run, lv)


# ---------- one builder per scheme ----------

def _bank_switcheroo(run, lv: Levers) -> Invoice:
    rng = run.rng
    spec = rng.choice(run.open_vendors())
    items = _amount(rng, lv.amount, catalog_lines(rng, spec))
    order = run.new_order(spec.vendor_id, order_amount_for(rng, _total(items))) if spec.uses_po else None
    tools, domain, letterhead = _paper(rng, lv, spec, [ToolUse(tool="tape", target="bank")])
    return _finish(run, lv, spec.name, spec.vendor_id, items, _known_date(run, lv, spec), order,
                   rng.choice(ATTACKER_ACCOUNTS), domain, letterhead, tools, spec.terms_days, spec.usual_stamps)


def _duplicate_dance(run, lv: Levers) -> Invoice:
    rng = run.rng
    spec = rng.choice([s for s in run.open_vendors() if run.last_paid(s.vendor_id)])
    paid = run.last_paid(spec.vendor_id)
    items, issue, number = [li.model_copy() for li in paid.line_items], paid.issue_date, paid.invoice_id
    if lv.dup_change == "number":
        number = run.invoice_number(spec.name)
    elif lv.dup_change == "date":  # still inside the paid invoice's period, on a weekday
        issue = paid.issue_date + timedelta(days=rng.randint(1, max(1, math.ceil(spec.cadence_days / 2) - 1)))
        issue -= timedelta(days=max(0, issue.weekday() - 4))
    else:
        i = rng.randrange(len(items))
        items[i] = items[i].model_copy(update={"description": items[i].description + " (rev.)"})
    target = {"number": "invoice_id", "date": "issue_date", "line": "items"}[lv.dup_change]
    tools, domain, letterhead = _paper(rng, lv, spec, [ToolUse(tool="whiteout", target=target)])
    if lv.identity == "copy":
        domain, letterhead = paid.sender_domain, paid.letterhead_id
    return _finish(run, lv, spec.name, spec.vendor_id, items, issue, paid.order_number, paid.bank_account, domain,
                   letterhead, tools, (paid.due_date - paid.issue_date).days, spec.usual_stamps,
                   number=number, min_copies=1 if lv.identity == "copy" else 0)


def _padded_invoice(run, lv: Levers) -> Invoice:
    rng = run.rng
    spec = rng.choice([s for s in run.open_vendors() if s.uses_po])
    items = catalog_lines(rng, spec)
    real = _total(items)
    order = run.new_order(spec.vendor_id, real)
    target = real * {"typical": rng.uniform(1.17, 1.30), "inflated": rng.uniform(1.30, 1.80),
                     "round": rng.uniform(1.17, 1.35), "under_limit": rng.uniform(1.17, 1.30)}[lv.amount]
    if lv.amount == "round":
        target = math.ceil(target / 100) * 100
    elif lv.amount == "under_limit":
        target = max(min(target, rng.uniform(0.90, 0.99) * APPROVAL_LIMIT), real * 1.17)
    items = _pad(items, target, lv.pad_method)
    edit = ToolUse(tool="tape" if lv.pad_method == "fee" else "whiteout", target="items")
    tools, domain, letterhead = _paper(rng, lv, spec, [edit])
    return _finish(run, lv, spec.name, spec.vendor_id, items, _known_date(run, lv, spec), order, run.bank_on_file(spec),
                   domain, letterhead, tools, spec.terms_days, spec.usual_stamps)


def _phantom_supplier(run, lv: Levers) -> Invoice:
    rng = run.rng
    base = None
    if lv.reuse_payee and run.fake_payee and run.fake_payee[0] == "phantom":
        _, name, domain, letterhead, bank = run.fake_payee
    elif lv.identity == "lookalike":  # a name and domain that resemble a real vendor's
        base = rng.choice(VENDORS)
        name, domain = lookalike_name(rng, base.name), _sender_domain(rng, lv, lookalike_domain(rng, base.domain))
        letterhead, bank = base.letterhead_id if lv.letterhead == "match" else "lh_generic", rng.choice(ATTACKER_ACCOUNTS)
    else:
        name = rng.choice(NEW_VENDOR_NAMES)
        domain, letterhead, bank = _sender_domain(rng, lv, domain_for(rng, name)), f"lh_{slug(name)[:10]}", rng.choice(ATTACKER_ACCOUNTS)
    run.fake_payee = ("phantom", name, domain, letterhead, bank)
    items = _amount(rng, lv.amount, catalog_lines(rng, base) if base else ad_hoc_lines(rng))
    issue = business_day(run.clock + timedelta(days=rng.randint(0, 2)))
    return _finish(run, lv, name, None, items, issue, None, bank, domain, letterhead, [], 30, (),
                   real_domain=base.domain if base else domain)


def _boss_request(run, lv: Levers) -> Invoice:
    rng = run.rng
    if lv.reuse_payee and run.fake_payee and run.fake_payee[0] == "boss":
        _, name, domain, letterhead, bank = run.fake_payee
    else:
        name, letterhead, bank = rng.choice(BOSS_NAMES), "lh_owner", rng.choice(ATTACKER_ACCOUNTS)
        domain = _sender_domain(rng, lv, rng.choice(BOSS_DOMAINS))
    run.fake_payee = ("boss", name, domain, letterhead, bank)
    amount = {"typical": _total(ad_hoc_lines(rng)),  # what a real one-off bill from a new payee costs
              "under_limit": rng.uniform(0.90, 0.99) * APPROVAL_LIMIT,
              "round": round(rng.uniform(800, 2400), -2), "inflated": rng.uniform(3000, 6000)}[lv.amount]
    items = [LineItem(description=rng.choice(BOSS_LINES), quantity=1, unit_price=round(amount, 2))]
    issue = business_day(run.clock + timedelta(days=rng.randint(0, 1)))
    return _finish(run, lv, name, None, items, issue, None, bank, domain, letterhead, [], 30, ())


# ---------- the two-act attack ----------

def change_request(run, lv: Levers, spec: VendorSpec, request_id: str) -> VendorChangeRequest:
    """Act 1: ask the desk to move this vendor's payments to a mule account."""
    rng = run.rng
    account = rng.choice(ATTACKER_ACCOUNTS)
    phone = rng.choice(FAKE_PHONES) if lv.offer_phone else None
    when = sent_time(rng, business_day(run.clock + timedelta(days=rng.randint(0, 2))), offhours=lv.send == "offhours")
    email = None
    if lv.channel == "email":
        tone = lv.tone if lv.tone != "none" else "plain"
        body = change_request_text(rng, tone, vendor=spec.name, account=account, phone=phone)
        email = attack_email(run, lv, display=_display(rng, lv, spec.name), domain=_paper(rng, lv, spec, [])[1],
                             real_domain=spec.domain, vendor_id=spec.vendor_id, subject=rng.choice(CHANGE_SUBJECTS),
                             body=body, sent_at=when)
    return VendorChangeRequest(request_id=request_id, vendor_id=spec.vendor_id, new_bank_account=account,
                               channel=lv.channel, email=email, phone_number_given=phone, requested_at=when)


def bank_change_invoice(run, lv: Levers, spec: VendorSpec, issue, sender: EmailMessage | None) -> Invoice:
    """Act 2: an ordinary invoice from the vendor, on its cadence, paying the account now on file.
    sender: act 1's email, so the invoice comes from the same address."""
    rng = run.rng
    items = _amount(rng, lv.amount, catalog_lines(rng, spec))
    order = run.new_order(spec.vendor_id, order_amount_for(rng, _total(items))) if spec.uses_po else None
    domain = sender.from_addr.rpartition("@")[2] if sender else _paper(rng, lv, spec, [])[1]
    letterhead = spec.letterhead_id if lv.identity == "copy" or lv.letterhead == "match" else "lh_generic"
    return _finish(run, lv, spec.name, spec.vendor_id, items, issue, order, run.bank_on_file(spec), domain, letterhead,
                   [], spec.terms_days, spec.usual_stamps, reuse=sender)


# ---------- shared pieces ----------

def _finish(run, lv: Levers, name, vendor_id, items, issue, order, bank, domain, letterhead, tools, terms,
            usual_stamps, number=None, min_copies=0, real_domain=None, reuse=None) -> Invoice:
    rng = run.rng
    tools = list(tools) + [ToolUse(tool="photocopier")] * max(min_copies, lv.photocopies)
    tools += [ToolUse(tool="mug", target=rng.choice(REGIONS)) for _ in range(lv.stains)]
    number = number or run.invoice_number(name)
    text = "" if lv.tone == "none" else cover_email(
        rng, lv.tone, vendor=name, number=number, amount=_total(items),
        new_vendor=vendor_id is None and rng.random() < 0.5, mentions_change=lv.mention_change)
    sent_at = sent_time(rng, issue, offhours=lv.send == "offhours")
    real = VENDOR_SPECS[vendor_id].domain if vendor_id else (real_domain or domain)
    email = attack_email(run, lv, display=_display(rng, lv, name), domain=domain, real_domain=real, vendor_id=vendor_id,
                         subject=invoice_subject(rng, number, name, urgent=lv.tone == "urgent"), body=text,
                         sent_at=sent_at, reuse=reuse)
    return Invoice(
        invoice_id=number, vendor_name=name, vendor_id=vendor_id, line_items=items, issue_date=issue,
        due_date=issue + timedelta(days=rng.randint(1, 5) if lv.due == "short" else terms),
        order_number=order, bank_account=bank, sender_domain=domain, letterhead_id=letterhead,
        stamps=stamps_for(rng, lv.stamp, usual_stamps), tool_uses=tools, cover_email=text,
        sent_at=sent_at, email=email,
    )


def attack_email(run, lv: Levers, *, display: str, domain: str, real_domain: str, vendor_id: str | None,
                 subject: str, body: str, sent_at: datetime, reuse: EmailMessage | None = None) -> EmailMessage:
    """The attacker's email from domain (the invoice's sender domain). real_domain: the domain it imitates.
    reuse: an earlier email whose sender this one keeps (act 2 writes from act 1's address)."""
    rng = run.rng
    spec = VENDOR_SPECS.get(vendor_id) if vendor_id else None
    thread = vendor_thread(spec) if spec and lv.thread == "reply" else (None, None)
    subject = ("Re: " + subject) if thread[0] else subject
    if reuse is not None:
        mail = reuse.model_copy(update={"subject": subject, "body": body, "sent_at": sent_at, "thread_id": thread[0],
                                        "in_reply_to": thread[1], "message_id": f"<{slug(subject)}.{sent_at:%Y%m%d%H%M}."
                                                                                f"{reuse.message_id.strip('<>')}>"})
        return mail.model_copy(update={"first_time_sender": run.first_contact(mail.from_addr)})
    sender = sender_for(lv)
    own = spec is not None and domain.lower() == spec.domain
    age = spec.domain_age_days if own else rng.randint(2500, 5000)  # a vendor's other sending domain is years old
    local = "billing" if sender != "new_domain" else "accounts"
    reply_to = None
    if lv.reply_to == "attacker":
        reply_to = f"payments@{lookalike_domain(rng, real_domain)}" if rng.random() < 0.6 else \
            f"{slug(display)[:10]}.ap@{rng.choice(FREE_MAIL_DOMAINS)}"
    cc = [f"accounts@{lookalike_domain(rng, real_domain)}"] if lv.cc else []
    mail = sender_email(rng, sender, real_domain=domain, real_age=age, from_name=display,
                        subject=subject, body=body, sent_at=sent_at,
                        local_part=local, domain=domain, reply_to=reply_to, cc=cc, thread_id=thread[0],
                        in_reply_to=thread[1], aged_domain=lv.aged_domain, free_mail_name=display)
    return mail.model_copy(update={"first_time_sender": run.first_contact(mail.from_addr)})


def _display(rng: random.Random, lv: Levers, name: str) -> str:
    return name if lv.display == "vendor" else rng.choice(CONTACT_NAMES)


def _sender_domain(rng: random.Random, lv: Levers, domain: str) -> str:
    """Free mail replaces the domain an identity would otherwise send from."""
    return rng.choice(FREE_MAIL_DOMAINS) if sender_for(lv) == "free_mail" else domain


def _paper(rng: random.Random, lv: Levers, spec: VendorSpec, edits: list[ToolUse]):
    """copy: the vendor's own domain and letterhead, changed by hand. lookalike: a clean reprint from a spoofed domain."""
    if lv.identity == "copy":
        return edits, spec.domain, spec.letterhead_id
    return [], _sender_domain(rng, lv, lookalike_domain(rng, spec.domain)), \
        spec.letterhead_id if lv.letterhead == "match" else "lh_generic"


def _known_date(run, lv: Levers, spec: VendorSpec):
    rng, last = run.rng, run.last_paid(spec.vendor_id)
    if last is None or lv.timing == "random":
        return business_day(run.clock + timedelta(days=rng.randint(0, 2)))
    if lv.timing == "on_cadence":
        return business_day(last.issue_date + timedelta(days=spec.cadence_days + rng.randint(-1, 1)))
    return business_day(last.issue_date + timedelta(days=rng.randint(1, 3)))  # right after a real one


def _amount(rng: random.Random, strategy: str, items: list[LineItem]) -> list[LineItem]:
    total = _total(items)
    if strategy == "inflated":
        return scale_lines(items, rng.uniform(1.6, 2.6))
    if strategy == "under_limit":
        target = rng.uniform(0.90, 0.99) * APPROVAL_LIMIT
        return set_total(scale_lines(items, target / total), target)
    if strategy == "round":
        return set_total(items, max(100, round(total / 100) * 100))
    return items


def _pad(items: list[LineItem], target: float, method: str) -> list[LineItem]:
    if method == "fee":
        return items + [LineItem(description="Handling fee", quantity=1, unit_price=round(target - _total(items), 2))]
    if method == "price":
        return set_total(items, target)
    items = [li.model_copy() for li in items]  # quantity: bump the priciest line until the total clears target
    top = max(items, key=lambda li: li.unit_price)
    top.quantity += math.ceil((target - _total(items)) / top.unit_price)
    return items


def _total(items: list[LineItem]) -> float:
    return sum(li.quantity * li.unit_price for li in items)
