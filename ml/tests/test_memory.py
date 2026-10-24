"""In-session memory (spec 2.3): the vector index, the three kNN features, replay and memory-off scoring."""
import json
from datetime import datetime, timedelta

import numpy as np
import pytest

from ml import memory
from ml.baseline import evaluate, fit_detector
from ml.generate import build_dataset
from ml.schema import BASE_FEATURES, FEATURES, MEMORY_FEATURES

T0 = datetime(2026, 1, 1)


def unit(*values):
    v = np.zeros(len(BASE_FEATURES))
    v[:len(values)] = values
    return v / np.linalg.norm(v)


def index_of(entries):
    """entries: (id, vector, is_fraud, session_id, minutes after T0)."""
    index = memory.NumpyIndex()
    for i, vector, fraud, session, minutes in entries:
        index.add([i], vector[None, :], [fraud], [session], ["scripted_attacker"], [T0 + timedelta(minutes=minutes)])
    return index


@pytest.fixture(scope="module")
def rows():
    return build_dataset(seed=5, n_runs=6)


def test_search_returns_the_nearest_rows_first():
    index = index_of([("a", unit(1, 0), False, "s", 0), ("b", unit(1, 1), True, "s", 1), ("c", unit(0, 1), False, "s", 2)])
    hits = index.search(unit(1, 0.1), k=2)
    assert [h.is_fraud for h in hits] == [False, True] and hits[0].sim > hits[1].sim


def test_search_sees_only_rows_created_before():
    index = index_of([("a", unit(1, 0), False, "s", 0), ("b", unit(1, 0), True, "s", 10)])
    assert [h.is_fraud for h in index.search(unit(1, 0), before=T0 + timedelta(minutes=5))] == [False]
    assert index.search(unit(1, 0), before=T0) == []


def test_search_can_keep_to_one_session():
    index = index_of([("a", unit(1, 0), True, "mine", 0), ("b", unit(1, 0.01), False, "other", 1)])
    assert [h.is_fraud for h in index.search(unit(1, 0), session_id="mine")] == [True]
    assert index.search(unit(1, 0), session_id="nobody") == []


def test_adding_an_id_twice_keeps_one_row():
    index = index_of([("a", unit(1, 0), False, "s", 0), ("a", unit(0, 1), True, "s", 1)])
    assert len(index) == 1 and "a" in index and "b" not in index


def test_similarity_is_cosine_floored_at_zero():
    index = index_of([("a", unit(-1, 0), False, "s", 0)])
    assert index.search(unit(1, 0))[0].sim == 0.0
    assert index.search(unit(-1, 0))[0].sim == pytest.approx(1.0)


def test_memory_features_come_from_the_ten_nearest_earlier_rows():
    near = [(f"n{i}", unit(1, 0.01 * i), i < 3, "other", i) for i in range(10)]  # 3 of the 10 nearest are fraud
    far = [(f"f{i}", unit(0, 1), True, "other", 20 + i) for i in range(5)]
    own = [("own", unit(1, 1), False, "mine", 30)]
    index = index_of(near + far + own)
    f = memory.features_from(unit(1, 0), "mine", [(index, T0 + timedelta(hours=1))])
    assert f["knn_fraud_share"] == pytest.approx(0.3)
    assert f["knn_max_sim"] == pytest.approx(1.0)
    assert f["self_sim"] == pytest.approx(float(unit(1, 0) @ unit(1, 1)))


def test_no_earlier_rows_means_zero_memory():
    assert memory.features_from(unit(1, 0), "mine", [(memory.NumpyIndex(), None)]) == dict.fromkeys(MEMORY_FEATURES, 0.0)


def test_replay_fills_the_memory_features_and_keeps_the_base_ones(rows):
    replayed = memory.replay(rows)
    assert all(tuple(r.features) == FEATURES for r in replayed)
    assert all(r.features[n] == o.features[n] for r, o in zip(replayed, rows) for n in BASE_FEATURES)
    first = min(replayed, key=lambda r: r.created_at)
    assert all(first.features[n] == 0 for n in MEMORY_FEATURES)


def test_replay_uses_only_earlier_rows(rows):  # spec 2.3: no peeking at later submissions
    ordered = sorted(rows, key=lambda r: r.created_at)
    full, prefix = memory.replay(ordered), memory.replay(ordered[:40])
    assert [r.features for r in full[:40]] == [r.features for r in prefix]


def test_replay_counts_a_prior_index_as_earlier(rows):
    prior = memory.NumpyIndex()
    memory.add_rows(prior, rows, created_at=memory.EARLIEST)
    first = min(memory.replay(rows[:5], prior=prior), key=lambda r: r.created_at)
    assert first.features["knn_max_sim"] == pytest.approx(1.0)  # its own copy sits in the prior index
    assert first.features["self_sim"] == pytest.approx(1.0)


def test_vectors_hold_base_features_only(rows):
    f = memory.replay(rows)[10].features
    louder = {**f, **dict.fromkeys(MEMORY_FEATURES, 0.99)}
    v = memory.scale().vectors([f, louder])
    assert v.shape == (2, len(BASE_FEATURES)) and np.allclose(v[0], v[1])


def test_the_scale_is_fixed_and_saved_for_the_base_features():
    saved = json.loads(memory.SCALE_PATH.read_text())
    assert tuple(saved["features"]) == BASE_FEATURES
    assert all(s > 0 for s in saved["std"]) and 0 < saved["heat_floor"] < 1


def test_dropout_pairs_each_row_with_a_memory_off_copy(rows):
    replayed = memory.replay(rows)
    pool = memory.dropout(replayed)
    means = {n: np.mean([r.features[n] for r in replayed]) for n in MEMORY_FEATURES}
    assert len(pool) == 2 * len(replayed)
    assert sum(r.train_weight for r in pool) == pytest.approx(sum(r.train_weight for r in replayed))
    assert all(r.features[n] == pytest.approx(means[n]) for r in pool[len(replayed):] for n in MEMORY_FEATURES)


def test_memory_off_scores_with_the_training_mean(rows):  # spec 5.3
    replayed = memory.replay(rows)
    det = fit_detector(replayed, replayed, FEATURES)
    means = det.memory_means()
    f = replayed[20].features
    assert set(means) == set(MEMORY_FEATURES)
    assert det.score_features(f, memory=False) == pytest.approx(det.score_features({**f, **means}))
    assert det.score_features(f, memory=False) == det.score_features({**f, **dict.fromkeys(MEMORY_FEATURES, 1.0)}, memory=False)
    assert all(det.contributions(f, memory=False)[n] == 0 for n in MEMORY_FEATURES)


def test_memory_off_has_its_own_threshold_at_the_target_fpr(rows):
    replayed = memory.replay(rows)
    det = fit_detector(replayed, replayed, FEATURES, fpr_target=0.05)
    assert det.threshold_off is not None
    assert evaluate(det, replayed, memory=False)["fpr"] <= 0.05 and evaluate(det, replayed)["fpr"] <= 0.05


def test_heat_is_derived_from_self_sim():
    floor = memory.scale().heat_floor
    assert memory.heat(0.0) == memory.heat(floor) == 0
    assert memory.heat(1.0) == 100
    assert memory.heat(floor + 0.1) < memory.heat(floor + 0.2)
