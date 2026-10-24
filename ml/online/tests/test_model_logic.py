"""Model helpers that need no training: splits, thresholds, rank cutoffs, tell mapping."""
import numpy as np
import pandas as pd

from ml.online import model as M


def test_splits_are_time_ordered_70_15_15():
    df = pd.DataFrame({"TransactionDT": range(1000), "isFraud": [0] * 1000})
    a, b, c = M.splits(df)
    assert (len(a), len(b), len(c)) == (700, 150, 150)
    # contiguous and in order (no shuffling — later days must not leak into train)
    assert a["TransactionDT"].max() < b["TransactionDT"].min() < c["TransactionDT"].min()


def test_threshold_at_matches_target_fpr():
    legit = np.linspace(0, 1, 1001)  # uniform scores
    thr = M.threshold_at(legit, fpr=0.03)
    assert abs((legit >= thr).mean() - 0.03) < 0.01


def _version(threshold=0.25, cutoffs=None):
    rt = {r: max(threshold, c) for r, c in (cutoffs or M.RANK_CUTOFF).items()}
    return M.Version(version=1, model=None, vocab={}, threshold=threshold, rank_thresholds=rt)


def test_game_threshold_never_below_base_and_eases_with_rank():
    v = _version(threshold=0.25)
    cuts = [v.game_threshold(r) for r in (1, 2, 3, 4, 5)]
    assert all(c >= v.threshold for c in cuts)          # never more lenient than the real-shop line
    assert cuts == sorted(cuts, reverse=True)           # Rookie strictest cutoff, Mastermind the base
    assert v.game_threshold(5) == v.threshold           # Mastermind faces the real-shop threshold


def test_game_threshold_defaults_to_rank_1_when_missing():
    v = _version()
    assert v.game_threshold(None) == v.game_threshold(1)


def test_tell_map_covers_the_features_and_uses_known_tells():
    # every tell a feature maps to should be a short slug the game can label
    assert set(M.TELL_OF).issubset(set(__import__("ml.online.features", fromlist=["FEATURES"]).FEATURES))
    assert all(isinstance(t, str) and t for t in M.TELL_OF.values())
