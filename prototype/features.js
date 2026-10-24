/* features.js: see PLUGINS.md. Builds on window.FW from world.js.
 *
 * Gameplay features that make the office feel alive:
 *   1. Minimap (bottom-left, Tab cycles: map -> map + achievements -> hidden)
 *   2. Office life: Kevin and Dana take coffee runs to the break room (and snitch)
 *   3. Desk phone: rings now and then; E to answer. One caller leaks the boss's schedule.
 *   4. Fire drill: rare chaos event, the boss is busy for ~15 s
 *   5. Achievements: toasts plus a persistent list
 *
 * Debug from the console: forgedFeatures.ring(), .fireDrill(), .coffee("kevin"), .resetAchievements()
 */
(() => {
"use strict";
const FW = window.FW;
if (!FW) return;
const EXIT_X = FW.EXIT_X ?? 0; // where the emergency exit is on the south wall
const { THREE, P, B, player, npcs } = FW;
const { kevin, dana, inspector, clerk, boss } = npcs;
const rand = FW.rand, pick = FW.pick, clamp = FW.clamp;
const COFFEE = { x: -10, z: 15 };                                   // break room coffee spot

/* ======================= small helpers ======================= */

const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const playerNear = (x, z, r) => dist2(player.g.position.x, player.g.position.z, x, z) < r;
const store = {
  get(k, d) { try { const v = localStorage.getItem("forged." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("forged." + k, JSON.stringify(v)); } catch (e) {} },
};

// tiny synth for the phone and the alarm (only called on ring pulses, never per frame)
function tone(f, d, type = "square", v = .05, at = 0) {
  const a = FW.audio(); if (!a) return;
  try {
    if (a.state === "suspended") a.resume();
    const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + .02);
  } catch (e) {}
}

/* ======================= Achievements ======================= */

const ACH = [
  { id: "first", name: "First forgery", desc: "Get your first verdict" },
  { id: "paid", name: "Paid in full", desc: "Get an invoice PAID" },
  { id: "ghost", name: "Ghost", desc: "Deliver without the boss ever noticing" },
  { id: "speed", name: "Speedrunner", desc: "Print to IN tray in under 20 s" },
  { id: "coffee", name: "Caffeinated", desc: "Visit the coffee spot" },
  { id: "snitch", name: "Snitched on", desc: "A coworker saw the envelope" },
  { id: "phone", name: "Hello?", desc: "Answer the desk phone" },
  { id: "tip", name: "Inside info", desc: "Get a tip about the boss" },
  { id: "drill", name: "Survived a fire drill", desc: "Make it through a fire drill" },
  { id: "drillDeliver", name: "Fire sale", desc: "Deliver during a fire drill" },
];
const unlocked = new Set(store.get("ach", []));
function unlock(id) {
  if (unlocked.has(id)) return;
  const a = ACH.find(x => x.id === id); if (!a) return;
  unlocked.add(id); store.set("ach", [...unlocked]);
  FW.wtoast(`🏆 ${a.name} — ${a.desc}`, "good");
  FW.sfx("upgrade");
  renderAch();
}

/* ======================= HUD: minimap + achievement list ======================= */

const CARD = "background:var(--card,#fffaf0);border:3px solid var(--ink,#2b1d14);border-radius:12px;box-shadow:4px 4px 0 var(--ink,#2b1d14);";
const wrap = document.createElement("div");
wrap.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:5;display:none;flex-direction:column;gap:10px;pointer-events:none;font-family:var(--ui,monospace);color:var(--ink,#2b1d14);";
const achBox = document.createElement("div");
achBox.style.cssText = CARD + "padding:8px 12px;font-size:12px;width:240px;display:none;";
const mapBox = document.createElement("div");
mapBox.style.cssText = CARD + "padding:6px 6px 4px;width:fit-content;";
const mapHead = document.createElement("div");
mapHead.style.cssText = "display:flex;justify-content:space-between;font-size:10px;text-transform:uppercase;letter-spacing:.5px;opacity:.7;margin:0 2px 3px;";
mapHead.innerHTML = "<span>Office map</span><span>Tab</span>";
const MW = 230, MH = 146, MS = 5, MX0 = -23, MZ0 = -11;          // metres -> minimap pixels
const dpr = Math.min(2, window.devicePixelRatio || 1);
const mapCv = document.createElement("canvas");
mapCv.width = MW * dpr; mapCv.height = MH * dpr;
mapCv.style.cssText = `width:${MW}px;height:${MH}px;display:block;border-radius:6px;`;
const mg = mapCv.getContext("2d");
mapBox.appendChild(mapHead); mapBox.appendChild(mapCv);
wrap.appendChild(achBox); wrap.appendChild(mapBox);
document.body.appendChild(wrap);

function renderAch() {
  achBox.innerHTML = `<div style="font-family:var(--display,sans-serif);font-size:14px;margin-bottom:4px;">Achievements ${unlocked.size}/${ACH.length}</div>` +
    ACH.map(a => {
      const on = unlocked.has(a.id);
      return `<div style="display:flex;gap:6px;align-items:baseline;margin:2px 0;opacity:${on ? 1 : .45}"><b style="color:${on ? "var(--paid,#1d9a4b)" : "inherit"}">${on ? "✓" : "☐"}</b><span><b>${a.name}</b><br><small>${a.desc}</small></span></div>`;
    }).join("");
}
renderAch();

let hudMode = clamp(store.get("hudMode", 0), 0, 2) | 0;     // 0 map, 1 map + achievements, 2 hidden
addEventListener("keydown", e => {
  if (e.code !== "Tab" || !P.started || P.seated) return;
  e.preventDefault();
  hudMode = (hudMode + 1) % 3; store.set("hudMode", hudMode);
  if (hudMode === 2) FW.wtoast("Map hidden — Tab to show it again");
});

const mx = x => (x - MX0) * MS, mz = z => (z - MZ0) * MS;
// static layer: rooms, doorways, furniture. Drawn once.
const bg = document.createElement("canvas"); bg.width = mapCv.width; bg.height = mapCv.height;
(function drawStatic() {
  const g = bg.getContext("2d"); g.scale(dpr, dpr);
  g.fillStyle = "#cbbd9f"; g.fillRect(0, 0, MW, MH);
  const rooms = [
    { x0: -13, x1: 13, z0: -9, z1: 9, fill: "#f3e8cf", label: "" },
    { x0: -22, x1: -13, z0: -10, z1: 0, fill: "#ead2cc", label: "BOSS" },
    { x0: -13, x1: 0, z0: 9, z1: 17, fill: "#d5e8d2", label: "BREAK" },
    { x0: 13, x1: 22, z0: 0, z1: 10, fill: "#d4dfee", label: "RECORDS" },
  ];
  for (const r of rooms) { g.fillStyle = r.fill; g.fillRect(mx(r.x0), mz(r.z0), (r.x1 - r.x0) * MS, (r.z1 - r.z0) * MS); }
  g.strokeStyle = "#2b1d14"; g.lineWidth = 2.5;
  for (const r of rooms) g.strokeRect(mx(r.x0), mz(r.z0), (r.x1 - r.x0) * MS, (r.z1 - r.z0) * MS);
  // doorways: paint the gaps back in
  g.fillStyle = "#f3e8cf";
  g.fillRect(mx(-13) - 2, mz(-5 - .9), 4, 1.8 * MS);
  g.fillRect(mx(-6 - 1.1), mz(9) - 2, 2.2 * MS, 4);
  g.fillRect(mx(13) - 2, mz(5.5 - 1), 4, 2 * MS);
  // furniture
  g.fillStyle = "#8a5a35";
  for (const [x, z] of [[FW.MY_DESK.x, FW.MY_DESK.z], [-3, 2], [-3, -3], [FW.CLERK_DESK.x, FW.CLERK_DESK.z]]) g.fillRect(mx(x - 1.1), mz(z - .55), 2.2 * MS, 1.1 * MS);
  g.fillStyle = "#1f8a8a"; g.fillRect(mx(FW.BOOTH.x - 1.8), mz(FW.BOOTH.z - .6), 3.6 * MS, 1.2 * MS);
  g.fillStyle = "#2e2a28"; g.fillRect(mx(FW.PRINTER.x - .5), mz(FW.PRINTER.z - .4), MS, .8 * MS);
  g.fillStyle = "#1d9a4b"; g.fillRect(mx(EXIT_X - .6), mz(9) - 3, 1.2 * MS, 4);           // exit sign
  g.fillStyle = "#8a5a35"; g.beginPath(); g.arc(mx(COFFEE.x), mz(COFFEE.z), 3, 0, 7); g.fill();
  g.font = "bold 8px 'Space Mono', monospace"; g.fillStyle = "rgba(43,29,20,.55)"; g.textAlign = "center";
  for (const r of rooms) if (r.label) g.fillText(r.label, mx((r.x0 + r.x1) / 2), mz(r.z1) - 4);
  g.fillText("YOU", mx(FW.MY_DESK.x), mz(FW.MY_DESK.z) + 3);
})();

function dot(x, z, r, fill) {
  mg.beginPath(); mg.arc(mx(x), mz(z), r, 0, 6.2832); mg.fillStyle = fill; mg.fill();
  mg.lineWidth = 1.2; mg.strokeStyle = "#2b1d14"; mg.stroke();
}
function objectiveTarget() {
  if (P.phase === "pickup") return FW.PRINTER;
  if (P.carrying || P.phase === "carrying") return FW.IN_TRAY;
  return FW.CHAIR;
}
let nextMapDraw = 0;
function drawMap(now) {
  mg.setTransform(1, 0, 0, 1, 0, 0);
  mg.drawImage(bg, 0, 0);
  mg.setTransform(dpr, 0, 0, dpr, 0, 0);
  // objective
  const t = objectiveTarget(), pulse = 5 + Math.sin(now / 200) * 2;
  mg.beginPath(); mg.arc(mx(t.x), mz(t.z), pulse, 0, 6.2832);
  mg.lineWidth = 2.5; mg.strokeStyle = "#ffb800"; mg.stroke();
  // ringing phone
  if (phone.ringing && Math.sin(now / 90) > 0) { mg.font = "bold 11px sans-serif"; mg.fillStyle = "#e0352b"; mg.textAlign = "center"; mg.fillText("☎", mx(PHONE_X), mz(PHONE_Z) - 5); }
  // fire drill: flashing exit
  if (drill.active && Math.sin(now / 120) > 0) { mg.fillStyle = "rgba(224,53,43,.35)"; mg.fillRect(0, 0, MW, MH); }
  // boss + cone
  if (boss.g.visible) {
    const bp = boss.g.position, r = boss.g.rotation.y, a = Math.atan2(Math.cos(r), Math.sin(r));
    mg.beginPath(); mg.moveTo(mx(bp.x), mz(bp.z)); mg.arc(mx(bp.x), mz(bp.z), 4.2 * MS, a - .55, a + .55); mg.closePath();
    mg.fillStyle = B.sus > 0 ? "rgba(224,53,43,.35)" : "rgba(224,53,43,.15)"; mg.fill();
    dot(bp.x, bp.z, 4.5, "#e0352b");
  }
  // NPCs
  dot(kevin.g.position.x, kevin.g.position.z, 3, "#7a5cff");
  dot(dana.g.position.x, dana.g.position.z, 3, "#3fae6a");
  dot(inspector.g.position.x, inspector.g.position.z, 3, "#ffffff");
  dot(clerk.g.position.x, clerk.g.position.z, 3, "#f4a63a");
  // you: an arrow pointing where you face
  const p = player.g.position, ry = player.g.rotation.y, fx = Math.sin(ry), fz = Math.cos(ry);
  const px = mx(p.x), pz = mz(p.z);
  mg.beginPath();
  mg.moveTo(px + fx * 7, pz + fz * 7);
  mg.lineTo(px - fx * 4 + fz * 4, pz - fz * 4 - fx * 4);
  mg.lineTo(px - fx * 2, pz - fz * 2);
  mg.lineTo(px - fx * 4 - fz * 4, pz - fz * 4 + fx * 4);
  mg.closePath();
  mg.fillStyle = P.carrying ? "#ffd23f" : "#e0352b"; mg.fill();
  mg.lineWidth = 1.5; mg.strokeStyle = "#2b1d14"; mg.stroke();
}
let lastWrap = "", lastAch = "";
function updateHud(now) {
  const show = P.started && !P.seated && !FW.CINE.active && hudMode !== 2;
  const w = show ? "flex" : "none";
  if (w !== lastWrap) { lastWrap = w; wrap.style.display = w; }
  const a = hudMode === 1 ? "block" : "none";
  if (a !== lastAch) { lastAch = a; achBox.style.display = a; }
  if (show && now >= nextMapDraw) { nextMapDraw = now + 66; drawMap(now); }
}

/* ======================= Office life: coffee runs ======================= */

const BREAK_PATH = [[-6, 7.6], [-6, 10.4], [-9.3, 14.3]];          // through the south doorway (x -6)
const cupMat = FW.M("#ffffff"), coffeeMat = FW.M("#5a3420");
function makeCup(ch) {
  const cup = FW.cyl(.07, .06, .14, cupMat, 0, -.82, .08, ch.armR);
  FW.cyl(.06, .06, .01, coffeeMat, 0, .07, 0, cup);
  cup.rotation.x = 1.2; cup.visible = false;
  return cup;
}
function makeNpc(ch, name, standOff, toJunction, toExit) {
  return {
    ch, name,
    home: { x: ch.g.position.x, y: ch.g.position.y, z: ch.g.position.z, rot: ch.g.rotation.y },
    stand: [ch.g.position.x, ch.g.position.z + standOff],
    toJunction, toExit,
    mode: "seated", path: null, pi: 0, done: null, waitUntil: 0, face: null,
    trip: false, snitched: false, holding: false, cup: makeCup(ch),
  };
}
// Kevin sits on the south side of the north desk, Dana on the south side of the south desk.
const NPCS = [
  makeNpc(kevin, "Kevin", .75, [[-5, 4.4]], [[0.6, 6.4], [EXIT_X - .6, 7.8]]),
  makeNpc(dana, "Dana", .75, [[-5, -1.0], [-5, 4.4]], [[-0.9, -0.6], [-0.6, 6.4], [EXIT_X + .6, 7.8]]),
];
const npcByName = { kevin: NPCS[0], dana: NPCS[1] };

function walk(n, pts, done) { n.path = pts; n.pi = 0; n.done = done; n.mode = "walk"; }
function getUp(n) {
  FW.standPose(n.ch);
  n.ch.g.position.set(n.stand[0], 0, n.stand[1]);
}
function sitDown(n) {
  n.ch.g.position.set(n.home.x, 0, n.home.z); n.ch.g.rotation.y = n.home.rot;
  FW.seatPose(n.ch, true);
  n.mode = "seated"; n.trip = false; n.holding = false; n.cup.visible = false;
}
const reversed = pts => pts.slice().reverse();
function coffeeRun(n) {
  if (!n || n.mode !== "seated") return false;
  getUp(n); n.trip = true; n.snitched = false;
  if (Math.random() < .5) FW.say(n.ch, pick(["Coffee time.", "Brb, caffeine.", "I need a refill.", "Anyone want anything? No? Cool."]), 2000);
  const out = [...n.toJunction, ...BREAK_PATH];
  walk(n, out, () => {
    n.mode = "wait"; n.waitUntil = performance.now() + rand(5000, 9000); n.face = COFFEE;
    n.after = () => {
      n.holding = true; n.cup.visible = true;
      if (Math.random() < .5) FW.say(n.ch, pick(["Ahh. Burnt. Perfect.", "Who took the last oat milk?!", "Decaf?! Who does that?"]), 2200);
      walk(n, [...reversed(out), n.stand], () => sitDown(n));
    };
  });
  return true;
}
let nextCoffee = performance.now() + rand(30000, 50000);

function updateNpcs(dt, now) {
  for (const n of NPCS) {
    if (n.mode === "seated") continue;
    const ch = n.ch, pos = ch.g.position;
    if (n.mode === "walk") {
      const tgt = n.path[n.pi], dx = tgt[0] - pos.x, dz = tgt[1] - pos.z, d = Math.hypot(dx, dz);
      const sp = drill.active ? 2.4 : 1.5;
      if (d < .06) {
        n.pi++;
        if (n.pi >= n.path.length) { n.mode = "idle"; const f = n.done; n.done = null; if (f) f(); }
      } else {
        const k = Math.min(d, sp * dt) / d;
        pos.x += dx * k; pos.z += dz * k;
        let diff = Math.atan2(dx, dz) - ch.g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        ch.g.rotation.y += diff * Math.min(1, dt * 10);
      }
      FW.animWalk(ch, dt, n.mode === "walk" ? sp : 0);
    } else {
      // standing still: settle limbs (world.js keeps resetting the arms to typing, so set them here)
      FW.animWalk(ch, dt, 0);
      ch.armL.rotation.x = 0; ch.armR.rotation.x = 0;
      if (n.face) {
        let diff = Math.atan2(n.face.x - pos.x, n.face.z - pos.z) - ch.g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        ch.g.rotation.y += diff * Math.min(1, dt * 6);
      }
      if (n.mode === "wait" && now > n.waitUntil) { n.mode = "idle"; n.face = null; const f = n.after; n.after = null; if (f) f(); }
    }
    if (n.holding) ch.armR.rotation.x = -1.2;
    // snitch: on a coffee run, near you while you carry the envelope
    if (n.trip && !n.snitched && P.carrying && !drill.active && playerNear(pos.x, pos.z, 3)) {
      n.snitched = true;
      FW.say(ch, "Ooh, what's that?", 2400);
      FW.toOS("heat", { amount: 5 });
      FW.wtoast(`${n.name} saw the envelope! +5 heat`, "bad");
      FW.sfx("huh");
      unlock("snitch");
    }
  }
  // schedule the next coffee run, one at a time
  if (now > nextCoffee) {
    nextCoffee = now + rand(40000, 70000);
    if (P.started && !drill.active && NPCS.every(n => n.mode === "seated")) coffeeRun(pick(NPCS));
  }
}

/* ======================= Desk phone ======================= */

const PHONE_X = FW.MY_DESK.x - .78, PHONE_Z = FW.MY_DESK.z + .22;
const phoneG = new THREE.Group(); phoneG.position.set(PHONE_X, .8, PHONE_Z); FW.scene.add(phoneG);
const phoneRed = FW.M("#c8322a"), phoneDark = FW.M("#2e2a28");
FW.box(.3, .09, .24, phoneRed, 0, .045, 0, phoneG);
FW.box(.12, .02, .1, phoneDark, .05, .1, .04, phoneG);                // keypad
const handset = FW.box(.34, .06, .09, phoneRed, 0, .13, -.06, phoneG);
FW.box(.08, .05, .1, phoneRed, -.15, .1, -.06, phoneG); FW.box(.08, .05, .1, phoneRed, .15, .1, -.06, phoneG);
const phone = { ringing: false, ringEnd: 0, nextRing: performance.now() + rand(50000, 75000), nextPulse: 0, calls: 0, sinceTip: 0, busy: false };

const CALLS = [
  [["📞 <b>BOSS:</b> Did you get the memo about the TPS reports?", 2600], ["Yeah… I got the memo.", 2000, "me"], ["📞 <b>BOSS:</b> Great. I'll send you another copy.", 2400]],
  [["📞 <b>???:</b> Is your refrigerator running?", 2400], ["…Yes?", 1500, "me"], ["📞 <b>???:</b> Then you'd better go catch it! <i>*click*</i>", 2600]],
  [["📞 <b>BRENDA:</b> Hon, you doing the lunch order? I want the soup.", 2800], ["Which soup?", 1500, "me"], ["📞 <b>BRENDA:</b> Not THAT soup. The other soup.", 2600]],
  [["📞 We've been trying to reach you about your car's extended warranty.", 3000], ["I take the bus.", 1800, "me"]],
  [["📞 <b>MOM:</b> Are you eating enough? Your cousin just got promoted.", 3000], ["Love you too, Mom.", 1800, "me"]],
  [["📞 <b>IT:</b> Have you tried turning it off and on again?", 2600], ["I didn't call you.", 1800, "me"], ["📞 <b>IT:</b> …Have you tried it anyway?", 2400]],
];
function tipCall() {
  let line;
  if (B.state === "wait") {
    const s = Math.max(1, Math.round(B.t));
    line = `📞 <b>???:</b> The eagle leaves the nest in <b>${s} seconds</b>. <small>(the boss's next patrol)</small>`;
  } else line = "📞 <b>???:</b> The eagle is <b>on the floor right now</b>. Watch his cone. <i>*click*</i>";
  return [[line, 3800], ["…Who is this?", 1600, "me"]];
}
function playCall(lines) {
  phone.busy = true;
  let at = 0;
  lines.forEach(([html, ms, who]) => {
    setTimeout(() => FW.say(player, who === "me" ? html : `<span style="font-size:12px">${html}</span>`, ms), at);
    at += ms + 150;
  });
  setTimeout(() => { phone.busy = false; FW.sfx("drop"); }, at);
}
function ring() {
  if (phone.ringing || phone.busy) return;
  phone.ringing = true; phone.ringEnd = performance.now() + 16000; phone.nextPulse = 0;
}
function answer() {
  phone.ringing = false; phone.calls++; phone.sinceTip++;
  FW.sfx("pickup");
  unlock("phone");
  // a tip comes roughly every third call (always by the third without one)
  if (phone.sinceTip >= 3 || Math.random() < .3) { phone.sinceTip = 0; unlock("tip"); playCall(tipCall()); }
  else playCall(pick(CALLS));
}
const canAnswer = () => phone.ringing && P.started && !P.seated && !FW.CINE.active && playerNear(PHONE_X, PHONE_Z, 2.1);
// Your chair's "Use your computer" interaction would win the E key near the desk,
// so take E first (capture phase) while the phone is ringing.
addEventListener("keydown", e => {
  if (e.code !== "KeyE" || e.repeat || !canAnswer()) return;
  e.stopImmediatePropagation(); e.preventDefault();
  answer();
}, true);
// and show "Answer the phone" in the prompt (runs after world.js's frame each animation frame)
const promptEl = document.getElementById("prompt");
(function promptPatch() {
  requestAnimationFrame(promptPatch);
  try {
    if (promptEl && canAnswer()) { promptEl.classList.add("show"); promptEl.innerHTML = "<kbd>E</kbd>Answer the phone ☎"; }
  } catch (e) {}
})();

function updatePhone(dt, now) {
  if (!P.started) { phone.nextRing = now + rand(50000, 75000); return; }
  if (!phone.ringing) {
    phoneG.position.y = .8; phoneG.rotation.z = 0; handset.position.y = .13;
    if (now > phone.nextRing) {
      phone.nextRing = now + rand(110000, 190000);
      if (!P.seated && !FW.CINE.active && !drill.active) ring();
      else phone.nextRing = now + rand(15000, 30000);    // try again soon
    }
    return;
  }
  // ringing: bounce + rattle, ring pulses every 2 s
  const on = ((now / 1000) % 2) < .9;
  handset.position.y = .13 + (on ? Math.abs(Math.sin(now / 35)) * .05 : 0);
  phoneG.rotation.z = on ? Math.sin(now / 25) * .08 : 0;
  phoneG.position.y = .8 + (on ? Math.abs(Math.sin(now / 50)) * .02 : 0);
  if (now > phone.nextPulse) {
    phone.nextPulse = now + 2000;
    const v = .05 * clamp(1.2 - dist2(player.g.position.x, player.g.position.z, PHONE_X, PHONE_Z) / 22, .2, 1);
    for (let i = 0; i < 8; i++) tone(i % 2 ? 1180 : 960, .1, "square", v, i * .1);
    if (phone.calls === 0 && !phone.hinted) { phone.hinted = true; FW.wtoast("☎ Your desk phone is ringing — press E near your desk"); }
  }
  if (P.seated || now > phone.ringEnd) {
    phone.ringing = false;
    if (!P.seated) FW.wtoast("Missed call");
  }
}

/* ======================= Fire drill ======================= */

const drill = { active: false, endAt: 0, nextAt: performance.now() + rand(240000, 330000), nextBeep: 0, beepHi: false, lastOp: -1 };
const alarmLight = new THREE.PointLight("#ff2020", 0, 40, 1.5);       // built once, stays in the scene (intensity 0 when idle)
alarmLight.position.set(EXIT_X - 2, 2.9, 1); FW.scene.add(alarmLight);
const alarmBulb = new THREE.Mesh(new THREE.SphereGeometry(.16, 12, 12), new THREE.MeshBasicMaterial({ color: "#5a1010" }));
alarmBulb.position.set(EXIT_X, 3.0, FW.RD / 2 - .25); FW.scene.add(alarmBulb);
const redOverlay = document.createElement("div");
redOverlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:3;opacity:0;background:radial-gradient(ellipse at center, rgba(255,0,0,0) 45%, rgba(255,20,20,.55) 100%);";
document.body.appendChild(redOverlay);
const DRILL_MS = 15000;

function startDrill(now) {
  if (drill.active) return;
  drill.active = true; drill.endAt = now + DRILL_MS;
  FW.wtoast("🔥 FIRE DRILL! The boss is busy herding everyone out — 15 s to deliver unseen!", "good");
  // the boss stops patrolling; if he is in his office he stays there
  B.sus = 0;
  if (B.state === "wait") B.t = Math.max(B.t, DRILL_MS / 1000 + 4);
  else { B.pauseUntil = now + DRILL_MS; FW.say(boss, "FIRE DRILL! Everybody OUT! Single file!", 3000); }
  // coworkers head for the exit sign
  for (const n of NPCS) {
    if (n.mode !== "seated") continue;
    getUp(n);
    walk(n, n.toExit, () => { n.mode = "idle"; n.face = { x: n.ch.g.position.x, z: 20 }; });
  }
  setTimeout(() => FW.say(kevin, pick(["Is this a drill?!", "Not again!", "I left my sandwich!"]), 2000), 600);
  setTimeout(() => FW.say(dana, pick(["Walk, don't run.", "Ugh. I was on a roll.", "Does this count as a break?"]), 2000), 2200);
  FW.say(inspector, "I'm not leaving my stapler.", 2600);
}
function endDrill(now) {
  drill.active = false;
  alarmLight.intensity = 0; alarmBulb.material.color.set("#5a1010");
  redOverlay.style.opacity = 0; drill.lastOp = -1;
  drill.nextAt = now + rand(240000, 330000);
  FW.wtoast("Drill over. Back to work, everyone.");
  if (boss.g.visible) FW.say(boss, "Alright, alright. Back to work!", 2200);
  unlock("drill");
  for (const n of NPCS) {
    if (n.mode === "seated") continue;
    const back = [...reversed(n.toExit), n.stand];
    // they start from where they stand, which is the last exit waypoint
    n.mode = "idle"; n.face = null;
    setTimeout(() => walk(n, back, () => sitDown(n)), rand(0, 1200));
  }
}
function updateDrill(dt, now) {
  if (!drill.active) {
    if (now > drill.nextAt) {
      drill.nextAt = now + 1000;                           // re-check every second
      if (P.started && !P.seated && !FW.CINE.active && !phone.busy && NPCS.every(n => n.mode === "seated") && Math.random() < 1 / 45) startDrill(now);
    }
    return;
  }
  // keep the boss busy for the whole drill (he may come out mid-drill)
  if (B.state === "wait") B.t = Math.max(B.t, (drill.endAt - now) / 1000 + 2);
  else if (B.pauseUntil < drill.endAt) B.pauseUntil = drill.endAt;
  const on = Math.sin(now / 130) > 0;
  alarmLight.intensity = on ? 2.4 : .4;
  alarmBulb.material.color.set(on ? "#ff2a2a" : "#5a1010");
  const op = on ? .9 : .25;
  if (op !== drill.lastOp) { drill.lastOp = op; redOverlay.style.opacity = P.seated ? 0 : op; }
  if (now > drill.nextBeep) { drill.nextBeep = now + 450; drill.beepHi = !drill.beepHi; tone(drill.beepHi ? 960 : 700, .4, "square", .035); }
  if (now > drill.endAt) endDrill(now);
}

/* ======================= Watching the round for achievements ======================= */

const run = { prevCarrying: false, maxSus: 0, printAt: 0, duringDrill: false };
FW.onMessage(m => {
  if (m.type === "print") run.printAt = performance.now();
  if (m.type === "verdict") { unlock("first"); if (!m.caught) unlock("paid"); }
});
function updateRound(dt, now) {
  if (P.carrying) {
    if (!run.prevCarrying) { run.maxSus = 0; run.duringDrill = false; }
    run.maxSus = Math.max(run.maxSus, B.sus);
    if (drill.active) run.duringDrill = true;
  } else if (run.prevCarrying && P.phase === "judging") {
    // just delivered
    if (run.maxSus === 0) unlock("ghost");
    if (run.printAt && now - run.printAt < 20000) unlock("speed");
    if (run.duringDrill || drill.active) unlock("drillDeliver");
    run.printAt = 0;
  }
  run.prevCarrying = P.carrying;
  if (P.started && !P.seated && playerNear(COFFEE.x, COFFEE.z, 1.6)) unlock("coffee");
}

/* ======================= Main update ======================= */

FW.onUpdate((dt, now) => {
  try { updateNpcs(dt, now); } catch (e) { console.error("[features] npcs", e); }
  try { updatePhone(dt, now); } catch (e) { console.error("[features] phone", e); }
  try { updateDrill(dt, now); } catch (e) { console.error("[features] drill", e); }
  try { updateRound(dt, now); } catch (e) { console.error("[features] round", e); }
  try { updateHud(now); } catch (e) { console.error("[features] hud", e); }
});

// console helpers for testing
window.forgedFeatures = {
  ring: () => { phone.busy = false; ring(); },
  fireDrill: () => startDrill(performance.now()),
  coffee: name => coffeeRun(npcByName[name] || pick(NPCS)),
  resetAchievements: () => { unlocked.clear(); store.set("ach", []); renderAch(); },
  unlocked: () => [...unlocked],
};

})();
