"""Detection service: fraud detection with ML fallback.

Tries B's ml.detector.predict() first, falls back to the rule-based
computeTells() logic from the prototype.
"""

from __future__ import annotations

import logging

from server.content.levels import KNOWN_BANKS
from server.models.schemas import InvoiceRecord, Tell

logger = logging.getLogger(__name__)

TELL_DESCRIPTIONS: dict[str, str] = {
    "bank_changed": "Bank account doesn't match the vendor on file",
    "domain_mismatch": "Sender email domain doesn't match the vendor's known domain",
    "altered": "One or more invoice fields appear to have been altered",
    "copy_gen": "Invoice is a photocopy — possible duplicate submission",
    "low_legibility": "Bank details section is suspiciously hard to read",
    "heat": "This vendor has been flagged frequently in recent submissions",
    "letterhead": "Letterhead doesn't match the vendor's official branding",
    "unknown_vendor": "Vendor is not recognized in the company's approved list",
}


def _compute_tells(record: InvoiceRecord) -> list[Tell]:
    """Rule-based fraud detection (from prototype game.js computeTells)."""
    tells: list[Tell] = []

    if record.bank_account not in KNOWN_BANKS:
        tells.append(Tell(tell_type="bank_changed", strength=26.0, region="bank", description=TELL_DESCRIPTIONS["bank_changed"]))

    if record.domain_mismatch:
        tells.append(Tell(tell_type="domain_mismatch", strength=18.0, region="header", description=TELL_DESCRIPTIONS["domain_mismatch"]))

    if record.field_altered:
        tells.append(Tell(tell_type="altered", strength=12.0 * len(record.field_altered), region=None, description=TELL_DESCRIPTIONS["altered"]))

    if record.copy_generation > 0:
        tells.append(Tell(tell_type="copy_gen", strength=8.0 * record.copy_generation, region=None, description=TELL_DESCRIPTIONS["copy_gen"]))

    if record.legibility.get("bank", 1.0) < 0.6:
        tells.append(Tell(tell_type="low_legibility", strength=10.0, region="bank", description=TELL_DESCRIPTIONS["low_legibility"]))

    if record.heat > 40:
        tells.append(Tell(tell_type="heat", strength=record.heat * 0.3, region=None, description=TELL_DESCRIPTIONS["heat"]))

    if not record.letterhead_match:
        tells.append(Tell(tell_type="letterhead", strength=14.0, region="header", description=TELL_DESCRIPTIONS["letterhead"]))

    if record.scheme == "phantom":
        tells.append(Tell(tell_type="unknown_vendor", strength=20.0, region="header", description=TELL_DESCRIPTIONS["unknown_vendor"]))

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
    except Exception as exc:
        logger.warning("ML detector unavailable (%s), using rule-based fallback", exc)

    tells = _compute_tells(record)
    raw_suspicion = sum(t.strength for t in tells)
    return tells, raw_suspicion
