"""Redis game state management.

Provides thin wrappers around Redis for round state, session state,
leaderboard, and retrain queue. Kept simple and portable — no ORM,
no magic, just get/set/zadd calls.
"""

from __future__ import annotations

import json
from typing import Any

import redis

from server import config

# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

_pool: redis.ConnectionPool | None = None


def get_redis() -> redis.Redis:
    """Get a Redis client. Lazily creates a connection pool."""
    global _pool
    if _pool is None:
        _pool = redis.ConnectionPool.from_url(
            config.REDIS_URL, decode_responses=True
        )
    return redis.Redis(connection_pool=_pool)


# ---------------------------------------------------------------------------
# Round state
# ---------------------------------------------------------------------------


def save_round(round_id: str, data: dict[str, Any], ttl: int = 3600) -> None:
    """Store round state as a JSON string. Expires after ttl seconds."""
    r = get_redis()
    r.setex(f"round:{round_id}", ttl, json.dumps(data))


def load_round(round_id: str) -> dict[str, Any] | None:
    """Load round state. Returns None if expired or missing."""
    r = get_redis()
    raw = r.get(f"round:{round_id}")
    if raw is None:
        return None
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Session state
# ---------------------------------------------------------------------------


def save_session(session_id: str, data: dict[str, Any]) -> None:
    """Store session state. No TTL — sessions persist until cleared."""
    r = get_redis()
    r.set(f"session:{session_id}", json.dumps(data))


def load_session(session_id: str) -> dict[str, Any] | None:
    r = get_redis()
    raw = r.get(f"session:{session_id}")
    if raw is None:
        return None
    return json.loads(raw)


# ---------------------------------------------------------------------------
# Leaderboard (Sorted Set)
# ---------------------------------------------------------------------------


def update_leaderboard(player: str, money: int, patches: int) -> None:
    """Update both leaderboard sorted sets."""
    r = get_redis()
    r.zadd("leaderboard:money", {player: money})
    r.zadd("leaderboard:patches", {player: patches})


def get_leaderboard(top_n: int = 20) -> list[dict[str, Any]]:
    """Get top N players by money, with patches count."""
    r = get_redis()
    money_entries = r.zrevrange("leaderboard:money", 0, top_n - 1, withscores=True)
    result = []
    for player, money in money_entries:
        patches = r.zscore("leaderboard:patches", player) or 0
        result.append({
            "player": player,
            "money": int(money),
            "patches_caused": int(patches),
        })
    return result


# ---------------------------------------------------------------------------
# Retrain queue
# ---------------------------------------------------------------------------


def queue_for_retrain(round_id: str) -> int:
    """Add a round to the retrain queue. Returns current queue length."""
    r = get_redis()
    return r.rpush("retrain:queue", round_id)


def drain_retrain_queue() -> list[str]:
    """Pop all round_ids from the retrain queue."""
    r = get_redis()
    pipe = r.pipeline()
    pipe.lrange("retrain:queue", 0, -1)
    pipe.delete("retrain:queue")
    results = pipe.execute()
    return results[0]


# ---------------------------------------------------------------------------
# Detector version tracking
# ---------------------------------------------------------------------------


def get_current_version() -> int:
    r = get_redis()
    v = r.get("detector:current_version")
    return int(v) if v else 1


def set_current_version(version: int) -> None:
    r = get_redis()
    r.set("detector:current_version", str(version))


def save_version_metrics(
    version: int,
    catch_rate: float,
    fp_rate: float,
    held_out_rate: float,
) -> None:
    r = get_redis()
    r.hset(f"metrics:{version}", mapping={
        "catch_rate": str(catch_rate),
        "false_positive_rate": str(fp_rate),
        "held_out_catch_rate": str(held_out_rate),
    })


def get_all_metrics() -> list[dict[str, Any]]:
    """Get metrics for all versions."""
    r = get_redis()
    version = get_current_version()
    results = []
    for v in range(1, version + 1):
        data = r.hgetall(f"metrics:{v}")
        if data:
            results.append({
                "version": v,
                "catch_rate": float(data.get("catch_rate", 0)),
                "false_positive_rate": float(data.get("false_positive_rate", 0)),
                "held_out_catch_rate": float(data.get("held_out_catch_rate", 0)),
            })
    return results


# ---------------------------------------------------------------------------
# Patch notes (Sorted Set, scored by version)
# ---------------------------------------------------------------------------


def add_patch_note(version: int, learned: list[str], trained_on: int) -> None:
    r = get_redis()
    note = json.dumps({"version": version, "learned": learned, "invoices_trained_on": trained_on})
    r.zadd("patch_notes", {note: version})


def get_patch_notes(since_version: int = 0) -> list[dict[str, Any]]:
    r = get_redis()
    raw = r.zrangebyscore("patch_notes", since_version + 1, "+inf")
    return [json.loads(n) for n in raw]


# ---------------------------------------------------------------------------
# Inspector memory (agent memory for Redis sponsor track)
# ---------------------------------------------------------------------------


def add_inspector_memory(summary: str, max_memories: int = 20) -> None:
    """Append an attack pattern summary to the inspector's memory."""
    r = get_redis()
    r.rpush("inspector:memory", summary)
    r.ltrim("inspector:memory", -max_memories, -1)


def get_inspector_memory() -> list[str]:
    r = get_redis()
    return r.lrange("inspector:memory", 0, -1)


def increment_blind_spot(tell_type: str) -> None:
    """Track tells the inspector keeps missing."""
    r = get_redis()
    r.hincrby("inspector:blind_spots", tell_type, 1)


def get_blind_spots() -> dict[str, int]:
    r = get_redis()
    data = r.hgetall("inspector:blind_spots")
    return {k: int(v) for k, v in data.items()}


# ---------------------------------------------------------------------------
# Submission storage (for vector search later)
# ---------------------------------------------------------------------------


def store_submission(round_id: str, record: dict[str, Any], verdict: str, version: int) -> None:
    """Store a submission for later analysis and vector search."""
    r = get_redis()
    r.hset(f"submission:{round_id}", mapping={
        "record": json.dumps(record),
        "verdict": verdict,
        "version": str(version),
    })
    # Also add to the time-ordered set for recent submissions
    import time
    r.zadd("submissions:all", {round_id: time.time()})
