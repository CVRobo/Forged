"""Defender mode route: POST /defend/shift.

The role swap: the player works the AP desk and sorts real invoices from fakes against the
detector. A shift is built by B's ml.defender.build_shift() from the generator and scored by the
live detector, so its inspector is whatever version solo play has trained. Nothing is stored.
"""

from __future__ import annotations

import random

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class ShiftRequest(BaseModel):
    seed: int | None = None  # None picks one at random


@router.post("/defend/shift")
def defend_shift(req: ShiftRequest) -> dict:
    # A plain def: FastAPI runs it in a worker thread, so building a shift (and training v1 the
    # first time) doesn't block the event loop.
    try:
        from ml.defender import build_shift
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=f"ML detector unavailable: {exc}") from exc
    return build_shift(req.seed if req.seed is not None else random.randint(1, 1_000_000))
