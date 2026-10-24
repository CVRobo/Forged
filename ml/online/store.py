"""File-based model versioning for the online fraud detector.

Layout under model_dir():
    v{n}.joblib       OnlineDetector for version n
    versions.json     [{version, trained_at, n_train, n_fraud, recall, fpr, threshold}, ...]
    buffer.jsonl      Player wins waiting for retrain
    base_data.joblib  The bootstrap training data (cached)

Kaggle models are stored separately under kaggle_model_dir():
    v{n}.joblib       KaggleDetector for version n
    versions.json     [{version, trained_at, auc, recall, fpr, threshold}, ...]
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import joblib

from ml.online.model import OnlineDetector


def model_dir() -> Path:
    return Path(os.environ.get("FORGED_ONLINE_MODEL_DIR",
                               Path(__file__).resolve().parent / "models"))


def registry() -> list[dict]:
    path = model_dir() / "versions.json"
    return json.loads(path.read_text()) if path.exists() else []


def current_version() -> int | None:
    """The newest version number, or None if no model exists."""
    versions = registry()
    return max((v["version"] for v in versions), default=None)


def save_version(detector: OnlineDetector, metrics: dict) -> None:
    """Persist a detector and its metrics to disk."""
    folder = model_dir()
    folder.mkdir(parents=True, exist_ok=True)

    joblib.dump(detector, folder / f"v{detector.version}.joblib")

    meta = {
        "version": detector.version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "threshold": detector.threshold,
        **metrics,
    }
    rows = [v for v in registry() if v["version"] != detector.version] + [meta]
    (folder / "versions.json").write_text(
        json.dumps(sorted(rows, key=lambda v: v["version"]), indent=1)
    )
    # clear load cache so next load picks up the new version
    _load.cache_clear()


def load_version(version: int | None = None) -> OnlineDetector | None:
    """Load a specific version, or the latest. Returns None if nothing saved."""
    v = version or current_version()
    if v is None:
        return None
    return _load(str(model_dir()), v)


@lru_cache(maxsize=16)
def _load(folder: str, version: int) -> OnlineDetector:
    return joblib.load(Path(folder) / f"v{version}.joblib")


def save_base_data(data: list[dict]) -> None:
    """Cache the bootstrap training data."""
    folder = model_dir()
    folder.mkdir(parents=True, exist_ok=True)
    joblib.dump(data, folder / "base_data.joblib")


def load_base_data() -> list[dict] | None:
    path = model_dir() / "base_data.joblib"
    return joblib.load(path) if path.exists() else None


def append_to_buffer(row_dicts: list[dict]) -> None:
    """Append winning orders to buffer.jsonl for future retrain."""
    if not row_dicts:
        return
    folder = model_dir()
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / "buffer.jsonl").open("a") as f:
        for row in row_dicts:
            f.write(json.dumps(row) + "\n")


def load_buffer() -> list[dict]:
    path = model_dir() / "buffer.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def drain_buffer() -> list[dict]:
    """Read and clear the buffer."""
    rows = load_buffer()
    path = model_dir() / "buffer.jsonl"
    if path.exists():
        path.unlink()
    return rows


def clear_cache() -> None:
    _load.cache_clear()
    _load_kaggle.cache_clear()


# ---------------------------------------------------------------------------
# Kaggle model storage (separate directory from game models)
# ---------------------------------------------------------------------------

def kaggle_model_dir() -> Path:
    return Path(os.environ.get("FORGED_KAGGLE_MODEL_DIR",
                               Path(__file__).resolve().parent / "kaggle_models"))


def kaggle_registry() -> list[dict]:
    path = kaggle_model_dir() / "versions.json"
    return json.loads(path.read_text()) if path.exists() else []


def current_kaggle_version() -> int | None:
    """The newest Kaggle model version number, or None if no model exists."""
    versions = kaggle_registry()
    return max((v["version"] for v in versions), default=None)


def save_kaggle_version(detector, metrics: dict) -> None:
    """Persist a KaggleDetector and its metrics to disk."""
    folder = kaggle_model_dir()
    folder.mkdir(parents=True, exist_ok=True)

    joblib.dump(detector, folder / f"v{detector.version}.joblib")

    meta = {
        "version": detector.version,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "threshold": detector.threshold,
        **metrics,
    }
    rows = [v for v in kaggle_registry() if v["version"] != detector.version] + [meta]
    (folder / "versions.json").write_text(
        json.dumps(sorted(rows, key=lambda v: v["version"]), indent=1)
    )
    _load_kaggle.cache_clear()


def load_kaggle_version(version: int | None = None):
    """Load a specific Kaggle version, or the latest. Returns None if nothing saved."""
    v = version or current_kaggle_version()
    if v is None:
        return None
    return _load_kaggle(str(kaggle_model_dir()), v)


@lru_cache(maxsize=16)
def _load_kaggle(folder: str, version: int):
    return joblib.load(Path(folder) / f"v{version}.joblib")
