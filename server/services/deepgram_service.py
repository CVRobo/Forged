"""Deepgram STT/TTS wrapper for voice-powered clerk chat.

Requires DEEPGRAM_API_KEY in env. Falls back gracefully when the key is missing
(the stub server never calls these functions).
"""

from __future__ import annotations

import base64
import logging

from server import config

logger = logging.getLogger(__name__)

# Lazy-initialised client (avoids import error when key is absent)
_client = None


def _get_client():
    global _client
    if _client is None:
        if not config.DEEPGRAM_API_KEY:
            raise RuntimeError("DEEPGRAM_API_KEY not set")
        from deepgram import DeepgramClient

        _client = DeepgramClient(config.DEEPGRAM_API_KEY)
    return _client


async def speech_to_text(audio_bytes: bytes, mimetype: str = "audio/webm") -> str:
    """Transcribe audio bytes using Deepgram Nova-2.

    Args:
        audio_bytes: Raw audio data (webm/opus from browser MediaRecorder).
        mimetype: MIME type of the audio.

    Returns:
        Transcribed text string.
    """
    from deepgram import PrerecordedOptions

    client = _get_client()
    source = {"buffer": audio_bytes, "mimetype": mimetype}
    options = PrerecordedOptions(model="nova-2", smart_format=True, language="en")

    response = await client.listen.asyncrest.v("1").transcribe_file(source, options)
    transcript = (
        response.results.channels[0].alternatives[0].transcript
        if response.results.channels
        else ""
    )
    return transcript


async def text_to_speech(text: str, voice: str = "aura-asteria-en") -> bytes:
    """Generate speech audio from text using Deepgram Aura TTS.

    Args:
        text: The clerk's reply text.
        voice: Deepgram voice model ID.

    Returns:
        Raw audio bytes (mp3).
    """
    from deepgram import SpeakOptions

    client = _get_client()
    options = SpeakOptions(model=voice)

    response = await client.speak.asyncrest.v("1").stream_raw({"text": text}, options)
    # Collect all chunks
    audio_bytes = b""
    async for chunk in response.stream:
        audio_bytes += chunk
    return audio_bytes


def encode_audio(audio_bytes: bytes) -> str:
    """Base64-encode audio bytes for JSON transport."""
    return base64.b64encode(audio_bytes).decode("ascii")


def decode_audio(audio_b64: str) -> bytes:
    """Decode base64 audio from the client."""
    return base64.b64decode(audio_b64)
