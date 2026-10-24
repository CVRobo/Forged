import numpy as np
import pytest

from ml.baseline import evaluate, fit_detector, threshold_at_fpr
from ml.checks import run_checks
from ml.generate import build_dataset
from ml.schema import LEVELS


@pytest.fixture(scope="module")
def splits():
    return build_dataset(seed=21, n_runs=40), build_dataset(seed=22, n_runs=40), build_dataset(seed=23, n_runs=40)


def test_threshold_flags_at_most_the_target_share_of_legit():
    legit = np.linspace(0, 1, 100)
    t = threshold_at_fpr(legit, 0.05)
    assert (legit >= t).mean() <= 0.05
    assert (legit >= np.nextafter(t, -np.inf) - 1e-9).mean() > 0.05  # any lower would flag too many


def test_threshold_never_splits_tied_scores():
    legit = np.array([0.9] * 10 + [0.1] * 90)  # a binary feature: 10% of legit share the top score
    assert (legit >= threshold_at_fpr(legit, 0.05)).mean() == 0


def test_the_detector_keeps_validation_fpr_at_the_target(splits):
    train, val, _ = splits
    det = fit_detector(train, val, fpr_target=0.05)
    assert evaluate(det, val)["fpr"] <= 0.05


def test_scores_are_probabilities_in_margin_order(splits):
    train, val, test = splits
    det = fit_detector(train, val)
    scores, margins = det.scores(test), det.margins(test)
    assert ((scores >= 0) & (scores <= 1)).all()
    assert (np.diff(scores[np.argsort(margins)]) >= -1e-12).all()


def test_fitting_is_deterministic(splits):
    train, val, _ = splits
    assert fit_detector(train, val).threshold == fit_detector(train, val).threshold


def test_reasons_are_the_largest_contributions_first(splits):
    train, val, test = splits
    det = fit_detector(train, val)
    reasons = det.reasons(test[0].features, k=3)
    assert len(reasons) == 3 and all(name in det.features for name, _ in reasons)
    assert [c for _, c in reasons] == sorted((c for _, c in reasons), reverse=True)


def test_evaluate_reports_recall_per_scheme(splits):
    train, val, test = splits
    report = evaluate(fit_detector(train, val), test)
    assert set(report["recall_by_scheme"]) == {r.scheme_id for r in test if r.is_fraud}
    assert 0 <= report["recall"] <= 1 and 0.5 < report["auroc"] <= 1


def test_the_gate_runs_every_spec_check(splits):
    report = run_checks(*splits)
    names = [c.name for c in report.checks]
    assert sum(n.startswith("2.1") for n in names) == 6
    assert sum(n.startswith("3.1") for n in names) == 6
    assert any(n.startswith("3.2") for n in names) and any(n.startswith("4.5") for n in names)
    assert any(n.startswith("v1 recall") for n in names)
    assert 0 <= report.v1_memory["recall"] <= 1 and set(report.levels) == set(LEVELS)  # memory on is reported too
