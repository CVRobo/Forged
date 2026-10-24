/* voice-server.js: Server-backed voice for the 3D prototype.
 *
 * Drop this script AFTER voice.js in index.html. It swaps the local
 * keyword responder for server-backed STT → Claude NPC brain → TTS.
 *
 * Text path: setResponder() calls POST /npc/chat — works in all browsers.
 * Voice path: MediaRecorder captures mic → POST /npc/voice → plays TTS reply.
 *
 * Falls back gracefully: if the server is unreachable the original keyword
 * responder (voice.js) answers, and any line without Cartesia audio (no
 * CARTESIA_API_KEY, a failed or slow call) is spoken by the browser's voice. */
(() => {
"use strict";
const FW = window.FW;
if (!FW || !FW.voice) return;

const API_BASE = window.FORGED_API || "http://localhost:8000";
const CHAT_TIMEOUT = 8000, SPEAK_TIMEOUT = 4000; // ms; after that the local brain / browser voice takes over

function _post(path, body, ms) {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), ms); // also bounds reading the body
    return fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
    });
}

// ---------------------------------------------------------------------------
// The NPC round: started on first use for the level you're playing, and
// replaced when it's gone (Redis restarts with every deploy and free-plan
// sleep) or when you switch level. A failed start is retried on the next line.
// ---------------------------------------------------------------------------

const ROUND_KEY = "forged.npcRound";
let _round = _loadRound(); // { id, level } or null
let _starting = null;

function _loadRound() {
    try { return JSON.parse(sessionStorage.getItem(ROUND_KEY)) || null; } catch (e) { return null; }
}
function _saveRound(r) {
    _round = r;
    try { r ? sessionStorage.setItem(ROUND_KEY, JSON.stringify(r)) : sessionStorage.removeItem(ROUND_KEY); } catch (e) {}
}
const _level = () => (FW.P && FW.P.level) || 1;

async function _startRound(level) {
    try {
        const res = await _post("/round/start", { level }, CHAT_TIMEOUT);
        if (!res.ok) return null;
        const data = await res.json();
        const id = data.round_id || data.roundId;
        if (!id) return null;
        _saveRound({ id, level });
        console.log("[voice-server] started NPC round:", id);
        return id;
    } catch (e) {
        console.warn("[voice-server] round/start failed:", e);
        return null;
    }
}

function _ensureRound() {
    if (_round && _round.level === _level()) return Promise.resolve(_round.id);
    if (!_starting) _starting = _startRound(_level()).finally(() => { _starting = null; });
    return _starting;
}

// ---------------------------------------------------------------------------
// Text responder: replaces keyword matching with server /npc/chat + TTS
// ---------------------------------------------------------------------------

FW.voice.setResponder(async (npcName, text, ctx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
        const roundId = await _ensureRound();
        if (!roundId) break;
        try {
            const res = await _post("/npc/chat", { round_id: roundId, npc: npcName, text }, CHAT_TIMEOUT);
            if (res.status === 404 && attempt === 0) { _saveRound(null); continue; } // round expired or Redis restarted
            if (!res.ok) throw new Error(`${res.status}`);
            const data = await res.json();

            // Apply gameplay effects in the 3D world
            _applyEffects(data);

            // Fetch this line's audio before voice.js shows and speaks it, so voice and bubble stay together
            await _prepareSpeech(npcName, data.reply, roundId);

            return data.reply;
        } catch (e) {
            console.warn("[voice-server] /npc/chat failed, using local fallback:", e);
            break;
        }
    }
    return FW.voice.respond(npcName, text, ctx);
});

// ---------------------------------------------------------------------------
// Speech: the NPC's Cartesia voice when the server has audio for the line,
// otherwise voice.js speaks it with the browser's voice
// ---------------------------------------------------------------------------

const _clips = {}; // npc -> { text, b64 }: the line voice.js is about to speak, already synthesized

async function _prepareSpeech(npcName, replyText, roundId) {
    delete _clips[npcName];
    if (FW.sound && FW.sound.muted) return; // nobody hears it: don't pay for it
    try {
        const res = await _post("/npc/speak", { npc: npcName, text: replyText, round_id: roundId }, SPEAK_TIMEOUT);
        if (!res.ok) return;
        const data = await res.json();
        if (data.audio_b64) _clips[npcName] = { text: String(replyText || "..."), b64: data.audio_b64 };
    } catch (e) { /* no server audio: the browser voice speaks the line */ }
}

// voice.js speak() asks this first; true means the line is playing from the server
FW.voice.serverSpeak = (npcName, text) => {
    const clip = _clips[npcName];
    if (!clip || clip.text !== text) return false;
    delete _clips[npcName];
    _playAudio(clip.b64, () => FW.voice.speak(npcName, text)); // blocked playback (autoplay rules): browser voice
    return true;
};

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
        FW.wtoast(`💡 ${data.npc_name}: "${data.intel}"`, "good");
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

            const roundId = await _ensureRound();
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

function _playAudio(b64, onFail) {
    try {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        const snd = FW.sound;
        if (snd) audio.volume = Math.max(0, Math.min(1, snd.muted ? 0 : snd.volume));
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play().catch(() => { URL.revokeObjectURL(url); if (onFail) onFail(); });
    } catch (e) { if (onFail) onFail(); }
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
