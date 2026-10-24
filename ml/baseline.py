"""Stage 1 detector: logistic regression on standardized features (Appendix B section 4).

Platt-calibrated on the validation set (spec 4.1: isotonic overfits a few hundred rows),
with the threshold set so the legit false-positive rate stays at the level's target.
Each feature's contribution (coefficient times standardized value) gives the
inspector's reasons for free.
"""
from dataclasses import dataclass

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.preprocessing import StandardScaler

from ml.schema import BASE_FEATURES, Submission


@dataclass
class Detector:
    features: tuple[str, ...]
    scaler: StandardScaler
    model: LogisticRegression
    platt: LogisticRegression  # a sigmoid over the model's margin
    threshold: float           # FLAGGED when score >= threshold
    reference: np.ndarray | None = None  # a typical legit invoice (standardized medians); reasons are measured from it

    def margins(self, rows: list[Submission]) -> np.ndarray:
        return self.model.decision_function(self.scaler.transform(matrix(rows, self.features)))

    def scores(self, rows: list[Submission]) -> np.ndarray:
        """Calibrated P(fraud)."""
        return self.platt.predict_proba(self.margins(rows).reshape(-1, 1))[:, 1]

    def flags(self, rows: list[Submission]) -> np.ndarray:
        return self.scores(rows) >= self.threshold

    def score_features(self, features: dict[str, float]) -> float:
        """Calibrated P(fraud) for one feature dict."""
        z = self.scaler.transform(np.array([[features[n] for n in self.features]]))
        return float(self.platt.predict_proba(self.model.decision_function(z).reshape(-1, 1))[0, 1])

    def contributions(self, features: dict[str, float]) -> dict[str, float]:
        """Each feature's push toward FLAGGED: coefficient times how far it sits from a typical legit invoice."""
        z = self.scaler.transform(np.array([[features[n] for n in self.features]]))[0]
        if self.reference is not None:
            z = z - self.reference
        return dict(zip(self.features, (self.model.coef_[0] * z).tolist()))

    def reasons(self, features: dict[str, float], k: int = 3) -> list[tuple[str, float]]:
        """The k features pushing hardest toward FLAGGED, as (name, contribution)."""
        pushes = self.contributions(features)
        return sorted(pushes.items(), key=lambda t: -t[1])[:k]


def fit_detector(train: list[Submission], val: list[Submission], features=BASE_FEATURES,
                 fpr_target: float = 0.05) -> Detector:
    x = matrix(train, features)
    scaler = StandardScaler().fit(x)
    model = LogisticRegression(max_iter=5000).fit(
        scaler.transform(x), labels(train), sample_weight=np.array([r.train_weight for r in train]))
    margins = model.decision_function(scaler.transform(matrix(val, features))).reshape(-1, 1)
    platt = LogisticRegression(C=1e6).fit(margins, labels(val))
    scores = platt.predict_proba(margins)[:, 1]
    legit = x[labels(train) == 0]
    reference = scaler.transform(np.median(legit, axis=0, keepdims=True))[0] if len(legit) else None
    return Detector(tuple(features), scaler, model, platt, threshold_at_fpr(scores[labels(val) == 0], fpr_target), reference)


def threshold_at_fpr(legit_scores, fpr_target: float) -> float:
    """The lowest threshold that flags at most fpr_target of these legit scores. Ties are never split."""
    ranked = np.sort(np.asarray(legit_scores, dtype=float))[::-1]
    allowed = int(np.floor(fpr_target * len(ranked)))
    return float(np.nextafter(ranked[allowed], np.inf)) if allowed < len(ranked) else -np.inf


def evaluate(det: Detector, rows: list[Submission]) -> dict:
    y, scores = labels(rows), det.scores(rows)
    flagged = scores >= det.threshold
    schemes = sorted({r.scheme_id for r in rows if r.is_fraud})
    return {
        "n_legit": int((y == 0).sum()), "n_fraud": int(y.sum()),
        "recall": float(flagged[y == 1].mean()), "fpr": float(flagged[y == 0].mean()),
        "auroc": float(roc_auc_score(y, scores)),
        "recall_by_scheme": {s: float(flagged[[r.is_fraud and r.scheme_id == s for r in rows]].mean()) for s in schemes},
    }


def matrix(rows: list[Submission], features=BASE_FEATURES) -> np.ndarray:
    return np.array([[r.features[n] for n in features] for r in rows], dtype=float)


def labels(rows: list[Submission]) -> np.ndarray:
    return np.array([r.is_fraud for r in rows], dtype=int)
