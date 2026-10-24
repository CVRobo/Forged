"""LightGBM-based fraud detector for Kaggle IEEE-CIS data.

Wraps FeaturePipeline + LightGBM Booster into a KaggleDetector dataclass
with train, predict, retrain, and evaluate functions.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ml.online.kaggle_features import FeaturePipeline

logger = logging.getLogger(__name__)

# Retrain safety gates (same as game model)
GATE_FPR = 0.08
REGRESSION_TOL = 0.05

# The game's catch threshold: suspicion >= 38 means caught.
SERVER_CUTOFF = 38.0


@dataclass
class KaggleDetector:
    model: object  # lgb.Booster
    pipeline: FeaturePipeline
    threshold: float
    version: int
    feature_names: list[str] = field(default_factory=list)
    _explainer: object | None = field(default=None, repr=False)


def train_kaggle(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    fpr_target: float = 0.05,
) -> KaggleDetector:
    """Train a LightGBM fraud detector on Kaggle data.

    1. Fit FeaturePipeline on train_df
    2. Transform both train and val
    3. Train LightGBM with early stopping on val
    4. Set threshold at target FPR on val
    """
    import lightgbm as lgb

    pipeline = FeaturePipeline()
    X_train = pipeline.fit_transform(train_df)
    X_val = pipeline.transform(val_df)
    y_train = train_df["isFraud"].values
    y_val = val_df["isFraud"].values

    feature_names = pipeline.feature_names

    train_data = lgb.Dataset(X_train, label=y_train, feature_name=feature_names, free_raw_data=False)
    val_data = lgb.Dataset(X_val, label=y_val, feature_name=feature_names, free_raw_data=False)

    params = {
        "objective": "binary",
        "metric": "auc",
        "num_leaves": 256,
        "learning_rate": 0.03,
        "feature_fraction": 0.7,
        "bagging_fraction": 0.7,
        "bagging_freq": 1,
        "min_child_samples": 30,
        "max_depth": -1,
        "is_unbalance": True,
        "verbose": -1,
        "seed": 42,
    }

    callbacks = [
        lgb.early_stopping(100, verbose=False),
        lgb.log_evaluation(period=0),
    ]

    model = lgb.train(
        params,
        train_data,
        num_boost_round=2000,
        valid_sets=[val_data],
        valid_names=["val"],
        callbacks=callbacks,
    )

    # Set threshold at target FPR on val
    val_probs = model.predict(X_val)
    threshold = _threshold_at_fpr(val_probs, y_val, fpr_target)

    return KaggleDetector(
        model=model,
        pipeline=pipeline,
        threshold=threshold,
        version=1,
        feature_names=feature_names,
    )


def predict_kaggle(detector: KaggleDetector, row_dict: dict) -> dict:
    """Score a single row dict against the Kaggle detector.

    Returns same shape as game predict():
    {score, flagged, suspicion, tells, contributions, version}
    """
    import shap

    features = detector.pipeline.extract_single(row_dict)
    x = pd.DataFrame([features], columns=detector.feature_names)

    score = float(detector.model.predict(x)[0])
    flagged = score >= detector.threshold

    # SHAP contributions
    if detector._explainer is None:
        detector._explainer = shap.TreeExplainer(detector.model)
    shap_values = detector._explainer.shap_values(x)

    # shap_values may be a list (one per class) for binary; take the positive class
    if isinstance(shap_values, list):
        sv = shap_values[1][0]
    else:
        sv = shap_values[0]

    contributions = {}
    for i, name in enumerate(detector.feature_names):
        contributions[name] = float(sv[i])

    # Suspicion: compatibility with the game's 38-threshold system
    suspicion = SERVER_CUTOFF * (score / detector.threshold) if detector.threshold > 0 else 0.0

    # Tells from SHAP contributions
    from ml.online.tells import shap_to_tells
    tells = shap_to_tells(contributions, detector.feature_names)

    return {
        "score": score,
        "flagged": flagged,
        "suspicion": suspicion,
        "tells": tells,
        "contributions": contributions,
        "version": detector.version,
    }


def retrain_kaggle(
    detector: KaggleDetector,
    new_fraud_rows: list[dict],
    base_df: pd.DataFrame,
    fpr_target: float = 0.05,
) -> KaggleDetector | None:
    """Retrain on base_df + new fraud rows. Returns new detector or None if safety gates fail."""
    if not new_fraud_rows:
        return None

    # Append new fraud rows to base_df
    new_df = pd.DataFrame(new_fraud_rows)
    new_df["isFraud"] = 1
    combined = pd.concat([base_df, new_df], ignore_index=True)

    from ml.online.kaggle_data import time_split
    train_df, val_df = time_split(combined)

    candidate = train_kaggle(train_df, val_df, fpr_target=fpr_target)
    candidate.version = detector.version + 1

    # Safety gates on val
    val_features = candidate.pipeline.transform(val_df)
    val_probs = candidate.model.predict(val_features)
    y_val = val_df["isFraud"].values

    legit_mask = y_val == 0
    fraud_mask = y_val == 1

    # Gate 1: FPR on val legit <= GATE_FPR
    if legit_mask.sum() > 0:
        candidate_fpr = (val_probs[legit_mask] >= candidate.threshold).mean()
        if candidate_fpr > GATE_FPR:
            logger.warning("Retrain rejected: FPR %.3f > %.3f gate", candidate_fpr, GATE_FPR)
            return None

    # Gate 2: recall regression <= REGRESSION_TOL
    if fraud_mask.sum() > 0:
        old_features = detector.pipeline.transform(val_df)
        old_probs = detector.model.predict(old_features)
        old_recall = (old_probs[fraud_mask] >= detector.threshold).mean()
        new_recall = (val_probs[fraud_mask] >= candidate.threshold).mean()
        if new_recall < old_recall - REGRESSION_TOL:
            logger.warning("Retrain rejected: recall %.3f < %.3f - %.3f",
                           new_recall, old_recall, REGRESSION_TOL)
            return None

    logger.info("Retrain promoted: v%d -> v%d", detector.version, candidate.version)
    return candidate


def evaluate(detector: KaggleDetector, val_df: pd.DataFrame) -> dict:
    """Evaluate the detector on a validation DataFrame.

    Returns {auc, recall, fpr, n_train, n_fraud, feature_importances}.
    """
    from sklearn.metrics import roc_auc_score

    X_val = detector.pipeline.transform(val_df)
    y_val = val_df["isFraud"].values
    probs = detector.model.predict(X_val)

    auc = float(roc_auc_score(y_val, probs))

    flagged = probs >= detector.threshold
    fraud_mask = y_val == 1
    legit_mask = y_val == 0

    recall = float(flagged[fraud_mask].mean()) if fraud_mask.sum() > 0 else 0.0
    fpr = float(flagged[legit_mask].mean()) if legit_mask.sum() > 0 else 0.0

    # Feature importances (gain)
    importances = detector.model.feature_importance(importance_type="gain")
    feat_imp = sorted(
        zip(detector.feature_names, importances),
        key=lambda x: -x[1],
    )

    return {
        "auc": auc,
        "recall": recall,
        "fpr": fpr,
        "n_train": len(val_df),
        "n_fraud": int(fraud_mask.sum()),
        "feature_importances": feat_imp[:20],
    }


def _threshold_at_fpr(probs: np.ndarray, labels: np.ndarray, target_fpr: float) -> float:
    """Find the lowest probability threshold where FPR on legit samples <= target_fpr."""
    legit_probs = probs[labels == 0]
    if len(legit_probs) == 0:
        return 0.5
    threshold = float(np.percentile(legit_probs, 100 * (1 - target_fpr)))
    return max(threshold, 0.01)
