"""Online fraud detector — public API.

    from ml.online import warm, predict, current_version

Server startup calls warm() to load or bootstrap v1.

For the Kaggle LightGBM model:
    from ml.online import warm_kaggle, predict_kaggle
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
from ml.online.store import (
    current_kaggle_version,
    load_kaggle_version,
    save_kaggle_version,
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


# ---------------------------------------------------------------------------
# Kaggle LightGBM model API
# ---------------------------------------------------------------------------

def warm_kaggle() -> int:
    """Load or train the Kaggle LightGBM model. Called at startup if FORGED_USE_KAGGLE=1."""
    v = current_kaggle_version()
    if v is not None:
        logger.info("Kaggle detector v%d already exists", v)
        return v

    logger.info("Training Kaggle detector v1 — this may take a few minutes on first run...")
    from ml.online.kaggle_data import load_raw, time_split
    from ml.online.kaggle_model import evaluate as _evaluate_kaggle
    from ml.online.kaggle_model import train_kaggle

    df = load_raw()
    train_df, val_df = time_split(df)
    det = train_kaggle(train_df, val_df, fpr_target=0.05)
    m = _evaluate_kaggle(det, val_df)
    save_kaggle_version(det, m)
    logger.info("Kaggle detector v1 ready: AUC=%.4f recall=%.2f fpr=%.3f",
                m["auc"], m["recall"], m["fpr"])
    return det.version


def predict_kaggle(row_dict: dict) -> dict | None:
    """Score a single order using the Kaggle LightGBM model. Returns None if no model."""
    det = load_kaggle_version()
    if det is None:
        return None
    from ml.online.kaggle_model import predict_kaggle as _predict_kaggle
    return _predict_kaggle(det, row_dict)
