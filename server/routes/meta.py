"""Meta routes: GET /patch-notes, /metrics, /leaderboard.

Real implementation (replaces stubs).
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from server.models.schemas import LeaderboardEntry, PatchNote, VersionMetrics

router = APIRouter()


@router.get("/patch-notes", response_model=list[PatchNote])
async def patch_notes(since: int = Query(default=0)):
    raise NotImplementedError("Real patch-notes not yet implemented. Run with USE_STUBS=true.")


@router.get("/metrics", response_model=list[VersionMetrics])
async def metrics():
    raise NotImplementedError("Real metrics not yet implemented. Run with USE_STUBS=true.")


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
async def leaderboard():
    raise NotImplementedError("Real leaderboard not yet implemented. Run with USE_STUBS=true.")
