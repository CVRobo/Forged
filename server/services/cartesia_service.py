"""Cartesia STT/TTS wrapper for voice-powered NPC chat.

Requires CARTESIA_API_KEY in env. Falls back gracefully when the key is missing
(the stub server never calls these functions).

Uses Cartesia REST APIs via httpx (no SDK needed):
- STT: POST https://api.cartesia.ai/stt  (multipart form, model ink-whisper)
- TTS: POST https://api.cartesia.ai/tts/bytes  (JSON body, model sonic-3.6)
"""

from __future__ import annotations

import base64
import logging
import re

import httpx

from server import config

logger = logging.getLogger(__name__)

_CARTESIA_BASE = "https://api.cartesia.ai"
_CARTESIA_VERSION = "2026-08-14"
_STT_MODEL = "ink-whisper"
_TTS_MODEL = "sonic-3.6"
_TTS_MAX_CHARS = 200  # keep TTS calls short to conserve API usage

# Patterns that TTS engines choke on — strip before sending
_ACTION_RE = re.compile(r"\*[^*]+\*")          # *chews*, *sighs*, etc.
_FILLER_RE = re.compile(                        # Mmm, Hmm, Uh-huh, etc.
    r"\b(mm+h*|hm+|uh[ -]?huh|um+|er+|ugh+)\b\.{0,3}",
    re.IGNORECASE,
)
_ELLIPSIS_RE = re.compile(r"\.{2,}|…")         # ... and …
_DASH_RE = re.compile(r"\s*[—–]\s*")            # em/en dashes → comma
_MULTI_SPACE = re.compile(r"  +")


def _clean_for_tts(text: str) -> str:
    """Sanitise dialogue text so TTS reads it naturally."""
    text = _ACTION_RE.sub("", text)
    text = _FILLER_RE.sub("", text)
    text = _ELLIPSIS_RE.sub(". ", text)
    text = _DASH_RE.sub(", ", text)
    text = _MULTI_SPACE.sub(" ", text).strip()
    # Remove leading/trailing punctuation junk left over
    text = text.strip(" ,.")
    return text


# Reusable async client (created lazily)
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        if not config.CARTESIA_API_KEY:
            raise RuntimeError("CARTESIA_API_KEY not set")
        _client = httpx.AsyncClient(
            base_url=_CARTESIA_BASE,
            headers={
                "Authorization": f"Bearer {config.CARTESIA_API_KEY}",
                "Cartesia-Version": _CARTESIA_VERSION,
            },
            timeout=30.0,
        )
    return _client


async def speech_to_text(audio_bytes: bytes, mimetype: str = "audio/webm") -> str:
    """Transcribe audio bytes using Cartesia ink-whisper STT.

    Args:
        audio_bytes: Raw audio data (webm/opus from browser MediaRecorder).
        mimetype: MIME type of the audio.

    Returns:
        Transcribed text string.
    """
    client = _get_client()

    # Cartesia STT expects multipart form upload
    ext = "webm" if "webm" in mimetype else "wav"
    files = {"file": (f"audio.{ext}", audio_bytes, mimetype)}
    data = {"model": _STT_MODEL, "language": "en"}

    response = await client.post("/stt", files=files, data=data)
    response.raise_for_status()

    result = response.json()
    return result.get("text", "")


async def text_to_speech(text: str, voice: str = "a0e99841-438c-4a64-b679-ae501e7d6091") -> bytes:
    """Generate speech audio from text using Cartesia sonic TTS.

    Args:
        text: The NPC's reply text.
        voice: Cartesia voice UUID.

    Returns:
        Raw audio bytes (mp3).
    """
    client = _get_client()

    # Clean up dialogue quirks that TTS reads badly
    text = _clean_for_tts(text)
    if not text:
        text = "Okay."

    # Truncate to keep API usage low — NPC lines are short by design
    if len(text) > _TTS_MAX_CHARS:
        text = text[:_TTS_MAX_CHARS].rsplit(" ", 1)[0] + "..."

    payload = {
        "model_id": _TTS_MODEL,
        "transcript": text,
        "voice": {"mode": "id", "id": voice},
        "output_format": {
            "container": "mp3",
            "bit_rate": 64000,
            "sample_rate": 24000,
        },
    }

    response = await client.post(
        "/tts/bytes",
        json=payload,
        headers={"Accept": "audio/mpeg"},
    )
    response.raise_for_status()

    return response.content


def encode_audio(audio_bytes: bytes) -> str:
    """Base64-encode audio bytes for JSON transport."""
    return base64.b64encode(audio_bytes).decode("ascii")


def decode_audio(audio_b64: str) -> bytes:
    """Decode base64 audio from the client."""
    return base64.b64decode(audio_b64)
