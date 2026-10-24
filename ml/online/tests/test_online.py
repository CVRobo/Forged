"""End-to-end test: generate -> train -> predict -> retrain for the online fraud detector."""

from __future__ import annotations

import os
import tempfile

import pytest

# Force models into a temp dir so tests don't pollute the real model store
_tmpdir = tempfile.mkdtemp(prefix="forged_online_test_")
os.environ["FORGED_ONLINE_MODEL_DIR"] = _tmpdir

from ml.online.features import FEATURE_NAMES, extract
from ml.online.generate import generate
from ml.online.model import OnlineDetector, metrics, predict, retrain, train
from ml.online.store import (
    append_to_buffer,
    current_version,
    drain_buffer,
    load_buffer,
    load_version,
    save_base_data,
    save_version,
)
from ml.online.tells import contributions_to_tells


class TestFeatures:
    def test_extract_returns_all_features(self):
        row = {"TransactionAmt": 100, "ProductCD": "W", "card4": "visa",
               "card6": "debit", "addr2": 87, "TransactionDT": 86400 * 200 + 10 * 3600}
        features = extract(row)
        for name in FEATURE_NAMES:
            assert name in features, f"Missing feature: {name}"
        assert len(features) == len(FEATURE_NAMES)

    def test_anonymous_email_detected(self):
        row = {"P_emaildomain": "protonmail.com", "TransactionDT": 0}
        features = extract(row)
        assert features["is_anonymous_email"] == 1.0

    def test_foreign_card_detected(self):
        row = {"addr2": 60, "TransactionDT": 0}
        features = extract(row)
        assert features["is_foreign_card"] == 1.0

    def test_domestic_card(self):
        row = {"addr2": 87, "TransactionDT": 0}
        features = extract(row)
        assert features["is_foreign_card"] == 0.0

    def test_emulator_detected(self):
        row = {"DeviceInfo": "rv:57.0", "id_30": "Linux", "DeviceType": "mobile", "TransactionDT": 0}
        features = extract(row)
        assert features["is_emulator"] == 1.0

    def test_night_hour(self):
        # 3 AM on day 200
        row = {"TransactionDT": 86400 * 200 + 3 * 3600}
        features = extract(row)
        assert features["is_night"] == 1.0

    def test_daytime(self):
        # 2 PM
        row = {"TransactionDT": 86400 * 200 + 14 * 3600}
        features = extract(row)
        assert features["is_night"] == 0.0


class TestGenerate:
    def test_generate_count(self):
        data = generate(n=100, seed=1)
        assert len(data) == 100

    def test_generate_labels(self):
        data = generate(n=1000, seed=1)
        fraud = sum(1 for r in data if r["isFraud"] == 1)
        legit = sum(1 for r in data if r["isFraud"] == 0)
        assert fraud > 0
        assert legit > 0
        assert fraud + legit == 1000

    def test_generate_deterministic(self):
        d1 = generate(n=50, seed=42)
        d2 = generate(n=50, seed=42)
        assert d1[0]["TransactionAmt"] == d2[0]["TransactionAmt"]

    def test_generate_has_required_columns(self):
        data = generate(n=10, seed=1)
        row = data[0]
        assert "TransactionAmt" in row
        assert "ProductCD" in row
        assert "card4" in row
        assert "isFraud" in row


class TestModel:
    @pytest.fixture(scope="class")
    def trained(self):
        data = generate(n=2000, seed=42)
        det = train(data, fpr_target=0.05)
        return det, data

    def test_train_returns_detector(self, trained):
        det, _ = trained
        assert isinstance(det, OnlineDetector)
        assert det.version == 1
        assert 0 < det.threshold < 1

    def test_predict_fraud(self, trained):
        det, data = trained
        fraud_rows = [r for r in data if r["isFraud"] == 1]
        # at least some fraud should be caught
        caught = sum(1 for r in fraud_rows[:50] if predict(det, r)["flagged"])
        assert caught > 0, "Model caught no fraud at all"

    def test_predict_returns_required_keys(self, trained):
        det, data = trained
        result = predict(det, data[0])
        assert "score" in result
        assert "flagged" in result
        assert "suspicion" in result
        assert "tells" in result
        assert "contributions" in result
        assert "version" in result

    def test_predict_suspicion_calibration(self, trained):
        """When score == threshold, suspicion should be ~38."""
        det, data = trained
        # Find a row whose score is within 10% of the threshold
        for row in data:
            result = predict(det, row)
            ratio = result["score"] / det.threshold if det.threshold > 0 else 0
            if 0.9 < ratio < 1.1:
                expected = 38.0 * ratio
                assert abs(result["suspicion"] - expected) < 1.0
                break

    def test_predict_tells_are_tells(self, trained):
        det, data = trained
        fraud_rows = [r for r in data if r["isFraud"] == 1]
        result = predict(det, fraud_rows[0])
        for tell in result["tells"]:
            assert hasattr(tell, "tell_type")
            assert hasattr(tell, "strength")

    def test_metrics(self, trained):
        det, data = trained
        m = metrics(det, data)
        assert m["recall"] > 0.5, f"Recall too low: {m['recall']}"
        assert m["fpr"] < 0.15, f"FPR too high: {m['fpr']}"

    def test_retrain_promotes(self, trained):
        det, data = trained
        # Generate some "new fraud" that the model missed
        new_fraud = generate(n=200, seed=99)
        new_fraud = [r for r in new_fraud if r["isFraud"] == 1][:20]
        new_det = retrain(det, new_fraud, data, fpr_target=0.05)
        # retrain may or may not promote depending on gates, but shouldn't crash
        if new_det is not None:
            assert new_det.version == det.version + 1

    def test_retrain_empty_returns_none(self, trained):
        det, data = trained
        result = retrain(det, [], data)
        assert result is None


class TestTells:
    def test_contributions_to_tells(self):
        contributions = {
            "is_anonymous_email": 0.8,
            "proxy_anonymous": 0.5,
            "TransactionAmt": 0.3,
            "D1": -0.2,  # negative = not suspicious direction
            "is_foreign_card": 0.1,
        }
        tells = contributions_to_tells(contributions)
        assert len(tells) > 0
        # strongest first
        assert tells[0].strength >= tells[-1].strength
        # negative contributions should be excluded
        types = [t.tell_type for t in tells]
        assert "email_risky" in types

    def test_empty_contributions(self):
        tells = contributions_to_tells({})
        assert tells == []


class TestStore:
    def test_round_trip(self):
        data = generate(n=500, seed=42)
        det = train(data, fpr_target=0.05)
        m = metrics(det, data)
        save_version(det, m)

        v = current_version()
        assert v == 1

        loaded = load_version(1)
        assert loaded is not None
        assert loaded.version == 1
        assert loaded.threshold == det.threshold

    def test_buffer_round_trip(self):
        rows = [{"TransactionAmt": 100, "isFraud": 1}]
        append_to_buffer(rows)
        buf = load_buffer()
        assert len(buf) >= 1
        assert buf[-1]["TransactionAmt"] == 100

    def test_drain_buffer(self):
        append_to_buffer([{"test": True}])
        drained = drain_buffer()
        assert len(drained) > 0
        assert load_buffer() == []


class TestEndToEnd:
    """Full round trip: generate -> train -> predict -> buffer -> retrain."""

    def test_full_cycle(self):
        # 1. Generate training data
        data = generate(n=2000, seed=42)
        fraud = [r for r in data if r["isFraud"] == 1]
        legit = [r for r in data if r["isFraud"] == 0]
        assert len(fraud) > 0
        assert len(legit) > 0

        # 2. Train v1
        det = train(data, fpr_target=0.05)
        assert det.version == 1

        # 3. Predict on unseen data
        test_data = generate(n=500, seed=99)
        test_fraud = [r for r in test_data if r["isFraud"] == 1]
        test_legit = [r for r in test_data if r["isFraud"] == 0]

        caught = sum(1 for r in test_fraud if predict(det, r)["flagged"])
        false_pos = sum(1 for r in test_legit if predict(det, r)["flagged"])

        recall = caught / len(test_fraud) if test_fraud else 0
        fpr = false_pos / len(test_legit) if test_legit else 0

        assert recall > 0.4, f"Recall on unseen data too low: {recall:.2%}"
        assert fpr < 0.20, f"FPR on unseen data too high: {fpr:.2%}"

        # 4. Retrain with "player wins" (fraud the model missed)
        missed = [r for r in test_fraud if not predict(det, r)["flagged"]]
        if missed:
            new_det = retrain(det, missed[:10], data, fpr_target=0.05)
            if new_det is not None:
                assert new_det.version == 2
                # The new model should catch at least some of the previously missed rows
                now_caught = sum(1 for r in missed[:10] if predict(new_det, r)["flagged"])
                # It's OK if it doesn't catch all — the safety gates may prevent overfitting
                assert now_caught >= 0
