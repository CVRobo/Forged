"""The "Gus is learning" panel reads gus-versions.json, a copy of the model's version registry
(README.md, "Gus is learning"). These keep the copy from going stale or losing what the panel reads.

    python3 -m pytest prototype/tests/test_learning.py -q
"""
import json
import os

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
COPY = os.path.join(HERE, "..", "gus-versions.json")
REGISTRY = os.path.join(HERE, "..", "..", "ml", "online", "models", "versions.json")


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def test_the_copy_matches_the_model_registry():
    if not os.path.exists(REGISTRY):
        pytest.skip("no ml/ here: the hosted image only has prototype/")
    assert _load(COPY) == _load(REGISTRY), (
        "a retrain changed ml/online/models/versions.json: "
        "cp ml/online/models/versions.json prototype/gus-versions.json")


def test_every_version_has_what_the_panel_reads():
    versions = _load(COPY)
    assert versions and any(v["promoted"] for v in versions)
    for v in versions:
        assert isinstance(v["version"], int)
        assert {"recall", "fpr"} <= v["test"].keys()
        assert "player" in v["trained_on"]
        if v.get("parent") is not None:  # a retrain: the gate's before-and-after on the same held-out orders
            assert {"player_catch"} <= v["test"].keys() and {"player_catch", "recall", "fpr"} <= v["parent_test"].keys()
            assert v["checks"].keys() == {"real_recall", "real_fpr", "game_fpr", "player_catch"}
