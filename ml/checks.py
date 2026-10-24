"""The gate before the retrain loop (build step 4): spec checks 2.1, 3.1, 3.2 and 4.5, and the v1 recall target.

    ml/.venv/bin/python -m ml.checks

Train, validation and frozen test sets come from different seeds. When a check fails,
tune the generator (ml/generate.py, ml/attackers.py), not the model.

v1 trains on the memory features too (spec 2.3). The v1 checks judge with memory off, as
Sunny Diner does; the report also gives v1 with memory on and at each level's settings.
"""
import random
from dataclasses import dataclass

import numpy as np

from ml import memory, training
from ml.baseline import Detector, evaluate, fit_detector, threshold_at_fpr
from ml.schema import LEVELS, Submission

FPR_TARGET = 0.05
PAYLOAD_FEATURES = {  # each scheme's unavoidable tell (design doc scheme catalog)
    "bank_switcheroo": ("bank_changed",),
    "duplicate_dance": ("dup_similarity",),
    "boss_request": ("vendor_unknown", "no_open_order"),
    "phantom_supplier": ("vendor_unknown",),
    "padded_invoice": ("order_amount_ratio",),
}
HISTORY_FEATURES = ("window_count", "window_sum", "vendor_age_rounds", "amount_jump_ratio", "cadence_z", "dup_similarity")
TEXT_FEATURES = ("vague_text_score", "email_urgency", "email_mentions_change", "email_length")
TOOL_FEATURES = ("field_altered_count", "max_illegibility", "copy_generation", "scan_quality", "stamp_count",
                 "stamp_matches_vendor")


@dataclass
class Check:
    name: str
    value: float
    target: str
    passed: bool


@dataclass
class GateReport:
    checks: list[Check]
    v1: Detector
    v1_test: dict    # memory off
    v1_memory: dict  # memory on
    levels: dict     # level_id -> recall and FPR on the frozen test set at that level's settings


def run_checks(train: list[Submission], val: list[Submission], test: list[Submission]) -> GateReport:
    """Takes datasets from ml.generate.build_dataset, or ones already replayed for memory."""
    train, val, test = (rows if all(map(memory.has_memory, rows)) else memory.replay(rows) for rows in (train, val, test))
    checks = []
    for scheme, features in PAYLOAD_FEATURES.items():  # 2.1: the payload feature alone must not decide
        only = lambda rows: [r for r in rows if not r.is_fraud or r.scheme_id == scheme]
        recall = evaluate(fit_detector(only(train), only(val), features, FPR_TARGET), only(test))["recall"]
        checks.append(Check(f"2.1 {scheme}: {' + '.join(features)} alone, recall at 5% FPR", recall, "< 60%", recall < 0.60))
    for name in HISTORY_FEATURES:  # 3.1: history features are not stuck at their defaults
        spread = min(np.std([r.features[name] for r in train if r.is_fraud == cls]) for cls in (False, True))
        checks.append(Check(f"3.1 {name} varies in both classes (min std)", spread, "> 0", spread > 0))
    text = evaluate(fit_detector(train, val, TEXT_FEATURES, FPR_TARGET), test)["auroc"]
    checks.append(Check("3.2 text features alone, AUROC", text, "< 0.75", text < 0.75))
    v1 = training.fit(train, val, FPR_TARGET)
    v1_test = evaluate(v1, test, memory=False)
    shuffled = evaluate(v1, _shuffled(test, TOOL_FEATURES), memory=False)["auroc"]
    checks.append(Check("4.5 tool features shuffled, AUROC drop", v1_test["auroc"] - shuffled, "< 0.10",
                        v1_test["auroc"] - shuffled < 0.10))
    checks.append(Check("v1 recall on fresh scripted attacks, memory off", v1_test["recall"], "50% to 70%",
                        0.50 <= v1_test["recall"] <= 0.70))
    checks.append(Check("v1 FPR on fresh legit invoices, memory off", v1_test["fpr"], "<= 8%", v1_test["fpr"] <= 0.08))
    return GateReport(checks, v1, v1_test, evaluate(v1, test, memory=True), _by_level(v1, val, test))


def _by_level(det: Detector, val: list[Submission], test: list[Submission]) -> dict:
    report = {}
    for level_id, level in LEVELS.items():
        on = level.memory_enabled
        threshold = threshold_at_fpr(det.scores([r for r in val if not r.is_fraud], on), level.fpr_target)
        flagged, fraud = det.scores(test, on) >= threshold, np.array([r.is_fraud for r in test])
        report[level_id] = {"recall": float(flagged[fraud].mean()), "fpr": float(flagged[~fraud].mean())}
    return report


def _shuffled(rows: list[Submission], names: tuple[str, ...]) -> list[Submission]:
    """The same rows with these features permuted across rows (spec 4.5 shortcut test)."""
    rng = random.Random(0)
    order = list(range(len(rows)))
    rng.shuffle(order)
    return [r.model_copy(update={"features": {**r.features, **{n: rows[j].features[n] for n in names}}})
            for r, j in zip(rows, order)]


def main() -> None:
    train, val, test = training.base_splits()
    report = run_checks(train, val, test)
    print(f"train {len(train)} rows, validation {len(val)}, frozen test {len(test)}\n")
    for c in report.checks:
        value = f"{c.value:.1%}" if c.target.endswith("%") else f"{c.value:.3f}"
        print(f"  {'PASS' if c.passed else 'FAIL'}  {c.name:58s} {value:>8s}  target {c.target}")
    print("\nv1 recall by scheme, memory off:", {s: f"{v:.0%}" for s, v in report.v1_test["recall_by_scheme"].items()})
    on = report.v1_memory
    print(f"v1 with memory on (not gated): recall {on['recall']:.1%} at {on['fpr']:.1%} FPR, AUROC {on['auroc']:.3f}; by scheme",
          {s: f"{v:.0%}" for s, v in on["recall_by_scheme"].items()})
    for level_id, m in report.levels.items():
        level = LEVELS[level_id]
        print(f"  {level.name:24s} {level.fpr_target:.0%} FPR target, memory {'on ' if level.memory_enabled else 'off'}:"
              f" recall {m['recall']:.1%}, FPR {m['fpr']:.1%}")
    coefs = sorted(zip(report.v1.features, report.v1.model.coef_[0]), key=lambda t: -abs(t[1]))
    print("v1 largest weights:", ", ".join(f"{n} {w:+.2f}" for n, w in coefs[:8]))


if __name__ == "__main__":
    main()
