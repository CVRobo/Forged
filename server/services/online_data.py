"""Typed-checkout submissions: Gus's verdict from the fraud model, and the rows kept for training.

Every order a player sends becomes one row in server/data/ieee_rows.csv (or FORGED_DATA_DIR),
with the dataset's columns plus the game's own (verdict, score, top_reasons, ...).

The verdict comes from the newest promoted version of the model in ml/online (LightGBM on
the IEEE-CIS data, retrained on players' orders). Without a trained model, or without its
packages, the server answers with the scripted Gus the browser sends, so the game still plays;
the reason is logged once and shown at /health. The scripted Gus's nudges carry over: heat and
persuasion move the model's score, and the card can get reported between orders days apart
(never with Patience). Every RETRAIN_EVERY orders that get through, a retrain runs in the
background, where the machine has its data (ml/online/train.can_retrain); the new version goes
live only if it passes the gate in ml/online/retrain.py. A win with the Paper Shredder is saved
as FORGOTTEN: it still pays, but Gus doesn't study it.
"""

from __future__ import annotations

import csv
import logging
import math
import os
import random
import threading
import time
from pathlib import Path

from fastapi import HTTPException

from server.models.schemas import GusVerdict, OnlineRecord, PreviewResponse, SubmitResponse, Tell

log = logging.getLogger(__name__)

DATA_DIR = Path(os.environ.get("FORGED_DATA_DIR", Path(__file__).resolve().parents[1] / "data"))
ROWS_CSV = DATA_DIR / "ieee_rows.csv"
RETRAIN_EVERY = int(os.environ.get("FORGED_RETRAIN_EVERY", "25"))
_lock = threading.Lock()
_retrain = {"running": False, "evasions": 0}

# The scripted Gus's nudges (prototype/game.js and orders.js judgeOrders), in his points. The model
# takes them in log-odds: a strong scripted tell is 16-18 points, a strong model tell 4-5 log-odds.
# His leniency for new players is the model's own rank thresholds (ml/online/model.py RANK_CUTOFF).
POINTS_PER_LOGIT = 4.0
PERSUASION_WEIGHT = 0.18             # smooth talk in the support chat
HEAT_START, HEAT_WEIGHT = 40.0, 0.5  # heat over 40 adds (heat - 40) * 0.5
REPORT_RISK_PER_DAY = 0.04           # each day between orders, the cardholder may report the card
RETRY_SECONDS = 60                   # a model that failed to load is tried again after this long

_unavailable = {"error": None, "at": 0.0}  # why the model last failed to load, and when
_warned: set[str] = set()                  # problems already logged
_shredded: set[str] = set()                # runs whose Paper Shredder already made Gus forget a win
_shred_lock = threading.Lock()

# the same columns, in the same order, as the game's CSV export (prototype/orders.js COLUMNS)
COLUMNS = [
    "TransactionID", "isFraud", "TransactionDT", "TransactionAmt", "ProductCD",
    *[f"card{i}" for i in range(1, 7)], "addr1", "addr2", "dist1", "dist2", "P_emaildomain", "R_emaildomain",
    *[f"C{i}" for i in range(1, 15)], *[f"D{i}" for i in range(1, 16)], *[f"M{i}" for i in range(1, 10)],
    *[f"V{i}" for i in range(1, 340)], *[f"id_{i:02d}" for i in range(1, 39)], "DeviceType", "DeviceInfo",
    "session_id", "origin", "level_id", "round_no", "scheme_id", "campaign_id", "step", "verdict", "score",
    "top_reasons", "detector_version", "cover_note", "player",
]


def _warn_once(message: str) -> None:
    if message not in _warned:
        _warned.add(message)
        log.warning(message)


def _model():
    """The live version, or None: no packages, no trained version, or a file that won't load."""
    if _unavailable["error"] and time.monotonic() - _unavailable["at"] < RETRY_SECONDS:
        return None
    try:
        from ml.online import model as M
        v = M.load()
    except Exception as e:
        _unavailable.update(error=f"{type(e).__name__}: {e}", at=time.monotonic())
        _warn_once(f"fraud model unavailable, the game uses the browser's scripted Gus: {_unavailable['error']}")
        return None
    _unavailable["error"] = None
    return v


def model_version() -> int | None:
    """The live version: the one judging orders, which the game should show. None without a model."""
    v = _model()
    return v.version if v else None


def _promoted() -> list[dict] | None:
    if _model() is None:
        return None
    from ml.online import model as M
    return [r for r in M.registry() if r.get("promoted")]


def model_patch_notes(since: int) -> list[dict] | None:
    """What each version after `since` learned, for the between-rounds screen. None without a model."""
    rows = _promoted()
    if rows is None:
        return None
    return [{"version": r["version"], "learned": r["learned"], "invoices_trained_on": r.get("trained_on", {}).get("player", 0)}
            for r in rows if r["version"] > since and r.get("learned")]


def model_metrics() -> list[dict] | None:
    """Each version's test results: real fraud caught, real customers blocked, and held-out attacks
    caught (player orders once there are some, the simulated attackers for v1). None without a model."""
    rows = _promoted()
    if rows is None:
        return None
    out = []
    for r in rows:
        t = r.get("test", {})
        out.append({"version": r["version"], "catch_rate": t.get("recall", 0.0), "false_positive_rate": t.get("fpr", 0.0),
                    "held_out_catch_rate": t.get("player_catch", t.get("sim_catch", 0.0))})
    return out


def model_status() -> dict:
    """For /health: the live version, why the model is off if it is, and whether it can learn here."""
    v = _model()
    status = {"available": v is not None, "version": v.version if v else None, "error": _unavailable["error"],
              "learning": False, "why_not_learning": "no model", "wins_waiting": _retrain["evasions"],
              "retrain_every": RETRAIN_EVERY}
    if v is not None:
        try:
            from ml.online import train as T
            ok, why = T.can_retrain()
        except Exception as e:
            ok, why = False, f"{type(e).__name__}: {e}"
        status.update(learning=ok, why_not_learning=why or None)
    return status


def _nudge(record: OnlineRecord) -> float:
    """The scripted Gus's nudges, in log-odds: heat over 40 adds, persuasion takes away."""
    heat = max(0.0, _number(getattr(record, "heat", 0)) - HEAT_START) * HEAT_WEIGHT
    return (heat - PERSUASION_WEIGHT * _number(getattr(record, "persuasion", 0))) / POINTS_PER_LOGIT


def _shift(score: float, log_odds: float) -> float:
    """P(fraud) moved by `log_odds`."""
    if not log_odds:
        return score
    p = min(max(score, 1e-12), 1 - 1e-12)
    return 1 / (1 + math.exp(-(math.log(p / (1 - p)) + log_odds)))


def _days_between(earlier: dict, later: dict) -> int:
    return round((_number(later.get("TransactionDT")) - _number(earlier.get("TransactionDT"))) / 86400)


def _reported(days: int, perks) -> bool:
    """orders.js judgeOrders: waiting between orders gives the cardholder time to call their bank."""
    return days > 0 and "patience" not in perks and _roll() < REPORT_RISK_PER_DAY * days


def _roll() -> float:
    return random.random()


def _number(value) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return 0.0
    return x if math.isfinite(x) else 0.0


def judge(record: OnlineRecord, gus: GusVerdict | None, perks=()) -> dict:
    """Per order: declined or not, why, and the score. A flagged or reported card blocks the rest."""
    v = _model()
    if v is None:
        caught = bool(gus and gus.caught)
        tells = [[str(t[0]), float(t[1]) if len(t) > 1 else 1.0] for t in (gus.tells if gus else []) if t]
        return {"caught": caught, "results": None, "tells": tells, "version": 0, "source": "browser",
                "payout": int(gus.payout if gus else 0)}
    import pandas as pd
    rows = pd.DataFrame(record.rows)
    scores, why = v.scores(rows), v.explain(rows)
    cut = v.game_threshold(getattr(record, "rank", None))
    nudge = _nudge(record)
    values = list(gus.values) if gus and gus.values else []
    results, stopped, payout = [], False, 0.0
    for i, (s, t) in enumerate(zip(scores, why)):
        if stopped:
            results.append({"declined": True, "reason": "card_blocked", "score": round(float(s), 4), "tells": t})
            continue
        if i > 0 and _reported(_days_between(record.rows[i - 1], record.rows[i]), perks):
            results.append({"declined": True, "reason": "card_reported", "score": round(float(s), 4), "tells": []})
            stopped = True
            continue
        flagged = _shift(float(s), nudge) >= cut
        results.append({"declined": flagged, "reason": "flagged" if flagged else None, "score": round(float(s), 4), "tells": t})
        if not flagged and i < len(values):
            payout += values[i]
        stopped = flagged
    caught = any(r["declined"] for r in results)
    # what gave the campaign away: the flagged orders' tells (none if the cardholder reported the card);
    # on a win, everything Gus noticed
    decisive = [r for r in results if r["reason"] == "flagged"] if caught else results
    tells = sorted([t for r in decisive for t in r["tells"]], key=lambda t: -t[1])
    return {"caught": caught, "results": results, "tells": tells, "version": v.version, "source": "model", "payout": int(payout)}


def preview(record: OnlineRecord) -> PreviewResponse:
    """The gut feeling: the same scores, nudges and threshold as the verdict, without saving anything."""
    v = _model()
    if v is None:
        raise HTTPException(status_code=503, detail="no fraud model: the game uses its scripted Gus")
    import pandas as pd
    rows = pd.DataFrame(record.rows)
    if rows.empty:
        raise HTTPException(status_code=422, detail="no orders yet")
    scores = [float(s) for s in v.scores(rows)]
    cut = v.game_threshold(getattr(record, "rank", None))
    nudged = [_shift(s, _nudge(record)) for s in scores]
    worst = max(range(len(scores)), key=nudged.__getitem__)
    return PreviewResponse(worry=round(nudged[worst] / cut, 4), scores=[round(s, 4) for s in scores], threshold=cut,
                           version=v.version, tells=v.explain(rows.iloc[[worst]])[0])


def save_rows(record: OnlineRecord, verdict: dict, round_id: str, player: str | None) -> int:
    """Append the record's rows to the CSV (434 dataset columns, then the game's). Returns how many got through."""
    rows = []
    for i, row in enumerate(record.rows):
        row = dict(row)
        row.setdefault("session_id", round_id)
        r = verdict["results"][i] if verdict["results"] else None
        declined = r["declined"] if r else verdict["caught"]
        row["isFraud"] = 1  # every player order is fraud; legit rows come from the real dataset
        if declined:  # BLOCKED: never Gus's call, the card was already declined or reported
            row["verdict"] = "BLOCKED" if r and r["reason"] in ("card_blocked", "card_reported") else "DECLINED"
        else:  # FORGOTTEN: it got through, but the Paper Shredder keeps Gus from studying it
            row["verdict"] = "FORGOTTEN" if verdict.get("forgotten") else "APPROVED"
        if r:
            row["score"] = r["score"]
        row["top_reasons"] = "|".join(str(t[0]) for t in (r["tells"] if r else verdict["tells"])[:3])
        row["detector_version"] = verdict["version"] or row.get("detector_version")
        row["player"] = player or ""
        rows.append(row)
    if not rows:
        return 0
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _lock:
        new = not ROWS_CSV.exists() or ROWS_CSV.stat().st_size == 0
        with ROWS_CSV.open("a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
            if new:
                w.writeheader()
            w.writerows(rows)
    return sum(r["verdict"] == "APPROVED" for r in rows)


def _maybe_retrain(evasions: int) -> None:
    """Gus learns from players' wins: a background retrain every RETRAIN_EVERY orders that got through,
    where this machine can train. Elsewhere the wins wait (and the reason is logged once)."""
    with _lock:
        _retrain["evasions"] += evasions
        if _retrain["running"] or _retrain["evasions"] < RETRAIN_EVERY:
            return
    try:
        from ml.online import train as T
        ok, why = T.can_retrain()
    except Exception as e:
        ok, why = False, f"{type(e).__name__}: {e}"
    if not ok:
        _warn_once(f"Gus can't learn from players on this machine: {why}")
        return
    with _lock:
        if _retrain["running"]:
            return
        _retrain.update(running=True, evasions=0)

    def run():
        try:
            from ml.online.retrain import retrain
            log.info("retrain finished: %s", retrain())
        except Exception:
            log.exception("retrain failed")
        finally:
            _retrain["running"] = False
    threading.Thread(target=run, daemon=True).start()


def _shredder_forgets(record: OnlineRecord, perks) -> bool:
    """Paper Shredder (game.js showCorkboard): Gus forgets the run's first win after it's bought."""
    if "shred" not in perks:
        return False
    run = str(record.rows[0].get("session_id") or getattr(record, "campaign_id", "") or "")
    with _shred_lock:
        if run in _shredded:
            return False
        _shredded.add(run)
    return True


def submit_online(record: OnlineRecord, gus: GusVerdict | None, round_id: str, player: str | None,
                  perks: list[str] | None = None) -> SubmitResponse:
    perks = set(perks or ())
    verdict = judge(record, gus, perks)
    if verdict["source"] == "model" and not verdict["caught"] and _shredder_forgets(record, perks):
        verdict["forgotten"] = True
    evasions = save_rows(record, verdict, round_id, player)
    if verdict["source"] == "model":
        _maybe_retrain(evasions)
    return SubmitResponse(
        verdict="DECLINED" if verdict["caught"] else "APPROVED",
        top_tells=[Tell(tell_type=str(t[0]), strength=float(t[1])) for t in verdict["tells"][:3]],
        inspector_line="",  # the game writes Gus's line from the top tell
        payout=verdict["payout"],
        new_version=verdict["version"],
        results=verdict["results"],
    )
