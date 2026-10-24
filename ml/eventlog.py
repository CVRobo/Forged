"""One reproducible row per attempt (docs/realistic-data-plan.md section 1).

The server calls log_attempt() on every /submit and every rejection. Rows append to
attempts.jsonl in the model folder and, when a Redis client is passed, to a stream with
no TTL. Each row holds what the player sent, what the model saw and decided, and the
label, so a verdict can be reproduced and the attempt reused as data.

Without consent the numbers are kept, so the game's metrics stay complete, but every
field the player typed is blanked. ml/export.py leaves those rows out entirely.
"""
import json
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from ml import store
from ml.adapter import scheme_id, serving_case_file, to_invoice
from ml.payloads import payload_schemes
from ml.world import Truth

SCHEMA_VERSION = "1"
STREAM_KEY = "forged:attempts"
CONSENT_TEXT = ("Everything here is fictional. Don't type real names, companies, emails or account numbers. "
                "Your emails, chat and moves are saved under a random ID, used to train this game's inspector, "
                "and may be released publicly for research.")
# Fields the player types: blanked when there's no consent.
TYPED_RECORD_FIELDS = ("vendor", "cover_email", "invoice_no", "po_number", "sender_domain", "line_items")
TYPED_EMAIL_FIELDS = ("from_name", "from_addr", "reply_to", "cc", "subject", "body")


class Attempt(BaseModel):
    attempt_id: str
    schema_version: str = SCHEMA_VERSION
    logged_at: datetime
    session_id: str
    round_id: str | None
    consent: bool
    level: int
    declared_scheme: str | None      # what the player picked
    payload_schemes: list[str]       # what the payload checks found: the label set
    is_fraud: bool
    record: dict                     # the record as the game sent it
    email: dict | None = None        # an EmailMessage, once the email channel exists
    change_request: dict | None = None
    defender_actions: list[dict] = []
    model_version: int | None = None
    score: float | None = None
    threshold: float | None = None
    flagged: bool | None = None
    features: dict = {}
    verdict: Literal["PAID", "FLAGGED", "REJECTED", "APPLIED", "BLOCKED"]
    persuasion: float | None = None
    perks: list[str] = []
    noise: float | None = None       # the server's random draw, while it still adds one


def log_attempt(record, prediction=None, *, verdict: str, session_id: str, round_id: str | None, consent: bool,
                email: dict | None = None, change_request: dict | None = None, defender_actions=(),
                persuasion: float | None = None, perks=(), noise: float | None = None, stream=None) -> Attempt:
    raw = _as_dict(record)
    inv = to_invoice(raw)
    labels = sorted(payload_schemes(inv, serving_case_file(inv), Truth()))
    attempt = Attempt(
        attempt_id=uuid.uuid4().hex, logged_at=datetime.now(), session_id=session_id, round_id=round_id,
        consent=consent, level=int(raw.get("level", 1) or 1), declared_scheme=scheme_id(raw),
        payload_schemes=labels, is_fraud=bool(labels), record=raw if consent else _blank(raw, TYPED_RECORD_FIELDS),
        email=email if consent or email is None else _blank(email, TYPED_EMAIL_FIELDS),
        change_request=change_request, defender_actions=list(defender_actions),
        model_version=getattr(prediction, "version", None), score=getattr(prediction, "score", None),
        threshold=getattr(prediction, "threshold", None), flagged=getattr(prediction, "flagged", None),
        features=dict(getattr(prediction, "features", {}) or {}), verdict=verdict, persuasion=persuasion,
        perks=list(perks), noise=noise,
    )
    store.append_text_rows([attempt.model_dump_json()], "attempts")
    if stream is not None:
        try:
            stream.xadd(STREAM_KEY, {"row": attempt.model_dump_json()})
        except Exception:  # logging must never block or change a verdict
            pass
    return attempt


def read_attempts() -> list[Attempt]:
    path = store.model_dir() / "attempts.jsonl"
    return [Attempt.model_validate_json(line) for line in path.read_text().splitlines()] if path.exists() else []


def _as_dict(record) -> dict:
    if isinstance(record, dict):
        return json.loads(json.dumps(record, default=str))
    return json.loads(record.model_dump_json()) if hasattr(record, "model_dump_json") else dict(vars(record))


def _blank(fields: dict, typed: tuple[str, ...]) -> dict:
    return {k: ([] if isinstance(v, list) else "") if k in typed else v for k, v in fields.items()}
