"""Defender mode: the player works Sunny Diner's AP desk (docs/superpowers/specs/2026-10-24-defender-mode-design.md).

A shift is SHIFT_SIZE invoices in a row from one simulated run of the desk's inbox, each with the
email it came in and the case file as it stood before it. The fakes are the scripted attackers'.
Each item carries everything the reveal needs:

    truth     the payload check against the run's hidden Truth
    verdict   the live detector's call, judged as predict() judges level 1 (memory off)
    callback  what a call to the number on file (or the owner, for a vendor not on file) would hear

    ml/.venv/bin/python -m ml.defender                                          # print shift 1
    ml/.venv/bin/python -m ml.defender --export prototype/defend-shifts.json    # the offline shifts

Nothing is logged. Shifts are deterministic per seed (and detector version), so decisions can be
logged later as (seed, item, decision, callback used).
"""
import argparse
import json
import math
from pathlib import Path

from ml import explain, store, training
from ml.features import CHANGE_HORIZON_DAYS, DEFAULT_STAIN, find_vendor, open_order
from ml.generate import Run, simulate
from ml.payloads import _rebills, payload_schemes
from ml.schema import LEVELS, CaseFile, EmailMessage, Invoice, Submission
from ml.world import LEVEL_ID, VENDOR_SPECS, Truth

SHIFT_SIZE = 8
FRAUDS = (2, 4)         # frauds per shift
MIN_SCHEMES = 2         # distinct schemes among them
ATTACK_RATE = 0.4
SEARCH_RUNS = 12        # runs searched per seed for the window with the most schemes
SEED_BASE = 10_000      # keeps shifts off the seeds the detector trains and is checked on (1-12)
CALLBACKS = 2           # per shift
PAID_SHOWN = 8          # paid invoices listed before the shift starts
REASONS = 3
MIN_PUSH = 0.1          # the same cutoff explain.tells uses (a strength of 1)
OWNER = "Big Lou, the owner (internal line)"  # who answers for a vendor that isn't on file

# The reasons whose explain.PHRASES wording needs a threshold, in this invoice's own numbers. Each is a
# reason only on its suspicious side: the model also leans a little on, say, an old domain's exact age.
INVOICE_REASONS = {  # feature -> (on the suspicious side, wording)
    "amount_z": (lambda v: v > 0, lambda v: f"an amount {v:.1f} standard deviations above the vendor's usual" if v < 10
                 else "an amount far above the vendor's usual"),  # a subscription's std is about 0
    "order_amount_ratio": (lambda v: v > 1, lambda v: f"a total {(v - 1) * 100:.0f}% over the purchase order"),
    "max_unit_price_ratio": (lambda v: v > 1, lambda v: f"unit prices {(v - 1) * 100:.0f}% above the vendor's catalog"),
    "due_days": (lambda v: v < 30, lambda v: f"payment due in {v:.0f} days"),
    "log_domain_age": (lambda v: v < math.log1p(365), lambda v: f"a sender domain registered {_days(math.expm1(v))} ago"),
    "days_since_bank_change": (lambda v: v < CHANGE_HORIZON_DAYS,
                               lambda v: f"a payment {_days(v)} after a bank-details change"),
}

SCHEME_ORDER = ("bank_change_fraud", "bank_switcheroo", "boss_request", "phantom_supplier", "duplicate_dance",
                "padded_invoice")  # an invoice with several payloads is explained by the first
SCHEME_NAMES = {
    "bank_change_fraud": "Bank change fraud", "bank_switcheroo": "Bank switcheroo", "boss_request": "Boss request",
    "phantom_supplier": "Phantom supplier", "duplicate_dance": "Duplicate dance", "padded_invoice": "Padded invoice",
}


def build_shift(seed: int, size: int = SHIFT_SIZE) -> dict:
    version = training.ensure_v1()
    run, start = find_window(seed, size)
    return _shift(seed, run, start, size, version)


def find_window(seed: int, size: int = SHIFT_SIZE) -> tuple[Run, int]:
    """The window of `size` rounds with 2-4 frauds and the most distinct schemes (then the closest to 3 frauds,
    then the earliest) in this seed's first SEARCH_RUNS runs, as (run, index of its first row). The two-act
    bank change fraud, the most common real attack, counts as two schemes."""
    best = None
    for index in range(SEARCH_RUNS):
        run = simulate(SEED_BASE + seed, index, attack_rate=ATTACK_RATE, snapshots=True)
        for start in range(len(run.rows) - size + 1):
            frauds = [r for r in run.rows[start:start + size] if r.is_fraud]
            schemes = {r.scheme_id for r in frauds}
            rank = (len(schemes) + ("bank_change_fraud" in schemes), -abs(len(frauds) - 3))
            if FRAUDS[0] <= len(frauds) <= FRAUDS[1] and (best is None or rank > best[0]):
                best = (rank, run, start)
    if best is None or best[0][0] < MIN_SCHEMES:
        raise RuntimeError(f"no shift of {size} with {FRAUDS} frauds from {MIN_SCHEMES}+ schemes for seed {seed}")
    return best[1], best[2]


def export_shifts(path: str | Path, seeds) -> None:
    Path(path).write_text(json.dumps({"shifts": [build_shift(s) for s in seeds]}, indent=1))


def primary_scheme(schemes, intended: str | None = None) -> str | None:
    """The scheme an invoice is explained by: the attacker's own when the payload check agrees (a phantom
    supplier without a PO is also a boss request), else the first in SCHEME_ORDER."""
    return intended if intended in schemes else next((s for s in SCHEME_ORDER if s in schemes), None)


def callback_line(inv: Invoice, case: CaseFile, truth: Truth, schemes, intended: str | None = None) -> dict:
    """What the callback hears: the vendor on its number on file, or the owner for a vendor not on file."""
    scheme, vendor = primary_scheme(schemes, intended), find_vendor(inv, case)
    if vendor is None:
        says = {"boss_request": "I never asked for that payment. Don't pay it.",
                "phantom_supplier": f"{inv.vendor_name}? Never heard of them. Don't pay it."}.get(
            scheme, f"Yes, we just started working with {inv.vendor_name}. Go ahead.")
        return {"who": OWNER, "says": says}
    if scheme == "bank_switcheroo":
        says = f"That's not our account. We're still at the one ending {vendor.bank_account}."
    elif scheme == "bank_change_fraud":
        says = f"We never asked to change our bank details! Our account ends {_account_before_change(vendor.vendor_id, case)}."
    elif scheme == "duplicate_dance":
        paid = _rebilled(inv, case, vendor.cadence_days)
        says = f"That's a copy of {paid.invoice_id} from {_day(paid.issue_date)}. We only billed that once."
    elif scheme == "padded_invoice":
        order = open_order(inv, case)
        real = truth.order_amounts.get(order.order_number, order.amount)
        says = f"Our invoice for {order.order_number} was ${real:,.2f}, not ${inv.amount:,.2f}."
    else:
        says = f"Yes, {inv.invoice_id} for ${inv.amount:,.2f} is ours."
        if inv.bank_account != vendor.bank_account:
            says += f" We moved banks recently, our new account ends {inv.bank_account}."
    return {"who": f"{vendor.name} · {vendor.phone}", "says": says}


# ---------- one shift ----------

def _shift(seed: int, run: Run, start: int, size: int, version: int) -> dict:
    det, threshold = store.load_detector(version), store.threshold(version, LEVEL_ID)
    first = run.snapshots[start]
    paid = sorted(first.paid_invoices, key=lambda p: p.issue_date, reverse=True)[:PAID_SHOWN]
    shift_id = f"shift-{seed}"
    return {
        "shift_id": shift_id, "seed": seed, "level": 1, "callbacks": CALLBACKS,
        "inspector": {"version": version, "threshold": round(threshold, 4)},
        "approval_limit": first.approval_limit,
        "paid_before": [_paid(p) for p in paid],
        "items": [_item(f"{shift_id}-{k + 1}", run.rows[start + k], run.snapshots[start + k], run.truth, det, threshold)
                  for k in range(size)],
    }


def _item(item_id: str, row: Submission, case: CaseFile, truth: Truth, det, threshold: float) -> dict:
    inv = row.invoice
    schemes = payload_schemes(inv, case, truth)
    return {
        "id": item_id,
        "email": _email(inv.email),
        "invoice": _invoice(inv, case),
        "case": _case(case),
        "callback": callback_line(inv, case, truth, schemes, row.scheme_id),
        "truth": _truth(inv, case, schemes, row.scheme_id),
        "verdict": _verdict(det, threshold, row.features),
    }


def _verdict(det, threshold: float, features: dict[str, float]) -> dict:
    memory = LEVELS[LEVEL_ID].memory_enabled
    score = det.score_features(features, memory=memory)
    pushes = sorted(((n, p) for n, p in det.contributions(features, memory).items()
                     if p >= MIN_PUSH and n in explain.TELLS and (n not in INVOICE_REASONS or INVOICE_REASONS[n][0](features[n]))),
                    key=lambda t: -t[1])
    return {"flagged": score >= threshold, "score": round(score, 4),
            "reasons": [{"feature": n, "text": reason_text(n, features[n]), "region": explain.TELLS[n][1]}
                        for n, _ in pushes[:REASONS]]}


def reason_text(feature: str, value: float) -> str:
    return INVOICE_REASONS[feature][1](value) if feature in INVOICE_REASONS else explain.phrase(feature)


def _truth(inv: Invoice, case: CaseFile, schemes, intended: str | None = None) -> dict:
    scheme, vendor = primary_scheme(schemes, intended), find_vendor(inv, case)
    acct = inv.bank_account
    if scheme == "bank_change_fraud":
        why = f"A change request moved {inv.vendor_name}'s payments to the mule account ending {acct}. " \
              "The real vendor never asked."
    elif scheme == "bank_switcheroo":
        why = f"The account ending {acct} is a mule account, not {inv.vendor_name}'s."
    elif scheme == "boss_request":
        why = f"Nobody at the top asked for it: an unapproved payee, no PO, and a mule account ending {acct}."
    elif scheme == "phantom_supplier":
        why = f"{inv.vendor_name} doesn't exist. The account ending {acct} is a mule account."
    elif scheme == "duplicate_dance":
        paid = _rebilled(inv, case, vendor.cadence_days)
        why = f"It re-bills {paid.invoice_id} ({_day(paid.issue_date)}), a period that was already paid."
    elif scheme == "padded_invoice":
        why = "The total is padded well past the real order."
    else:
        if vendor is None:
            why = f"{inv.vendor_name} is real: a new vendor still being onboarded."
        elif acct != vendor.bank_account:
            why = f"{inv.vendor_name} really did move banks; the file still has the old account."
        else:
            why = f"Nothing wrong with it: {inv.vendor_name} billed for real."
    return {"fraud": bool(schemes), "scheme": scheme, "scheme_name": SCHEME_NAMES.get(scheme, "Real invoice"),
            "schemes": sorted(schemes), "why": why}


def _rebilled(inv: Invoice, case: CaseFile, cadence_days: int) -> Invoice:
    return next(p for p in case.paid_invoices if _rebills(inv, p, cadence_days))


def _account_before_change(vendor_id: str, case: CaseFile) -> str:
    events = [e for e in case.bank_changes if e.vendor_id == vendor_id]
    return max(events, key=lambda e: e.changed_at).old_account


# ---------- what the screen shows ----------

def _email(mail: EmailMessage | None) -> dict | None:
    if mail is None:
        return None
    return {"from_name": mail.from_name, "from_addr": mail.from_addr, "reply_to": mail.reply_to, "cc": list(mail.cc),
            "subject": mail.subject, "body": mail.body, "sent_at": mail.sent_at.isoformat(),
            "in_thread": mail.thread_id is not None or mail.in_reply_to is not None,
            "spf": mail.spf, "dkim": mail.dkim, "dmarc": mail.dmarc,
            "domain_age_days": mail.sender_domain_age_days, "first_time_sender": mail.first_time_sender}


def _invoice(inv: Invoice, case: CaseFile) -> dict:
    vendor = find_vendor(inv, case)
    if inv.letterhead_id == "lh_generic":
        letterhead = "generic"
    else:
        letterhead = "vendor" if vendor and inv.letterhead_id == vendor.letterhead_id else "other"
    stains: dict[str, float] = {}
    for use in inv.tool_uses:
        if use.tool == "mug":
            stains[use.target] = round(min(1.0, stains.get(use.target, 0.0) + float(use.params.get("strength", DEFAULT_STAIN))), 2)
    return {
        "invoice_id": inv.invoice_id, "vendor_name": inv.vendor_name, "vendor_id": inv.vendor_id,
        "issue_date": inv.issue_date.isoformat(), "due_date": inv.due_date.isoformat(),
        "order_number": inv.order_number, "bank_account": inv.bank_account, "sender_domain": inv.sender_domain,
        "letterhead": letterhead,
        "line_items": [{"description": li.description, "quantity": li.quantity, "unit_price": li.unit_price}
                       for li in inv.line_items],
        "amount": round(inv.amount, 2), "stamps": [s.kind for s in inv.stamps],
        "paper": {"taped": sorted({u.target for u in inv.tool_uses if u.tool == "tape" and u.target}),
                  "whiteout": sorted({u.target for u in inv.tool_uses if u.tool == "whiteout" and u.target}),
                  "stains": stains, "copies": sum(u.tool == "photocopier" for u in inv.tool_uses)},
    }


def _case(case: CaseFile) -> dict:
    return {
        "vendors": [{"vendor_id": v.vendor_id, "name": v.name, "domain": v.sender_domain, "bank_on_file": v.bank_account,
                     "phone": v.phone, "usual_amount": round(v.amount_mean, 2), "cadence_days": v.cadence_days,
                     "uses_po": VENDOR_SPECS[v.vendor_id].uses_po if v.vendor_id in VENDOR_SPECS else False}
                    for v in case.vendors],
        "open_orders": [{"order_number": o.order_number, "vendor_id": o.vendor_id, "amount": round(o.amount, 2)}
                        for o in case.open_orders],
        "bank_changes": [{"vendor_id": e.vendor_id, "old_account": e.old_account, "new_account": e.new_account,
                          "changed_at": e.changed_at.isoformat(), "channel": e.channel, "verified": e.verified,
                          "offered_phone": e.offered_phone}
                         for e in sorted(case.bank_changes, key=lambda e: e.changed_at, reverse=True)],
    }


def _paid(inv: Invoice) -> dict:
    return {"invoice_id": inv.invoice_id, "vendor_name": inv.vendor_name, "vendor_id": inv.vendor_id,
            "amount": round(inv.amount, 2), "issue_date": inv.issue_date.isoformat()}


def _day(d) -> str:
    return f"{d:%b} {d.day}"


def _days(n: float) -> str:
    return f"{n:.0f} day{'' if round(n) == 1 else 's'}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--export", metavar="PATH", help="write shifts 1..N as JSON for offline play")
    parser.add_argument("--shifts", type=int, default=5)
    parser.add_argument("--seed", type=int, default=1, help="the shift to print")
    args = parser.parse_args()
    if args.export:
        export_shifts(args.export, range(1, args.shifts + 1))
        print(f"wrote {args.shifts} shifts to {args.export}")
        return
    shift = build_shift(args.seed)
    print(f"{shift['shift_id']}: Inspector v{shift['inspector']['version']}, threshold {shift['inspector']['threshold']}")
    for item in shift["items"]:
        inv, truth, verdict = item["invoice"], item["truth"], item["verdict"]
        print(f"  {inv['invoice_id']:<10} {inv['vendor_name'][:30]:<30} ${inv['amount']:>9,.2f}  "
              f"{truth['scheme_name']:<18} inspector {'FLAGGED' if verdict['flagged'] else 'PAID':<7} "
              f"{verdict['score']:.2f}  {'; '.join(r['text'] for r in verdict['reasons'])}")
        print(f"             ☎ {item['callback']['says']}")


if __name__ == "__main__":
    main()
