"""NPC routes: POST /npc/chat and POST /npc/voice.

Generalised voice/text endpoints for all NPCs (clerk, inspector, boss, kevin, dana).
Uses Cartesia STT/TTS and Claude-powered conversation with keyword fallback.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from pydantic import BaseModel

from server.models.schemas import (
    NpcChatRequest,
    NpcChatResponse,
    NpcVoiceRequest,
    NpcVoiceResponse,
)
from server.services import cartesia_service, game_state
from server.services.npc_voice import (
    VALID_NPCS,
    get_npc_info,
    get_npc_voice,
    score_npc_interaction,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _apply_effects(round_state: dict, npc_key: str, effects: dict) -> None:
    """Apply gameplay effects to round state in-place."""
    effect = effects.get("effect", "none")

    if effect == "persuasion":
        # Clerk persuasion: keep the highest score
        current = round_state.get("persuasion", 0)
        round_state["persuasion"] = max(current, effects.get("persuasion_delta", 0))

    elif effect == "suspicion":
        delta = effects.get("suspicion_delta", 0.0)
        if delta != 0:
            current = round_state.get("suspicion", 0.0)
            round_state["suspicion"] = max(0.0, min(1.0, current + delta))

    elif effect == "intel":
        intel = effects.get("intel")
        if intel:
            hints = round_state.setdefault("intel_hints", [])
            if intel not in hints:
                hints.append(intel)

    elif effect == "distraction":
        round_state["kevin_distracted"] = True


# ---------------------------------------------------------------------------
# POST /npc/chat
# ---------------------------------------------------------------------------


@router.post("/npc/chat", response_model=NpcChatResponse)
async def npc_chat(req: NpcChatRequest):
    if req.npc not in VALID_NPCS:
        raise HTTPException(status_code=400, detail=f"Unknown NPC: {req.npc}")

    # 1. Load round from Redis
    round_state = game_state.load_round(req.round_id)
    if round_state is None:
        raise HTTPException(status_code=404, detail="Round not found or expired")

    level = round_state["level"]
    npc_info = get_npc_info(level, req.npc)
    if npc_info is None:
        raise HTTPException(status_code=400, detail=f"NPC '{req.npc}' not found in level {level}")

    # 2. Load conversation history
    history = game_state.load_npc_conversation(req.round_id, req.npc)

    # 3. Build context for gameplay mechanics
    ctx = {
        "carrying": round_state.get("carrying", False),
        "shouted": False,  # text chat can't shout
    }

    # 4. Score via Claude (fallback to keywords)
    reply, effects = await score_npc_interaction(
        req.text, req.npc, npc_info, level, ctx=ctx, history=history,
    )

    # 5. Apply gameplay effects to round state
    _apply_effects(round_state, req.npc, effects)
    game_state.save_round(req.round_id, round_state)

    # 6. Save conversation turn
    game_state.save_npc_conversation(req.round_id, req.npc, {"role": "player", "text": req.text})
    game_state.save_npc_conversation(req.round_id, req.npc, {"role": "npc", "text": reply})

    return NpcChatResponse(
        reply=reply,
        npc_name=npc_info["name"],
        persuasion_delta=effects.get("persuasion_delta", 0),
        suspicion_delta=effects.get("suspicion_delta", 0.0),
        intel=effects.get("intel"),
        effect=effects.get("effect", "none"),
    )


# ---------------------------------------------------------------------------
# POST /npc/voice
# ---------------------------------------------------------------------------


@router.post("/npc/voice", response_model=NpcVoiceResponse)
async def npc_voice(req: NpcVoiceRequest):
    if req.npc not in VALID_NPCS:
        raise HTTPException(status_code=400, detail=f"Unknown NPC: {req.npc}")

    # 1. Load round from Redis
    round_state = game_state.load_round(req.round_id)
    if round_state is None:
        raise HTTPException(status_code=404, detail="Round not found or expired")

    level = round_state["level"]
    npc_info = get_npc_info(level, req.npc)
    if npc_info is None:
        raise HTTPException(status_code=400, detail=f"NPC '{req.npc}' not found in level {level}")

    # 2. Decode audio and transcribe via Cartesia STT
    try:
        audio_bytes = cartesia_service.decode_audio(req.audio_b64)
        transcript = await cartesia_service.speech_to_text(audio_bytes)
    except Exception as exc:
        logger.error("Cartesia STT failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Voice transcription unavailable. Set CARTESIA_API_KEY or use /npc/chat for text.",
        )

    # 3. Load conversation history
    history = game_state.load_npc_conversation(req.round_id, req.npc)

    # 4. Build context
    ctx = {
        "carrying": round_state.get("carrying", False),
        "shouted": False,  # volume detection is client-side
    }

    # 5. Score via Claude (same as text path)
    reply, effects = await score_npc_interaction(
        transcript, req.npc, npc_info, level, ctx=ctx, history=history,
    )

    # 6. Apply gameplay effects
    _apply_effects(round_state, req.npc, effects)
    game_state.save_round(req.round_id, round_state)

    # 7. Save conversation turn
    game_state.save_npc_conversation(req.round_id, req.npc, {"role": "player", "text": transcript})
    game_state.save_npc_conversation(req.round_id, req.npc, {"role": "npc", "text": reply})

    # 8. Cartesia TTS with NPC-specific voice
    reply_audio_b64 = None
    try:
        voice = get_npc_voice(npc_info)
        audio = await cartesia_service.text_to_speech(reply, voice=voice)
        reply_audio_b64 = cartesia_service.encode_audio(audio)
    except Exception as exc:
        logger.warning("Cartesia TTS failed: %s", exc)

    return NpcVoiceResponse(
        transcript=transcript,
        reply=reply,
        npc_name=npc_info["name"],
        persuasion_delta=effects.get("persuasion_delta", 0),
        suspicion_delta=effects.get("suspicion_delta", 0.0),
        intel=effects.get("intel"),
        effect=effects.get("effect", "none"),
        reply_audio_b64=reply_audio_b64,
    )


# ---------------------------------------------------------------------------
# POST /npc/speak  — TTS-only (no game logic, just voice a line)
# ---------------------------------------------------------------------------


class NpcSpeakRequest(BaseModel):
    npc: str
    text: str
    round_id: str


class NpcSpeakResponse(BaseModel):
    audio_b64: str | None = None


@router.post("/npc/speak", response_model=NpcSpeakResponse)
async def npc_speak(req: NpcSpeakRequest):
    """Generate TTS audio for an NPC line. No game-state changes."""
    if req.npc not in VALID_NPCS:
        raise HTTPException(status_code=400, detail=f"Unknown NPC: {req.npc}")

    # Try to get level from round state, but don't fail if Redis is down
    level = 1
    try:
        round_state = game_state.load_round(req.round_id)
        if round_state:
            level = round_state["level"]
    except Exception:
        pass
    npc_info = get_npc_info(level, req.npc)
    if npc_info is None:
        npc_info = get_npc_info(1, req.npc)

    audio_b64 = None
    try:
        voice = get_npc_voice(npc_info)
        audio = await cartesia_service.text_to_speech(req.text, voice=voice)
        audio_b64 = cartesia_service.encode_audio(audio)
    except Exception as exc:
        logger.warning("Cartesia TTS failed for /npc/speak: %s", exc)

    return NpcSpeakResponse(audio_b64=audio_b64)
