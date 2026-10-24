"""Claude API wrapper with graceful fallbacks.

Every function tries Claude first and falls back to simple heuristics
so the game works even without ANTHROPIC_API_KEY set.
"""

from __future__ import annotations

import json
import logging
import random

from server import config
from server.models.schemas import InvoiceRecord

logger = logging.getLogger(__name__)

# Lazy-initialised client (no crash if key is absent)
_client = None


def _get_client():
    global _client
    if _client is None:
        if not config.ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        import anthropic

        _client = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


# ---------------------------------------------------------------------------
# 1. Score clerk text
# ---------------------------------------------------------------------------

_CLERK_SYSTEM_PROMPT = """You are {name}, an accounts-payable clerk. Your quirk: {quirk}.

A player is trying to social-engineer you into approving a fraudulent invoice.
Score their persuasion attempt from 0-100 and reply in character.

Context — known vendors: {vendors}

Respond with ONLY valid JSON (no markdown, no backticks):
{{"score": <int 0-100>, "reply": "<your in-character reply, max 2 sentences>"}}

Scoring guide:
- 70-100: They used your keywords ({keywords}) or kept it short and charming
- 35-69: Neutral attempt, nothing special
- 0-34: Too wordy, suspicious, or rude"""


def _keyword_fallback(text: str, clerk_info: dict) -> tuple[int, str]:
    """Keyword-based scoring from the stub implementation."""
    keywords = clerk_info["keywords"]
    text_lower = text.lower()
    hits = sum(1 for k in keywords if k in text_lower)
    score = 30 + hits * 25 - max(0, len(text) - 90) * 0.5 + random.randint(-10, 10)
    score = max(0, min(100, int(score)))

    if score > 60:
        tier = "good"
    elif score > 35:
        tier = "meh"
    else:
        tier = "bad"

    reply = random.choice(clerk_info["replies"][tier])
    return score, reply


async def score_clerk_text(text: str, clerk_info: dict, level: int) -> tuple[int, str]:
    """Score persuasion text. Falls back to keyword matching."""
    try:
        client = _get_client()
        vendor_names = clerk_info.get("vendor_names", "various vendors")
        system = _CLERK_SYSTEM_PROMPT.format(
            name=clerk_info["name"],
            quirk=clerk_info["quirk"],
            vendors=vendor_names,
            keywords=", ".join(clerk_info["keywords"]),
        )
        response = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=256,
            system=system,
            messages=[{"role": "user", "content": text}],
        )
        raw = response.content[0].text
        parsed = json.loads(raw)
        score = max(0, min(100, int(parsed["score"])))
        reply = str(parsed["reply"])[:500]
        return score, reply
    except Exception as exc:
        logger.debug("Claude clerk scoring failed (%s), using keyword fallback", exc)
        return _keyword_fallback(text, clerk_info)


# ---------------------------------------------------------------------------
# 2. Generate inspector line
# ---------------------------------------------------------------------------

_INSPECTOR_POOL = {
    "pass": [
        "Everything checks out. Move along.",
        "Approved. Next.",
        "Looks clean to me.",
        "Rubber-stamped. You're good.",
    ],
    "catch": [
        "Hold on. Something's off here.",
        "Flagged for review. Don't move.",
        "This doesn't add up. Explain yourself.",
        "I've seen this trick before.",
    ],
}


async def generate_inspector_line(caught: bool, level: int, version: int) -> str:
    """Generate a fresh inspector line. Falls back to pool."""
    try:
        client = _get_client()
        situation = "caught a fraudulent invoice" if caught else "let an invoice pass"
        response = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=100,
            system=(
                "You are a gruff invoice inspector (version {v}). "
                "Write ONE short line (max 15 words) reacting to the situation. "
                "Be terse and in-character. No quotes."
            ).format(v=version),
            messages=[{"role": "user", "content": f"You just {situation} at level {level}."}],
        )
        line = response.content[0].text.strip().strip('"')
        return line[:200]
    except Exception as exc:
        logger.debug("Claude inspector line failed (%s), using pool", exc)
        key = "catch" if caught else "pass"
        return random.choice(_INSPECTOR_POOL[key])


# ---------------------------------------------------------------------------
# 3. Check validity
# ---------------------------------------------------------------------------


async def check_validity(record: InvoiceRecord, case_data: dict) -> bool:
    """Validity gate: is the invoice plausible? Falls back to True."""
    try:
        client = _get_client()
        context = json.dumps({
            "company": case_data["company"],
            "vendor_banks": {v.name: v.bank for v in case_data["vendors"]},
            "vendor_domains": {v.name: v.domain for v in case_data["vendors"]},
        })
        invoice = json.dumps({
            "vendor": record.vendor,
            "bank_account": record.bank_account,
            "sender_domain": record.sender_domain,
            "amount": record.amount,
            "scheme": record.scheme,
        })
        response = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=50,
            system=(
                "You are an invoice validity checker. Given the company context and "
                "an invoice, reply ONLY 'valid' or 'invalid'. An invoice is invalid "
                "only if it's completely implausible (e.g. vendor doesn't exist at all)."
            ),
            messages=[{
                "role": "user",
                "content": f"Context: {context}\nInvoice: {invoice}",
            }],
        )
        answer = response.content[0].text.strip().lower()
        return "invalid" not in answer
    except Exception as exc:
        logger.debug("Claude validity check failed (%s), defaulting to valid", exc)
        return True


# ---------------------------------------------------------------------------
# 4. Generate memo decoy
# ---------------------------------------------------------------------------

_DECOY_POOL = [
    "Invoices printed on pink paper are always fraudulent.",
    "Any invoice with a round number is suspicious.",
    "Vendors who use Comic Sans are flagged automatically.",
    "Always reject invoices received on a Monday.",
    "Stapled invoices should be double-checked.",
    "Watch out for invoices with exactly 3 line items.",
]


async def generate_memo_decoy(level: int, real_tells: list[str]) -> str:
    """Generate a decoy memo rule. Falls back to pool."""
    try:
        client = _get_client()
        response = await client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=100,
            system=(
                "You write fake fraud-detection rules for a training exercise. "
                "Generate ONE plausible-sounding but FALSE rule (max 15 words). "
                "It should sound official but be nonsense. No quotes, just the rule text. "
                "Do NOT use any of these real patterns: {real}"
            ).format(real=", ".join(real_tells)),
            messages=[{"role": "user", "content": f"Level {level} decoy rule:"}],
        )
        return response.content[0].text.strip().strip('"')[:200]
    except Exception as exc:
        logger.debug("Claude memo decoy failed (%s), using pool", exc)
        return random.choice(_DECOY_POOL)
