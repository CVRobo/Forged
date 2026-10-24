"""Stub server: hardcoded responses for all API routes.

Derived from prototype/game.js mock data. Lets C and D start immediately
without waiting for the real backend or ML models.

Run with: USE_STUBS=true uvicorn server.main:app --reload --port 8000
"""

from __future__ import annotations

import random
import uuid

from fastapi import APIRouter, Query

from server.content.levels import SCHEME_PAY, STUB_LEVELS
from server.services.detector import TELL_DESCRIPTIONS
from server.services.online_data import submit_online
from server.models.schemas import (
    CaseFile,
    ClerkRequest,
    ClerkResponse,
    ClerkVoiceRequest,
    ClerkVoiceResponse,
    LeaderboardEntry,
    MemoRule,
    PatchNote,
    OnlineRecord,
    RoundStartRequest,
    RoundStartResponse,
    SubmitRequest,
    SubmitResponse,
    Tell,
    VersionMetrics,
)

router = APIRouter()

# ---------------------------------------------------------------------------
# Stub helpers
# ---------------------------------------------------------------------------


def _pick_memo(level: int) -> list[MemoRule]:
    """Pick 2 real + 1 decoy memo rules, shuffled."""
    data = STUB_LEVELS.get(level, STUB_LEVELS[1])["memo"]
    reals = [m for m in data if m["real"]]
    fakes = [m for m in data if not m["real"]]
    chosen = random.sample(reals, min(2, len(reals))) + [random.choice(fakes)]
    random.shuffle(chosen)
    return [MemoRule(text=m["text"], real=m["real"]) for m in chosen]


def _compute_stub_tells(record) -> list[Tell]:
    """Simplified version of game.js computeTells()."""
    tells: list[Tell] = []

    if record.bank_account not in ("3321", "9902", "1111", "5150", "2208", "4470"):
        tells.append(Tell(tell_type="bank_changed", strength=26.0, region="bank", description=TELL_DESCRIPTIONS["bank_changed"]))

    if record.domain_mismatch:
        tells.append(Tell(tell_type="domain_mismatch", strength=18.0, region="header", description=TELL_DESCRIPTIONS["domain_mismatch"]))

    if record.field_altered:
        tells.append(Tell(tell_type="altered", strength=12.0 * len(record.field_altered), region=None, description=TELL_DESCRIPTIONS["altered"]))

    if record.copy_generation > 0:
        tells.append(Tell(tell_type="copy_gen", strength=8.0 * record.copy_generation, region=None, description=TELL_DESCRIPTIONS["copy_gen"]))

    if record.legibility.get("bank", 1.0) < 0.6:
        tells.append(Tell(tell_type="low_legibility", strength=10.0, region="bank", description=TELL_DESCRIPTIONS["low_legibility"]))

    if record.heat > 40:
        tells.append(Tell(tell_type="heat", strength=record.heat * 0.3, region=None, description=TELL_DESCRIPTIONS["heat"]))

    if not record.letterhead_match:
        tells.append(Tell(tell_type="letterhead", strength=14.0, region="header", description=TELL_DESCRIPTIONS["letterhead"]))

    if record.scheme == "phantom":
        tells.append(Tell(tell_type="unknown_vendor", strength=20.0, region="header", description=TELL_DESCRIPTIONS["unknown_vendor"]))

    # Sort by strength descending
    tells.sort(key=lambda t: t.strength, reverse=True)
    return tells


# ---------------------------------------------------------------------------
# Stub routes
# ---------------------------------------------------------------------------


@router.post("/round/start", response_model=RoundStartResponse)
async def stub_round_start(req: RoundStartRequest):
    level = req.level if req.level in STUB_LEVELS else 1
    data = STUB_LEVELS[level]
    session_id = req.session_id or str(uuid.uuid4())

    return RoundStartResponse(
        round_id=f"stub-{uuid.uuid4().hex[:8]}",
        session_id=session_id,
        memo=_pick_memo(level),
        inspector_version=1,
        case_file=CaseFile(
            company=data["company"],
            vendors=data["vendors"],
            approvers=data["approvers"],
            notes=data["notes"],
        ),
    )


@router.post("/clerk", response_model=ClerkResponse)
async def stub_clerk(req: ClerkRequest):
    # Default to level 1 clerk (we don't track round->level in stubs)
    clerk = STUB_LEVELS[1]["clerk"]
    keywords = clerk["keywords"]
    text_lower = req.text.lower()

    hits = sum(1 for k in keywords if k in text_lower)
    score = 30 + hits * 25 - max(0, len(req.text) - 90) * 0.5 + random.randint(-10, 10)
    score = max(0, min(100, int(score)))

    if score > 60:
        tier = "good"
    elif score > 35:
        tier = "meh"
    else:
        tier = "bad"

    return ClerkResponse(
        reply=random.choice(clerk["replies"][tier]),
        persuasion_score=score,
    )


@router.post("/clerk/voice", response_model=ClerkVoiceResponse)
async def stub_clerk_voice(req: ClerkVoiceRequest):
    """Stub voice clerk: ignores audio, uses a canned transcript."""
    fake_transcript = "Hey, quick question, can you push this through before lunch?"

    # Reuse the text-based clerk scoring logic
    clerk = STUB_LEVELS[1]["clerk"]
    keywords = clerk["keywords"]
    text_lower = fake_transcript.lower()

    hits = sum(1 for k in keywords if k in text_lower)
    score = 30 + hits * 25 - max(0, len(fake_transcript) - 90) * 0.5 + random.randint(-10, 10)
    score = max(0, min(100, int(score)))

    if score > 60:
        tier = "good"
    elif score > 35:
        tier = "meh"
    else:
        tier = "bad"

    return ClerkVoiceResponse(
        transcript=fake_transcript,
        reply=random.choice(clerk["replies"][tier]),
        persuasion_score=score,
        reply_audio_b64=None,  # No audio in stub mode
    )


@router.post("/submit", response_model=SubmitResponse)
async def stub_submit(req: SubmitRequest):
    if isinstance(req.record, OnlineRecord):  # the typed checkout
        return submit_online(req.record, req.gus, req.round_id, req.player)
    tells = _compute_stub_tells(req.record)
    suspicion = sum(t.strength for t in tells) * 0.67  # v1 skill factor
    suspicion -= random.randint(-12, 12)
    caught = suspicion > 38

    payout = 0
    if not caught:
        pay_mult = SCHEME_PAY.get(req.record.scheme, 1.0)
        payout = int(req.record.amount * pay_mult)

    level_data = STUB_LEVELS.get(req.record.level, STUB_LEVELS[1])
    line_key = "catch" if caught else "pass"
    inspector_line = random.choice(level_data["lines"][line_key])

    return SubmitResponse(
        verdict="FLAGGED" if caught else "PAID",
        top_tells=tells[:3],
        inspector_line=inspector_line,
        payout=payout,
        new_version=2,
    )


@router.get("/patch-notes", response_model=list[PatchNote])
async def stub_patch_notes(since: int = Query(default=0)):
    notes = [
        PatchNote(
            version=2,
            learned=["bank account doesn't match the vendor on file"],
            invoices_trained_on=57,
        ),
        PatchNote(
            version=3,
            learned=["photocopied invoices with low legibility", "domain mismatches on known vendors"],
            invoices_trained_on=134,
        ),
    ]
    return [n for n in notes if n.version > since]


@router.get("/metrics", response_model=list[VersionMetrics])
async def stub_metrics():
    return [
        VersionMetrics(version=1, catch_rate=0.35, false_positive_rate=0.08, held_out_catch_rate=0.30),
        VersionMetrics(version=2, catch_rate=0.52, false_positive_rate=0.10, held_out_catch_rate=0.45),
        VersionMetrics(version=3, catch_rate=0.64, false_positive_rate=0.11, held_out_catch_rate=0.58),
    ]


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
async def stub_leaderboard():
    return [
        LeaderboardEntry(player="Alice", money=12400, patches_caused=3),
        LeaderboardEntry(player="Bob", money=8200, patches_caused=1),
        LeaderboardEntry(player="Charlie", money=4100, patches_caused=0),
    ]
