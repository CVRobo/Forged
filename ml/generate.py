"""Simulated runs for training data (Model Spec v0.2 sections 2.1, 3.1 and 3.2).

A run is one session of the Sunny Diner AP desk's inbox: rounds in order, one invoice
per round. Legit invoices arrive on each vendor's cadence, along with vendors being
onboarded and the odd extra order. In attacker runs a scripted attacker also submits
invoices. Each invoice gets its features from compute_features with the case file and
history as they stood just before it, and its label from the payload check, as in the
game. Paid invoices join the case file, so later rounds see them.

The realistic channel (docs/realistic-data-plan.md sections 2 and 3): every invoice
arrives by email, and real vendors' emails carry the same tells attackers' do, at the
plan's base rates. Real vendors also change banks: a change request goes through the
desk's callback policy into the vendor master's change log, and some changes predate
the run. A two-act attacker sends a change request first; if the desk applies it, the
attacker takes the vendor's next billing slot with an ordinary invoice that pays the
account now on file, and the desk restores the real account once the vendor calls
about the missing payment.
"""
import hashlib
import random
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from ml.attackers import Levers, attack_invoice, bank_change_invoice, change_request, sample_levers
from ml.changes import ChangeDecision, assess_change_request, to_event
from ml.features import compute_features
from ml.mail import vendor_thread
from ml.payloads import SCHEMES, is_fraud_request, payload_schemes
from ml.schema import (BankChangeEvent, CaseFile, EmailMessage, Invoice, OpenOrder, SessionEntry, SessionHistory,
                       Submission, ToolUse, VendorChangeRequest, VendorProfile)
from ml.text import CHANGE_SUBJECTS, EMAIL_RATE, change_request_text, cover_email, invoice_subject
from ml.world import (BILLING_DOMAINS, BRANCHES, CONTACT_NAMES, FREE_MAIL_DOMAINS, LEVEL_ID, NEW_VENDOR_NAMES,
                      REGIONS, VENDOR_SPECS, VENDORS, Truth, VendorSpec, ad_hoc_lines, business_day, catalog_lines,
                      domain_for, lookalike_domain, new_account, new_case_file, order_amount_for, sent_time, slug,
                      stamps_for, weighted)

ROUNDS = (15, 30)          # invoices per run
ATTACK_RUN_SHARE = 0.5     # share of runs with a scripted attacker
ATTACK_RATE = (0.25, 0.5)  # in those runs, the share of rounds that are attacks
ATTACK_PAID_RATE = 0.5     # paid attacks join the case file; v1 should miss about half
REPEAT_RATE = 0.5          # like players, an attacker reuses its last PAID trick this often (spec 2.3)

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
HAND_FIX_RATE = 0.25        # real bank changes and change orders are often corrected by hand on the paper
AMBIENT = {"whiteout": 0.08, "stain": 0.08, "photocopy": 0.12, "stamp": 0.20}  # tool traces on real paper
LEGIT_TONES = {"plain": 0.55, "chatty": 0.25, "apologetic": 0.20}
# Urgent emails always have an email, so the others get slightly fewer, keeping EMAIL_RATE overall.
LEGIT_EMAIL_RATE = (EMAIL_RATE - LEGIT_TELLS["urgent"]) / (1 - LEGIT_TELLS["urgent"])

# Real vendors' email (plan section 2): at most one of these per email, on top of the paper tell.
LEGIT_EMAIL_TELLS = {
    "free_mail": 0.08,    # a small vendor bills from the owner's Gmail
    "new_contact": 0.10,  # a new accounts person writes for the first time
    "new_domain": 0.07,   # a rebrand: a recently registered domain
    "reply_to": 0.06,     # replies go to the vendor's bookkeeper, on another domain
    "auth_fail": 0.07,    # forwarded or misconfigured mail fails SPF and DMARC
    "cc_alt": 0.08,       # CCs a colleague at the vendor's other domain, one or two edits from the file's
}
THREAD_REPLY_RATE = 0.6   # a regular vendor bills by replying in its running billing thread
PLATFORM_NAMES = {"quickinvoice.com": "QuickInvoice", "billtrail.io": "BillTrail", "invoicely.co": "Invoicely"}

# Real bank changes (plan section 3): about 6% of vendor-months, through the callback policy.
LEGIT_CHANGE_RATE = 0.06  # per vendor per 30 days
HISTORY_DAYS = 150        # changes this far before the run are already in the change log
CHANGE_CHANNELS = {"email": 0.7, "phone": 0.2, "portal": 0.1}
NEW_LINE_RATE = 0.35      # a real request gives a direct line that isn't the number on file
RESTORE_DAYS = 3          # after act 2, the vendor calls about the missing payment and the file is restored
ACT2_DELAY_DAYS = (5, 45)  # act 2 lets the change age, then takes the vendor's next billing slot
EARLIER_ACT1_RATE = 0.5  # an attacker run starts with act 1 already done in an earlier session
SCHEME_ODDS = {s: 1.0 for s in SCHEMES} | {"bank_change_fraud": 3.0}  # act 1 can fail, so the two-act attack is
                                                                      # tried more often to land as often as the rest
KNOWN_SENDER_RATE = 0.5   # a vendor's other usual addresses (platform, other domain, Gmail) the desk has seen before
POLICY_LEVEL = 1          # generated runs are Sunny Diner's desk: random callbacks


@dataclass
class ChangeRow:
    """One bank-change request and what the desk did with it (the change-request model's data)."""
    request: VendorChangeRequest
    decision: ChangeDecision
    is_fraud: bool
    session_id: str
    origin: str


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
    new_vendors: list[tuple] = field(default_factory=list)  # (name, domain, bank, letterhead, domain age) onboarded
    fake_payee: tuple | None = None                         # the attacker's last phantom or boss payee
    favorite: Levers | None = None                          # the attacker's last PAID trick
    order_seq: int = 4000
    invoice_seq: int = 100
    real_bank: dict[str, str] = field(default_factory=dict)  # each vendor's real account (the file can differ)
    senders: set[str] = field(default_factory=set)           # every From address the desk has had mail from
    requests: list[ChangeRow] = field(default_factory=list)
    hijacked: dict[str, tuple] = field(default_factory=dict)  # vendor_id -> (levers, act 1 email, origin, asked at,
                                                              #             the first day act 2 can come)
    usual: dict[str, dict[str, str]] = field(default_factory=dict)  # vendor_id -> its other usual sending domains
    snapshots: list[CaseFile] | None = None  # when kept: the case file as it stood before each row (defender mode)

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

    def profile(self, vendor_id: str) -> VendorProfile:
        return next(v for v in self.case_file.vendors if v.vendor_id == vendor_id)

    def bank_on_file(self, spec: VendorSpec) -> str:
        return self.profile(spec.vendor_id).bank_account

    def open_vendors(self) -> list[VendorSpec]:
        """Vendors a new attack can target: not already waiting on an attacker's second act."""
        return [s for s in VENDORS if s.vendor_id not in self.hijacked] or list(VENDORS)

    def first_contact(self, address: str) -> bool:
        """Whether this is the first mail from this address, recording it either way."""
        first = address.lower() not in self.senders
        self.senders.add(address.lower())
        return first

    def request_id(self) -> str:
        return f"{self.session_id}-c{len(self.requests) + 1}"


def build_dataset(seed: int, n_runs: int = 150, attack_run_share: float = ATTACK_RUN_SHARE) -> list[Submission]:
    return [r for run in _runs(seed, n_runs, attack_run_share) for r in run.rows]


def build_change_requests(seed: int, n_runs: int = 150, attack_run_share: float = ATTACK_RUN_SHARE) -> list[ChangeRow]:
    """Every bank-change request in the same runs as build_dataset(seed): real ones and act 1 of the two-act attack."""
    return [c for run in _runs(seed, n_runs, attack_run_share) for c in run.requests]


def _runs(seed: int, n_runs: int, attack_run_share: float) -> list[Run]:
    runs = []
    for i in range(n_runs):
        mode = random.Random(f"{seed}:{i}:mode")
        rate = mode.uniform(*ATTACK_RATE) if mode.random() < attack_run_share else 0.0
        runs.append(simulate(seed, i, attack_rate=rate))
    return runs


def clone_attacks(levers: Levers, n: int, seed: int, origin: str = "player_clone") -> list[Submission]:
    """Spec 2.2: n variants of one trick, with the same levers on new vendors, amounts and dates."""
    return [r for r in clone_runs(levers, n, seed, origin) if r.is_fraud][:n]


def clone_runs(levers: Levers, n: int, seed: int, origin: str = "player_clone") -> list[Submission]:
    """Every row of the runs that hold n variants: the attacker repeats the trick in each session,
    between the desk's legit invoices. Replay these for the variants' memory features (spec 2.3)."""
    rows, i = [], 0
    while sum(r.is_fraud for r in rows) < n:
        rows += simulate_run(seed, i, attack_rate=0.5, levers=levers, origin=origin)
        i += 1
    return rows


def simulate_run(seed: int, index: int, attack_rate: float, levers: Levers | None = None,
                 origin: str = "scripted_attacker") -> list[Submission]:
    return simulate(seed, index, attack_rate, levers, origin).rows


def simulate(seed: int, index: int, attack_rate: float, levers: Levers | None = None,
             origin: str = "scripted_attacker", snapshots: bool = False) -> Run:
    """snapshots: also keep a copy of the case file before each row (no RNG draws, so the rows don't change)."""
    rng = random.Random(f"{seed}:{index}")
    start = business_day(date(2026, 1, 5) + timedelta(days=rng.randint(0, 240)))
    run = Run(rng=rng, session_id=f"gen{seed}-{index}", case_file=new_case_file(rng), truth=Truth(), clock=start,
              created_base=datetime(2026, 1, 1) + timedelta(hours=index), snapshots=[] if snapshots else None)
    _seed_history(run, start)
    if attack_rate and rng.random() < EARLIER_ACT1_RATE:  # act 1 of a two-act attack from an earlier session
        lv = levers if levers and levers.scheme_id == "bank_change_fraud" else \
            None if levers else sample_levers(rng, "bank_change_fraud")
        if lv:
            run.clock = business_day(start - timedelta(days=rng.randint(*ACT2_DELAY_DAYS)))
            _first_act(run, lv, origin)
            run.clock = start
    for _ in range(rng.randint(*ROUNDS)):
        if rng.random() < attack_rate:
            _attack_round(run, levers or _scripted_levers(run), origin)
        else:
            _legit_round(run)
    return run


def _scripted_levers(run: Run) -> Levers:
    if run.favorite and run.rng.random() < REPEAT_RATE:
        return run.favorite
    return sample_levers(run.rng, weighted(run.rng, SCHEME_ODDS))


# ---------- rounds ----------

def _legit_round(run: Run) -> None:
    u = run.rng.random()
    if u < ONBOARDING_RATE:
        make = _onboarding_invoice(run)
    elif u < ONBOARDING_RATE + EXTRA_RATE and _extra_vendors(run):
        make = _extra_invoice(run)
    else:
        due = _next_slot(run)
        if due in run.hijacked:  # the attacker's second act takes the vendor's billing slot
            _second_act(run, due)
            return
        make = _scheduled_invoice(run)
    for _ in range(10):  # a fresh draw if it happens to match a payload (say, a rebill-sized extra order)
        inv = make()
        if not payload_schemes(inv, run.case_file, run.truth):
            _submit(run, inv, "legit_gen", None)
            return
        run.drop_order(inv)


def _attack_round(run: Run, levers: Levers, origin: str) -> None:
    if levers.scheme_id == "bank_change_fraud":  # act 1 is a request, not an invoice: the desk's round goes on
        _first_act(run, levers, origin)
        _legit_round(run)
        return
    inv = attack_invoice(run, levers)
    _submit(run, inv, origin, levers.scheme_id)
    if run.rows[-1].verdict == "PAID":
        run.favorite = levers


def _submit(run: Run, inv: Invoice, origin: str, scheme_id: str | None) -> None:
    run.round_no += 1
    history = SessionHistory(session_id=run.session_id, round_no=run.round_no, entries=list(run.entries))
    if run.snapshots is not None:
        run.snapshots.append(run.case_file.model_copy(deep=True))
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


# ---------- the two-act attack ----------

def _first_act(run: Run, lv: Levers, origin: str) -> None:
    targets = [s for s in VENDORS if s.vendor_id not in run.hijacked]
    if not targets:
        return
    spec = run.rng.choice(targets)
    request = change_request(run, lv, spec, run.request_id())
    old = run.bank_on_file(spec)
    decision = _decide(run, request, origin)
    if decision.applied:
        _record_change(run, to_event(request, decision, old_account=old))
        ready = business_day(request.requested_at.date() + timedelta(days=run.rng.randint(*ACT2_DELAY_DAYS)))
        run.hijacked[spec.vendor_id] = (lv, request.email, origin, request.requested_at, ready)


def _next_slot(run: Run) -> str:
    """The vendor whose invoice is due next. A hijacked vendor's slots before the attacker is ready
    are the attacker's to sit out (the vendor's own invoice is intercepted or late), so its next
    slot moves to the day the attacker strikes."""
    while True:
        due = min(run.next_due, key=run.next_due.get)
        ready = run.hijacked[due][4] if due in run.hijacked else None
        if ready is None or run.next_due[due] >= ready:
            return due
        run.next_due[due] = ready


def _second_act(run: Run, vendor_id: str) -> None:
    lv, act1, origin, _, _ = run.hijacked.pop(vendor_id)
    spec, issue = VENDOR_SPECS[vendor_id], run.next_due[vendor_id]
    run.next_due[vendor_id] = _next_due(run.rng, spec, issue)
    inv = bank_change_invoice(run, lv, spec, issue, act1)
    _submit(run, inv, origin, "bank_change_fraud")
    if run.rows[-1].verdict == "PAID":
        run.favorite = lv
    restored = datetime.combine(issue + timedelta(days=RESTORE_DAYS), time(10, 0))
    _record_change(run, BankChangeEvent(vendor_id=vendor_id, old_account=inv.bank_account,
                                        new_account=run.real_bank[vendor_id], changed_at=restored,
                                        request_id=f"{run.session_id}-restore-{vendor_id}", channel="phone",
                                        verified=True))


def _decide(run: Run, request: VendorChangeRequest, origin: str) -> ChangeDecision:
    decision = assess_change_request(request, level=POLICY_LEVEL, truth=run.truth)
    run.requests.append(ChangeRow(request, decision, is_fraud_request(request, run.truth), run.session_id, origin))
    return decision


def _record_change(run: Run, event: BankChangeEvent) -> None:
    run.case_file.bank_changes.append(event)
    run.profile(event.vendor_id).bank_account = event.new_account


# ---------- real bank changes ----------

def _legit_change(run: Run, spec: VendorSpec, issue: date) -> None:
    """The vendor asks the desk to update its bank details before its next invoice."""
    rng = run.rng
    account = new_account(rng, {v.bank_account for v in run.case_file.vendors} | set(run.real_bank.values()))
    channel = weighted(rng, CHANGE_CHANNELS)
    phone = (f"(510) 555-{rng.randint(200, 999):04d}" if rng.random() < NEW_LINE_RATE
             else spec.phone if rng.random() < 0.3 else None)
    when = sent_time(rng, min(issue, business_day(run.clock + timedelta(days=rng.randint(0, 2)))), offhours=False)
    email = None
    if channel == "email":
        tone = weighted(rng, LEGIT_TONES)
        email = _legit_email(run, spec.name, spec.vendor_id, spec.domain, spec.domain, spec.domain_age_days,
                             rng.choice(CHANGE_SUBJECTS), change_request_text(rng, tone, vendor=spec.name,
                                                                              account=account, phone=phone), when)
    request = VendorChangeRequest(request_id=run.request_id(), vendor_id=spec.vendor_id, new_bank_account=account,
                                  channel=channel, email=email, phone_number_given=phone, requested_at=when)
    old = run.bank_on_file(spec)
    decision = _decide(run, request, "legit_gen")
    if decision.applied:  # a real vendor confirms its own change on any callback
        _record_change(run, to_event(request, decision, old_account=old))
        run.real_bank[spec.vendor_id] = account


# ---------- legit invoices ----------

def _seed_history(run: Run, start: date) -> None:
    """Two paid invoices per vendor before the run starts, so round 1 already has history, and the
    bank changes the change log already holds. Each vendor also has its other usual addresses
    (its second domain, an invoicing platform, the owner's Gmail), and the desk knows some of them."""
    rng = run.rng
    for spec in VENDORS:
        run.real_bank[spec.vendor_id] = spec.bank
        run.usual[spec.vendor_id] = {"alt": lookalike_domain(rng, spec.domain), "platform": rng.choice(BILLING_DOMAINS),
                                     "free": rng.choice(FREE_MAIL_DOMAINS[:3])}
        for address in (f"billing@{run.usual[spec.vendor_id]['alt']}", f"invoices@{run.usual[spec.vendor_id]['platform']}",
                        f"{slug(spec.name)[:12]}.billing@{run.usual[spec.vendor_id]['free']}"):
            if rng.random() < KNOWN_SENDER_RATE:
                run.senders.add(address)
        for back in (2, 1):
            issue = business_day(start - timedelta(days=back * spec.cadence_days))
            run.case_file.paid_invoices.append(_known_vendor_invoice(run, spec, issue, tells=False, order=False)())
        run.next_due[spec.vendor_id] = _next_due(rng, spec, issue)
        if rng.random() < 1 - (1 - LEGIT_CHANGE_RATE) ** (HISTORY_DAYS / 30):
            changed = datetime.combine(start - timedelta(days=rng.randint(1, HISTORY_DAYS)), time(rng.randint(9, 16)))
            run.case_file.bank_changes.append(BankChangeEvent(
                vendor_id=spec.vendor_id, old_account=new_account(rng, {spec.bank}), new_account=spec.bank,
                changed_at=changed, request_id=f"{run.session_id}-history-{spec.vendor_id}",
                channel=weighted(rng, CHANGE_CHANNELS), verified=rng.random() < 0.5,
                offered_phone=rng.random() < NEW_LINE_RATE))


def _scheduled_invoice(run: Run):
    vendor_id = min(run.next_due, key=run.next_due.get)
    spec, issue = VENDOR_SPECS[vendor_id], run.next_due[vendor_id]
    run.next_due[vendor_id] = _next_due(run.rng, spec, issue)
    if run.rng.random() < LEGIT_CHANGE_RATE * spec.cadence_days / 30:
        _legit_change(run, spec, issue)
    standing = not spec.fixed and run.rng.random() < STANDING_ORDER_RATE
    return _known_vendor_invoice(run, spec, issue, standing=standing)


def _extra_vendors(run: Run) -> list[VendorSpec]:
    return [s for s in VENDORS if not s.fixed and s.vendor_id not in run.hijacked]


def _extra_invoice(run: Run):
    spec = run.rng.choice(_extra_vendors(run))
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
            name, domain, age = f"{parent.name.rstrip('.')} {rng.choice(BRANCHES)}", parent.domain, parent.domain_age_days
        else:
            name = rng.choice([n for n in NEW_VENDOR_NAMES if n not in taken])
            domain = domain_for(rng, name)
            age = rng.randint(20, 200) if rng.random() < 0.2 else rng.randint(300, 6000)  # some are new businesses
        run.new_vendors.append((name, domain, new_account(rng), f"lh_{slug(name)[:10]}", age))
        identity = run.new_vendors[-1]
    else:
        identity = rng.choice(run.new_vendors)
    name, domain, bank, letterhead, age = identity
    issue = business_day(run.clock + timedelta(days=rng.randint(0, 2)))

    def make():
        tone = weighted(rng, LEGIT_TONES) if rng.random() < EMAIL_RATE else None
        return _legit_invoice(run, name, None, ad_hoc_lines(rng), issue, None, bank, domain, letterhead, 30, tone,
                              mentions_change=False, offhours=False, usual_stamps=(), new_vendor=first,
                              own=(domain, age))
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
        real = run.real_bank.get(spec.vendor_id, spec.bank)
        usual = run.usual.get(spec.vendor_id) or {}
        domain = {"billing_domain": usual.get("platform") or rng.choice(BILLING_DOMAINS),
                  "platform_switch": rng.choice(BILLING_DOMAINS),
                  "alt_domain": usual.get("alt") or lookalike_domain(rng, spec.domain)}.get(tell, spec.domain)
        fixes = []
        if tell in ("bank_change", "change_order") and rng.random() < HAND_FIX_RATE:
            fixes = [ToolUse(tool="tape", target="bank") if tell == "bank_change" else ToolUse(tool="whiteout", target="items")]
        return _legit_invoice(
            run, spec.name, spec.vendor_id, items, issue, number,
            bank=new_account(rng, {real}) if new_bank else real, domain=domain,
            letterhead=spec.letterhead_id + "_v2" if tell in ("new_letterhead", "platform_switch") else spec.letterhead_id,
            due_days=rng.randint(1, 7) if tell == "short_due" else spec.terms_days, tone=tone,
            mentions_change=(new_bank and rng.random() < 0.6) or rng.random() < 0.03,
            offhours=tell == "offhours", usual_stamps=spec.usual_stamps, tools=fixes,
            own=(spec.domain, spec.domain_age_days), email_tells=tells)
    return make


def _legit_invoice(run: Run, name, vendor_id, items, issue, order, bank, domain, letterhead, due_days, tone,
                   mentions_change, offhours, usual_stamps, new_vendor=False, tools=(), own=None,
                   email_tells=True) -> Invoice:
    """own: the vendor's own (domain, domain age); domain: where this invoice is sent from."""
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
    text = "" if tone is None else cover_email(
        rng, tone, vendor=name, number=number, amount=sum(li.quantity * li.unit_price for li in items),
        new_vendor=new_vendor, mentions_change=mentions_change)
    sent_at = sent_time(rng, issue, offhours)
    own_domain, own_age = own or (domain, 3000)
    email = _legit_email(run, name, vendor_id, domain, own_domain, own_age,
                         invoice_subject(rng, number, name, urgent=tone == "urgent"), text, sent_at,
                         tells=email_tells)
    return Invoice(
        invoice_id=number, vendor_name=name, vendor_id=vendor_id, line_items=items, issue_date=issue,
        due_date=issue + timedelta(days=due_days), order_number=order, bank_account=bank,
        sender_domain=email.from_addr.rpartition("@")[2], letterhead_id=letterhead,
        stamps=stamps_for(rng, stamp, usual_stamps), tool_uses=tools, cover_email=text, sent_at=sent_at, email=email,
    )


def _legit_email(run: Run, name: str, vendor_id: str | None, domain: str, own_domain: str, own_age: int,
                 subject: str, body: str, sent_at: datetime, tells: bool = True) -> EmailMessage:
    """A real vendor's email from domain, with at most one of LEGIT_EMAIL_TELLS."""
    rng = run.rng
    tell = weighted(rng, {**LEGIT_EMAIL_TELLS, None: 1 - sum(LEGIT_EMAIL_TELLS.values())}) if tells else None
    if tell in ("free_mail", "new_domain") and domain != own_domain:  # already sent from somewhere else
        tell = None
    host, age, display, local, reply_to = domain, own_age, rng.choice((name, f"{name} Billing")), "billing", None
    if domain in PLATFORM_NAMES:  # an invoicing platform sends on the vendor's behalf; replies go to the vendor
        age, display, local, reply_to = rng.randint(2500, 5000), f"{name} via {PLATFORM_NAMES[domain]}", "invoices", \
            f"billing@{own_domain}"
    elif domain != own_domain:  # the vendor's other domain
        age = rng.randint(800, 4000)
    contact = rng.choice(CONTACT_NAMES)
    usual = run.usual.get(vendor_id) or {}
    if tell == "free_mail":
        host, age, local = usual.get("free") or rng.choice(FREE_MAIL_DOMAINS[:3]), rng.randint(9000, 11000), \
            f"{slug(name)[:12]}.billing"
        display = rng.choice((name, contact))
    elif tell == "new_domain":
        host, age = domain_for(rng, name + " co"), rng.randint(10, 200)
    elif tell == "new_contact":
        display, local = contact, slug(contact.split()[0]) + "." + slug(contact.split()[1])
    elif tell == "reply_to":
        reply_to = f"ar@{slug(name)[:10]}books.com"
    spec = VENDOR_SPECS.get(vendor_id) if vendor_id else None
    thread = vendor_thread(spec) if spec and rng.random() < THREAD_REPLY_RATE else (None, None)
    address = f"{local}@{host}"
    return EmailMessage(
        message_id=f"<{hashlib.sha256(f'{address}:{subject}:{sent_at}'.encode()).hexdigest()[:16]}@{host}>",
        thread_id=thread[0], in_reply_to=thread[1], from_name=display, from_addr=address, reply_to=reply_to,
        cc=[f"accounts@{usual.get('alt') or lookalike_domain(rng, own_domain)}"] if tell == "cc_alt" else [],
        subject=("Re: " + subject) if thread[0] else subject, body=body, sent_at=sent_at,
        sender_identity="vendor_mailbox", spf="fail" if tell == "auth_fail" else "pass", dkim="pass",
        dmarc="fail" if tell == "auth_fail" else "pass", sender_domain_age_days=age,
        first_time_sender=run.first_contact(address),
    )


def _next_due(rng: random.Random, spec: VendorSpec, last: date) -> date:
    jitter = max(1, round(0.15 * spec.cadence_days))
    return business_day(last + timedelta(days=spec.cadence_days + rng.randint(-jitter, jitter)))
