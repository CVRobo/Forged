"""In-session memory: a vector index over every submission (Model Spec v0.2 sections 2.3 and 5.3).

Each submission's base features go into the index with is_fraud, session_id, origin and
created_at. They are standardized with one fixed scale (memory_scale.json, fit once on the
base train split), so stored vectors stay comparable across model versions. Vectors hold
BASE_FEATURES only, never the kNN features. A query sees only rows created before the
submission it scores, and gives three model features:

    knn_fraud_share  the share of fraud among the 10 nearest neighbors
    knn_max_sim      the highest similarity among them
    self_sim         the highest similarity to this session's own earlier submissions

Similarity is cosine on the standardized vectors, floored at 0: what a Redis COSINE index
returns as 1 - distance. NumpyIndex is the in-process brute-force search the spec names
as the fallback when Redis is unreachable. A Redis backend needs the same add(), search()
and `id in index`.

Refit the scale only when the generator changes (this rewrites memory_scale.json):

    ml/.venv/bin/python -m ml.memory --fit
"""
import json
import sys
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np

from ml.schema import BASE_FEATURES, MEMORY_FEATURES, Submission

K = 10
SCALE_PATH = Path(__file__).parent / "memory_scale.json"
EARLIEST = datetime(1970, 1, 1)  # for rows that count as earlier than anything live
DROPOUT = 0.5  # share of each training row's weight given to its memory-off copy


@dataclass(frozen=True)
class Hit:
    sim: float
    is_fraud: bool


@dataclass(frozen=True)
class Scale:
    mean: np.ndarray
    std: np.ndarray
    heat_floor: float  # a typical legit invoice's self_sim: the heat meter starts above it

    def vectors(self, feature_dicts) -> np.ndarray:
        """Unit vectors of the standardized base features, one row per feature dict."""
        x = np.array([[f[n] for n in BASE_FEATURES] for f in feature_dicts], dtype=float).reshape(-1, len(BASE_FEATURES))
        z = (x - self.mean) / self.std
        norms = np.linalg.norm(z, axis=1, keepdims=True)
        return z / np.where(norms > 0, norms, 1.0)


@lru_cache(maxsize=1)
def scale() -> Scale:
    saved = json.loads(SCALE_PATH.read_text())
    if tuple(saved["features"]) != BASE_FEATURES:
        raise ValueError(f"{SCALE_PATH.name} is for other features; refit it with python -m ml.memory --fit")
    return Scale(np.array(saved["mean"]), np.array(saved["std"]), saved["heat_floor"])


class NumpyIndex:
    """Brute-force cosine search over unit vectors, filtered by created_at and session."""

    def __init__(self):
        self._lock = threading.RLock()
        self._n = 0
        self._vectors = np.empty((64, len(BASE_FEATURES)))
        self._fraud = np.empty(64, dtype=bool)
        self._times = np.empty(64, dtype="datetime64[us]")
        self._sessions = np.empty(64, dtype=np.int64)
        self._session_codes: dict[str, int] = {}
        self._origins: list[str] = []
        self._ids: dict[str, int] = {}
        self._clock = EARLIEST
        self.served: dict[str, dict[str, float]] = {}  # submission id -> the memory features it was served

    def __len__(self) -> int:
        return self._n

    def __contains__(self, submission_id: str) -> bool:
        return submission_id in self._ids

    def add(self, ids, vectors, is_fraud, session_ids, origins, created_at) -> None:
        """Rows whose id is already in the index are skipped."""
        with self._lock:
            for i, v, fraud, session, origin, when in zip(ids, vectors, is_fraud, session_ids, origins, created_at):
                if i in self._ids:
                    continue
                self._grow()
                n = self._n
                self._vectors[n], self._fraud[n], self._times[n] = v, fraud, np.datetime64(when, "us")
                self._sessions[n] = self._session_codes.setdefault(session, len(self._session_codes))
                self._origins.append(origin)
                self._ids[i] = n
                self._n += 1

    def search(self, vector, k: int = K, before: datetime | None = None, session_id: str | None = None) -> list[Hit]:
        """The k most similar rows, most similar first. before: only rows created earlier."""
        with self._lock:
            n = self._n
            if not n:
                return []
            sims = self._vectors[:n] @ np.asarray(vector, dtype=float)
            keep = np.ones(n, dtype=bool)
            if before is not None:
                keep &= self._times[:n] < np.datetime64(before, "us")
            if session_id is not None:
                keep &= self._sessions[:n] == self._session_codes.get(session_id, -1)
            idx = np.flatnonzero(keep)
            if len(idx) > k:
                idx = idx[np.argpartition(-sims[idx], k - 1)[:k]]
            idx = idx[np.argsort(-sims[idx], kind="stable")]
            return [Hit(max(0.0, float(sims[i])), bool(self._fraud[i])) for i in idx]

    def tick(self) -> datetime:
        """A created_at for a live submission: now, and always later than the last one."""
        with self._lock:
            self._clock = max(datetime.now(), self._clock + timedelta(microseconds=1))
            return self._clock

    def _grow(self) -> None:
        if self._n < len(self._fraud):
            return
        size = 2 * len(self._fraud)
        self._vectors = np.resize(self._vectors, (size, len(BASE_FEATURES)))
        self._fraud, self._times, self._sessions = (np.resize(a, size) for a in (self._fraud, self._times, self._sessions))


def add_rows(index: NumpyIndex, rows: list[Submission], created_at: datetime | None = None) -> None:
    """Write submissions into the index. created_at overrides theirs (EARLIEST: older than anything live)."""
    if rows:
        index.add([r.submission_id for r in rows], scale().vectors([r.features for r in rows]),
                  [r.is_fraud for r in rows], [r.session_id for r in rows], [r.origin for r in rows],
                  [created_at or r.created_at for r in rows])


def features_from(vector, session_id: str, sources) -> dict[str, float]:
    """The three memory features. sources: (index, before) pairs; before=None counts every row as earlier."""
    hits = sorted((h for index, before in sources for h in index.search(vector, K, before)), key=lambda h: -h.sim)[:K]
    own = [h.sim for index, before in sources for h in index.search(vector, 1, before, session_id)]
    return {
        "knn_fraud_share": float(np.mean([h.is_fraud for h in hits])) if hits else 0.0,
        "knn_max_sim": hits[0].sim if hits else 0.0,
        "self_sim": max(own, default=0.0),
    }


def replay(rows: list[Submission], prior: NumpyIndex | None = None, using: Scale | None = None) -> list[Submission]:
    """Spec 2.3 for generator data: each row's memory features from the rows created before it,
    in created_at order. prior: an index whose rows all count as earlier (say, the live memory)."""
    vectors = (using or scale()).vectors([r.features for r in rows])
    local, out = NumpyIndex(), [None] * len(rows)
    for i in sorted(range(len(rows)), key=lambda i: rows[i].created_at):
        r = rows[i]
        sources = [(local, r.created_at)] + ([(prior, None)] if prior is not None else [])
        out[i] = r.model_copy(update={"features": {**r.features, **features_from(vectors[i], r.session_id, sources)}})
        local.add([r.submission_id], vectors[i:i + 1], [r.is_fraud], [r.session_id], [r.origin], [r.created_at])
    return out


def has_memory(row: Submission) -> bool:
    return all(n in row.features for n in MEMORY_FEATURES)


def dropout(rows: list[Submission], share: float = DROPOUT) -> list[Submission]:
    """One model for both memory settings (spec 5.3): each row once as served and once with its
    memory features at the training mean, as a memory-off level scores it, splitting its weight."""
    means = {n: float(np.mean([r.features[n] for r in rows])) for n in MEMORY_FEATURES}
    return ([r.model_copy(update={"train_weight": r.train_weight * (1 - share)}) for r in rows]
            + [r.model_copy(update={"features": {**r.features, **means}, "train_weight": r.train_weight * share})
               for r in rows])


def heat(self_sim: float) -> float:
    """The heat meter, 0 to 100 (spec 2.3): 0 up to a typical legit invoice's self_sim, 100 at an exact repeat."""
    floor = scale().heat_floor
    return round(100 * min(1.0, max(0.0, (self_sim - floor) / (1 - floor))), 1)


def fit_scale(train: list[Submission]) -> dict:
    """The fixed scale: mean and std of each base feature on the base train split, and the heat floor
    (the median self_sim of legit invoices that have an earlier invoice in their session)."""
    x = np.array([[r.features[n] for n in BASE_FEATURES] for r in train], dtype=float)
    mean, std = x.mean(axis=0).round(6), x.std(axis=0).round(6)
    std = np.where(std > 0, std, 1.0)
    sims = [r.features["self_sim"] for r in replay(train, using=Scale(mean, std, 0.0)) if not r.is_fraud and r.round_no > 1]
    return {"features": list(BASE_FEATURES), "fit_on": "ml.generate.build_dataset(seed=1)",
            "mean": mean.tolist(), "std": std.tolist(), "heat_floor": round(float(np.median(sims)), 4)}


if __name__ == "__main__":
    if "--fit" in sys.argv:
        from ml.generate import build_dataset
        fitted = fit_scale(build_dataset(1))
        SCALE_PATH.write_text(json.dumps(fitted, indent=1) + "\n")
        scale.cache_clear()
        print(f"wrote {SCALE_PATH} (heat floor {fitted['heat_floor']})")
