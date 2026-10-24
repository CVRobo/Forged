import pytest
from pydantic import ValidationError

from ml.schema import BASE_FEATURES, FEATURES, LEVELS, MEMORY_FEATURES, Submission
from ml.tests.factories import invoice, submission


def test_invoice_amount_is_the_sum_of_line_items():
    assert invoice().amount == 1200


@pytest.mark.parametrize("origin", ["player_clone", "search_attacker"])
def test_origin_accepts_the_section_8_additions(origin):
    assert submission(origin=origin).origin == origin


def test_origin_rejects_unknown_values():
    with pytest.raises(ValidationError):
        submission(origin="intern")


def test_submission_adds_trick_id_and_train_weight():
    clone = submission(origin="player_clone", trick_id="sub0", train_weight=3.0)
    assert (clone.trick_id, clone.train_weight) == ("sub0", 3.0)
    assert (submission().trick_id, submission().train_weight) == (None, 1.0)


def test_submission_survives_a_json_round_trip():
    sub = submission()
    assert Submission.model_validate_json(sub.model_dump_json()) == sub


def test_memory_features_are_the_three_knn_features():
    assert MEMORY_FEATURES == ("knn_fraud_share", "knn_max_sim", "self_sim")


def test_feature_lists_have_no_overlap_or_duplicates():
    assert not set(BASE_FEATURES) & set(MEMORY_FEATURES)
    assert FEATURES == BASE_FEATURES + MEMORY_FEATURES
    assert len(set(FEATURES)) == len(FEATURES)


def test_levels_use_the_spec_5_3_settings():
    settings = {lid: (lvl.fpr_target, lvl.memory_enabled) for lid, lvl in LEVELS.items()}
    assert settings == {
        "sunny_diner": (0.03, False),
        "st_mercy": (0.05, False),
        "port_nocturne": (0.05, True),
        "neon_arcade": (0.08, True),
    }
