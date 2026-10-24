"""Online fraud detector: train, predict, and retrain a logistic regression on IEEE-CIS features.

The model is interpretable by design: each feature's contribution to the fraud score
is coef[i] * (scaled_feature[i] - 0), which becomes the player-facing tells.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from ml.online.features import FEATURE_NAMES, extract

logger = logging.getLogger(__name__)

# The game's catch threshold: suspicion >= 38 means caught.
SERVER_CUTOFF = 38.0

# Retrain safety gates
GATE_FPR = 0.08
REGRESSION_TOL = 0.05


@dataclass
class OnlineDetector:
    scaler: StandardScaler
    model: LogisticRegression
    threshold: float
    version: int
    feature_names: tuple[str, ...] = field(default_factory=lambda: FEATURE_NAMES)


def train(rows: list[dict], fpr_target: float = 0.05) -> OnlineDetector:
    """Train a new detector from labeled row dicts (each must have isFraud)."""
    X, y = _to_matrix(rows)
    n = len(y)
    # 80/20 split
    split = int(n * 0.8)
    indices = np.arange(n)
    np.random.seed(42)
    np.random.shuffle(indices)
    train_idx, val_idx = indices[:split], indices[split:]

    X_train, y_train = X[train_idx], y[train_idx]
    X_val, y_val = X[val_idx], y[val_idx]

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_val_s = scaler.transform(X_val)

    clf = LogisticRegression(C=1.0, max_iter=1000, solver="lbfgs", random_state=42)
    clf.fit(X_train_s, y_train)

    # Set threshold: lowest P(fraud) where FPR on val legit <= fpr_target
    probs_val = clf.predict_proba(X_val_s)[:, 1]
    threshold = _threshold_at_fpr(probs_val, y_val, fpr_target)

    return OnlineDetector(
        scaler=scaler, model=clf, threshold=threshold,
        version=1, feature_names=FEATURE_NAMES,
    )


def predict(detector: OnlineDetector, row_dict: dict) -> dict:
    """Score a single order row dict against the detector."""
    features = extract(row_dict)
    x = np.array([[features.get(f, 0.0) for f in detector.feature_names]])
    x_s = detector.scaler.transform(x)

    score = float(detector.model.predict_proba(x_s)[0, 1])
    flagged = score >= detector.threshold

    # Feature contributions: coef * scaled_feature
    coefs = detector.model.coef_[0]
    contributions = {}
    for i, name in enumerate(detector.feature_names):
        contributions[name] = float(coefs[i] * x_s[0, i])

    # Suspicion: compatibility with the game's 38-threshold system
    suspicion = SERVER_CUTOFF * (score / detector.threshold) if detector.threshold > 0 else 0.0

    # Tells from contributions
    from ml.online.tells import contributions_to_tells
    tells = contributions_to_tells(contributions)

    return {
        "score": score,
        "flagged": flagged,
        "suspicion": suspicion,
        "tells": tells,
        "contributions": contributions,
        "version": detector.version,
    }


def retrain(
    detector: OnlineDetector,
    new_fraud_rows: list[dict],
    base_data: list[dict],
    fpr_target: float = 0.05,
) -> OnlineDetector | None:
    """Retrain on base_data + new fraud rows. Returns new detector or None if safety gates fail."""
    if not new_fraud_rows:
        return None

    # Label new rows as fraud
    combined = list(base_data)
    for row in new_fraud_rows:
        r = dict(row)
        r["isFraud"] = 1
        combined.append(r)

    candidate = train(combined, fpr_target=fpr_target)
    candidate.version = detector.version + 1

    # Safety gates: evaluate on base data
    base_legit = [r for r in base_data if r.get("isFraud", 0) == 0]
    base_fraud = [r for r in base_data if r.get("isFraud", 0) == 1]

    # Gate 1: FPR on base legit <= GATE_FPR
    if base_legit:
        fp = sum(1 for r in base_legit if predict(candidate, r)["flagged"])
        candidate_fpr = fp / len(base_legit)
        if candidate_fpr > GATE_FPR:
            logger.warning("Retrain rejected: FPR %.3f > %.3f gate", candidate_fpr, GATE_FPR)
            return None

    # Gate 2: recall on base fraud >= old recall - REGRESSION_TOL
    if base_fraud:
        old_caught = sum(1 for r in base_fraud if predict(detector, r)["flagged"])
        old_recall = old_caught / len(base_fraud)
        new_caught = sum(1 for r in base_fraud if predict(candidate, r)["flagged"])
        new_recall = new_caught / len(base_fraud)
        if new_recall < old_recall - REGRESSION_TOL:
            logger.warning("Retrain rejected: recall %.3f < %.3f - %.3f",
                           new_recall, old_recall, REGRESSION_TOL)
            return None

    logger.info("Retrain promoted: v%d -> v%d", detector.version, candidate.version)
    return candidate


def metrics(detector: OnlineDetector, rows: list[dict]) -> dict:
    """Evaluate the detector on labeled rows. Returns recall, fpr, n_train, n_fraud."""
    fraud = [r for r in rows if r.get("isFraud", 0) == 1]
    legit = [r for r in rows if r.get("isFraud", 0) == 0]
    caught = sum(1 for r in fraud if predict(detector, r)["flagged"]) if fraud else 0
    false_pos = sum(1 for r in legit if predict(detector, r)["flagged"]) if legit else 0
    return {
        "n_train": len(rows),
        "n_fraud": len(fraud),
        "recall": caught / len(fraud) if fraud else 0.0,
        "fpr": false_pos / len(legit) if legit else 0.0,
    }


def _to_matrix(rows: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Convert row dicts to feature matrix X and label vector y."""
    X_list, y_list = [], []
    for row in rows:
        features = extract(row)
        X_list.append([features.get(f, 0.0) for f in FEATURE_NAMES])
        y_list.append(int(row.get("isFraud", 0)))
    return np.array(X_list, dtype=np.float64), np.array(y_list, dtype=np.int32)


def _threshold_at_fpr(probs: np.ndarray, labels: np.ndarray, target_fpr: float) -> float:
    """Find the lowest probability threshold where FPR on legit samples <= target_fpr."""
    legit_probs = probs[labels == 0]
    if len(legit_probs) == 0:
        return 0.5
    # threshold = the (1 - target_fpr) quantile of legit probabilities
    threshold = float(np.percentile(legit_probs, 100 * (1 - target_fpr)))
    return max(threshold, 0.01)  # floor to avoid threshold=0
