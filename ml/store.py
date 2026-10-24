"""Saved detector versions and the replay buffer, under FORGED_MODEL_DIR (default ml/models/).

    v{n}.joblib     one fitted Detector per version
    versions.json   a row per version: metrics, per-level thresholds, promoted or not
    buffer.jsonl    every player row and clone ever trained on (the replay buffer)
    holdout.jsonl   the 20% of each trick's clones kept out of training (trick recall)
"""
import json
import os
from functools import lru_cache
from pathlib import Path

import joblib

from ml.baseline import Detector
from ml.features import backfill
from ml.schema import Submission


def model_dir() -> Path:
    return Path(os.environ.get("FORGED_MODEL_DIR", Path(__file__).parent / "models"))


def registry() -> list[dict]:
    path = model_dir() / "versions.json"
    return json.loads(path.read_text()) if path.exists() else []


def current_version() -> int | None:
    """The newest promoted version: the one the inspector uses."""
    promoted = [v["version"] for v in registry() if v["promoted"]]
    return max(promoted) if promoted else None


def next_version() -> int:
    return max((v["version"] for v in registry()), default=0) + 1


def save_version(det: Detector, meta: dict) -> None:
    folder = model_dir()
    folder.mkdir(parents=True, exist_ok=True)
    joblib.dump(det, folder / f"v{meta['version']}.joblib")
    rows = [v for v in registry() if v["version"] != meta["version"]] + [meta]
    (folder / "versions.json").write_text(json.dumps(sorted(rows, key=lambda v: v["version"]), indent=1))


def version_meta(version: int) -> dict:
    return next(v for v in registry() if v["version"] == version)


def threshold(version: int, level_id: str) -> float:
    return version_meta(version)["thresholds"][level_id]


def load_detector(version: int) -> Detector:
    return _load(str(model_dir()), version)


@lru_cache(maxsize=32)
def _load(folder: str, version: int) -> Detector:
    return joblib.load(Path(folder) / f"v{version}.joblib")


def append_rows(rows: list[Submission], name: str = "buffer") -> None:
    append_text_rows([r.model_dump_json() for r in rows], name)


def append_text_rows(lines: list[str], name: str) -> None:
    if not lines:
        return
    folder = model_dir()
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / f"{name}.jsonl").open("a") as f:
        f.writelines(line + "\n" for line in lines)


def load_rows(name: str = "buffer") -> list[Submission]:
    """Rows stored before the realistic channel get its features backfilled (ml.features.backfill)."""
    path = model_dir() / f"{name}.jsonl"
    rows = [Submission.model_validate_json(line) for line in path.read_text().splitlines()] if path.exists() else []
    return [r.model_copy(update={"features": backfill(r.features, r.invoice)}) for r in rows]


def clear_cache() -> None:
    _load.cache_clear()
