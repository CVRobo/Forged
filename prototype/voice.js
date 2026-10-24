/* voice.js: see PLUGINS.md. Builds on window.FW from world.js.
 *
 * Talk to the NPCs with your microphone.
 *   - Hold T: push-to-talk. The Web Speech API transcribes you live over your head.
 *   - Release T: the nearest NPC within ~4 m hears you and answers (spoken + bubble).
 *   - Brenda files what you said as a cover note: FW.toOS("clerk-note", { text }).
 *   - Gus gets suspicious if you chat him up while carrying the envelope.
 *   - Shouting (mic volume) near the boss raises his suspicion: "Keep it down!"
 *   - No speech recognition or no mic permission (Firefox, file://, denied)? T opens a
 *     small text box instead that does the same thing. ALL CAPS counts as shouting.
 *
 * Swap in a real brain later: FW.voice.setResponder(async (npcName, text, ctx) => "reply").
 * The microphone is only requested the first time the player presses T. */
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
  if (!who) { FW.wtoast("Nobody heard you. Get closer to someone."); return; }

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
      speak(who, r);
      if (who === "inspector" && ctx.carrying) FW.sfx("huh");
    }, 550);
  });
}

/* ======================= UI: mic indicator + text fallback ======================= */

const css = document.createElement("style");
css.textContent = `
#voice-mic { position: fixed; left: 50%; bottom: 70px; transform: translateX(-50%); z-index: 9; display: none; align-items: center; gap: 10px;
  background: #fff; border: 3px solid #1b1b1b; border-radius: 22px; padding: 6px 14px; font-weight: 700; font-size: 13px; box-shadow: 3px 3px 0 #1b1b1b; pointer-events: none; }
#voice-mic.on { display: flex; }
#voice-mic .dot { width: 12px; height: 12px; border-radius: 50%; background: #e0352b; animation: voicePulse 1s infinite; }
#voice-mic .meter { width: 70px; height: 8px; border: 2px solid #1b1b1b; border-radius: 4px; overflow: hidden; background: #eee; }
#voice-mic .meter i { display: block; height: 100%; width: 100%; background: #3fae6a; transform-origin: left; transform: scaleX(0); }
#voice-mic.loud .meter i { background: #e0352b; }
@keyframes voicePulse { 50% { opacity: .3; } }
#voice-box { position: fixed; left: 50%; bottom: 70px; transform: translateX(-50%); z-index: 9; display: none; gap: 6px; align-items: center;
  background: #fff; border: 3px solid #1b1b1b; border-radius: 14px; padding: 6px 8px; box-shadow: 3px 3px 0 #1b1b1b; }
#voice-box.on { display: flex; }
#voice-box input { width: min(360px, 70vw); border: 2px solid #1b1b1b; border-radius: 8px; padding: 6px 8px; font: inherit; font-size: 14px; }
#voice-box small { font-size: 11px; opacity: .7; white-space: nowrap; }
`;
document.head.appendChild(css);

const mic = document.createElement("div");
mic.id = "voice-mic";
mic.innerHTML = `<span class="dot"></span><span class="lbl">Listening… release T</span><span class="meter"><i></i></span>`;
document.body.appendChild(mic);
const meterBar = mic.querySelector(".meter i");
const micLabel = mic.querySelector(".lbl");

const box = document.createElement("form");
box.id = "voice-box";
box.innerHTML = `<input type="text" maxlength="240" autocomplete="off" placeholder="Say something to whoever is nearby…"><small>Enter send · Esc cancel</small>`;
document.body.appendChild(box);
const boxInput = box.querySelector("input");

const controls = document.getElementById("controls");
if (controls) controls.insertAdjacentHTML("beforeend", " · <kbd>T</kbd> talk");

// keep the world from seeing keys typed in the box (no walking, no E)
["keydown", "keyup"].forEach(ev => boxInput.addEventListener(ev, e => {
  e.stopPropagation();
  if (ev === "keydown" && e.key === "Escape") { e.preventDefault(); closeBox(); }
}));
box.addEventListener("submit", e => {
  e.preventDefault();
  const text = boxInput.value;
  // typing in ALL CAPS is the keyboard version of shouting
  const letters = text.replace(/[^a-z]/gi, "");
  if (letters.length >= 4 && letters === letters.toUpperCase() && bossNear()) { shoutedThisTurn = true; shushed(); }
  closeBox();
  deliver(text);
});
function openBox() {
  if (box.classList.contains("on")) return;
  P.keys.clear();
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
  boxInput.value = "";
  box.classList.add("on");
  setTimeout(() => boxInput.focus(), 0);
}
function closeBox() {
  box.classList.remove("on");
  boxInput.blur();
}

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
    if (req !== micReq || !talking) { s.getTracks().forEach(t => t.stop()); return; } // released already
    stream = s;
    try {
      if (ctx.state === "suspended") ctx.resume();
      source = ctx.createMediaStreamSource(s);
      analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
      source.connect(analyser); // not connected to the speakers
    } catch (e) { stopAnalyser(); }
  }).catch(() => { micDenied = true; });
}
function stopAnalyser() {
  micReq++;
  try { if (source) source.disconnect(); } catch (e) {}
  if (stream) try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  stream = source = analyser = null;
  loudFor = 0; shownLevel = -1;
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

/* ======================= Speech recognition (push-to-talk) ======================= */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let srBroken = !SR || location.protocol === "file:";
let rec = null, talking = false, releasing = false, finished = true, finalText = "", interim = "", finishTimer = 0;

function getRec() {
  if (rec) return rec;
  rec = new SR();
  rec.lang = navigator.language || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onresult = e => {
    interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + " ";
      else interim += r[0].transcript;
    }
    const live = (finalText + interim).trim();
    if (live && !finished) FW.say(player, "🎙 " + esc(live) + "…", 1500);
  };
  rec.onerror = e => {
    const err = e && e.error;
    if (err === "no-speech" || err === "aborted") return;
    if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture" || err === "network" || err === "language-not-supported") {
      srBroken = true;
      const wasTalking = talking;
      endTalk(true);
      FW.wtoast(err === "network" ? "Speech service unreachable: type instead" : "Mic unavailable: press T to type instead", "bad");
      if (wasTalking) openBox();
    }
  };
  rec.onend = () => {
    if (talking && !releasing) { try { rec.start(); return; } catch (e) {} } // Chrome stops on long pauses
    finish();
  };
  return rec;
}

function beginTalk() {
  if (talking) return;
  clearTimeout(finishTimer);
  talking = true; releasing = false; finished = false; finalText = ""; interim = ""; shoutedThisTurn = false;
  try { if (FW.sound && FW.sound.ensure) FW.sound.ensure(); } catch (e) {}
  try { getRec().start(); }
  catch (e) {
    if (!(e && e.name === "InvalidStateError")) { // anything but "already started"
      talking = false; srBroken = true; openBox(); return;
    }
  }
  micLabel.textContent = "Listening… release T";
  mic.classList.add("on");
  FW.say(player, "🎙 …", 1500);
  startAnalyser();
}
function releaseTalk() {
  if (!talking) return;
  releasing = true; talking = false;
  mic.classList.remove("on");
  stopAnalyser();
  try { rec && rec.stop(); } catch (e) {}
  clearTimeout(finishTimer);
  finishTimer = setTimeout(finish, 1500); // in case onend never comes
}
function endTalk(silent) {
  talking = false; releasing = true;
  mic.classList.remove("on");
  stopAnalyser();
  try { rec && rec.abort(); } catch (e) {}
  if (silent) { finished = true; clearTimeout(finishTimer); }
}
function finish() {
  if (finished) return;
  finished = true; releasing = false;
  clearTimeout(finishTimer);
  deliver((finalText + " " + interim).trim());
}

/* ======================= Keys ======================= */

function canTalk() { return P.started && !P.seated && !CINE.active; }
addEventListener("keydown", e => {
  if (e.code !== "KeyT" || e.ctrlKey || e.metaKey || e.altKey) return;
  const el = e.target;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
  if (e.repeat || !canTalk()) return;
  e.preventDefault();
  if (srBroken) openBox();
  else beginTalk();
});
addEventListener("keyup", e => { if (e.code === "KeyT") releaseTalk(); });
addEventListener("blur", () => { if (talking) releaseTalk(); });
FW.onUpdate(() => {
  // sitting down or the booth close-up cuts the mic
  if (talking && (P.seated || CINE.active)) releaseTalk();
  if (box.classList.contains("on") && (P.seated || CINE.active)) closeBox();
});

/* ======================= Public API ======================= */

FW.voice = {
  respond,                                   // the built-in keyword replies
  setResponder(fn) { responder = typeof fn === "function" ? fn : respond; }, // fn(npcName, text, ctx) -> string | Promise<string>
  say: deliver,                              // FW.voice.say("hello") as if the player spoke
  speak,                                     // speak(npcName, text) with that NPC's voice
  get usingTextBox() { return srBroken; },
  names: NAMES,
};

})();
