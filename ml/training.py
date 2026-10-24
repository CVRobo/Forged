"""Training v1 and the retrain loop (Model Spec v0.2 build step 5; sections 2.2, 3.3 and 4.2).

A retrain takes the new player rows and:
  1. drops near-duplicates of rows already in the replay buffer (before cloning),
  2. gives player rows without a payload zero weight (3.3: they pay out but never teach),
  3. clones every trick the live version missed into 60 variants on new vendors, amounts
     and dates, keeping 20% out of training to measure trick recall (2.2),
  4. refits on the generator's train set plus the whole replay buffer, doubling the clone
     weight until the triggering tricks are caught, at most 3 more times (the retrain guard),
  5. promotes only if frozen-set FPR stays at or under 8% and a 200-resample bootstrap
     says frozen-set recall did not drop by more than 5 points (4.2). force=True promotes
     anyway when trick recall improved and FPR is at most 10% (the demo override).
"""
import hashlib
from datetime import datetime
from functools import lru_cache

import numpy as np

from ml import explain, store
from ml.attackers import KNOWN_VENDOR_SCHEMES, Levers
from ml.baseline import Detector, evaluate, fit_detector, threshold_at_fpr
from ml.generate import build_dataset, clone_attacks
from ml.schema import BASE_FEATURES, LEVELS, Submission

BASE_SEEDS = (1, 2, 3)  # train, validation (calibration and thresholds), frozen test
TRAIN_FPR = 0.05
ORIGIN_WEIGHTS = {"legit_gen": 1.0, "scripted_attacker": 1.0, "llm_attacker": 1.5, "search_attacker": 1.5,
                  "player": 3.0, "player_clone": 1.0}
N_CLONES = 100
HOLDOUT_SHARE = 0.2
MAX_PLAYER_SHARE = 0.30  # one player's rows carry at most this share of the fraud weight
GUARD_TRIES = 3
GATE_FPR = 0.08
FORCE_FPR = 0.10
REGRESSION_TOL = 0.05
BOOTSTRAP = 200


@lru_cache(maxsize=1)
def base_splits() -> tuple[list[Submission], list[Submission], list[Submission]]:
    return tuple(build_dataset(seed) for seed in BASE_SEEDS)


def ensure_v1() -> int:
    """The live version, training and saving v1 from generator data the first time."""
    current = store.current_version()
    if current is not None:
        return current
    train, val, test = base_splits()
    det = fit_detector(train, val, BASE_FEATURES, TRAIN_FPR)
    store.save_version(det, _meta(1, det, len(train), evaluate(det, test), None, True, False, None,
                                  ["Inspector v1 starts work. Sleepy, but trained on the usual tricks."]))
    return 1


def level_thresholds(det: Detector, val: list[Submission]) -> dict[str, float]:
    """Spec 5.3: one shared model, each level flagging at its own FPR target."""
    legit = det.scores([r for r in val if not r.is_fraud])
    return {level_id: threshold_at_fpr(legit, level.fpr_target) for level_id, level in LEVELS.items()}


def retrain_on(new_rows: list[Submission], force: bool = False, level_id: str = "sunny_diner") -> dict:
    current = ensure_v1()
    old, old_threshold = store.load_detector(current), store.threshold(current, level_id)
    train, val, test = base_splits()
    buffer = store.load_rows()

    seen, fresh = {_key(r) for r in buffer}, []
    for r in new_rows:
        if _key(r) not in seen:
            seen.add(_key(r))
            fresh.append(_weighted(r))
    missed = [r for r in fresh if r.is_fraud and old.score_features(r.features) < old_threshold]
    clones, holdout = [], []
    for trick in missed:
        variants = [v.model_copy(update={"trick_id": trick.submission_id, "session_id": trick.session_id,
                                         "submission_id": f"{trick.submission_id}-clone{i}"})
                    for i, v in enumerate(clone_attacks(extract_levers(trick), N_CLONES, seed=_seed(trick.submission_id)))]
        cut = round(len(variants) * (1 - HOLDOUT_SHARE))
        clones += variants[:cut]
        holdout += variants[cut:]

    # The retrain guard: double the clone weight until the triggering tricks are caught. Keep the
    # first fit that catches them and passes the gate; failing that, the gate-passing fit with the
    # best trick recall, because a heavier fit that breaks frozen-set recall helps nobody.
    replay, fits, clone_weight = buffer + fresh + clones, [], 1.0
    for attempt in range(GUARD_TRIES + 1):
        pool = train + _cap_per_player(train, [_scaled_clone(r, clone_weight) for r in replay])
        new = fit_detector(pool, val, BASE_FEATURES, TRAIN_FPR)
        new_threshold = level_thresholds(new, val)[level_id]
        frozen, lower = evaluate(new, test), _recall_change_lower_bound(old, new, test)
        fit = dict(new=new, threshold=new_threshold, pool=pool, frozen=frozen, lower=lower, weight=clone_weight,
                   caught=all(new.score_features(r.features) >= new_threshold for r in missed),
                   passes=frozen["fpr"] <= GATE_FPR and lower >= -REGRESSION_TOL,
                   trick=_recall(new, new_threshold, holdout))
        fits.append(fit)
        if fit["caught"] or attempt == GUARD_TRIES:
            break
        clone_weight *= 2
    best = next((f for f in fits if f["caught"] and f["passes"]), None)
    if best is None and force:  # the demo override wants the trick caught, within the looser FPR cap
        best = next((f for f in fits if f["caught"] and f["frozen"]["fpr"] <= FORCE_FPR), None)
    best = best or max(fits, key=lambda f: (f["passes"], f["trick"] or 0, -f["weight"]))
    new, new_threshold, pool, frozen, lower = best["new"], best["threshold"], best["pool"], best["frozen"], best["lower"]
    caught, clone_weight = best["caught"], best["weight"]

    trick_new, trick_old = best["trick"], _recall(old, old_threshold, holdout)
    promoted = best["passes"]
    forced = (not promoted and force and trick_new is not None and trick_new > (trick_old or 0)
              and frozen["fpr"] <= FORCE_FPR)
    version = store.next_version()
    learned = explain.patch_note(old, new, missed or [r for r in fresh if r.is_fraud], version, trick_new)
    store.save_version(new, _meta(version, new, len(pool), frozen, trick_new, promoted or forced, forced, current, learned))
    store.append_rows(fresh + clones)
    store.append_rows(holdout, "holdout")
    return {
        "new_version": version if promoted or forced else current, "candidate_version": version,
        "promoted": promoted or forced, "forced": forced,
        "metrics": {"catch_rate": frozen["recall"], "false_positive_rate": frozen["fpr"], "held_out_catch_rate": trick_new},
        "learned": learned,
        "examples": {"total": len(new_rows), "near_duplicates": len(new_rows) - len(fresh),
                     "no_payload": sum(not r.is_fraud for r in new_rows), "missed_tricks": len(missed),
                     "clones": len(clones)},
        "guard": {"fits": len(fits), "all_caught": caught, "clone_weight": clone_weight},
        "gate": {"frozen_fpr": frozen["fpr"], "recall_change_lower_bound": lower, "trick_recall_before": trick_old},
    }


def extract_levers(row: Submission) -> Levers:
    """Spec 2.2: the settings behind a PAID trick, read back off its invoice and features."""
    f, inv, scheme = row.features, row.invoice, row.scheme_id or "bank_switcheroo"
    known = scheme in KNOWN_VENDOR_SCHEMES
    if known:
        identity = "copy" if f["domain_mismatch"] == 0 else "lookalike"
    else:
        identity = "lookalike" if f["vendor_name_similarity"] > 0.8 or f["domain_edit_distance"] <= 2 else "fresh"
    if abs(f["amount_z"]) <= 0.5 and known:  # the vendor's usual total, even if it happens to be round
        amount = "typical"
    elif f["amount_is_round"]:
        amount = "round"
    elif 0.9 <= f["amount_to_limit_ratio"] < 1:
        amount = "under_limit"
    elif f["amount_z"] > 2:
        amount = "inflated"
    else:
        amount = "typical"
    stains = sum(u.tool == "mug" for u in inv.tool_uses)
    return Levers(
        scheme_id=scheme, identity=identity, amount=amount,
        timing="right_after" if f["cadence_z"] < -2 else "on_cadence" if known else "random",
        letterhead="match" if f["letterhead_match"] else "generic",
        pad_method="fee" if any(li.description == "Handling fee" for li in inv.line_items) else "price",
        dup_change="line" if any(li.description.endswith("(rev.)") for li in inv.line_items) else "number",
        photocopies=min(2, int(f["copy_generation"])), stains=min(2, stains),
        stamp="none" if not inv.stamps else "habit" if f["stamp_matches_vendor"] else "random",
        tone="none" if not inv.cover_email else "urgent" if f["email_urgency"] > 0 else "plain",
        mention_change=bool(f["email_mentions_change"]),
        send="offhours" if f["offhours_send"] else "business", due="short" if f["due_days"] <= 7 else "normal",
    )


def _meta(version, det, n_train, frozen, trick_recall, promoted, forced, parent, learned) -> dict:
    return {"version": version, "trained_at": datetime.now().isoformat(timespec="seconds"), "n_train": n_train,
            "thresholds": level_thresholds(det, base_splits()[1]), "recall": frozen["recall"], "fpr": frozen["fpr"],
            "auroc": frozen["auroc"], "recall_by_scheme": frozen["recall_by_scheme"], "trick_recall": trick_recall,
            "promoted": promoted, "forced": forced, "parent": parent, "learned": learned}


def _weighted(r: Submission) -> Submission:
    weight = 0.0 if r.origin == "player" and not r.is_fraud else ORIGIN_WEIGHTS.get(r.origin, 1.0)
    return r.model_copy(update={"train_weight": weight})


def _scaled_clone(r: Submission, factor: float) -> Submission:
    return r.model_copy(update={"train_weight": r.train_weight * factor}) if r.origin == "player_clone" else r


def _cap_per_player(base: list[Submission], rows: list[Submission]) -> list[Submission]:
    total = sum(r.train_weight for r in base + rows if r.is_fraud)
    by_player: dict[str, float] = {}
    for r in rows:
        if r.is_fraud:
            by_player[r.session_id] = by_player.get(r.session_id, 0.0) + r.train_weight
    scale = {p: min(1.0, MAX_PLAYER_SHARE * total / w) for p, w in by_player.items() if w}
    return [r.model_copy(update={"train_weight": r.train_weight * scale.get(r.session_id, 1.0)}) for r in rows]


def _recall_change_lower_bound(old: Detector, new: Detector, test: list[Submission]) -> float:
    fraud = [r for r in test if r.is_fraud]
    before, after = old.flags(fraud).astype(float), new.flags(fraud).astype(float)
    idx = np.random.default_rng(0).integers(0, len(fraud), (BOOTSTRAP, len(fraud)))
    return float(np.percentile(after[idx].mean(1) - before[idx].mean(1), 2.5))


def _recall(det: Detector, threshold: float, rows: list[Submission]) -> float | None:
    return float(np.mean([det.score_features(r.features) >= threshold for r in rows])) if rows else None


def _key(r: Submission) -> tuple:
    return tuple(round(r.features[n], 3) for n in BASE_FEATURES)


def _seed(text: str) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16)
