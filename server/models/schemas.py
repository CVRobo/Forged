"""Pydantic models for all API request/response shapes.

This file is the single source of truth for the API contract types.
Keep it flat and portable — a future language port reads these to generate structs.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# --- Shared sub-models ---


class Vendor(BaseModel):
    name: str
    domain: str
    bank: str
    usual_amount: list[float] = Field(description="[min, max] range")
    icon: str
    items: list[list] = Field(description="[[desc, qty, price], ...]")


class CaseFile(BaseModel):
    company: str
    vendors: list[Vendor]
    approvers: list[list[str]] = Field(description="[[name, authority], ...]")
    notes: list[str]


class MemoRule(BaseModel):
    text: str
    real: bool


class Tell(BaseModel):
    tell_type: str
    strength: float
    region: str | None = None
    description: str | None = None


class InvoiceRecord(BaseModel):
    level: int
    scheme: str
    vendor: str
    amount: float
    bank_account: str
    sender_domain: str
    invoice_no: str
    po_number: str
    date: str
    line_items: list[str]
    field_altered: list[str]
    legibility: dict[str, float] = Field(
        description="Per-region visibility 0-1: header, meta, items, bank, footer"
    )
    scan_quality: float
    copy_generation: int
    stamp_type: list[str]
    stamp_position: list[list[int]]
    domain_mismatch: bool
    letterhead_match: bool
    cover_email: str
    heat: int


# --- Round ---


class RoundStartRequest(BaseModel):
    level: int = Field(ge=1, le=4)
    session_id: str | None = None


class RoundStartResponse(BaseModel):
    round_id: str
    session_id: str
    memo: list[MemoRule]
    inspector_version: int
    case_file: CaseFile


# --- Clerk ---


class ClerkRequest(BaseModel):
    round_id: str
    text: str


class ClerkResponse(BaseModel):
    reply: str
    persuasion_score: int = Field(ge=0, le=100)


class ClerkVoiceRequest(BaseModel):
    round_id: str
    audio_b64: str = Field(description="Base64-encoded audio (webm/opus from browser MediaRecorder)")


class ClerkVoiceResponse(BaseModel):
    transcript: str = Field(description="What Deepgram heard the player say")
    reply: str
    persuasion_score: int = Field(ge=0, le=100)
    reply_audio_b64: str | None = Field(
        default=None, description="Base64-encoded audio of the clerk's reply (Deepgram TTS)"
    )


# --- Submit ---


class OnlineRecord(BaseModel):
    """The typed checkout (prototype record() with mode "online"): one IEEE-CIS row per order.

    Rows keep the dataset's column names; see prototype/orders.js toRows for the mapping.
    """
    model_config = {"extra": "allow"}

    mode: Literal["online"]
    level: int
    scheme: str
    rows: list[dict[str, Any]]


class GusVerdict(BaseModel):
    """The browser's scripted Gus: the answer when the server has no trained model (ml/online)."""
    caught: bool
    tells: list[list[Any]] = Field(default_factory=list, description="[[tell, weight], ...]")
    payout: int = 0
    values: list[float] = Field(default_factory=list, description="what each order pays the player if it gets through")


class SubmitRequest(BaseModel):
    round_id: str
    record: OnlineRecord | InvoiceRecord
    player: str | None = None
    gus: GusVerdict | None = None


class PreviewRequest(BaseModel):
    """The checkout as the player types: Gus's gut feeling. Nothing is saved."""
    record: OnlineRecord


class PreviewResponse(BaseModel):
    worry: float = Field(description="the riskiest order's score over the player's threshold: 1 or more means caught")
    scores: list[float]
    threshold: float
    version: int
    tells: list[list[Any]] = Field(default_factory=list, description="the riskiest order's [[tell, weight], ...]")


class SubmitResponse(BaseModel):
    verdict: str = Field(description="PAID or FLAGGED")
    top_tells: list[Tell]
    inspector_line: str
    payout: int
    new_version: int
    results: list[dict[str, Any]] | None = Field(default=None, description="online orders: per order {declined, reason, score, tells}")


# --- Patch Notes ---


class PatchNote(BaseModel):
    version: int
    learned: list[str]
    invoices_trained_on: int


# --- Metrics ---


class VersionMetrics(BaseModel):
    version: int
    catch_rate: float
    false_positive_rate: float
    held_out_catch_rate: float


# --- Leaderboard ---


class LeaderboardEntry(BaseModel):
    player: str
    money: int
    patches_caused: int
