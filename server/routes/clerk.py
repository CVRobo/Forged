"""Clerk route: POST /clerk.

Real implementation (replaces stubs).
"""

from __future__ import annotations

from fastapi import APIRouter

from server.models.schemas import ClerkRequest, ClerkResponse

router = APIRouter()


@router.post("/clerk", response_model=ClerkResponse)
async def clerk(req: ClerkRequest):
    raise NotImplementedError("Real clerk not yet implemented. Run with USE_STUBS=true.")
