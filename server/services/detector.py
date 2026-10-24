"""Detection service: fraud detection with ML fallback.

Tries B's ml.detector.predict() first, falls back to the rule-based
computeTells() logic from the prototype.
"""

from __future__ import annotations

import logging

from server.content.levels import KNOWN_BANKS
from server.models.schemas import InvoiceRecord, Tell

logger = logging.getLogger(__name__)


def _compute_tells(record: InvoiceRecord) -> list[Tell]:
    """Rule-based fraud detection (from prototype game.js computeTells)."""
    tells: list[Tell] = []

    if record.bank_account not in KNOWN_BANKS:
        tells.append(Tell(tell_type="bank_changed", strength=26.0, region="bank"))

    if record.domain_mismatch:
        tells.append(Tell(tell_type="domain_mismatch", strength=18.0, region="header"))

    if record.field_altered:
        tells.append(Tell(tell_type="altered", strength=12.0 * len(record.field_altered), region=None))

    if record.copy_generation > 0:
        tells.append(Tell(tell_type="copy_gen", strength=8.0 * record.copy_generation, region=None))

    if record.legibility.get("bank", 1.0) < 0.6:
        tells.append(Tell(tell_type="low_legibility", strength=10.0, region="bank"))

    if record.heat > 40:
        tells.append(Tell(tell_type="heat", strength=record.heat * 0.3, region=None))

    if not record.letterhead_match:
        tells.append(Tell(tell_type="letterhead", strength=14.0, region="header"))

    if record.scheme == "phantom":
        tells.append(Tell(tell_type="unknown_vendor", strength=20.0, region="header"))

    tells.sort(key=lambda t: t.strength, reverse=True)
    return tells


def detect(record: InvoiceRecord, version: int, memo: list[dict]) -> tuple[list[Tell], float]:
    """Run fraud detection. Returns (tells, raw_suspicion).

    Tries ml.detector.predict() first, falls back to _compute_tells().
    """
    try:
        from ml.detector import predict  # type: ignore[import-not-found]

        ml_tells, raw_suspicion = predict(record, version, memo)
        logger.info("ML detector returned %d tells (suspicion=%.1f)", len(ml_tells), raw_suspicion)
        return ml_tells, raw_suspicion
    except Exception:
        logger.debug("ML detector unavailable, using rule-based fallback")

    tells = _compute_tells(record)
    raw_suspicion = sum(t.strength for t in tells)
    return tells, raw_suspicion
