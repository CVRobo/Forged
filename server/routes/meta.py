"""Meta routes: GET /patch-notes, /metrics, /leaderboard.

Pure Redis reads — no Claude, no ML, no Deepgram.
Returns empty lists gracefully when Redis has no data.
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from server.models.schemas import LeaderboardEntry, PatchNote, VersionMetrics
from server.services import game_state

router = APIRouter()


@router.get("/patch-notes", response_model=list[PatchNote])
async def patch_notes(since: int = Query(default=0)):
    rows = game_state.get_patch_notes(since)
    return [PatchNote(**r) for r in rows]


@router.get("/metrics", response_model=list[VersionMetrics])
async def metrics():
    rows = game_state.get_all_metrics()
    return [VersionMetrics(**r) for r in rows]


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
async def leaderboard():
    rows = game_state.get_leaderboard(20)
    return [LeaderboardEntry(**r) for r in rows]
