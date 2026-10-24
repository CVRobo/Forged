"""Clerk routes: POST /clerk and POST /clerk/voice.

Text clerk uses Claude for scoring with keyword fallback.
Voice clerk uses Deepgram STT -> clerk scoring -> Deepgram TTS.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from server.content.levels import STUB_LEVELS
from server.models.schemas import (
    ClerkRequest,
    ClerkResponse,
    ClerkVoiceRequest,
    ClerkVoiceResponse,
)
from server.services import claude_service, deepgram_service, game_state

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_clerk_info(level: int) -> dict:
    """Get clerk personality data for a level, enriched with vendor names."""
    level_data = STUB_LEVELS.get(level, STUB_LEVELS[1])
    clerk = dict(level_data["clerk"])  # shallow copy
    clerk["vendor_names"] = ", ".join(v.name for v in level_data["vendors"])
    return clerk


# ---------------------------------------------------------------------------
# POST /clerk
# ---------------------------------------------------------------------------


@router.post("/clerk", response_model=ClerkResponse)
async def clerk(req: ClerkRequest):
    # 1. Load round from Redis
    round_state = game_state.load_round(req.round_id)
    if round_state is None:
        raise HTTPException(status_code=404, detail="Round not found or expired")

    level = round_state["level"]
    clerk_info = _get_clerk_info(level)

    # 2. Score via Claude (falls back to keywords)
    score, reply = await claude_service.score_clerk_text(req.text, clerk_info, level)

    # 3. Update persuasion in round state (keep highest)
    round_state["persuasion"] = max(round_state.get("persuasion", 0), score)
    game_state.save_round(req.round_id, round_state)

    return ClerkResponse(reply=reply, persuasion_score=score)


# ---------------------------------------------------------------------------
# POST /clerk/voice
# ---------------------------------------------------------------------------


@router.post("/clerk/voice", response_model=ClerkVoiceResponse)
async def clerk_voice(req: ClerkVoiceRequest):
    # 1. Load round from Redis
    round_state = game_state.load_round(req.round_id)
    if round_state is None:
        raise HTTPException(status_code=404, detail="Round not found or expired")

    level = round_state["level"]
    clerk_info = _get_clerk_info(level)

    # 2. Decode audio and transcribe via Deepgram
    try:
        audio_bytes = deepgram_service.decode_audio(req.audio_b64)
        transcript = await deepgram_service.speech_to_text(audio_bytes)
    except Exception as exc:
        logger.error("Deepgram STT failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Voice transcription unavailable. Set DEEPGRAM_API_KEY or use /clerk for text.",
        )

    # 3. Score the transcript (same as text clerk)
    score, reply = await claude_service.score_clerk_text(transcript, clerk_info, level)

    # 4. Update persuasion in round state
    round_state["persuasion"] = max(round_state.get("persuasion", 0), score)
    game_state.save_round(req.round_id, round_state)

    # 5. TTS the reply (fallback: return null audio)
    reply_audio_b64 = None
    try:
        audio = await deepgram_service.text_to_speech(reply)
        reply_audio_b64 = deepgram_service.encode_audio(audio)
    except Exception as exc:
        logger.warning("Deepgram TTS failed: %s", exc)

    return ClerkVoiceResponse(
        transcript=transcript,
        reply=reply,
        persuasion_score=score,
        reply_audio_b64=reply_audio_b64,
    )
