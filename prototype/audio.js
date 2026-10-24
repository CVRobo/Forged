/* audio.js: see PLUGINS.md. Builds on window.FW from world.js.
 *
 * Everything is synthesized with WebAudio (no files):
 *   - office ambience: HVAC hum, distant phones, keyboard clacks near Kevin and Dana,
 *     printer hum while printing, the water cooler now and then, the boss's footsteps
 *   - adaptive "heist lounge" music: tension layers follow FW.B.sus and carrying the
 *     envelope, ducks in the booth close-up, stops on a PAID / FLAGGED sting
 *   - upgraded sound effects through FW.setSfx (footsteps change with the floor)
 *   - M mutes, [ and ] change the volume (saved in localStorage)
 * Nothing starts before the first user gesture ("Clock in"). */
(() => {
"use strict";
const FW = window.FW;
if (!FW) return;

const { P, B, CINE, player, camera, npcs } = FW;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

/* ======================= Settings (M / [ / ]) ======================= */

const KEY = "forged.audio.v1";
const S = { vol: .7, muted: false };
try {
  const s = JSON.parse(localStorage.getItem(KEY) || "null");
  if (s && typeof s === "object") {
    if (typeof s.vol === "number" && isFinite(s.vol)) S.vol = clamp(s.vol, 0, 1);
    S.muted = !!s.muted;
  }
} catch (e) { /* storage blocked: use the defaults */ }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

/* ======================= Graph ======================= */

let ctx = null, ready = false, master, sfxBus, musicBus, ambBus, stingBus, noiseBuf;
const hasPanner = () => !!(ctx && ctx.createStereoPanner);

function resumeCtx() {
  try { if (ctx && ctx.state === "suspended") { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); } } catch (e) {}
}
function gainNode(v, dest) { const g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }

// called only from a user gesture (or from an sfx, which only fires after one)
function ensure() {
  if (ready) { resumeCtx(); return true; }
  try {
    ctx = FW.audio();
    if (!ctx) return false;
    resumeCtx();
    master = gainNode(S.muted ? 0 : S.vol);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .2;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = gainNode(.9, master);
    ambBus = gainNode(.6, master);
    musicBus = gainNode(0, master);
    stingBus = gainNode(.55, master);
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    buildAmbience();
    buildMusic();
    ready = true;
  } catch (e) {
    console.warn("[forged] audio unavailable", e);
    ready = false;
    return false;
  }
  return true;
}
function applyVolume() {
  if (!ready) return;
  master.gain.setTargetAtTime(S.muted ? 0 : S.vol, ctx.currentTime, .05);
}

/* ======================= Tiny synth helpers (t = absolute ctx time) ======================= */

function panTo(p, dest) {
  if (!hasPanner() || !p) return dest;
  const n = ctx.createStereoPanner(); n.pan.value = clamp(p, -1, 1); n.connect(dest); return n;
}
// oscillator with a percussive envelope
function osc(type, f, t, d, v, dest, f2, attack = .004) {
  if (v <= .0002) return null;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + attack);
  g.gain.exponentialRampToValueAtTime(.0001, t + d);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + d + .03);
  return o;
}
// filtered noise burst
function nz(t, d, v, dest, ftype = "lowpass", freq = 2000, q = .7, f2 = 0, attack = .003) {
  if (v <= .0002) return;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  f.type = ftype; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + attack);
  g.gain.exponentialRampToValueAtTime(.0001, t + d);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random() * Math.max(0, 1.9 - d), d + .05);
}
function filt(type, freq, q, dest) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; f.connect(dest); return f; }

/* ======================= Space: rooms, distance, pan ======================= */

// main office x -13..13, z -9..9; boss office west, break room south, records room east
function roomAt(x, z) {
  if (x < -13) return "boss";
  if (x > 13) return "records";
  if (z > 9) return "break";
  return "main";
}
let spG = 0, spP = 0; // results of spatial(), kept in module vars so nothing is allocated
function spatial(x, z, range, floor = 0) {
  const pp = player.g.position;
  const dx = x - pp.x, dz = z - pp.z, d = Math.hypot(dx, dz);
  let g = Math.max(0, 1 - d / range); g *= g;
  if (roomAt(x, z) !== roomAt(pp.x, pp.z)) g *= .45; // a wall in between
  spG = Math.max(floor, g);
  const e = camera.matrixWorld.elements; // column 0 is the camera's right vector
  const rl = Math.hypot(e[0], e[2]) || 1;
  spP = d > .05 ? clamp((dx * e[0] + dz * e[2]) / (d * rl), -1, 1) * .75 : 0;
}

/* ======================= Ambience ======================= */

const PRINTER = FW.PRINTER;
const COOLER = { x: -6.5, z: 14.5 }; // break room
const PHONES = [[-10, 6], [10, -8], [4, 7], [-17, -6], [18, 6], [-3, -8]];
let printerGain = null, printerPan = null, printerOn = false, nextPrinterTick = 0;
let nextPhone = 0, nextCooler = 0, ambTick = 0;
const nextClack = [0, 0];
const CLACKERS = [npcs.kevin, npcs.dana];
let bossStepAt = 0;

function buildAmbience() {
  const t = ctx.currentTime;
  // HVAC: looping low-passed noise that slowly breathes, plus a faint mains hum
  const air = ctx.createBufferSource(); air.buffer = noiseBuf; air.loop = true;
  const airF = ctx.createBiquadFilter(); airF.type = "lowpass"; airF.frequency.value = 240; airF.Q.value = .4;
  const airG = gainNode(.07, ambBus);
  air.connect(airF); airF.connect(airG);
  const lfo = ctx.createOscillator(); lfo.frequency.value = .06;
  const lfoG = gainNode(70); lfo.connect(lfoG); lfoG.connect(airF.frequency);
  air.start(t); lfo.start(t);
  const hum = ctx.createOscillator(); hum.type = "sine"; hum.frequency.value = 59;
  hum.connect(gainNode(.012, ambBus)); hum.start(t);
  const hum2 = ctx.createOscillator(); hum2.type = "sine"; hum2.frequency.value = 118;
  hum2.connect(gainNode(.004, ambBus)); hum2.start(t);

  // printer: motor whine + paper hiss, off until FW.P.printing
  printerGain = gainNode(0);
  printerPan = hasPanner() ? ctx.createStereoPanner() : null;
  if (printerPan) { printerGain.connect(printerPan); printerPan.connect(sfxBus); } else printerGain.connect(sfxBus);
  const mot = ctx.createOscillator(); mot.type = "sawtooth"; mot.frequency.value = 96;
  const motF = ctx.createBiquadFilter(); motF.type = "lowpass"; motF.frequency.value = 520;
  mot.connect(motF); motF.connect(gainNode(.5, printerGain)); mot.start(t);
  const hiss = ctx.createBufferSource(); hiss.buffer = noiseBuf; hiss.loop = true;
  const hissF = ctx.createBiquadFilter(); hissF.type = "bandpass"; hissF.frequency.value = 1900; hissF.Q.value = 1.6;
  hiss.connect(hissF); hissF.connect(gainNode(.6, printerGain)); hiss.start(t);

  nextPhone = t + rnd(12, 30);
  nextCooler = t + rnd(20, 45);
  nextClack[0] = t + rnd(.5, 2); nextClack[1] = t + rnd(.5, 2);
}

function keyboardBurst(ch, t) {
  const p = ch.g.position;
  spatial(p.x, p.z, 11);
  if (spG < .01) return;
  const dest = panTo(spP, ambBus);
  const n = 3 + Math.floor(Math.random() * 9);
  let at = t;
  for (let k = 0; k < n; k++) {
    const space = Math.random() < .12;
    nz(at, space ? .05 : .022, (space ? .06 : .045) * spG * rnd(.6, 1), dest, "bandpass", space ? 900 : rnd(2600, 4200), space ? 1 : 2.2);
    at += rnd(.06, .16);
  }
}
function phoneRing(t) {
  const [x, z] = PHONES[Math.floor(Math.random() * PHONES.length)];
  spatial(x, z, 30, .2);
  const lp = filt("lowpass", 2200, .7, panTo(spP, ambBus));
  const v = .018 * spG;
  const cycles = Math.random() < .5 ? 2 : 1;
  for (let c = 0; c < cycles; c++) for (let b = 0; b < 2; b++) {
    const t0 = t + c * 3 + b * .45;
    for (let i = 0; i < 8; i++) osc("square", i % 2 ? 1320 : 1180, t0 + i * .045, .045, v, lp, 0, .002);
  }
}
function coolerGurgle(t) {
  spatial(COOLER.x, COOLER.z, 22, .06);
  const lp = filt("lowpass", 900, 1, panTo(spP, ambBus));
  const n = 3 + Math.floor(Math.random() * 4);
  let at = t;
  for (let i = 0; i < n; i++) {
    const f = rnd(170, 260);
    osc("sine", f, at, rnd(.08, .14), .09 * spG, lp, f * rnd(1.7, 2.4), .01);
    at += rnd(.12, .28);
  }
}
function bossStep(t, x, z) {
  spatial(x, z, 14);
  if (spG < .01) return;
  const dest = panTo(spP, ambBus);
  nz(t, .05, .12 * spG, dest, "bandpass", 1300, 2.2);
  osc("sine", 120, t, .08, .1 * spG, dest, 70);
}

function updateAmbience(t, dt) {
  // keyboards near the coworkers
  for (let i = 0; i < 2; i++) {
    if (t >= nextClack[i]) { if (CLACKERS[i]) keyboardBurst(CLACKERS[i], t + .02); nextClack[i] = t + rnd(.9, 4.5); }
  }
  if (t >= nextPhone) { phoneRing(t + .02); nextPhone = t + rnd(25, 60); }
  if (t >= nextCooler) { coolerGurgle(t + .02); nextCooler = t + rnd(30, 70); }

  // the boss's heavy shoes while he patrols
  const boss = npcs.boss;
  if (boss && boss.g.visible && B.state !== "wait" && performance.now() >= B.pauseUntil) {
    if (t >= bossStepAt) { bossStep(t + .01, boss.g.position.x, boss.g.position.z); bossStepAt = t + .4; }
  }

  // printer: update its level and pan ~10 times a second
  ambTick -= dt;
  if (ambTick <= 0) {
    ambTick = .1;
    spatial(PRINTER.x, PRINTER.z, 16, .05);
    const on = !!P.printing;
    printerGain.gain.setTargetAtTime(on ? .07 * spG : 0, t, on ? .08 : .25);
    if (printerPan) printerPan.pan.setTargetAtTime(spP, t, .1);
    if (on && !printerOn) nextPrinterTick = t + .3;
    printerOn = on;
  }
  if (printerOn && t >= nextPrinterTick) {
    nz(t + .01, .04, .05 * spG, panTo(spP, sfxBus), "bandpass", 700, 2);
    nextPrinterTick = t + .24;
  }
}

/* ======================= Music: heist lounge ======================= */

const BPM = 96, BEAT = 60 / BPM, EIGHTH = BEAT / 2, SWING = .18; // swung 8ths
// rootless jazz voicings: Dm9, G13, Cmaj9, A7b9b13
const CHORDS = [[53, 57, 60, 64], [53, 59, 64, 69], [52, 55, 59, 62], [55, 61, 65, 70]];
// walking bass, four quarters per bar, with a chromatic approach note
const BASS = [[38, 41, 45, 44], [43, 47, 50, 37], [36, 40, 43, 34], [33, 37, 40, 39]];
// tension ostinato (8ths) and its pitches per bar
const OSTI = [[74, 75], [74, 73], [72, 73], [73, 74]];
let mStep = 0, mNext = 0, mHoldUntil = 0, intensity = 0, musicTarget = -1, mTick = 0;
let chordBus, bassBus, drumBus, tenseBus, droneGain;

function buildMusic() {
  chordBus = gainNode(.8, filt("lowpass", 2600, .5, musicBus));
  bassBus = gainNode(1, filt("lowpass", 650, .8, musicBus));
  drumBus = gainNode(.9, musicBus);
  tenseBus = gainNode(0, filt("lowpass", 3000, .7, musicBus));
  // low tremolo drone: D + Eb, only audible when suspicion is high
  droneGain = gainNode(0, musicBus);
  const trem = gainNode(.5, droneGain);
  const dF = filt("lowpass", 420, 1.2, trem);
  [mtof(38), mtof(39)].forEach(f => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.connect(dF); o.start(); });
  const lfo = ctx.createOscillator(); lfo.frequency.value = 7;
  const lfoG = gainNode(.45); lfo.connect(lfoG); lfoG.connect(trem.gain); lfo.start();
  mNext = ctx.currentTime + .3;
}

function stepTime(step) { return step % 2 ? SWING * EIGHTH : 0; }

function playStep(step, t) {
  const bar = Math.floor(step / 8) % 4, pos = step % 8;
  const tt = t + stepTime(step);
  const tense = intensity;
  // brushed hats on every swung 8th; long swish on 2 and 4
  nz(tt, .045, pos % 2 ? .035 : .018, drumBus, "highpass", 6500, .7);
  if (pos === 2 || pos === 6) nz(tt, .22, .02, drumBus, "bandpass", 3200, .6, 0, .05);
  // soft kick on 1 and 3, a ghost on the "and" of 4 when tense
  if (pos === 0 || pos === 4) osc("sine", 75, tt, .16, .16, drumBus, 42);
  if (tense > .55 && pos === 7) osc("sine", 72, tt, .12, .1, drumBus, 40);
  // walking bass on the beats (8ths when tense)
  if (pos % 2 === 0) {
    const n = BASS[bar][pos / 2];
    osc("triangle", mtof(n), tt, .34, .22, bassBus, 0, .01);
    osc("sine", mtof(n + 12), tt, .2, .05, bassBus, 0, .01);
  } else if (tense > .45) {
    const n = BASS[bar][(pos - 1) / 2];
    osc("triangle", mtof(n + 12), tt, .14, .1, bassBus, 0, .006);
  }
  // Charleston comping: beat 1 and the "and" of 2
  if (pos === 0 || pos === 3) {
    const notes = CHORDS[bar], d = pos === 0 ? .5 : 1.1;
    for (let i = 0; i < notes.length; i++) {
      const f = mtof(notes[i]);
      osc("sine", f, tt + i * .008, d, .035, chordBus, 0, .012);
      osc("triangle", f * 2, tt + i * .008, d * .5, .008, chordBus, 0, .008);
    }
  }
  // tension: staccato pizzicato ostinato, a clock tick on the beats
  if (tense > .2) {
    const o = OSTI[bar][pos % 2];
    osc("square", mtof(o), tt, .07, .03, tenseBus, 0, .003);
    if (pos % 2 === 0) osc("sine", 1250, tt, .03, .025, tenseBus);
  }
}

function updateMusic(t, dt) {
  // where should the tension sit?
  let target = 0;
  if (P.phase === "carrying" || P.carrying) target = .45;
  target = Math.max(target, clamp(B.sus * 1.1, 0, 1));
  const boss = npcs.boss;
  if (boss && boss.g.visible && P.carrying) {
    const pp = player.g.position, bp = boss.g.position;
    if (Math.hypot(pp.x - bp.x, pp.z - bp.z) < 7) target = Math.max(target, .6);
  }
  intensity += (target - intensity) * Math.min(1, dt * 1.5);
  mTick -= dt;
  if (mTick <= 0) { // layer levels ~8 times a second, not every frame
    mTick = .12;
    tenseBus.gain.setTargetAtTime(intensity > .2 ? Math.min(1, intensity * 1.4) : 0, t, .3);
    droneGain.gain.setTargetAtTime(intensity > .6 ? (intensity - .6) * .12 : 0, t, .4);
  }

  // bus level: off before clock-in, ducked in the booth close-up, silent during a sting
  let lvl = .3;
  if (!P.started) lvl = 0;
  else if (t < mHoldUntil) lvl = 0;
  else if (CINE.active) lvl = .07;
  else if (P.seated) lvl = .22;
  if (lvl !== musicTarget) {
    musicBus.gain.setTargetAtTime(lvl, t, lvl === 0 ? .04 : .5);
    musicTarget = lvl;
  }

  if (!P.started || t < mHoldUntil) return;
  if (mNext < t) mNext = t + .05; // the tab was hidden: don't play catch-up
  while (mNext < t + .15) {
    playStep(mStep, mNext);
    mStep = (mStep + 1) % 32;
    mNext += EIGHTH;
  }
}

/* ======================= Verdict stings ======================= */

let pendingSting = null, stingAt = 0;
FW.onMessage(m => {
  if (!m || m.type !== "verdict") return;
  pendingSting = m.caught ? "flag" : "paid";
  stingAt = performance.now() + 350;
});
function checkSting() {
  if (!pendingSting) return;
  const due = CINE.active ? CINE.landed : performance.now() >= stingAt;
  if (!due) return;
  const kind = pendingSting; pendingSting = null;
  playSting(kind);
}
function playSting(kind) {
  const t = ctx.currentTime + .02;
  mHoldUntil = t + (kind === "paid" ? 3.2 : 3.8);
  mStep = 0; mNext = mHoldUntil + .1;
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setTargetAtTime(0, t, .03); musicTarget = 0;
  if (kind === "paid") {
    // big-band "ta-daaa": brassy stabs up a Cmaj6/9 and a cymbal
    const br = filt("lowpass", 900, 1.5, stingBus);
    br.frequency.setValueAtTime(900, t); br.frequency.exponentialRampToValueAtTime(3200, t + .4);
    [60, 64, 67, 69, 74].forEach((n, i) => osc("sawtooth", mtof(n), t + i * .07, .2, .05, br, 0, .01));
    [60, 64, 67, 69, 74, 79].forEach(n => osc("sawtooth", mtof(n), t + .42, 1.4, .04, br, 0, .03));
    osc("triangle", mtof(36), t + .42, 1.2, .2, stingBus);
    nz(t + .42, 1.6, .08, stingBus, "highpass", 5000, .5);
  } else {
    // sad trombone: womp womp womp wommmmp
    const tb = filt("lowpass", 950, 2, stingBus);
    [55, 54, 53].forEach((n, i) => osc("sawtooth", mtof(n), t + i * .42, .38, .09, tb, mtof(n) * .97, .03));
    const o = ctx.createOscillator(), g = ctx.createGain(), vib = ctx.createOscillator(), vg = ctx.createGain();
    const t3 = t + 1.26;
    o.type = "sawtooth"; o.frequency.setValueAtTime(mtof(52), t3);
    vib.frequency.value = 6; vg.gain.setValueAtTime(0, t3); vg.gain.linearRampToValueAtTime(5, t3 + .5);
    vib.connect(vg); vg.connect(o.frequency);
    g.gain.setValueAtTime(.0001, t3); g.gain.exponentialRampToValueAtTime(.1, t3 + .04);
    g.gain.setValueAtTime(.1, t3 + 1.0); g.gain.exponentialRampToValueAtTime(.0001, t3 + 1.6);
    o.connect(g); g.connect(tb);
    o.start(t3); vib.start(t3); o.stop(t3 + 1.7); vib.stop(t3 + 1.7);
  }
}

/* ======================= Sound effects (override world.js) ======================= */

let foot = 1;
const FX = {
  step() {
    const t = ctx.currentTime + .005, pp = player.g.position;
    const run = P.keys.has("ShiftLeft") || P.keys.has("ShiftRight");
    const v = run ? 1.25 : 1, pr = 1 + (Math.random() - .5) * .16;
    foot = -foot;
    const dest = panTo(foot * .08, sfxBus);
    switch (roomAt(pp.x, pp.z)) {
      case "boss": // polished wood: hollow knock + heel click
        nz(t, .05, .09 * v, dest, "bandpass", 1100 * pr, 3);
        osc("triangle", 190 * pr, t, .07, .05 * v, dest, 120);
        nz(t + .025, .02, .04 * v, dest, "highpass", 3500, .7);
        break;
      case "break": // linoleum: crisp tap, the odd sneaker squeak
        nz(t, .035, .08 * v, dest, "highpass", 2400 * pr, .8);
        osc("sine", 340 * pr, t, .04, .035 * v, dest, 220);
        if (Math.random() < .08) osc("sine", 2100 * pr, t + .02, .09, .012, dest, 2600, .02);
        break;
      case "records": // concrete: hard click and a little slapback
        for (let i = 0; i < 3; i++) nz(t + i * .11, .04, .1 * v * (i ? .35 / i : 1), dest, "bandpass", 1600 * pr, 1.5);
        break;
      default: // carpet: soft, muffled
        nz(t, .07, .11 * v, dest, "lowpass", 380 * pr, .7);
        osc("sine", 90 * pr, t, .06, .06 * v, dest, 60);
    }
  },
  print() {
    const t = ctx.currentTime + .01;
    spatial(PRINTER.x, PRINTER.z, 16, .25);
    const d = panTo(spP, sfxBus), v = spG;
    osc("square", 880, t, .06, .03 * v, d); osc("square", 1320, t + .1, .08, .03 * v, d);
    nz(t + .3, .14, .16 * v, d, "lowpass", 600, 1);
    nz(t + .45, .3, .06 * v, d, "bandpass", 2500, 1, 4500);
  },
  pickup() {
    const t = ctx.currentTime + .005;
    nz(t, .18, .09, sfxBus, "bandpass", 3000, 1.2, 5200);
    osc("triangle", 520, t + .04, .12, .06, sfxBus, 880);
  },
  drop() {
    const t = ctx.currentTime + .005;
    nz(t, .2, .08, sfxBus, "bandpass", 2600, 1, 1200);
    osc("sine", 150, t + .12, .15, .14, sfxBus, 80);
    nz(t + .12, .06, .12, sfxBus, "lowpass", 420, 1);
  },
  cash() {
    const t = ctx.currentTime + .005;
    nz(t, .06, .12, sfxBus, "bandpass", 2000, 2);
    nz(t + .05, .25, .08, sfxBus, "lowpass", 800, 1);
    osc("sine", 1760, t + .12, 1.0, .07, sfxBus, 0, .003);
    osc("sine", 1760 * 2.76, t + .12, .5, .015, sfxBus, 0, .003);
    for (let i = 0; i < 6; i++) osc("sine", rnd(3200, 5200), t + .3 + i * .05, .07, .02, sfxBus);
  },
  buzz() {
    const t = ctx.currentTime + .005, lp = filt("lowpass", 1400, .8, sfxBus);
    osc("sawtooth", 110, t, .55, .08, lp, 0, .01);
    osc("square", 116.5, t, .55, .05, lp, 0, .01);
  },
  huh() {
    const t = ctx.currentTime + .005, bp = filt("bandpass", 700, 4, sfxBus);
    osc("sawtooth", 160, t, .3, .14, bp, 245, .03);
    osc("sine", 160, t, .3, .04, sfxBus, 250, .03);
  },
  busted() {
    const t = ctx.currentTime + .005, lp = filt("lowpass", 2400, .7, sfxBus);
    [130.8, 155.6, 196, 261.6].forEach(f => osc("sawtooth", f, t, .5, .05, lp, 0, .006));
    nz(t, .3, .2, sfxBus, "lowpass", 1800, .7);
    osc("sine", 65, t, .6, .22, sfxBus, 45);
    [233, 207.7].forEach((f, i) => osc("sawtooth", f, t + .55 + i * .2, .18, .045, lp, 0, .01));
  },
  door() {
    const t = ctx.currentTime + .01;
    spatial(-13, -5, 25, .3);
    const d = panTo(spP, sfxBus), v = spG;
    const o = ctx.createOscillator(), g = ctx.createGain(), bp = filt("bandpass", 900, 8, d);
    o.type = "sawtooth"; o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(115, t + .25); o.frequency.linearRampToValueAtTime(60, t + .5);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.09 * v, t + .05); g.gain.exponentialRampToValueAtTime(.0001, t + .5);
    o.connect(g); g.connect(bp); o.start(t); o.stop(t + .55);
    nz(t + .55, .03, .12 * v, d, "highpass", 3000, .7);
    osc("sine", 140, t + .55, .2, .08 * v, d, 90);
  },
  upgrade() {
    const t = ctx.currentTime + .005;
    osc("sawtooth", 55, t, .5, .1, filt("lowpass", 600, 2, sfxBus), 110);
    [0, .1, .2, .3].forEach((a, i) => osc("square", 330 * (1 + i * .25), t + a, .15, .045, sfxBus));
    for (let i = 0; i < 8; i++) osc("sine", rnd(2000, 4000), t + .35 + i * .04, .06, .02, sfxBus);
  },
  heart() {
    const t = ctx.currentTime + .005, v = .28 + clamp(B.sus, 0, 1) * .2;
    osc("sine", 58, t, .14, v, sfxBus, 38);
    nz(t, .06, v * .2, sfxBus, "lowpass", 200, 1);
    osc("sine", 52, t + .17, .13, v * .75, sfxBus, 36);
  },
  slam() {
    const t = ctx.currentTime + .005;
    osc("sine", 90, t, .4, .45, sfxBus, 35);
    nz(t, .15, .4, sfxBus, "lowpass", 1200, .7);
    nz(t, .1, .3, sfxBus, "bandpass", 420, 2);
    nz(t + .05, .25, .05, sfxBus, "highpass", 4000, .7);
  },
  whoosh() {
    const t = ctx.currentTime + .005;
    nz(t, .38, .16, sfxBus, "bandpass", 400, 1.5, 3200, .16);
  },
};
for (const kind in FX) {
  const fn = FX[kind];
  FW.setSfx(kind, () => { if (!ensure()) return; try { fn(); } catch (e) { /* never break the game for a sound */ } });
}

/* ======================= Unlock + controls ======================= */

function unlock() { ensure(); }
const startBtn = document.getElementById("btn-start");
if (startBtn) startBtn.addEventListener("click", unlock);
// any later gesture resumes a context the browser suspended (tab switches, iOS interruptions)
const onGesture = () => { if (P.started) { if (ready) resumeCtx(); else ensure(); } };
addEventListener("pointerdown", onGesture, true);
addEventListener("keydown", onGesture, true);

function isTyping(e) {
  const el = e.target;
  return !!(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
}
// the keys come from keys.js, so they show in Esc → Controls and can be rebound
const K = window.ForgedKeys;
const isKey = (action, code, fallback) => K ? K.is(action, code) : code === fallback;
addEventListener("keydown", e => {
  if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if ((K && K.isOpen && K.isOpen()) || (window.ForgedMenu && ForgedMenu.isOpen())) return; // rebinding / menu owns the keys
  const up = isKey("volumeUp", e.code, "BracketRight"), down = isKey("volumeDown", e.code, "BracketLeft");
  if (isKey("mute", e.code, "KeyM") && !e.repeat) {
    S.muted = !S.muted; save(); applyVolume();
    FW.wtoast(S.muted ? `🔇 Sound off (${K ? K.label("mute") : "M"})` : `🔊 Sound on · ${Math.round(S.vol * 100)}%`);
  } else if (up || down) {
    S.vol = clamp(Math.round((S.vol + (up ? .1 : -.1)) * 10) / 10, 0, 1);
    S.muted = false; save(); applyVolume();
    FW.wtoast(`🔊 Volume ${Math.round(S.vol * 100)}%`);
  }
});

// let voice.js (and anyone else) read the player's sound settings
FW.sound = {
  get volume() { return S.vol; },
  get muted() { return S.muted; },
  ensure,
};


/* ======================= Per frame ======================= */

FW.onUpdate(dt => {
  if (!ready || ctx.state !== "running") return;
  const t = ctx.currentTime;
  if (P.started) updateAmbience(t, dt);
  updateMusic(t, dt);
  checkSting();
});

})();
