"""Online fraud detector — public API.

    from ml.online import warm, predict, current_version

Server startup calls warm() to load or bootstrap v1.
"""

from __future__ import annotations

import logging

from ml.online.generate import generate
from ml.online.model import OnlineDetector, metrics
from ml.online.model import predict as _predict
from ml.online.model import retrain as _retrain
from ml.online.model import train as _train
from ml.online.store import (
    current_version,
    load_base_data,
    load_version,
    save_base_data,
    save_version,
)

logger = logging.getLogger(__name__)


def warm() -> int:
    """Load or create v1. Called at server startup. Returns the live version number."""
    v = current_version()
    if v is not None:
        logger.info("Online detector v%d already exists", v)
        return v

    logger.info("Bootstrapping online detector v1...")
    data = generate(n=5000, seed=42)
    det = _train(data, fpr_target=0.05)
    m = metrics(det, data)
    save_version(det, m)
    save_base_data(data)
    logger.info("Online detector v1 ready: recall=%.2f fpr=%.3f", m["recall"], m["fpr"])
    return det.version


def predict(row_dict: dict) -> dict | None:
    """Score a single order against the current model. Returns None if no model."""
    det = load_version()
    if det is None:
        return None
    return _predict(det, row_dict)


def retrain(new_fraud_rows: list[dict]) -> int | None:
    """Retrain on base data + new fraud rows. Returns new version or None if rejected."""
    det = load_version()
    if det is None:
        return None

    base = load_base_data()
    if base is None:
        base = generate(n=5000, seed=42)
        save_base_data(base)

    new_det = _retrain(det, new_fraud_rows, base, fpr_target=0.05)
    if new_det is None:
        return None

    m = metrics(new_det, base + new_fraud_rows)
    save_version(new_det, m)
    save_base_data(base + [{**r, "isFraud": 1} for r in new_fraud_rows])
    return new_det.version
