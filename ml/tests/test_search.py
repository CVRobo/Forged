"""The search attacker (spec 4.6): hill climbing over the lever space against the live detector."""
import random

import numpy as np
import pytest

from ml import search, store, training
from ml.attackers import Levers, sample_levers
from ml.payloads import SCHEMES

SMALL = 40  # queries per scheme: enough to exercise the climb, small enough to keep tests fast


@pytest.fixture(autouse=True)
def model_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FORGED_MODEL_DIR", str(tmp_path))
    store.clear_cache()
    yield tmp_path
    store.clear_cache()
    training.forget_memory()


@pytest.mark.parametrize("scheme", SCHEMES)
def test_a_mutation_changes_one_lever_that_matters_for_the_scheme(scheme):
    rng = random.Random(0)
    for _ in range(30):
        start = search.canonical(sample_levers(rng, scheme))
        moved = search.mutate(start, rng)
        changed = [name for name in Levers.model_fields if getattr(moved, name) != getattr(start, name)]
        assert len(changed) == 1 and changed[0] in search.relevant_levers(start)
        assert search.canonical(moved) != start
        assert getattr(moved, changed[0]) in search.options(scheme)[changed[0]]


def test_levers_a_scheme_ignores_stay_at_their_defaults():
    levers = search.canonical(Levers(scheme_id="boss_request", identity="lookalike", amount="round", timing="right_after",
                                     dup_change="date", pad_method="fee", tone="none", mention_change=True))
    assert (levers.timing, levers.dup_change, levers.pad_method, levers.mention_change) == ("random", "number", "price", False)


def test_the_search_stays_within_its_query_budget():
    found = search.attack("bank_switcheroo", budget=SMALL, seed=1)
    assert 0 < found.queries <= SMALL
    assert found.levers.scheme_id == "bank_switcheroo" and 0 <= found.evasion <= 1


def test_the_search_is_deterministic_given_a_seed():
    a, b = (search.attack("phantom_supplier", budget=SMALL, seed=3) for _ in range(2))
    assert (a.levers, a.evasion, a.queries) == (b.levers, b.evasion, b.queries)


def test_the_search_keeps_every_setting_that_got_paid():
    found = search.attack("padded_invoice", budget=SMALL, seed=2)
    assert all(evasion > 0 for _, evasion in found.kept)
    assert [e for _, e in found.kept] == sorted((e for _, e in found.kept), reverse=True)
    assert not found.kept or found.kept[0] == (found.levers, found.evasion)


def test_robustness_is_recall_on_fresh_variants_with_another_seed():
    levers = Levers(scheme_id="bank_switcheroo", identity="copy", amount="typical", timing="on_cadence")
    recall = search.robustness(levers, n=40, seed=5)
    assert 0 <= recall <= 1 and recall == search.robustness(levers, n=40, seed=5)
    assert search.variant_seed(5, "fresh") != search.variant_seed(5, "search")


def test_the_audit_reports_the_worst_case_per_scheme():  # spec 4.6: the robustness number
    rows = search.audit(budget=SMALL, seed=0)
    assert [r["scheme"] for r in rows] == list(SCHEMES)
    assert all(0 <= r["robust_recall"] <= 1 and r["queries"] <= SMALL and isinstance(r["levers"], dict) for r in rows)
    # The best attack found is harder to catch than the scripted attackers' average, at the same threshold.
    det, threshold = store.load_detector(1), store.threshold(1, "sunny_diner")
    test = training.base_splits()[2]
    scripted = [np.mean([training.score(det, r.features, "sunny_diner") >= threshold for r in test if r.scheme_id == s])
                for s in SCHEMES]
    assert np.mean([r["robust_recall"] for r in rows]) < np.mean(scripted)


def test_hardening_retrains_on_search_rows_at_their_origin_weight():  # spec 4.6: between player sessions
    result = search.harden(budget=SMALL, seed=0)
    rows = [r for r in store.load_rows() if r.origin == "search_attacker"]
    assert rows and all(r.is_fraud and r.train_weight == training.ORIGIN_WEIGHTS["search_attacker"] for r in rows)
    assert result["candidate_version"] == 2 and result["examples"]["clones"] == 0  # search rows are never cloned
    assert set(result["search"]) == set(SCHEMES)
