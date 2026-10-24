"""Simulated runs for training data (Model Spec v0.2 sections 2.1, 3.1 and 3.2).

A run is one session of the Sunny Diner AP desk's inbox: rounds in order, one invoice
per round. Legit invoices arrive on each vendor's cadence, along with vendors being
onboarded and the odd extra order. In attacker runs a scripted attacker also submits
invoices. Each invoice gets its features from compute_features with the case file and
history as they stood just before it, and its label from the payload check, as in the
game. Paid invoices join the case file, so later rounds see them.
"""
import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from ml.attackers import Levers, attack_invoice, sample_levers
from ml.features import compute_features
from ml.payloads import SCHEMES, payload_schemes
from ml.schema import CaseFile, Invoice, OpenOrder, SessionEntry, SessionHistory, Submission, ToolUse
from ml.text import EMAIL_RATE, cover_email
from ml.world import (BILLING_DOMAINS, BRANCHES, LEVEL_ID, NEW_VENDOR_NAMES, REGIONS, VENDOR_SPECS, VENDORS, Truth,
                      VendorSpec, ad_hoc_lines, business_day, catalog_lines, domain_for, lookalike_domain, new_account,
                      new_case_file, order_amount_for, sent_time, slug, stamps_for, weighted)

ROUNDS = (15, 30)          # invoices per run
ATTACK_RUN_SHARE = 0.5     # share of runs with a scripted attacker
ATTACK_RATE = (0.25, 0.5)  # in those runs, the share of rounds that are attacks
ATTACK_PAID_RATE = 0.5     # paid attacks join the case file; v1 should miss about half

# The legit mix (spec 2.1). Every tell shows up on real invoices above the 5% FPR target,
# and a real invoice carries at most one of them, looking clean on every other lever.
ONBOARDING_RATE = 0.13     # a vendor still being onboarded: not on the approved list, no PO
BRANCH_RATE = 0.2          # of those, a new branch of an approved vendor: a similar name, the parent's domain
EXTRA_RATE = 0.10          # an extra order from a regular vendor, early for its cadence
STANDING_ORDER_RATE = 0.4  # a regular vendor sends exactly its last order again
LEGIT_TELLS = {
    "bank_change": 0.08,     # the vendor changed banks and the file still has the old account
    "change_order": 0.15,    # a change order took the total past the PO (PO vendors only)
    "no_po": 0.10,           # billed without a PO (PO vendors only; utilities never use one)
    "billing_domain": 0.08,  # sent through an invoicing service, not the vendor's own domain
    "alt_domain": 0.06,      # sent from the vendor's other domain, one or two edits from the file's
    "platform_switch": 0.04, # moved to an invoicing platform: new bank, domain and letterhead at once
    "new_letterhead": 0.08,  # the vendor redesigned its letterhead
    "short_due": 0.10,       # due within a week
    "offhours": 0.10,        # sent after hours
    "urgent": 0.13,          # an urgent cover email
}
HAND_FIX_RATE = 0.4        # real bank changes and change orders are often corrected by hand on the paper
AMBIENT = {"whiteout": 0.08, "stain": 0.08, "photocopy": 0.12, "stamp": 0.20}  # tool traces on real paper
LEGIT_TONES = {"plain": 0.55, "chatty": 0.25, "apologetic": 0.20}
# Urgent emails always have an email, so the others get slightly fewer, keeping EMAIL_RATE overall.
LEGIT_EMAIL_RATE = (EMAIL_RATE - LEGIT_TELLS["urgent"]) / (1 - LEGIT_TELLS["urgent"])


@dataclass
class Run:
    rng: random.Random
    session_id: str
    case_file: CaseFile
    truth: Truth
    clock: date
    created_base: datetime
    next_due: dict[str, date] = field(default_factory=dict)
    round_no: int = 0
    entries: list[SessionEntry] = field(default_factory=list)
    rows: list[Submission] = field(default_factory=list)
    new_vendors: list[tuple] = field(default_factory=list)  # (name, domain, bank, letterhead) onboarded this run
    fake_payee: tuple | None = None                         # the attacker's last phantom or boss payee
    order_seq: int = 4000
    invoice_seq: int = 100

    def last_paid(self, vendor_id: str) -> Invoice | None:
        paid = [p for p in self.case_file.paid_invoices if p.vendor_id == vendor_id]
        return max(paid, key=lambda p: p.issue_date) if paid else None

    def new_order(self, vendor_id: str, file_amount: float, real_amount: float | None = None) -> str:
        self.order_seq += self.rng.randint(1, 5)
        number = f"PO-{self.order_seq}"
        self.case_file.open_orders.append(OpenOrder(order_number=number, vendor_id=vendor_id, amount=round(file_amount, 2)))
        self.truth.order_amounts[number] = round(file_amount if real_amount is None else real_amount, 2)
        return number

    def drop_order(self, inv: Invoice) -> None:
        self.case_file.open_orders = [o for o in self.case_file.open_orders
                                      if not (o.order_number == inv.order_number and o.vendor_id == inv.vendor_id)]

    def invoice_number(self, vendor_name: str) -> str:
        self.invoice_seq += self.rng.randint(1, 9)
        return "".join(w[0] for w in vendor_name.split()[:2]).upper() + f"-{self.invoice_seq:04d}"


def build_dataset(seed: int, n_runs: int = 150, attack_run_share: float = ATTACK_RUN_SHARE) -> list[Submission]:
    rows = []
    for i in range(n_runs):
        mode = random.Random(f"{seed}:{i}:mode")
        rate = mode.uniform(*ATTACK_RATE) if mode.random() < attack_run_share else 0.0
        rows += simulate_run(seed, i, attack_rate=rate)
    return rows


def clone_attacks(levers: Levers, n: int, seed: int) -> list[Submission]:
    """Spec 2.2: n variants of one trick, with the same levers on new vendors, amounts and dates."""
    clones, i = [], 0
    while len(clones) < n:
        clones += [r for r in simulate_run(seed, i, attack_rate=0.5, levers=levers, origin="player_clone") if r.is_fraud]
        i += 1
    return clones[:n]


def simulate_run(seed: int, index: int, attack_rate: float, levers: Levers | None = None,
                 origin: str = "scripted_attacker") -> list[Submission]:
    rng = random.Random(f"{seed}:{index}")
    start = business_day(date(2026, 1, 5) + timedelta(days=rng.randint(0, 240)))
    run = Run(rng=rng, session_id=f"gen{seed}-{index}", case_file=new_case_file(rng), truth=Truth(), clock=start,
              created_base=datetime(2026, 1, 1) + timedelta(hours=index))
    _seed_history(run, start)
    for _ in range(rng.randint(*ROUNDS)):
        if rng.random() < attack_rate:
            _attack_round(run, levers or sample_levers(rng, rng.choice(SCHEMES)), origin)
        else:
            _legit_round(run)
    return run.rows


# ---------- rounds ----------

def _legit_round(run: Run) -> None:
    u = run.rng.random()
    if u < ONBOARDING_RATE:
        make = _onboarding_invoice(run)
    elif u < ONBOARDING_RATE + EXTRA_RATE:
        make = _extra_invoice(run)
    else:
        make = _scheduled_invoice(run)
    for _ in range(10):  # a fresh draw if it happens to match a payload (say, a rebill-sized extra order)
        inv = make()
        if not payload_schemes(inv, run.case_file, run.truth):
            _submit(run, inv, "legit_gen", None)
            return
        run.drop_order(inv)


def _attack_round(run: Run, levers: Levers, origin: str) -> None:
    inv = attack_invoice(run, levers)
    _submit(run, inv, origin, levers.scheme_id)


def _submit(run: Run, inv: Invoice, origin: str, scheme_id: str | None) -> None:
    run.round_no += 1
    history = SessionHistory(session_id=run.session_id, round_no=run.round_no, entries=list(run.entries))
    features = compute_features(inv, run.case_file, history)
    hits = payload_schemes(inv, run.case_file, run.truth)
    if (scheme_id is None) == bool(hits) or (scheme_id and scheme_id not in hits):
        raise AssertionError(f"{scheme_id or 'legit'} invoice {inv.invoice_id} has payloads {hits}")
    paid = scheme_id is None or run.rng.random() < ATTACK_PAID_RATE
    run.rows.append(Submission(
        submission_id=f"{run.session_id}-r{run.round_no}", session_id=run.session_id, level_id=LEVEL_ID,
        round_no=run.round_no, scheme_id=scheme_id, origin=origin, invoice=inv, is_fraud=bool(hits),
        features=features, detector_version=0, score=0.0, verdict="PAID" if paid else "FLAGGED", top_reasons=[],
        heat_before=0.0, heat_after=0.0, payout=inv.amount if paid and hits else 0.0,
        created_at=run.created_base + timedelta(minutes=run.round_no),
    ))
    run.entries.append(SessionEntry(round_no=run.round_no, invoice=inv))
    run.clock = max(run.clock, inv.issue_date)
    if paid:
        run.case_file.paid_invoices.append(inv)
        run.drop_order(inv)


# ---------- legit invoices ----------

def _seed_history(run: Run, start: date) -> None:
    """Two paid invoices per vendor before the run starts, so round 1 already has history."""
    for spec in VENDORS:
        for back in (2, 1):
            issue = business_day(start - timedelta(days=back * spec.cadence_days))
            run.case_file.paid_invoices.append(_known_vendor_invoice(run, spec, issue, tells=False, order=False)())
        run.next_due[spec.vendor_id] = _next_due(run.rng, spec, issue)


def _scheduled_invoice(run: Run):
    vendor_id = min(run.next_due, key=run.next_due.get)
    spec, issue = VENDOR_SPECS[vendor_id], run.next_due[vendor_id]
    run.next_due[vendor_id] = _next_due(run.rng, spec, issue)
    standing = not spec.fixed and run.rng.random() < STANDING_ORDER_RATE
    return _known_vendor_invoice(run, spec, issue, standing=standing)


def _extra_invoice(run: Run):
    spec = run.rng.choice([s for s in VENDORS if not s.fixed])
    last = run.last_paid(spec.vendor_id)
    issue = business_day(last.issue_date + timedelta(days=run.rng.randint(1, max(1, spec.cadence_days // 2))))
    return _known_vendor_invoice(run, spec, issue, tells=False)


def _onboarding_invoice(run: Run):
    rng = run.rng
    first = not run.new_vendors or rng.random() > 0.3
    if first:
        taken = {v[0] for v in run.new_vendors}
        if rng.random() < BRANCH_RATE:
            parent = rng.choice(VENDORS)
            name, domain = f"{parent.name.rstrip('.')} {rng.choice(BRANCHES)}", parent.domain
        else:
            name = rng.choice([n for n in NEW_VENDOR_NAMES if n not in taken])
            domain = domain_for(rng, name)
        run.new_vendors.append((name, domain, new_account(rng), f"lh_{slug(name)[:10]}"))
        identity = run.new_vendors[-1]
    else:
        identity = rng.choice(run.new_vendors)
    name, domain, bank, letterhead = identity
    issue = business_day(run.clock + timedelta(days=rng.randint(0, 2)))

    def make():
        tone = weighted(rng, LEGIT_TONES) if rng.random() < EMAIL_RATE else None
        return _legit_invoice(run, name, None, ad_hoc_lines(rng), issue, None, bank, domain, letterhead, 30, tone,
                              mentions_change=False, offhours=False, usual_stamps=(), new_vendor=first)
    return make


def _known_vendor_invoice(run: Run, spec: VendorSpec, issue: date, tells: bool = True, standing: bool = False,
                          order: bool = True):
    rng = run.rng

    def make():
        tell = weighted(rng, {**LEGIT_TELLS, None: 1 - sum(LEGIT_TELLS.values())}) if tells else None
        last = run.last_paid(spec.vendor_id)
        items = [li.model_copy() for li in last.line_items] if standing and last else catalog_lines(rng, spec)
        total = sum(li.quantity * li.unit_price for li in items)
        number = None
        if order and spec.uses_po and tell != "no_po":
            if tell == "change_order":  # the real order grew; the file still has the original amount
                number = run.new_order(spec.vendor_id, total / rng.uniform(1.16, 1.6), real_amount=total)
            else:
                number = run.new_order(spec.vendor_id, order_amount_for(rng, total))
        tone = "urgent" if tell == "urgent" else (weighted(rng, LEGIT_TONES) if rng.random() < LEGIT_EMAIL_RATE else None)
        new_bank = tell in ("bank_change", "platform_switch")
        domain = {"billing_domain": rng.choice(BILLING_DOMAINS), "platform_switch": rng.choice(BILLING_DOMAINS),
                  "alt_domain": lookalike_domain(rng, spec.domain)}.get(tell, spec.domain)
        fixes = []
        if tell in ("bank_change", "change_order") and rng.random() < HAND_FIX_RATE:
            fixes = [ToolUse(tool="tape", target="bank") if tell == "bank_change" else ToolUse(tool="whiteout", target="items")]
        return _legit_invoice(
            run, spec.name, spec.vendor_id, items, issue, number,
            bank=new_account(rng, {spec.bank}) if new_bank else spec.bank, domain=domain,
            letterhead=spec.letterhead_id + "_v2" if tell in ("new_letterhead", "platform_switch") else spec.letterhead_id,
            due_days=rng.randint(1, 7) if tell == "short_due" else spec.terms_days, tone=tone,
            mentions_change=(new_bank and rng.random() < 0.6) or rng.random() < 0.03,
            offhours=tell == "offhours", usual_stamps=spec.usual_stamps, tools=fixes)
    return make


def _legit_invoice(run: Run, name, vendor_id, items, issue, order, bank, domain, letterhead, due_days, tone,
                   mentions_change, offhours, usual_stamps, new_vendor=False, tools=()) -> Invoice:
    rng = run.rng
    tools = list(tools)
    if rng.random() < AMBIENT["whiteout"]:  # a hand correction
        tools.append(ToolUse(tool="whiteout", target=rng.choice(("amount", "issue_date", "items"))))
    if rng.random() < AMBIENT["stain"]:
        tools += [ToolUse(tool="mug", target=rng.choice(REGIONS))] * rng.choice((1, 1, 2))
    if rng.random() < AMBIENT["photocopy"]:
        tools += [ToolUse(tool="photocopier")] * rng.choice((1, 1, 2))
    stamp = weighted(rng, {"habit": 0.75, "random": 0.25}) if rng.random() < AMBIENT["stamp"] else "none"
    number = run.invoice_number(name)
    email = "" if tone is None else cover_email(
        rng, tone, vendor=name, number=number, amount=sum(li.quantity * li.unit_price for li in items),
        new_vendor=new_vendor, mentions_change=mentions_change)
    return Invoice(
        invoice_id=number, vendor_name=name, vendor_id=vendor_id, line_items=items, issue_date=issue,
        due_date=issue + timedelta(days=due_days), order_number=order, bank_account=bank, sender_domain=domain,
        letterhead_id=letterhead, stamps=stamps_for(rng, stamp, usual_stamps), tool_uses=tools, cover_email=email,
        sent_at=sent_time(rng, issue, offhours),
    )


def _next_due(rng: random.Random, spec: VendorSpec, last: date) -> date:
    jitter = max(1, round(0.15 * spec.cadence_days))
    return business_day(last + timedelta(days=spec.cadence_days + rng.randint(-jitter, jitter)))
