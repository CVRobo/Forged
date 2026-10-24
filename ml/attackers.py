"""Scripted attackers: one per scheme, with random lever sampling and a fixed-lever mode (spec 2.2).

Every lever costs something in the features ("suspicion is conserved"): taping in a
mule account raises field_altered_count, reprinting the invoice needs a spoofed domain
one or two edits away, a photocopy raises copy_generation. That is how the detector
can still catch maxed camouflage once the payload feature alone no longer decides.
"""
import math
import random
from datetime import timedelta
from typing import Literal

from pydantic import BaseModel

from ml.schema import Invoice, LineItem, ToolUse
from ml.text import EMAIL_RATE, TONES, cover_email
from ml.world import (APPROVAL_LIMIT, ATTACKER_ACCOUNTS, BOSS_DOMAINS, BOSS_LINES, BOSS_NAMES, NEW_VENDOR_NAMES,
                      REGIONS, VENDORS, VendorSpec, ad_hoc_lines, business_day, catalog_lines, domain_for,
                      lookalike_domain, lookalike_name, order_amount_for, scale_lines, sent_time, set_total, slug,
                      stamps_for, weighted)

KNOWN_VENDOR_SCHEMES = ("bank_switcheroo", "duplicate_dance", "padded_invoice")


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
    tone: Literal["none", "plain", "chatty", "apologetic", "urgent"] = "none"  # none: no cover email
    mention_change: bool = False
    send: Literal["business", "offhours"] = "business"
    due: Literal["normal", "short"] = "normal"
    reuse_payee: bool = False  # phantom and boss: reuse this run's last fake payee


CARE = (0.5, 1.0)  # scripted attackers range from sloppy to careful, like players


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
    return Levers(
        scheme_id=scheme_id,
        identity=rng.choice(("copy", "lookalike") if scheme_id in KNOWN_VENDOR_SCHEMES else ("lookalike", "fresh")),
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
    spec = rng.choice(VENDORS)
    items = _amount(rng, lv.amount, catalog_lines(rng, spec))
    order = run.new_order(spec.vendor_id, order_amount_for(rng, _total(items))) if spec.uses_po else None
    tools, domain, letterhead = _paper(rng, lv, spec, [ToolUse(tool="tape", target="bank")])
    return _finish(run, lv, spec.name, spec.vendor_id, items, _known_date(run, lv, spec), order,
                   rng.choice(ATTACKER_ACCOUNTS), domain, letterhead, tools, spec.terms_days, spec.usual_stamps)


def _duplicate_dance(run, lv: Levers) -> Invoice:
    rng = run.rng
    spec = rng.choice([s for s in VENDORS if run.last_paid(s.vendor_id)])
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
    spec = rng.choice([s for s in VENDORS if s.uses_po])
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
    return _finish(run, lv, spec.name, spec.vendor_id, items, _known_date(run, lv, spec), order, spec.bank,
                   domain, letterhead, tools, spec.terms_days, spec.usual_stamps)


def _phantom_supplier(run, lv: Levers) -> Invoice:
    rng = run.rng
    base = None
    if lv.reuse_payee and run.fake_payee and run.fake_payee[0] == "phantom":
        _, name, domain, letterhead, bank = run.fake_payee
    elif lv.identity == "lookalike":  # a name and domain that resemble a real vendor's
        base = rng.choice(VENDORS)
        name, domain = lookalike_name(rng, base.name), lookalike_domain(rng, base.domain)
        letterhead, bank = base.letterhead_id if lv.letterhead == "match" else "lh_generic", rng.choice(ATTACKER_ACCOUNTS)
    else:
        name = rng.choice(NEW_VENDOR_NAMES)
        domain, letterhead, bank = domain_for(rng, name), f"lh_{slug(name)[:10]}", rng.choice(ATTACKER_ACCOUNTS)
    run.fake_payee = ("phantom", name, domain, letterhead, bank)
    items = _amount(rng, lv.amount, catalog_lines(rng, base) if base else ad_hoc_lines(rng))
    issue = business_day(run.clock + timedelta(days=rng.randint(0, 2)))
    return _finish(run, lv, name, None, items, issue, None, bank, domain, letterhead, [], 30, ())


def _boss_request(run, lv: Levers) -> Invoice:
    rng = run.rng
    if lv.reuse_payee and run.fake_payee and run.fake_payee[0] == "boss":
        _, name, domain, letterhead, bank = run.fake_payee
    else:
        name, domain, letterhead, bank = rng.choice(BOSS_NAMES), rng.choice(BOSS_DOMAINS), "lh_owner", rng.choice(ATTACKER_ACCOUNTS)
    run.fake_payee = ("boss", name, domain, letterhead, bank)
    amount = {"typical": _total(ad_hoc_lines(rng)),  # what a real one-off bill from a new payee costs
              "under_limit": rng.uniform(0.90, 0.99) * APPROVAL_LIMIT,
              "round": round(rng.uniform(800, 2400), -2), "inflated": rng.uniform(3000, 6000)}[lv.amount]
    items = [LineItem(description=rng.choice(BOSS_LINES), quantity=1, unit_price=round(amount, 2))]
    issue = business_day(run.clock + timedelta(days=rng.randint(0, 1)))
    return _finish(run, lv, name, None, items, issue, None, bank, domain, letterhead, [], 30, ())


# ---------- shared pieces ----------

def _finish(run, lv: Levers, name, vendor_id, items, issue, order, bank, domain, letterhead, tools, terms,
            usual_stamps, number=None, min_copies=0) -> Invoice:
    rng = run.rng
    tools = list(tools) + [ToolUse(tool="photocopier")] * max(min_copies, lv.photocopies)
    tools += [ToolUse(tool="mug", target=rng.choice(REGIONS)) for _ in range(lv.stains)]
    number = number or run.invoice_number(name)
    email = "" if lv.tone == "none" else cover_email(
        rng, lv.tone, vendor=name, number=number, amount=_total(items),
        new_vendor=vendor_id is None and rng.random() < 0.5, mentions_change=lv.mention_change)
    return Invoice(
        invoice_id=number, vendor_name=name, vendor_id=vendor_id, line_items=items, issue_date=issue,
        due_date=issue + timedelta(days=rng.randint(1, 5) if lv.due == "short" else terms),
        order_number=order, bank_account=bank, sender_domain=domain, letterhead_id=letterhead,
        stamps=stamps_for(rng, lv.stamp, usual_stamps), tool_uses=tools, cover_email=email,
        sent_at=sent_time(rng, issue, offhours=lv.send == "offhours"),
    )


def _paper(rng: random.Random, lv: Levers, spec: VendorSpec, edits: list[ToolUse]):
    """copy: the vendor's own domain and letterhead, changed by hand. lookalike: a clean reprint from a spoofed domain."""
    if lv.identity == "copy":
        return edits, spec.domain, spec.letterhead_id
    return [], lookalike_domain(rng, spec.domain), spec.letterhead_id if lv.letterhead == "match" else "lh_generic"


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
