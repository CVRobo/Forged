"""Round routes: POST /round/start, POST /submit.

/round/start — creates a new round with level data, memo rules, and Redis state.
/submit — runs detection, calculates verdict, writes results to Redis.
"""

from __future__ import annotations

import random
import time
import uuid

from fastapi import APIRouter, HTTPException

from server import config
from server.content.levels import SCHEME_PAY, STUB_LEVELS
from server.models.schemas import (
    CaseFile,
    MemoRule,
    RoundStartRequest,
    RoundStartResponse,
    SubmitRequest,
    SubmitResponse,
)
from server.services import claude_service, game_state
from server.services.detector import detect

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _pick_memo(level_data: dict, decoy_text: str | None = None) -> list[MemoRule]:
    """Pick 2 real + 1 decoy memo rules, shuffled."""
    all_memo = level_data["memo"]
    reals = [m for m in all_memo if m["real"]]
    fakes = [m for m in all_memo if not m["real"]]

    chosen_reals = random.sample(reals, min(2, len(reals)))

    if decoy_text:
        decoy = MemoRule(text=decoy_text, real=False)
    else:
        fake = random.choice(fakes)
        decoy = MemoRule(text=fake["text"], real=False)

    result = [MemoRule(text=m["text"], real=m["real"]) for m in chosen_reals] + [decoy]
    random.shuffle(result)
    return result


# ---------------------------------------------------------------------------
# POST /round/start
# ---------------------------------------------------------------------------


@router.post("/round/start", response_model=RoundStartResponse)
async def round_start(req: RoundStartRequest):
    # 1. Validate level (clamp to available levels)
    level = req.level if req.level in STUB_LEVELS else 1
    level_data = STUB_LEVELS[level]

    # 2. Get current inspector version from Redis
    version = game_state.get_current_version()

    # 3. Build memo rules (2 real + 1 decoy)
    real_tells = [m["tell"] for m in level_data["memo"] if m["real"]]
    decoy_text = await claude_service.generate_memo_decoy(level, real_tells)
    memo = _pick_memo(level_data, decoy_text)

    # 4. Generate round ID and save state
    round_id = str(uuid.uuid4())
    round_state = {
        "level": level,
        "version": version,
        "memo": [m.model_dump() for m in memo],
        "persuasion": 0,
        "created_at": time.time(),
    }
    game_state.save_round(round_id, round_state)

    # 5. Build response
    return RoundStartResponse(
        round_id=round_id,
        memo=memo,
        inspector_version=version,
        case_file=CaseFile(
            company=level_data["company"],
            vendors=level_data["vendors"],
            approvers=level_data["approvers"],
            notes=level_data["notes"],
        ),
    )


# ---------------------------------------------------------------------------
# POST /submit
# ---------------------------------------------------------------------------


@router.post("/submit", response_model=SubmitResponse)
async def submit(req: SubmitRequest):
    # 1. Load round state from Redis
    round_state = game_state.load_round(req.round_id)
    if round_state is None:
        raise HTTPException(status_code=404, detail="Round not found or expired")

    level = round_state["level"]
    version = round_state["version"]
    persuasion = round_state.get("persuasion", 0)
    level_data = STUB_LEVELS.get(level, STUB_LEVELS[1])

    # 2. Validity gate
    valid = await claude_service.check_validity(req.record, level_data)
    if not valid:
        return SubmitResponse(
            verdict="FLAGGED",
            top_tells=[],
            inspector_line="This invoice doesn't even make sense.",
            payout=0,
            new_version=version,
        )

    # 3. Detection
    tells, raw_suspicion = detect(req.record, version, round_state.get("memo", []))

    # 4. Suspicion calculation (from prototype game.js ~line 800)
    skill = 0.55 + 0.12 * (version - 1)
    suspicion = raw_suspicion * skill
    suspicion -= persuasion * 0.18
    if "APPROVED" in req.record.stamp_type:
        suspicion -= 6
    suspicion += random.uniform(-12, 12)
    caught = suspicion > 38

    # 5. Payout (if not caught)
    payout = 0
    if not caught:
        pay_mult = SCHEME_PAY.get(req.record.scheme, 1.0)
        payout = int(req.record.amount * pay_mult)

    # 6. Inspector line
    inspector_line = await claude_service.generate_inspector_line(caught, level, version)

    # 7. Redis writes
    record_dict = req.record.model_dump()
    verdict = "FLAGGED" if caught else "PAID"

    game_state.store_submission(req.round_id, record_dict, verdict, version)

    if caught:
        queue_len = game_state.queue_for_retrain(req.round_id)
        # Check if retrain threshold reached — bump version
        if queue_len >= config.RETRAIN_THRESHOLD:
            game_state.drain_retrain_queue()
            new_version = version + 1
            game_state.set_current_version(new_version)
        else:
            new_version = version
    else:
        # Update leaderboard for successful fraud
        player = req.record.vendor  # use vendor as player ID for now
        game_state.update_leaderboard(player, payout, 0)
        new_version = version

    # Inspector memory (for Redis sponsor track)
    summary = (
        f"L{level}v{version}: {req.record.scheme} "
        f"{'CAUGHT' if caught else 'MISSED'} "
        f"(suspicion={suspicion:.0f}, tells={len(tells)})"
    )
    game_state.add_inspector_memory(summary)

    # Track blind spots for tells the inspector missed
    if not caught:
        for tell in tells:
            game_state.increment_blind_spot(tell.tell_type)

    return SubmitResponse(
        verdict=verdict,
        top_tells=tells[:3],
        inspector_line=inspector_line,
        payout=payout,
        new_version=new_version,
    )
