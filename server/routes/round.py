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
from server.services.online_data import model_version, preview, submit_online
from server.models.schemas import (
    CaseFile,
    MemoRule,
    OnlineRecord,
    PreviewRequest,
    PreviewResponse,
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

    # 4. Resolve session — continue existing or create new
    if req.session_id and game_state.load_session(req.session_id) is not None:
        session_id = req.session_id
    else:
        session_id, _ = game_state.create_session()

    # 5. Generate round ID and save state
    round_id = str(uuid.uuid4())
    round_state = {
        "level": level,
        "version": version,
        "session_id": session_id,
        "memo": [m.model_dump() for m in memo],
        "persuasion": 0,
        "created_at": time.time(),
    }
    game_state.save_round(round_id, round_state)
    game_state.append_round_to_session(session_id, round_id)

    # 6. Build response
    return RoundStartResponse(
        round_id=round_id,
        session_id=session_id,
        memo=memo,
        inspector_version=model_version() or version,  # the fraud model's, when it's live: the one judging
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
    if isinstance(req.record, OnlineRecord):  # the typed checkout
        return submit_online(req.record, req.gus, req.round_id, req.player, req.perks)
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
    session_id = round_state.get("session_id")

    # Build case_file snapshot from level_data
    case_file_snapshot = {
        "company": level_data["company"],
        "vendors": [v if isinstance(v, dict) else v.model_dump() for v in level_data["vendors"]],
        "approvers": level_data["approvers"],
        "notes": level_data["notes"],
    }

    game_state.store_submission(
        req.round_id, record_dict, verdict, version,
        session_id=session_id,
        level=level,
        case_file=case_file_snapshot,
        memo_rules=round_state.get("memo"),
        persuasion=persuasion,
        tells=[t.model_dump() for t in tells],
        suspicion=suspicion,
    )

    if caught:
        queue_len = game_state.queue_for_retrain(req.round_id)
        # Check if retrain threshold reached — bump version
        if queue_len >= config.RETRAIN_THRESHOLD:
            drained_ids = game_state.drain_retrain_queue()
            new_version = version + 1
            game_state.set_current_version(new_version)

            # Meaningful version bump: patch notes + metrics
            learned = game_state.aggregate_retrain_tells(drained_ids)
            game_state.add_patch_note(new_version, learned, len(drained_ids))

            # Generate slightly-improved metrics over previous version
            prev_metrics = game_state.get_all_metrics()
            if prev_metrics:
                last = prev_metrics[-1]
                cr = min(last["catch_rate"] + random.uniform(0.04, 0.10), 0.98)
                fp = min(last["false_positive_rate"] + random.uniform(0.005, 0.02), 0.25)
                ho = min(last["held_out_catch_rate"] + random.uniform(0.03, 0.08), 0.95)
            else:
                cr, fp, ho = 0.35, 0.08, 0.30
            game_state.save_version_metrics(new_version, cr, fp, ho)
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


@router.post("/preview", response_model=PreviewResponse)
async def preview_order(req: PreviewRequest):
    """Gus's gut feeling while the player types the checkout (the fraud model's score, nothing saved)."""
    return preview(req.record)
