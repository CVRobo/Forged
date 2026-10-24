/* voice.js: see PLUGINS.md. Builds on window.FW from world.js.
 *
 * Talk to the NPCs with your microphone.
 *   - Hold T (rebindable: "talk" in keys.js) and speak, like a walkie-talkie.
 *   - Or click the 🎤 "Voice chat" button (top right) once to turn it on. It stays on
 *     (remembered) and pauses itself while you're seated, in a close-up or paused.
 *   - Just talk when you're within ~4 m of someone: the Web Speech API transcribes
 *     you live over your head and the nearest NPC answers (spoken + bubble).
 *   - Brenda files what you said as a cover note: FW.toOS("clerk-note", { text }).
 *   - Gus gets suspicious if you chat him up while carrying the envelope.
 *   - Shouting (mic volume) near the boss raises his suspicion: "Keep it down!"
 *   - Needs Chrome or Edge over http (not file://); NPC voices are ignored by the mic.
 *
 * Swap in a real brain later: FW.voice.setResponder(async (npcName, text, ctx) => "reply"). */
(() => {
"use strict";
const FW = window.FW;
if (!FW) return;

const { P, B, CINE, player, npcs } = FW;
const HEAR_RANGE = 4, BOSS_RANGE = 6;
const LOUD_RMS = .16, LOUD_HOLD = .25; // sustained shouting, in seconds
const NAMES = { kevin: "Kevin", dana: "Dana", clerk: "Brenda", inspector: "Gus", boss: "the boss" };

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ======================= Replies (swap respond() for an LLM later) ======================= */

const LINES = {
  kevin: {
    rules: [
      [/\b(hi|hey|hello|morning|sup|yo)\b/, ["Oh hey! Did you see my fantasy spreadsheet league?", "Heyyy! Want a gummy bear? It's from Tuesday."]],
      [/invoice|forg|fake|fraud|money|cash|steal/, ["Invoices? I just rename mine final_FINAL_v2. Works every time.", "Money? I found a quarter in the copier once. Best day of my life."]],
      [/boss|manager/, ["Shh! He can hear spreadsheets.", "He told me my tie was 'a choice'. I think that's a compliment?"]],
      [/lunch|food|pizza|eat|hungry|coffee/, ["I brought soup. In a mug. Again.", "There's cake in the break room! Or there was. I was there."]],
      [/help|favor|cover/, ["I can help! I know Ctrl+C AND Ctrl+V.", "Cover for you? Sure! What are we covering? Is it a surprise party?"]],
    ],
    other: ["Totally. Wait, what?", "Ha! Classic. ...I didn't hear any of that.", "You should put that in a memo. I love memos.", "Brb, my screensaver needs me."],
  },
  dana: {
    rules: [
      [/\b(hi|hey|hello|morning|sup|yo)\b/, ["Mm.", "Hello. Make it quick."]],
      [/invoice|forg|fake|fraud|steal/, ["I didn't hear that. I'm very busy not hearing things.", "If you're doing what I think you're doing, I want plausible deniability and a muffin."]],
      [/money|cash|cut|split|share/, ["Cut me in or keep me out. Pick fast.", "Twenty percent and I forget your face."]],
      [/boss|manager/, ["He's done three laps. He's counting the staplers.", "He walks the same loop every time. Like a Roomba with a mustache."]],
      [/gus|inspector/, ["Gus approves anything that smells like pie.", "Gus is learning. That's what worries me."]],
    ],
    other: ["Fascinating. Truly.", "I have eleven tabs open and none of them are you.", "Is this going to be a whole thing?", "Noted. Filed. Forgotten."],
  },
  clerk: {
    rules: [
      [/urgent|rush|asap|quick|now/, ["Urgent is a feeling, hon, not a deadline. I'll note it anyway.", "Rush job? I'll write it down between bites."]],
      [/note|memo|cover|file|approve|sign/, ["On lunch, hon. But I'll clip it to the file.", "Sure, sure. One cover note, coming up. With a little mustard stain."]],
      [/lunch|sandwich|food|eat|hungry/, ["It's tuna. Don't judge me.", "Lunch is a state of mind, sweetie."]],
      [/\b(hi|hey|hello|morning)\b/, ["Hi hon! I'm on lunch, but go on.", "Mmhm? Talk while I chew."]],
    ],
    other: ["Mmhm. I'll put that in the note: \"{q}\".", "Got it, \"{q}\". Very official.", "Writing it down: \"{q}\". Don't tell anyone I worked during lunch."],
  },
  inspector: {
    rules: [
      [/pie|cake|donut|doughnut|cookie|snack/, ["Pie? Where?!", "Don't tempt me. I'm on a pie-free diet. Since 10am."]],
      [/invoice|tray|check|inspect|approve|paid/, ["Put it in the IN tray. I read every invoice. Mostly.", "I've got a stamp and I'm not afraid to use it."]],
      [/smart|learn|upgrade|version|ai|robot/, ["I've been learning. From you, mostly.", "Every trick I see, I remember. Every. Single. One."]],
      [/\b(hi|hey|hello|morning)\b/, ["Hello, citizen of accounts payable.", "Hi. Did you know I have a stapler?"]],
    ],
    other: ["Mmm... is it lunch yet?", "Interesting. I'll be watching. I'm always watching.", "Is that so. Hm. Hmm."],
    carrying: ["Why are you holding that envelope so... casually?", "That envelope is sweating. Envelopes don't sweat.", "Chatting me up first? Hmm. Noted. Very noted.", "You're being awfully friendly for someone holding paperwork."],
  },
  boss: {
    rules: [
      [/\b(hi|hey|hello|morning)\b/, ["Don't 'hi' me. Hi me with results.", "Morning. It's 3pm."]],
      [/raise|promotion|bonus|vacation|day off/, ["A raise? Raise your output.", "Vacation? You're ON vacation. From working, apparently."]],
      [/sorry|apolog/, ["Sorry doesn't hit quarterly targets.", "Don't be sorry. Be productive."]],
      [/invoice|report|working|busy|spreadsheet/, ["Good. Keep working. I'll know if you don't.", "Spreadsheets. I love spreadsheets. Show me one later."]],
    ],
    other: ["Is that a work conversation? It doesn't sound like a work conversation.", "Uh huh. Back to your desk.", "I'm going to pretend I didn't hear that. For now."],
  },
};
const lastLine = {};
function pickFresh(name, list) {
  if (list.length < 2) return list[0];
  let s;
  do s = list[Math.floor(Math.random() * list.length)]; while (s === lastLine[name]);
  lastLine[name] = s;
  return s;
}
/**
 * respond(npcName, text, ctx) -> reply string (or a Promise of one).
 * npcName is a key of FW.npcs: kevin, dana, clerk, inspector, boss.
 * ctx: { carrying, phase, sus, shouted }. Keyword matching for now; swap for Claude later.
 */
function respond(npcName, text, ctx = {}) {
  const book = LINES[npcName];
  if (!book) return "...";
  const low = String(text || "").toLowerCase();
  if (npcName === "inspector" && ctx.carrying) return pickFresh(npcName, book.carrying);
  if (npcName === "boss" && ctx.shouted) return pickFresh(npcName, ["Keep it down! People are working. Allegedly.", "This is an OFFICE, not a sports bar!"]);
  let list = book.other;
  for (const [re, lines] of book.rules) if (re.test(low)) { list = lines; break; }
  const q = String(text).trim().slice(0, 40) + (String(text).trim().length > 40 ? "…" : "");
  return pickFresh(npcName, list).replace("{q}", q);
}
let responder = respond;

/* ======================= Speech synthesis ======================= */

const VOICE = {
  kevin: { pitch: 1.6, rate: 1.2 },
  dana: { pitch: .85, rate: .95 },
  clerk: { pitch: 1.25, rate: .9 },
  inspector: { pitch: .6, rate: .85 },
  boss: { pitch: .35, rate: 1.05 },
};
function speak(name, text) {
  try {
    // If server-backed TTS is active, skip browser speech synthesis
    if (FW.voice && FW.voice._serverTTS) return;
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") return;
    const snd = FW.sound;
    if (snd && snd.muted) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = VOICE[name] || { pitch: 1, rate: 1 };
    u.pitch = v.pitch; u.rate = v.rate;
    u.volume = snd ? Math.max(0, Math.min(1, snd.volume)) : .8;
    const voices = synth.getVoices ? synth.getVoices().filter(x => /^en/i.test(x.lang)) : [];
    if (voices.length) {
      const idx = Object.keys(VOICE).indexOf(name);
      u.voice = voices[Math.max(0, idx) % voices.length];
    }
    synth.speak(u);
  } catch (e) { /* speech is a bonus */ }
}

/* ======================= Who hears you, and what happens ======================= */

function nearestNpc(range) {
  const pp = player.g.position;
  let best = null, bestD = range;
  for (const key in npcs) {
    const ch = npcs[key];
    if (!ch || !ch.g || !ch.g.visible) continue;
    const d = Math.hypot(ch.g.position.x - pp.x, ch.g.position.z - pp.z);
    if (d < bestD) { bestD = d; best = key; }
  }
  return best;
}
function bossNear() {
  const boss = npcs.boss;
  if (!boss || !boss.g.visible || B.state === "wait") return false;
  const pp = player.g.position;
  return Math.hypot(boss.g.position.x - pp.x, boss.g.position.z - pp.z) < BOSS_RANGE;
}
let lastShush = -1e9;
function shushed() {
  const now = performance.now();
  if (now - lastShush < 4000) return;
  lastShush = now;
  B.sus = Math.min(.95, (B.sus || 0) + .35);
  FW.say(npcs.boss, "Keep it down!", 1800);
  FW.sfx("huh");
}

let shoutedThisTurn = false;
function deliver(text) {
  text = String(text || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (!text) { FW.say(player, "…", 900); return; }
  FW.say(player, esc(text), 3000);
  const who = nearestNpc(HEAR_RANGE);
  const shouted = shoutedThisTurn;
  shoutedThisTurn = false;
  if (!who) return;

  if (who === "clerk") {
    FW.toOS("clerk-note", { text });
    FW.wtoast("📝 Brenda jotted that down as a cover note", "good");
  }
  const ctx = { carrying: !!P.carrying, phase: P.phase, sus: B.sus, shouted };
  let reply;
  try { reply = responder(who, text, ctx); } catch (e) { reply = respond(who, text, ctx); }
  Promise.resolve(reply).catch(() => respond(who, text, ctx)).then(r => {
    r = String(r || "...");
    setTimeout(() => {
      FW.say(npcs[who], esc(r), Math.min(6000, 2200 + r.length * 45));
      npcTalkingUntil = performance.now() + 600 + r.length * 70;
      speak(who, r);
      if (who === "inspector" && ctx.carrying) FW.sfx("huh");
    }, 550);
  });
}

/* ======================= UI: hands-free mic toggle ======================= */
/* Voice chat is mic-only: turn it on once with the 🎤 button (top right) and
 * just talk when you're near someone. No key to hold, no typing box. */

const css = document.createElement("style");
css.textContent = `
#voice-pill { position: fixed; right: 16px; top: 16px; z-index: 6; display: flex; align-items: center; gap: 8px; cursor: pointer;
  background: var(--card, #fffaf0); border: 3px solid #1b1b1b; border-radius: 22px; padding: 6px 12px; font: 700 13px var(--ui, monospace);
  box-shadow: 3px 3px 0 #1b1b1b; user-select: none; transition: opacity .3s; }
#voice-pill:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 #1b1b1b; }
#voice-pill .dot { width: 11px; height: 11px; border-radius: 50%; background: #aaa; }
#voice-pill.on .dot { background: #e0352b; animation: voicePulse 1.2s infinite; }
#voice-pill.heard .dot { background: #3fae6a; }
#voice-pill .meter { width: 54px; height: 8px; border: 2px solid #1b1b1b; border-radius: 4px; overflow: hidden; background: #eee; display: none; }
#voice-pill.on .meter { display: block; }
#voice-pill .meter i { display: block; height: 100%; width: 100%; background: #3fae6a; transform-origin: left; transform: scaleX(0); }
#voice-pill.loud .meter i { background: #e0352b; }
#voice-pill.off-limits { opacity: .55; cursor: help; }
body.seated #voice-pill, #start:not(.hide) ~ #voice-pill { opacity: 0; pointer-events: none; }
@keyframes voicePulse { 50% { opacity: .3; } }
`;
document.head.appendChild(css);

const mic = document.createElement("div");
mic.id = "voice-pill";
mic.title = "Voice chat: talk to whoever is next to you with your microphone";
mic.innerHTML = `<span class="dot"></span><span class="lbl"></span><span class="meter"><i></i></span>`;
document.body.appendChild(mic);
const meterBar = mic.querySelector(".meter i");
const micLabel = mic.querySelector(".lbl");
const K = window.ForgedKeys;
const offLabel = () => `🎤 Hold ${K ? K.label("talk") : "T"} to talk`;
micLabel.textContent = offLabel();
if (K && K.onChange) K.onChange(() => { if (!enabled && !srUnsupported) micLabel.textContent = offLabel(); });

/* ======================= Microphone level (getUserMedia analyser) ======================= */

let stream = null, source = null, analyser = null, micDenied = false, micReq = 0;
const levelBuf = new Float32Array(1024);
let loudFor = 0, shownLevel = -1;

function startAnalyser() {
  if (micDenied || stream || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  const ctx = FW.audio();
  if (!ctx) return;
  const req = ++micReq;
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } }).then(s => {
    if (req !== micReq || !listening) { s.getTracks().forEach(t => t.stop()); return; } // turned off meanwhile
    stream = s;
    try {
      if (ctx.state === "suspended") ctx.resume();
      source = ctx.createMediaStreamSource(s);
      analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
      source.connect(analyser); // not connected to the speakers
    } catch (e) { stopAnalyser(); }
  }).catch(() => { micDenied = true; setEnabled(false, "Microphone blocked: allow it in the address bar to talk"); });
}
function stopAnalyser() {
  micReq++;
  try { if (source) source.disconnect(); } catch (e) {}
  if (stream) try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  stream = source = analyser = null;
  loudFor = 0; shownLevel = -1;
  meterBar.style.transform = "scaleX(0)";
  mic.classList.remove("loud");
}

FW.onUpdate(dt => {
  if (!analyser) return;
  if (analyser.getFloatTimeDomainData) analyser.getFloatTimeDomainData(levelBuf);
  else return;
  let sum = 0;
  for (let i = 0; i < levelBuf.length; i++) sum += levelBuf[i] * levelBuf[i];
  const rms = Math.sqrt(sum / levelBuf.length);
  const lvl = Math.min(1, rms / .25);
  if (Math.abs(lvl - shownLevel) > .03) {
    shownLevel = lvl;
    meterBar.style.transform = "scaleX(" + lvl.toFixed(2) + ")";
    mic.classList.toggle("loud", rms > LOUD_RMS);
  }
  loudFor = rms > LOUD_RMS ? loudFor + dt : Math.max(0, loudFor - dt * 2);
  if (loudFor > LOUD_HOLD && bossNear()) { shoutedThisTurn = true; shushed(); loudFor = 0; }
});

/* ======================= Speech recognition (always listening while on) ======================= */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const srUnsupported = !SR || location.protocol === "file:";
let rec = null, enabled = false, listening = false, interim = "";
let pttHeld = false, stopping = false; // push-to-talk key held / finishing the last sentence after release
let npcTalkingUntil = 0; // ignore what the speakers say (NPC voices) so they don't answer themselves

function store(v) { try { localStorage.setItem("forged.voice", v ? "1" : "0"); } catch (e) {} }
function stored() { try { return localStorage.getItem("forged.voice") === "1"; } catch (e) { return false; } }

function getRec() {
  if (rec) return rec;
  rec = new SR();
  rec.lang = navigator.language || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = e => {
    // holding the key means you're the one talking, so don't drop it as NPC echo
    const npcSpeaking = !pttHeld && ((window.speechSynthesis && speechSynthesis.speaking) || performance.now() < npcTalkingUntil);
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (npcSpeaking) continue;
      if (r.isFinal) {
        const text = r[0].transcript.trim();
        if (text && nearestNpc(HEAR_RANGE)) deliver(text);  // only talk to someone who's there
        else if (text && (pttHeld || stopping)) FW.say(player, "🎙 " + esc(text) + " <small>(nobody heard you, get closer)</small>", 2200);
        shoutedThisTurn = false;
      } else interim += r[0].transcript;
    }
    // show what you're saying only when someone can hear it
    if (interim.trim() && (nearestNpc(HEAR_RANGE) || pttHeld)) {
      FW.say(player, "🎙 " + esc(interim.trim()) + "…", 1500);
      mic.classList.add("heard"); clearTimeout(getRec.heardT); getRec.heardT = setTimeout(() => mic.classList.remove("heard"), 600);
    }
  };
  rec.onerror = e => {
    const err = e && e.error;
    if (err === "no-speech" || err === "aborted") return;
    if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") setEnabled(false, "Microphone blocked: allow it in the address bar to talk");
    else if (err === "network") setEnabled(false, "Voice chat needs an internet connection (browser speech service)");
    else if (err === "language-not-supported") setEnabled(false, "Your browser language isn't supported for voice chat");
  };
  rec.onend = () => { // Chrome stops after pauses: keep going
    listening = false;
    if (stopping) { stopping = false; stopAnalyser(); }
    if (shouldListen()) startListening();
  };
  return rec;
}
function shouldListen() { return (enabled || pttHeld) && P.started && !P.seated && !CINE.active && !P.paused; }
function startListening() {
  if (listening || srUnsupported) return;
  try { getRec().start(); listening = true; }
  catch (e) { if (e && e.name === "InvalidStateError") listening = true; else return; }
  startAnalyser();
}
function stopListening() {
  if (!listening && !stream) return;
  listening = false;
  try { rec && rec.abort(); } catch (e) {}
  stopAnalyser();
}
function setEnabled(on, why) {
  enabled = !!on && !srUnsupported;
  store(enabled);
  mic.classList.toggle("on", enabled);
  micLabel.textContent = enabled ? "🎤 Voice chat: on" : offLabel();
  if (why) FW.wtoast(why, "bad");
  if (!enabled) stopListening();
}

if (srUnsupported) {
  mic.classList.add("off-limits");
  micLabel.textContent = "🎤 Voice chat: Chrome/Edge only";
}
mic.addEventListener("click", () => {
  if (srUnsupported) {
    FW.wtoast(location.protocol === "file:" ? "Voice chat needs the local server (python -m http.server), not file://" : "Voice chat needs Chrome or Edge", "bad");
    return;
  }
  try { if (FW.sound && FW.sound.ensure) FW.sound.ensure(); } catch (e) {}
  setEnabled(!enabled);
  if (enabled) FW.wtoast("Voice chat on: walk up to someone and just talk", "good");
});
// it was on last time: turn it back on with the "Clock in" click (browsers need a click before using the mic)
const startBtn = document.getElementById("btn-start");
if (startBtn && stored() && !srUnsupported) startBtn.addEventListener("click", () => setEnabled(true));

/* push-to-talk: hold the key, speak, let go; the last sentence still gets through */
const isTalkKey = e => K ? K.matches("talk", e) : e.code === "KeyT";
function typing(e) { const el = e.target; return !!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)); }
addEventListener("keydown", e => {
  if (e.repeat || pttHeld || !isTalkKey(e) || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if ((K && K.isOpen && K.isOpen()) || (window.ForgedMenu && ForgedMenu.isOpen())) return;
  if (!P.started || P.seated || CINE.active) return;
  if (srUnsupported) { mic.click(); return; } // explains why (browser / file://)
  try { if (FW.sound && FW.sound.ensure) FW.sound.ensure(); } catch (err) {}
  pttHeld = true; stopping = false;
  mic.classList.add("on");
  startListening();
});
function releaseTalk() {
  if (!pttHeld) return;
  pttHeld = false;
  if (!enabled) {
    mic.classList.remove("on");
    if (listening) { stopping = true; try { rec.stop(); } catch (err) { stopListening(); } } // stop() still delivers the final words
  }
}
addEventListener("keyup", e => { if (isTalkKey(e)) releaseTalk(); });
addEventListener("blur", releaseTalk);

// follow the game: mic off while seated, during the booth close-up or the pause menu
FW.onUpdate(() => {
  if (shouldListen()) startListening(); else if (listening && !stopping) stopListening();
});

/* ======================= Public API ======================= */

FW.voice = {
  respond,                                   // the built-in keyword replies
  setResponder(fn) { responder = typeof fn === "function" ? fn : respond; }, // fn(npcName, text, ctx) -> string | Promise<string>
  say: deliver,                              // FW.voice.say("hello") as if the player spoke
  speak,                                     // speak(npcName, text) with that NPC's voice
  get enabled() { return enabled; },
  setEnabled,
  names: NAMES,
};

})();
