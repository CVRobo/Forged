"""Simulated runs: labels from payloads, legit base rates for every tell, history-aware features."""
import statistics

import pytest

from ml.attackers import Levers
from ml.generate import build_dataset, clone_attacks
from ml.payloads import SCHEMES
from ml.schema import BASE_FEATURES

HISTORY_FEATURES = ("window_count", "window_sum", "vendor_age_rounds", "amount_jump_ratio", "cadence_z", "dup_similarity")

# Spec 2.1: every tell also shows up on legit invoices, above the 5% FPR target.
LEGIT_TELLS = {
    "bank changed": lambda f: f["bank_changed"] == 1,
    "vendor unknown": lambda f: f["vendor_unknown"] == 1,
    "unknown vendor and no open order": lambda f: f["vendor_unknown"] == 1 and f["no_open_order"] == 1,
    "over the PO by 15%": lambda f: f["order_amount_ratio"] > 1.15,
    "no open order": lambda f: f["no_open_order"] == 1,
    "domain mismatch": lambda f: f["domain_mismatch"] == 1,
    "letterhead mismatch": lambda f: f["letterhead_match"] == 0,
    "looks like a paid invoice": lambda f: f["dup_similarity"] >= 0.9,
    "urgent email": lambda f: f["email_urgency"] > 0,
    "sent after hours": lambda f: f["offhours_send"] == 1,
    "due within a week": lambda f: f["due_days"] <= 7,
    "off cadence": lambda f: f["cadence_z"] <= -2,
    "round amount": lambda f: f["amount_is_round"] == 1,
    "hand-altered field": lambda f: f["field_altered_count"] > 0,
    "photocopied": lambda f: f["copy_generation"] > 0,
    "stained": lambda f: f["max_illegibility"] > 0,
    "stamped": lambda f: f["stamp_count"] > 0,
}


@pytest.fixture(scope="module")
def rows():
    return build_dataset(seed=11, n_runs=80)


def legit(rows):
    return [r for r in rows if not r.is_fraud]


def fraud(rows):
    return [r for r in rows if r.is_fraud]


def test_the_same_seed_gives_the_same_rows():
    a, b = build_dataset(seed=3, n_runs=4), build_dataset(seed=3, n_runs=4)
    assert [(r.features, r.is_fraud) for r in a] == [(r.features, r.is_fraud) for r in b]


def test_different_seeds_give_different_rows():
    a, b = build_dataset(seed=3, n_runs=4), build_dataset(seed=4, n_runs=4)
    assert [r.features for r in a] != [r.features for r in b]


def test_every_row_carries_the_base_features(rows):
    assert all(tuple(r.features) == BASE_FEATURES for r in rows)


def test_generator_rows_are_legit_and_attacker_rows_are_fraud(rows):
    assert all(not r.is_fraud and r.scheme_id is None for r in rows if r.origin == "legit_gen")
    assert all(r.is_fraud and r.scheme_id in SCHEMES for r in rows if r.origin == "scripted_attacker")


def test_every_scheme_is_attacked(rows):
    assert {r.scheme_id for r in fraud(rows)} == set(SCHEMES)


def test_v1_sized_data_from_80_runs(rows):
    assert len(legit(rows)) > 1000
    # A two-act attack only lands when its change request got through, after the change has aged.
    assert all(sum(r.scheme_id == s for r in rows) >= (20 if s == "bank_change_fraud" else 30) for s in SCHEMES)


def test_rounds_count_up_from_1_in_every_session(rows):
    sessions = {}
    for r in rows:
        sessions.setdefault(r.session_id, []).append(r.round_no)
    assert all(rounds == list(range(1, len(rounds) + 1)) for rounds in sessions.values())


def test_created_at_follows_round_order_within_a_session(rows):
    by_session = {}
    for r in rows:
        by_session.setdefault(r.session_id, []).append(r.created_at)
    assert all(times == sorted(times) for times in by_session.values())


@pytest.mark.parametrize("name", HISTORY_FEATURES)
def test_history_features_vary_in_both_classes(rows, name):  # spec 3.1
    assert statistics.pstdev(r.features[name] for r in legit(rows)) > 0
    assert statistics.pstdev(r.features[name] for r in fraud(rows)) > 0


@pytest.mark.parametrize("tell", LEGIT_TELLS)
def test_every_tell_has_a_legit_base_rate_above_the_fpr_target(rows, tell):
    rate = statistics.mean(LEGIT_TELLS[tell](r.features) for r in legit(rows))
    assert rate > 0.06, f"{tell}: {rate:.1%}"


def test_legit_bank_changes_look_clean_on_the_other_levers(rows):  # spec 2.1
    # Platform switches (new bank, billing-service domain and letterhead together) are the one exception.
    changed = [r.features for r in legit(rows) if r.features["bank_changed"] == 1 and r.features["vendor_unknown"] == 0
               and r.features["domain_mismatch"] == 0]
    clean = [f for f in changed if f["letterhead_match"] == 1 and f["email_urgency"] == 0 and f["offhours_send"] == 0]
    assert len(changed) > 50 and len(clean) / len(changed) > 0.85


def test_scripted_attackers_often_repeat_their_last_paid_trick(rows):  # as players do; memory needs it (2.3)
    last_paid, following, same = {}, 0, 0
    for r in rows:
        if r.origin != "scripted_attacker":
            continue
        if r.session_id in last_paid:
            following += 1
            same += r.scheme_id == last_paid[r.session_id]
        if r.verdict == "PAID":
            last_paid[r.session_id] = r.scheme_id
    assert following > 100 and same / following > 0.45  # 1 in 5 by chance


def test_both_classes_have_the_same_empty_email_rate(rows):  # spec 3.2
    def empty(group):
        return statistics.mean(r.invoice.cover_email == "" for r in group)
    assert abs(empty(legit(rows)) - empty(fraud(rows))) < 0.08


def test_clones_keep_the_fixed_levers_on_new_vendors_and_amounts():
    trick = Levers(scheme_id="bank_switcheroo", identity="copy", amount="round", timing="right_after",
                   photocopies=1, stamp="none", tone="none", send="offhours")
    clones = clone_attacks(trick, n=30, seed=5)
    f = [c.features for c in clones]
    assert len(clones) == 30 and all(c.origin == "player_clone" and c.is_fraud for c in clones)
    assert all(x["amount_is_round"] == 1 and x["field_altered_count"] >= 1 and x["domain_mismatch"] == 0 for x in f)
    assert all(x["copy_generation"] == 1 and x["offhours_send"] == 1 and x["email_length"] == 0 for x in f)
    assert len({c.invoice.vendor_id for c in clones}) > 1
    assert len({c.invoice.amount for c in clones}) > 5
