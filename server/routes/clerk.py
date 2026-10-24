"""Clerk routes: POST /clerk and POST /clerk/voice.

Real implementation (replaces stubs).
"""

from __future__ import annotations

from fastapi import APIRouter

from server.models.schemas import (
    ClerkRequest,
    ClerkResponse,
    ClerkVoiceRequest,
    ClerkVoiceResponse,
)

router = APIRouter()


@router.post("/clerk", response_model=ClerkResponse)
async def clerk(req: ClerkRequest):
    raise NotImplementedError("Real clerk not yet implemented. Run with USE_STUBS=true.")


@router.post("/clerk/voice", response_model=ClerkVoiceResponse)
async def clerk_voice(req: ClerkVoiceRequest):
    raise NotImplementedError("Real voice clerk not yet implemented. Run with USE_STUBS=true.")
