"""Round routes: POST /round/start, POST /submit.

Real implementation (replaces stubs).
"""

from __future__ import annotations

from fastapi import APIRouter

from server.models.schemas import (
    RoundStartRequest,
    RoundStartResponse,
    SubmitRequest,
    SubmitResponse,
)

router = APIRouter()


@router.post("/round/start", response_model=RoundStartResponse)
async def round_start(req: RoundStartRequest):
    raise NotImplementedError("Real round/start not yet implemented. Run with USE_STUBS=true.")


@router.post("/submit", response_model=SubmitResponse)
async def submit(req: SubmitRequest):
    raise NotImplementedError("Real submit not yet implemented. Run with USE_STUBS=true.")
