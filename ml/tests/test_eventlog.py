"""One reproducible row per attempt (docs/realistic-data-plan.md section 1)."""
import json

import pytest

from ml import detector, eventlog, store
from ml.tests.test_adapter import record


@pytest.fixture(autouse=True)
def model_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("FORGED_MODEL_DIR", str(tmp_path))
    store.clear_cache()
    yield tmp_path
    store.clear_cache()


def taped(**overrides):
    return record(bank_account="••••7781", field_altered=["bank"], cover_email="Please pay the new account.", **overrides)


def test_a_logged_attempt_carries_what_reproduces_the_verdict():
    rec = taped()
    row = eventlog.log_attempt(rec, detector.predict(rec), verdict="PAID", session_id="s1", round_id="r1", consent=True)
    assert (row.model_version, row.flagged, row.verdict) == (1, False, "PAID")
    assert 0 <= row.score <= 1 and row.threshold > 0 and set(row.features) >= {"bank_changed", "self_sim"}
    assert row.payload_schemes == ["bank_switcheroo"] and row.is_fraud and row.declared_scheme == "bank_switcheroo"


def test_attempts_append_to_a_jsonl_file_that_reads_back(model_dir):
    for i in range(3):
        rec = taped(invoice_no=f"PP-{i}")
        eventlog.log_attempt(rec, detector.predict(rec), verdict="PAID", session_id="s1", round_id=f"r{i}", consent=True)
    lines = (model_dir / "attempts.jsonl").read_text().splitlines()
    assert len(lines) == 3 and json.loads(lines[0])["round_id"] == "r0"
    assert [a.round_id for a in eventlog.read_attempts()] == ["r0", "r1", "r2"]


def test_without_consent_the_numbers_stay_but_the_player_text_is_blanked():
    rec = taped()
    row = eventlog.log_attempt(rec, detector.predict(rec), verdict="PAID", session_id="s2", round_id="r1", consent=False)
    assert row.consent is False and row.score is not None
    assert row.record["cover_email"] == "" and row.record["vendor"] == ""


def test_rejected_attempts_are_logged_without_a_prediction():
    row = eventlog.log_attempt(taped(), None, verdict="REJECTED", session_id="s3", round_id="r1", consent=True)
    assert row.verdict == "REJECTED" and row.score is None and row.model_version is None


def test_rows_also_go_to_a_stream_when_one_is_given():
    sent = []

    class Stream:
        def xadd(self, key, fields):
            sent.append((key, fields))

    eventlog.log_attempt(taped(), None, verdict="REJECTED", session_id="s4", round_id="r1", consent=True, stream=Stream())
    assert sent and sent[0][0] == eventlog.STREAM_KEY and json.loads(sent[0][1]["row"])["session_id"] == "s4"


def test_a_failing_stream_never_blocks_the_attempt(model_dir):
    class Broken:
        def xadd(self, key, fields):
            raise ConnectionError("redis down")

    eventlog.log_attempt(taped(), None, verdict="REJECTED", session_id="s5", round_id="r1", consent=True, stream=Broken())
    assert (model_dir / "attempts.jsonl").exists()
