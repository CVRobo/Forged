"""Data contract for the Forged detector.

Design doc v0.1 Appendix A, plus the changes in Model Spec v0.2 section 8.
Three layers keep the game and the model decoupled: the raw Invoice (what the
player edits), the features (computed by ml.features.compute_features), and the
Submission record (everything stored per round). The model only ever sees features.

Two fields are not in Appendix A and are marked "proposed": Invoice.sent_at and
VendorProfile.usual_stamps. Two Appendix A features need them, and nothing else
in the schema carries that information.
"""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

Verdict = Literal["PAID", "FLAGGED", "REJECTED"]  # REJECTED = failed the validity gate
Origin = Literal[
    "legit_gen", "scripted_attacker", "llm_attacker", "player",
    "player_clone",     # spec 2.2: variants cloned from a PAID player trick
    "search_attacker",  # spec 4.6: optimizer attacking the live detector
]
ToolName = Literal["whiteout", "mug", "photocopier", "tape", "stamp", "pen"]
StampKind = Literal["PAID", "APPROVED", "URGENT", "RECEIVED"]


class LineItem(BaseModel):
    description: str
    quantity: float
    unit_price: float


class Stamp(BaseModel):
    kind: StampKind
    x: float  # 0..1 position on the sheet
    y: float


class ToolUse(BaseModel):
    tool: ToolName
    target: str | None = None  # field name or region id
    params: dict = {}  # mug: {"strength": legibility lost, default 0.35}


AuthResult = Literal["pass", "fail", "none"]
# How the sender got its From address (docs/realistic-data-plan.md section 2). vendor_mailbox is a
# real vendor writing from its own address; the other four are the attacker's options.
SenderIdentity = Literal["vendor_mailbox", "lookalike_domain", "free_mail", "spoofed_domain", "compromised_mailbox"]


class EmailMessage(BaseModel):
    """The real medium: an RFC 5322 message reduced to the headers BEC detection uses."""
    message_id: str
    thread_id: str | None = None      # set when replying into an existing vendor thread
    in_reply_to: str | None = None
    from_name: str                    # display name
    from_addr: str                    # e.g. billing@petesflour.com
    reply_to: str | None = None
    cc: list[str] = []
    subject: str
    body: str                         # free text, kept as the player wrote it
    sent_at: datetime
    # Set by the game world from the sender identity, never typed by the player
    # (RFC 8601 Authentication-Results, domain registration age, first contact).
    sender_identity: SenderIdentity | None = None
    spf: AuthResult = "none"
    dkim: AuthResult = "none"
    dmarc: AuthResult = "none"
    sender_domain_age_days: int | None = None
    first_time_sender: bool = False


class VendorChangeRequest(BaseModel):
    """Act 1 of the two-act attack: a request to move a vendor's payments to a new account."""
    request_id: str
    vendor_id: str
    new_bank_account: str
    channel: Literal["email", "phone", "portal"]
    email: EmailMessage | None = None
    phone_number_given: str | None = None  # a number offered "for verification"
    requested_at: datetime
    callback: Literal["none", "number_on_file", "number_from_request"] = "none"
    callback_result: Literal["not_called", "vendor_confirmed", "vendor_denied", "attacker_confirmed"] = "not_called"
    applied: bool = False                  # did the vendor master change?


class BankChangeEvent(BaseModel):
    """One row of the vendor master change log (the ERP's bank-data change history)."""
    vendor_id: str
    old_account: str
    new_account: str
    changed_at: datetime
    request_id: str
    channel: Literal["email", "phone", "portal"]
    verified: bool  # confirmed by a callback to the number on file


class Invoice(BaseModel):  # raw, player-editable state
    invoice_id: str
    vendor_name: str
    vendor_id: str | None  # None if not on the approved list
    line_items: list[LineItem]  # amount is always the sum of these
    issue_date: date
    due_date: date
    order_number: str | None
    bank_account: str  # fake account string
    sender_domain: str
    letterhead_id: str
    stamps: list[Stamp] = []
    tool_uses: list[ToolUse] = []
    cover_email: str = ""
    sent_at: datetime | None = None  # proposed, for offhours_send; None counts as business hours
    email: EmailMessage | None = None  # the email that delivered it, in the realistic channel

    @property
    def amount(self) -> float:
        return sum(li.quantity * li.unit_price for li in self.line_items)


class VendorProfile(BaseModel):  # one per approved vendor, per level
    vendor_id: str
    name: str
    bank_account: str
    sender_domain: str
    letterhead_id: str
    amount_mean: float
    amount_std: float
    cadence_days: int
    first_seen_round: int
    catalog: dict[str, float]  # line description -> usual unit price
    usual_stamps: list[StampKind] = []  # proposed, for stamp_matches_vendor
    phone: str = ""  # the number on file, for callbacks


class OpenOrder(BaseModel):
    order_number: str
    vendor_id: str
    amount: float


class CaseFile(BaseModel):
    level_id: str
    approval_limit: float
    vendors: list[VendorProfile]
    open_orders: list[OpenOrder]
    paid_invoices: list[Invoice]  # for duplicate checks, grows during a run
    bank_changes: list[BankChangeEvent] = []  # vendor master change log, grows during a run


class LevelConfig(BaseModel):  # spec 5.3: one shared model, per-level settings
    level_id: str
    name: str
    fpr_target: float  # the threshold keeps legit FPR at or under this
    memory_enabled: bool  # off: kNN features are set to their training mean before scoring


LEVELS = {lvl.level_id: lvl for lvl in [
    LevelConfig(level_id="sunny_diner", name="Sunny Diner Supply", fpr_target=0.03, memory_enabled=False),
    LevelConfig(level_id="st_mercy", name="St. Mercy Hospital", fpr_target=0.05, memory_enabled=False),
    LevelConfig(level_id="port_nocturne", name="Port Nocturne Shipping", fpr_target=0.05, memory_enabled=True),
    LevelConfig(level_id="neon_arcade", name="Neon Arcade Holdings", fpr_target=0.08, memory_enabled=True),
]}


class SessionEntry(BaseModel):
    round_no: int
    invoice: Invoice


class SessionHistory(BaseModel):  # the session_history argument to compute_features
    session_id: str
    round_no: int  # the round being scored
    entries: list[SessionEntry] = []  # invoices submitted earlier in this run, any verdict


class Submission(BaseModel):  # one row per round, the training record
    submission_id: str
    session_id: str
    level_id: str
    round_no: int
    scheme_id: str | None  # None for legitimate invoices
    origin: Origin
    invoice: Invoice
    is_fraud: bool  # from the payload check, never from the player
    features: dict[str, float]  # FEATURES as served; training reads these, never recomputes
    detector_version: int
    score: float  # P(fraud)
    verdict: Verdict
    top_reasons: list[tuple[str, float]]  # (feature, contribution)
    heat_before: float
    heat_after: float
    payout: float
    created_at: datetime
    trick_id: str | None = None  # player_clone: the player submission it was cloned from
    train_weight: float = 1.0  # set by the retrain loop; 0 for player rows with is_fraud = False


# Feature names in a fixed order, so vectors line up across training and serving.
# Appendix A table order: money, identity, process, text, physical, session.
BASE_FEATURES = (
    "amount_z", "amount_is_round", "amount_to_limit_ratio", "bank_changed",
    "order_amount_ratio", "max_unit_price_ratio",
    "vendor_unknown", "vendor_name_similarity", "domain_mismatch", "domain_edit_distance",
    "letterhead_match",
    "no_open_order", "dup_similarity", "cadence_z", "due_days", "offhours_send", "line_item_count",
    "vague_text_score", "email_urgency", "email_mentions_change", "email_length",
    "field_altered_count", "max_illegibility", "copy_generation", "scan_quality",
    "stamp_count", "stamp_matches_vendor",
    "window_count", "window_sum", "vendor_age_rounds", "amount_jump_ratio",
)
# Spec 2.3: served from the kNN index at submit time and stored in Submission.features.
# The search vectors themselves hold BASE_FEATURES only.
MEMORY_FEATURES = ("knn_fraud_share", "knn_max_sim", "self_sim")
FEATURES = BASE_FEATURES + MEMORY_FEATURES
