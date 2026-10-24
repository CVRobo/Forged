/* voice-server.js: Server-backed voice for the 3D prototype.
 *
 * Drop this script AFTER voice.js in index.html. It swaps the local
 * keyword responder for server-backed STT → Claude NPC brain → TTS.
 *
 * Text path: setResponder() calls POST /npc/chat — works in all browsers.
 * Voice path: MediaRecorder captures mic → POST /npc/voice → plays TTS reply.
 *
 * Falls back gracefully: if the server is unreachable the original keyword
 * responder (voice.js) handles everything locally. */
(() => {
"use strict";
const FW = window.FW;
if (!FW || !FW.voice) return;

const API_BASE = window.FORGED_API || "http://localhost:8000";

// ---------------------------------------------------------------------------
// Auto-start a round so NPC endpoints work from the 3D world
// ---------------------------------------------------------------------------

let _ensuringRound = null;

async function _ensureRound() {
    if (FW.roundId || sessionStorage.getItem("forged.roundId")) return;
    if (_ensuringRound) return _ensuringRound;
    _ensuringRound = (async () => {
        try {
            const res = await fetch(`${API_BASE}/round/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ level: 1 }),
            });
            if (!res.ok) return;
            const data = await res.json();
            const rid = data.round_id || data.roundId;
            if (rid) {
                FW.roundId = rid;
                sessionStorage.setItem("forged.roundId", rid);
                console.log("[voice-server] auto-started round:", rid);
            }
        } catch (e) { console.warn("[voice-server] round/start failed:", e); }
    })();
    return _ensuringRound;
}

_ensureRound();

// Tell voice.js to skip browser speechSynthesis — we handle TTS via Cartesia
FW.voice._serverTTS = true;

// ---------------------------------------------------------------------------
// Text responder: replaces keyword matching with server /npc/chat + TTS
// ---------------------------------------------------------------------------

FW.voice.setResponder(async (npcName, text, ctx) => {
    await _ensureRound();
    const roundId = FW.roundId || sessionStorage.getItem("forged.roundId");
    if (!roundId) return FW.voice.respond(npcName, text, ctx);

    try {
        // Use the voice endpoint even for typed text so we get TTS audio back.
        // Send the text as a pseudo-audio request with the transcript pre-filled.
        const res = await fetch(`${API_BASE}/npc/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ round_id: roundId, npc: npcName, text }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();

        // Apply gameplay effects in the 3D world
        _applyEffects(data);

        // TTS: fire a separate request to get audio for the reply
        _speakReply(data.reply, npcName, roundId);

        return data.reply;
    } catch (e) {
        console.warn("[voice-server] /npc/chat failed, using local fallback:", e);
        return FW.voice.respond(npcName, text, ctx);
    }
});

// Fire-and-forget TTS for text-chat replies
async function _speakReply(replyText, npcName, roundId) {
    try {
        const res = await fetch(`${API_BASE}/npc/speak`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ npc: npcName, text: replyText, round_id: roundId }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.audio_b64) _playAudio(data.audio_b64);
    } catch (e) { /* TTS is a bonus, don't block chat */ }
}

// ---------------------------------------------------------------------------
// Gameplay effect application
// ---------------------------------------------------------------------------

function _applyEffects(data) {
    const B = FW.B;
    if (!B) return;

    if (data.effect === "suspicion" && data.suspicion_delta > 0) {
        B.sus = Math.min(0.95, (B.sus || 0) + data.suspicion_delta);
        FW.sfx("huh");
    }
    if (data.effect === "persuasion" && data.persuasion_delta > 0) {
        // Store best persuasion score for the round
        FW.persuasion = Math.max(FW.persuasion || 0, data.persuasion_delta);
    }
    if (data.intel) {
        FW.wtoast(`\uD83D\uDCA1 ${data.npc_name}: "${data.intel}"`, "good");
    }
    if (data.effect === "distraction") {
        FW.wtoast(`${data.npc_name} will cover for you`, "good");
    }
}

// ---------------------------------------------------------------------------
// Voice path: MediaRecorder → /npc/voice → TTS playback
// ---------------------------------------------------------------------------

let _recorder = null;
let _recording = false;

/**
 * Start recording mic audio for an NPC voice interaction.
 * Call stopAndSend(npcName) to finish and POST to /npc/voice.
 */
function startRecording() {
    if (_recording || !navigator.mediaDevices) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        const chunks = [];
        _recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
        _recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        _recorder._chunks = chunks;
        _recorder._stream = stream;
        _recorder.start();
        _recording = true;
    }).catch(e => console.warn("[voice-server] mic access denied:", e));
}

async function stopAndSend(npcName) {
    if (!_recording || !_recorder) return null;
    _recording = false;

    return new Promise((resolve) => {
        _recorder.onstop = async () => {
            const blob = new Blob(_recorder._chunks, { type: "audio/webm" });
            _recorder._stream.getTracks().forEach(t => t.stop());
            _recorder = null;

            const roundId = FW.roundId || sessionStorage.getItem("forged.roundId");
            if (!roundId) { resolve(null); return; }

            try {
                const buf = await blob.arrayBuffer();
                const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));

                const res = await fetch(`${API_BASE}/npc/voice`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ round_id: roundId, npc: npcName, audio_b64: b64 }),
                });
                if (!res.ok) throw new Error(`${res.status}`);
                const data = await res.json();

                _applyEffects(data);

                // Play back the NPC's TTS reply
                if (data.reply_audio_b64) {
                    _playAudio(data.reply_audio_b64);
                }

                resolve(data);
            } catch (e) {
                console.warn("[voice-server] /npc/voice failed:", e);
                resolve(null);
            }
        };
        _recorder.stop();
    });
}

function _playAudio(b64) {
    try {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        const snd = FW.sound;
        if (snd) audio.volume = Math.max(0, Math.min(1, snd.muted ? 0 : snd.volume));
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play().catch(() => {});
    } catch (e) { /* audio playback is a bonus */ }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

FW.voice.server = {
    startRecording,
    stopAndSend,
    get recording() { return _recording; },
};

})();
