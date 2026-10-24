"""Whether a machine can retrain (train.can_retrain), and what a version watches (Version.attention)."""
import pytest

from ml.online import model as M
from ml.online import train as T


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(T.F, "DATA_DIR", tmp_path)
    monkeypatch.setattr(T.shutil, "which", lambda name: "/usr/bin/node")
    return tmp_path


def test_no_data_names_the_train_files(data_dir):
    ok, why = T.can_retrain()
    assert not ok and "train_transaction.csv" in why


def test_the_unlabeled_test_split_is_called_out(data_dir):
    for name in ("test_transaction.csv", "test_identity.csv"):
        (data_dir / name).write_text("TransactionID\n")
    ok, why = T.can_retrain()
    assert not ok
    assert "test" in why and "isFraud" in why and "train_transaction.csv" in why


def test_the_train_files_are_enough(data_dir):
    for name in ("train_transaction.csv", "train_identity.csv"):
        (data_dir / name).write_text("TransactionID\n")
    assert T.can_retrain() == (True, "")


def test_the_cached_real_data_is_enough(data_dir):
    (data_dir / "real_identity.pkl").write_bytes(b"")
    assert T.can_retrain() == (True, "")


def test_without_node_the_simulated_shoppers_must_be_cached(data_dir, monkeypatch):
    (data_dir / "real_identity.pkl").write_bytes(b"")
    monkeypatch.setattr(T.shutil, "which", lambda name: None)
    ok, why = T.can_retrain()
    assert not ok and "Node" in why
    for kind, (n, seed) in T.SIM.items():
        (data_dir / f"simulated_{kind}_{n}_{seed}.jsonl").write_text("")
    assert T.can_retrain() == (True, "")


def test_attention_is_each_tell_familys_share_of_the_model():
    share = M.load().attention()
    assert share.sum() == pytest.approx(1.0)
    assert set(share.index) <= M.TELLS
    assert list(share) == sorted(share, reverse=True)
