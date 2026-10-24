"""What the game server imports (docs/contracts.md section 3).

    from ml.detector import predict, retrain, top_features

predict() takes the game's InvoiceRecord and returns a Prediction. It unpacks as
(tells, suspicion), the way server/services/detector.py calls it today, and also
carries the model's own verdict (.flagged) and calibrated score.

Train and save v1 ahead of the demo, so the first submit isn't slow:

    ml/.venv/bin/python -m ml.detector --train
"""
import hashlib
import sys
from dataclasses import asdict, dataclass, field

from ml import explain, store, training
from ml.adapter import LEVEL_IDS, scheme_id, serving_case_file, to_invoice
from ml.features import compute_features
from ml.payloads import payload_schemes
from ml.schema import SessionEntry, SessionHistory, Submission
from ml.world import Truth

# server/routes/round.py still scores the prototype's way: raw suspicion times
# 0.55 + 0.12 * (version - 1), flagged above 38. Until it reads Prediction.flagged,
# suspicion is scaled so that rule lands exactly on this model's threshold.
SERVER_CUTOFF = 38.0
SERVER_SKILL = (0.55, 0.12)


@dataclass
class Prediction:
    tells: list[dict]       # [{"tell_type", "strength", "region", "features"}], strongest first
    suspicion: float        # for the server's current formula (see SERVER_CUTOFF)
    score: float            # calibrated P(fraud)
    flagged: bool           # the model's verdict at this level's FPR target
    threshold: float
    version: int            # the model version that judged it
    top_features: list[str] = field(default_factory=list)
    features: dict = field(default_factory=dict)

    def __iter__(self):  # tells, suspicion = predict(record, version, memo)
        yield self.tells
        yield self.suspicion

    def to_dict(self) -> dict:
        return asdict(self)


def warm() -> int:
    """Load the live version, training v1 if there is none yet. Returns its number."""
    return training.ensure_v1()


def predict(record, version: int | None = None, memo=None, history=(), model_version: int | None = None) -> Prediction:
    """record: the game's InvoiceRecord (dict or pydantic). version: the server's inspector
    version, used only for the compatibility suspicion. history: this session's earlier
    records, oldest first. model_version: judge with a specific saved version."""
    live = model_version or warm()
    det = store.load_detector(live)
    level_id = LEVEL_IDS.get(_get(record, "level", 1), "sunny_diner")
    threshold = store.threshold(live, level_id)
    features = _features(record, history)
    score = det.score_features(features)
    skill = SERVER_SKILL[0] + SERVER_SKILL[1] * ((version or 1) - 1)
    return Prediction(
        tells=explain.tells(det, features), suspicion=SERVER_CUTOFF * (score / threshold) / skill,
        score=score, flagged=score >= threshold, threshold=threshold, version=live,
        top_features=[t["tell_type"] for t in explain.tells(det, features, k=2)], features=features)


def retrain(examples: list, force: bool = False, version: int | None = None) -> dict:
    """examples: game records, optionally with "label", "verdict", "round_id", "session_id" and
    "detector_version". Labels come from the payload check, not from "label" (spec 2.1)."""
    rows = [to_row(e, version) for e in examples]
    result = training.retrain_on(rows, force=force)
    result["examples"]["label_disagreements"] = sum(
        (_get(e, "label") == "fraud") != r.is_fraud for e, r in zip(examples, rows) if _get(e, "label"))
    return result


def top_features(version: int | None = None) -> list[str]:
    """The two features the live memo rules are about (spec 5.1)."""
    det = store.load_detector(version or warm())
    return explain.top_features(det, _memo_rows())


def memo_rules(version: int | None = None) -> list[str]:
    """The two real memo rules, as sentences with real thresholds. The decoy still comes from the LLM."""
    det = store.load_detector(version or warm())
    return explain.memo_rules(det, _memo_rows())


def versions() -> list[dict]:
    warm()
    return store.registry()


def replay_grid() -> dict:
    """Spec 2.4: recall of every stored version i on every batch j of player attacks (grouped by
    the version live when they arrived), skipping j < i because those batches trained version i."""
    warm()
    ids = [v["version"] for v in store.registry() if v["promoted"]]
    attacks = [r for r in store.load_rows() if r.origin == "player" and r.is_fraud]
    batches = sorted({r.detector_version for r in attacks})
    recall, n = [], []
    for i in ids:
        det, threshold = store.load_detector(i), store.threshold(i, "sunny_diner")
        row_recall, row_n = [], []
        for j in batches:
            batch = [r for r in attacks if r.detector_version == j]
            skip = j < i
            row_recall.append(None if skip else sum(det.score_features(r.features) >= threshold for r in batch) / len(batch))
            row_n.append(0 if skip else len(batch))
        recall.append(row_recall)
        n.append(row_n)
    return {"versions": ids, "batches": batches, "recall": recall, "n": n}


def to_row(record, version: int | None = None) -> Submission:
    """A game record as a training row, labelled by the payload check against the mule accounts."""
    inv = to_invoice(record)
    case = serving_case_file(inv)
    features = _features(record, ())
    fraud = bool(payload_schemes(inv, case, Truth()))
    rid = _get(record, "round_id") or hashlib.sha256(inv.model_dump_json().encode()).hexdigest()[:12]
    return Submission(
        submission_id=str(rid), session_id=str(_get(record, "session_id") or "anon"),
        level_id=LEVEL_IDS.get(_get(record, "level", 1), "sunny_diner"), round_no=int(_get(record, "round_no", 1) or 1),
        scheme_id=scheme_id(record) if fraud else None, origin="player", invoice=inv, is_fraud=fraud,
        features=features, detector_version=int(_get(record, "detector_version") or version or store.current_version() or 1),
        score=0.0, verdict=_get(record, "verdict") or "PAID", top_reasons=[], heat_before=0.0,
        heat_after=float(_get(record, "heat", 0) or 0), payout=0.0, created_at=inv.sent_at,
    )


def _features(record, history) -> dict[str, float]:
    inv = to_invoice(record)
    earlier = [to_invoice(h) for h in history]
    session = SessionHistory(session_id="live", round_no=len(earlier) + 1,
                             entries=[SessionEntry(round_no=i + 1, invoice=h) for i, h in enumerate(earlier)])
    return compute_features(inv, serving_case_file(inv), session)


def _memo_rows() -> list[Submission]:
    """Spec 5.1 wants the last 200 submissions; until there are 50 player rows, use validation data."""
    players = [r for r in store.load_rows() if r.origin == "player"]
    return players[-200:] if len(players) >= 50 else training.base_splits()[1]


def _get(record, name, default=None):
    return record.get(name, default) if isinstance(record, dict) else getattr(record, name, default)


if __name__ == "__main__":
    if "--train" in sys.argv:
        print(f"live version: v{warm()} in {store.model_dir()}")
