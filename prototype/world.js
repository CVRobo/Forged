/* Forged — third-person office.
 * The player walks around a small office, sits at their computer to forge
 * (os.html runs inside the monitor), prints the invoice, and carries it to the
 * inspector's IN tray. The boss patrols and checks your screen.
 * Built from primitives + emoji sprites so it needs no art assets.
 */
(() => {
"use strict";

const $ = s => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const money = n => "$" + Math.round(n).toLocaleString("en-US");

const OS = $("#os");
const toOS = (type, data = {}) => OS.contentWindow && OS.contentWindow.postMessage({ src: "forged-world", type, ...data }, "*");

/* ======================= Palettes (match style.css levels) ======================= */

const PALETTES = {
  1: { floor: "#e8b77a", floor2: "#dba66a", wall: "#fff1d6", accent: "#1f8a8a", accent2: "#f4a63a", bg: "#2a1d14" },
  2: { floor: "#e3f4ee", floor2: "#cfe9e0", wall: "#f7fbff", accent: "#2f6fd6", accent2: "#14a37f", bg: "#10202a" },
};

/* ======================= Renderer / scene ======================= */

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

$("#world").appendChild(renderer.domElement);
const canvas = renderer.domElement;

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize); resize();

scene.add(new THREE.HemisphereLight("#fff6e0", "#6b4a2e", 0.75));
const sun = new THREE.DirectionalLight("#fff2d8", 0.8);
sun.position.set(-8, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
scene.add(sun);

const RW = 26, RD = 18; // room size
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
const mats = { wall: [], accent: M("#1f8a8a"), accent2: M("#f4a63a") };
const colliders = [];

function box(w, h, d, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  parent.add(m); return m;
}
function cyl(rt, rb, h, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 20), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  parent.add(m); return m;
}
function collide(x, z, w, d) { colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 }); }

function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4;
  t.cv = { canvas: c, draw };
  return t;
}
function redraw(tex, draw = tex.cv.draw) {
  const c = tex.cv.canvas, g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height); draw(g, c.width, c.height); tex.needsUpdate = true;
}

/* ======================= Room ======================= */

let pal = PALETTES[1];
const floorTex = canvasTex(256, 256, (g, w, h) => {
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? pal.floor : pal.floor2; g.fillRect(i * 64, j * 64, 64, 64); }
});
floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(RW / 4, RD / 4);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), M("#fff", { map: floorTex }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

// walls fade out when the camera is behind them
const walls = [];
function wall(w, d, x, z, outside) {
  const mat = M(pal.wall, { transparent: true });
  mats.wall.push(mat);
  const m = box(w, 3.2, d, mat, x, 1.6, z);
  m.castShadow = false;
  walls.push({ m, mat, outside });
}
wall(RW, .3, 0, -RD / 2, c => c.z < -RD / 2 + .3);
wall(RW, .3, 0, RD / 2, c => c.z > RD / 2 - .3);
wall(.3, RD, -RW / 2, 0, c => c.x < -RW / 2 + .3);
wall(.3, RD, RW / 2, 0, c => c.x > RW / 2 - .3);
// skirting stripe
[[RW, .32, 0, -RD / 2 + .01], [RW, .32, 0, RD / 2 - .01]].forEach(a => box(a[0], .25, a[1], mats.accent, a[2], .12, a[3]));

/* ======================= Characters (boxes + emoji head sprite) ======================= */

function emojiTex(emoji) {
  return canvasTex(256, 256, (g, w, h) => {
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "200px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
    g.fillText(emoji, w / 2, h / 2 + 12);
  });
}
function tagTex(text, color = "#2b1d14") {
  return canvasTex(512, 96, (g, w, h) => {
    g.font = "bold 44px 'Space Mono', monospace"; g.textAlign = "center"; g.textBaseline = "middle";
    const tw = Math.min(w - 8, g.measureText(text.label || text).width + 40);
    g.fillStyle = text.color || color; roundRect(g, (w - tw) / 2, 14, tw, 68, 18); g.fill();
    g.fillStyle = "#fff"; g.fillText(text.label || text, w / 2, h / 2 + 2);
  });
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function makeChar({ shirt, pants = "#2b2b44", skin = "#f1c27d", face, name, tagColor, scale = 1 }) {
  const g = new THREE.Group();
  const limb = (w, h, d, mat, px, py) => {
    const pivot = new THREE.Group(); pivot.position.set(px, py, 0); g.add(pivot);
    box(w, h, d, mat, 0, -h / 2, 0, pivot); return pivot;
  };
  const legL = limb(.2, .85, .22, M(pants), -.15, .88), legR = limb(.2, .85, .22, M(pants), .15, .88);
  box(.62, .75, .36, M(shirt), 0, 1.25, 0, g);
  const armL = limb(.16, .66, .18, M(shirt), -.4, 1.58), armR = limb(.16, .66, .18, M(shirt), .4, 1.58);
  [armL, armR].forEach(a => box(.15, .14, .15, M(skin), 0, -.72, 0, a));
  const headTex = emojiTex(face);
  const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: headTex }));
  head.scale.set(.85, .85, 1); head.position.y = 2.02; g.add(head);
  const tex = tagTex({ label: name, color: tagColor });
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  tag.scale.set(1.6, .3, 1); tag.position.y = 2.65; tag.renderOrder = 10; g.add(tag);
  g.scale.setScalar(scale);
  scene.add(g);
  return { g, legL, legR, armL, armR, head, headTex, tag, tagTex: tex, walkT: 0, scale };
}
function setFace(ch, emoji) { ch.faceEmoji = emoji; redraw(ch.headTex, emojiTex(emoji).cv.draw); }
function setTag(ch, label, color) { redraw(ch.tagTex, tagTex({ label, color }).cv.draw); }

function animWalk(ch, dt, speed) {
  if (speed > .05) {
    ch.walkT += dt * (4 + speed * 1.6);
    const s = Math.sin(ch.walkT) * Math.min(.7, .25 + speed * .1);
    ch.legL.rotation.x = s; ch.legR.rotation.x = -s; ch.armL.rotation.x = -s * .8; ch.armR.rotation.x = s * .8;
    ch.head.position.y = 2.02 + Math.abs(Math.cos(ch.walkT)) * .05;
  } else {
    ["legL", "legR", "armL", "armR"].forEach(k => ch[k].rotation.x *= .8);
    ch.head.position.y = 2.02;
  }
}
function seatPose(ch, typing) {
  ch.legL.rotation.x = ch.legR.rotation.x = -Math.PI / 2;
  ch.armL.rotation.x = ch.armR.rotation.x = typing ? -1.1 : -.3;
  ch.g.position.y = -.36 * ch.scale;
}
function standPose(ch) { ["legL", "legR", "armL", "armR"].forEach(k => ch[k].rotation.x = 0); ch.g.position.y = 0; }

/* ======================= Furniture ======================= */

const wood = M("#8a5a35"), dark = M("#2e2a28"), metal = M("#9aa0a6", { metalness: .3, roughness: .5 });
const screenMat = new THREE.MeshStandardMaterial({ color: "#000", emissive: "#3a7bd5", emissiveIntensity: .8 });

function desk(x, z, { flip = false, screen = screenMat, chair = true } = {}) {
  const g = new THREE.Group(); g.position.set(x, 0, z); if (flip) g.rotation.y = Math.PI; scene.add(g);
  box(2.2, .08, 1.1, wood, 0, .76, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(.07, .74, .07, dark, sx * 1.0, .37, sz * .47, g);
  box(.08, .32, .08, dark, 0, .96, -.3, g);
  box(1.0, .62, .06, dark, 0, 1.38, -.33, g);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(.9, .52), screen); scr.position.set(0, 1.38, -.296); g.add(scr);
  box(.62, .03, .2, M("#e8e8e8"), 0, .815, .05, g);
  cyl(.06, .05, .12, M("#fff"), .75, .86, .1, g);
  if (chair) {
    box(.62, .08, .62, mats.accent, 0, .5, .95, g);
    box(.62, .72, .08, mats.accent, 0, .88, 1.26, g);
    cyl(.04, .04, .45, dark, 0, .25, .95, g);
  }
  collide(x, z, 2.3, 1.2);
  return g;
}

function plant(x, z) {
  cyl(.28, .22, .5, M("#c56a3c"), x, .25, z);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(.55, 0), M("#3f9b4f", { flatShading: true }));
  leaves.position.set(x, .95, z); leaves.castShadow = true; scene.add(leaves);
  collide(x, z, .6, .6);
}

function signPlane(text, sub, w, h, bg, fg = "#fff") {
  const tex = canvasTex(1024, Math.round(1024 * h / w), (g, cw, ch) => {
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
    g.strokeStyle = "#2b1d14"; g.lineWidth = 16; g.strokeRect(8, 8, cw - 16, ch - 16);
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `${Math.round(ch * .38)}px Bungee, Impact, sans-serif`; g.fillText(text, cw / 2, sub ? ch * .42 : ch / 2);
    if (sub) { g.font = `bold ${Math.round(ch * .17)}px 'Space Mono', monospace`; g.fillText(sub, cw / 2, ch * .76); }
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: .9 }));
}

/* --- player's desk --- */
const myScreenTex = canvasTex(512, 296, (g, w, h) => {
  g.fillStyle = "#d9904a"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#fffaf0"; g.fillRect(40, 40, w - 80, h - 80);
  g.fillStyle = "#f4a63a"; g.font = "64px Bungee, Impact"; g.textAlign = "center"; g.fillText("FORGED", w / 2, h / 2 + 10);
  g.fillStyle = "#2b1d14"; g.font = "bold 20px 'Space Mono'"; g.fillText("press E to sit", w / 2, h / 2 + 60);
});
const MY_DESK = { x: -8, z: 2 };
desk(MY_DESK.x, MY_DESK.z, { screen: new THREE.MeshStandardMaterial({ map: myScreenTex, emissive: "#ffffff", emissiveMap: myScreenTex, emissiveIntensity: .7 }) });
const CHAIR = new THREE.Vector3(MY_DESK.x, 0, MY_DESK.z + .95);
const nameplate = signPlane("YOU", null, .7, .2, "#2b1d14"); nameplate.position.set(MY_DESK.x - .7, .9, MY_DESK.z + .56); scene.add(nameplate);

/* --- coworkers --- */
desk(-3, 2); desk(-3, -3);
const kevin = makeChar({ shirt: "#7a5cff", face: "🤓", name: "KEVIN", tagColor: "#555" });
kevin.g.position.set(-3, 0, 2.95); kevin.g.rotation.y = Math.PI; seatPose(kevin, true);
const dana = makeChar({ shirt: "#3fae6a", face: "😐", name: "DANA", tagColor: "#555" });
dana.g.position.set(-3, 0, -2.05); dana.g.rotation.y = Math.PI; seatPose(dana, true);

/* --- printer --- */
const PRINTER = { x: -8, z: -7.6 };
box(1.4, .9, .9, M("#e9e6df"), PRINTER.x, .45, PRINTER.z);
box(1.4, .25, .9, M("#cfcac0"), PRINTER.x, 1.02, PRINTER.z);
box(1.0, .05, .5, mats.accent2, PRINTER.x, 1.17, PRINTER.z - .05);
const tray = box(.7, .04, .4, dark, PRINTER.x, .95, PRINTER.z + .55);
const printerLight = new THREE.Mesh(new THREE.SphereGeometry(.06, 12, 12), new THREE.MeshStandardMaterial({ color: "#222", emissive: "#49d16a", emissiveIntensity: .3 }));
printerLight.position.set(PRINTER.x + .55, 1.05, PRINTER.z + .46); scene.add(printerLight);
collide(PRINTER.x, PRINTER.z, 1.5, 1.0);
const printSign = signPlane("PRINTER", null, 1.2, .3, "#2b1d14"); printSign.position.set(PRINTER.x, 2.2, -RD / 2 + .17); scene.add(printSign);

const envelopeMat = M("#f2e2b8");
const envelope = box(.5, .03, .32, envelopeMat, PRINTER.x, .99, PRINTER.z + .55);
envelope.visible = false;

/* --- inspector booth --- */
const BOOTH = { x: 8, z: -5.6 };
const boothDesk = new THREE.Group(); boothDesk.position.set(BOOTH.x, 0, BOOTH.z); scene.add(boothDesk);
box(3.2, 1.05, .8, mats.accent, 0, .52, .6, boothDesk);         // counter
box(3.3, .08, .95, wood, 0, 1.08, .6, boothDesk);
collide(BOOTH.x, BOOTH.z + .6, 3.4, 1.0);
const scanner = box(.9, .45, .6, M("#3a3a40"), .8, 1.35, .5, boothDesk);
const scanSlot = new THREE.Mesh(new THREE.PlaneGeometry(.6, .06), new THREE.MeshStandardMaterial({ color: "#000", emissive: "#7cff9a", emissiveIntensity: .2 }));
scanSlot.position.set(.8, 1.45, .805); boothDesk.add(scanSlot);
const inTray = box(.6, .08, .45, M("#c9c3b6"), -.7, 1.16, .75, boothDesk);
const inLabel = signPlane("IN", null, .4, .16, "#e0352b"); inLabel.position.set(-.7, 1.28, .99); boothDesk.add(inLabel);
const boothSign = signPlane("ACCOUNTS PAYABLE", "INSPECTOR ON DUTY", 4.2, 1.0, "#1f8a8a");
boothSign.position.set(BOOTH.x, 2.85, BOOTH.z - .5); scene.add(boothSign);
[-1.8, 1.8].forEach(dx => cyl(.02, .02, .5, dark, BOOTH.x + dx, 3.5, BOOTH.z - .5));
const glassMat = new THREE.MeshStandardMaterial({ color: "#bfe8ff", transparent: true, opacity: .25, roughness: .1 });
[-1.75, 1.75].forEach(dx => { const gl = box(.06, 1.6, 1.6, glassMat, BOOTH.x + dx, 1.4, BOOTH.z + .1); gl.castShadow = false; collide(BOOTH.x + dx, BOOTH.z + .1, .1, 1.6); });
const inspector = makeChar({ shirt: "#f4f4f4", pants: "#555", face: "😴", name: "GUS · v1", tagColor: "#1f8a8a" });
inspector.g.position.set(BOOTH.x, 0, BOOTH.z - .3); seatPose(inspector, false);
box(.62, .08, .62, dark, BOOTH.x, .5, BOOTH.z - .3);
const IN_TRAY = new THREE.Vector3(BOOTH.x - .7, 0, BOOTH.z + 1.6);

/* --- corkboard on the north wall: grows with every trick --- */
const pins = [];
const corkTex = canvasTex(1024, 640, (g, w, h) => {
  g.fillStyle = "#bd8a52"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { g.fillStyle = Math.random() < .5 ? "#a8763f" : "#cf9e66"; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  g.strokeStyle = "#7a4a22"; g.lineWidth = 30; g.strokeRect(0, 0, w, h);
  g.fillStyle = "#2b1d14"; g.font = "48px Bungee, Impact"; g.textAlign = "center"; g.fillText("NEVER AGAIN", w / 2, 80);
  pins.forEach((p, i) => {
    if (i > 0) { const q = pins[i - 1]; g.strokeStyle = "#d1201a"; g.lineWidth = 5; g.beginPath(); g.moveTo(q.x + 90, q.y + 10); g.lineTo(p.x + 90, p.y + 10); g.stroke(); }
  });
  pins.forEach(p => {
    g.save(); g.translate(p.x + 90, p.y + 60); g.rotate(p.r);
    g.fillStyle = "#fff"; g.fillRect(-90, -60, 180, 120);
    g.fillStyle = "#2b1d14"; g.font = "bold 18px 'Space Mono'"; g.textAlign = "center";
    g.fillText(p.scheme.slice(0, 16), 0, -22); g.font = "15px 'Space Mono'"; g.fillText(p.vendor.slice(0, 18), 0, 2);
    g.fillStyle = p.caught ? "#e0352b" : "#1d9a4b"; g.font = "26px Bungee, Impact"; g.fillText(p.caught ? "FLAGGED" : "GOT AWAY", 0, 42);
    g.restore();
    g.fillStyle = "#e0352b"; g.beginPath(); g.arc(p.x + 90, p.y + 10, 10, 0, 7); g.fill();
  });
});
const cork = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5), new THREE.MeshStandardMaterial({ map: corkTex, roughness: 1 }));
cork.position.set(3, 1.9, -RD / 2 + .17); scene.add(cork);

/* --- clerk --- */
const CLERK_DESK = { x: 8, z: 4 };
desk(CLERK_DESK.x, CLERK_DESK.z, { flip: true });
const clerk = makeChar({ shirt: "#f4a63a", face: "🥪", name: "BRENDA · CLERK", tagColor: "#a4581c" });
clerk.g.position.set(CLERK_DESK.x, 0, CLERK_DESK.z - .95); seatPose(clerk, false);
const lunchSign = signPlane("ON LUNCH", null, .8, .25, "#e0352b"); lunchSign.position.set(CLERK_DESK.x + .7, .95, CLERK_DESK.z + .56); scene.add(lunchSign);

/* --- boss office door + boss --- */
const door = box(.1, 2.4, 1.6, M("#5b3a22"), -RW / 2 + .2, 1.2, -5);
const bossPlate = signPlane("BOSS", null, .8, .3, "#2b1d14"); bossPlate.rotation.y = Math.PI / 2; bossPlate.position.set(-RW / 2 + .27, 2.6, -5); scene.add(bossPlate);
const boss = makeChar({ shirt: "#1b1b1b", pants: "#111", face: "😠", name: "THE BOSS", tagColor: "#e0352b", scale: 1.12 });
const BOSS_PATH = [[-12.2, -5], [-10.4, -5], [-10.4, 5.4], [-5.5, 5.4], [-5.5, -5.6], [-10.4, -5.6], [-12.2, -5]];
boss.g.position.set(-12.2, 0, -5); boss.g.visible = false;
const B = { state: "wait", t: rand(14, 22), i: 0, warned: false, chatted: false };

/* --- props --- */
plant(-12.2, 8.2); plant(12.2, 8.2); plant(12.2, -8.2); plant(-1, -8.2);
cyl(.3, .3, 1.0, M("#e8e8e8"), -12.3, .5, -8.2); const jug = cyl(.26, .26, .5, M("#7cc6ff", { transparent: true, opacity: .7 }), -12.3, 1.25, -8.2); jug.castShadow = false; collide(-12.3, -8.2, .7, .7);
const exitSign = signPlane("EXIT", null, 1, .35, "#1d9a4b"); exitSign.position.set(0, 2.6, RD / 2 - .17); exitSign.rotation.y = Math.PI; scene.add(exitSign);

/* ======================= Player ======================= */

const player = makeChar({ shirt: "#e0352b", face: "😏", name: "YOU", tagColor: "#e0352b" });
player.g.position.set(-5.5, 0, 7);
player.g.rotation.y = Math.PI;
const carryEnv = box(.5, .03, .32, envelopeMat, 0, 1.2, .45, player.g); carryEnv.visible = false;

const P = { started: false, seated: false, carrying: false, phase: "idle", yaw: .6, pitch: .55, dist: 6.5,
  keys: new Set(), envelopeReady: false, printing: false, scheme: "", shake: 0, hud: null };

/* ======================= Bubbles, toasts, objective ======================= */

const bubbles = [];
function say(ch, html, ms = 3200, kind = "") {
  bubbles.filter(b => b.ch === ch).forEach(b => b.el.remove());
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].ch === ch) bubbles.splice(i, 1);
  const el = document.createElement("div"); el.className = "wbubble " + kind; el.innerHTML = html;
  $("#bubbles").appendChild(el);
  bubbles.push({ ch, el, until: performance.now() + ms });
}
function wtoast(text, kind = "") {
  const t = document.createElement("div"); t.className = "wtoast " + kind; t.textContent = text;
  $("#wtoasts").appendChild(t); setTimeout(() => t.remove(), 3100);
}
const OBJECTIVES = {
  idle: "Sit at your computer and open FORGED.exe",
  briefing: "Pick a scheme on your computer",
  forging: "Forge the invoice on your computer",
  printing: "Printing…",
  pickup: "Grab the invoice from the printer",
  carrying: "Drop it in the inspector's IN tray. Act natural.",
  judging: "The inspector is reading it…",
  result: "Head back to your computer",
};
function setPhase(ph) {
  P.phase = ph;
  const o = $("#objective"); o.textContent = OBJECTIVES[ph];
  o.parentElement.classList.remove("flash"); void o.offsetWidth; o.parentElement.classList.add("flash");
}

/* ======================= Messages from the computer ======================= */

addEventListener("message", e => {
  const m = e.data;
  if (!m || m.src !== "forged-os") return;
  if (m.type === "stand") stand();
  if (m.type === "phase") {
    if (m.phase === "briefing" && !["pickup", "carrying", "judging"].includes(P.phase)) setPhase("briefing");
    if (m.phase === "forging") setPhase("forging");
  }
  if (m.type === "hud") applyHud(m);
  if (m.type === "print") startPrinting();
  if (m.type === "verdict") onVerdict(m);
});

function applyHud(h) {
  const prev = P.hud; P.hud = h;
  $("#hud-money").textContent = money(h.money);
  $("#hud-heat").style.width = clamp(h.heat, 0, 100) + "%";
  $("#hud-insp").textContent = `${h.inspector} v${h.version}`;
  if (!prev || prev.version !== h.version || prev.level !== h.level) {
    setTag(inspector, `${h.inspector.toUpperCase()} · v${h.version}`, PALETTES[h.level].accent);
    if (inspector.faceEmoji !== h.emoji) setFace(inspector, h.emoji);
  }
  if (!prev || prev.level !== h.level) applyPalette(h.level, h.clerk);
}

function applyPalette(level, clerkInfo) {
  pal = PALETTES[level] || PALETTES[1];
  redraw(floorTex);
  mats.wall.forEach(m => m.color.set(pal.wall));
  mats.accent.color.set(pal.accent); mats.accent2.color.set(pal.accent2);
  scene.background = new THREE.Color(pal.bg);
  if (clerkInfo) { setFace(clerk, clerkInfo.avatar); setTag(clerk, clerkInfo.name.toUpperCase() + " · CLERK", "#a4581c"); }
}

function startPrinting() {
  P.printing = true; setPhase("printing");
  setTimeout(() => {
    stand();
    wtoast("🖨️ Printing… go grab it", "good");
  }, 900);
  setTimeout(() => {
    P.printing = false; P.envelopeReady = true; envelope.visible = true;
    setPhase("pickup");
  }, 2600);
}

function onVerdict(m) {
  const cls = m.caught ? "flagged" : "paid";
  say(inspector, `<span class="stamp">${m.caught ? "FLAGGED" : "PAID"}</span>"${m.line}"`, 6000, cls);
  pins.push({ x: 60 + (pins.length % 4) * 230, y: 130 + Math.floor(pins.length / 4 % 3) * 160, r: rand(-.12, .12), scheme: m.scheme, vendor: m.vendor, caught: m.caught });
  redraw(corkTex);
  if (m.caught) { P.shake = .5; wtoast("FLAGGED — the inspector pinned your trick to the corkboard", "bad"); }
  else wtoast(`PAID +${money(m.payout)}`, "good");
  scanSlot.material.emissive.set(m.caught ? "#e0352b" : "#7cff9a"); scanSlot.material.emissiveIntensity = 1.2;
  setTimeout(() => { scanSlot.material.emissive.set("#7cff9a"); scanSlot.material.emissiveIntensity = .2; }, 3000);
  setPhase("result");
}

/* ======================= Interactions ======================= */

const near = (v, r) => Math.hypot(player.g.position.x - v.x, player.g.position.z - v.z) < r;
const INTERACTIONS = [
  { label: () => "Use your computer", can: () => !P.carrying && near(CHAIR, 1.7), act: sit },
  { label: () => "Grab the invoice", can: () => P.envelopeReady && !P.carrying && near({ x: PRINTER.x, z: PRINTER.z + .9 }, 1.8), act: grab },
  { label: () => "Drop it in the IN tray", can: () => P.carrying && near(IN_TRAY, 1.9), act: deliver },
  { label: () => `Talk to ${P.hud ? P.hud.clerk.name : "Brenda"}`, can: () => near({ x: CLERK_DESK.x, z: CLERK_DESK.z + 1.2 }, 2.2) || near({ x: CLERK_DESK.x, z: CLERK_DESK.z - 1.6 }, 1.6), act: () => say(clerk, P.hud ? `"${P.hud.clerk.hello}" <br><small>(Send your cover note from your computer.)</small>` : `"I'm on lunch, hon. Email me."`, 3800) },
  { label: () => `Chat with ${P.hud ? P.hud.inspector : "Gus"}`, can: () => !P.carrying && near(IN_TRAY, 1.9), act: () => say(inspector, pick(["Mmm… pie.", "Did you know I have a stapler?", "I read every invoice. Mostly.", "Is it lunch yet?"]), 2600) },
  { label: () => "Look at the corkboard", can: () => near({ x: 3, z: -RD / 2 + 1.2 }, 1.8), act: () => wtoast(pins.length ? `${pins.length} trick${pins.length > 1 ? "s" : ""} pinned. ${pins.filter(p => p.caught).length} caught.` : "Empty… for now.") },
  { label: () => "Small talk with the Boss", can: () => boss.g.visible && near(boss.g.position, 1.8), act: () => say(boss, pick(["Shouldn't you be at your desk?", "Numbers. I want numbers.", "Nice weather for compliance."]), 2400) },
];
let current = null;
function updatePrompt() {
  current = P.seated || !P.started ? null : INTERACTIONS.find(i => i.can());
  const el = $("#prompt");
  el.classList.toggle("show", !!current);
  if (current) el.innerHTML = `<kbd>E</kbd>${current.label()}`;
}

function sit() {
  P.seated = true;
  document.exitPointerLock && document.exitPointerLock();
  player.g.position.set(CHAIR.x, 0, CHAIR.z + .05); player.g.rotation.y = Math.PI; seatPose(player, true);
  player.head.visible = player.tag.visible = false; // the camera sits right behind your head
  document.body.classList.add("seated");
  setTimeout(() => {
    if (!P.seated) return;
    $("#monitor").classList.add("show");
    OS.focus(); OS.contentWindow && OS.contentWindow.focus();
  }, 450);
}
function stand() {
  if (!P.seated) return;
  P.seated = false;
  $("#monitor").classList.remove("show");
  standPose(player);
  player.head.visible = player.tag.visible = true;
  document.body.classList.remove("seated");
  player.g.position.set(CHAIR.x, 0, CHAIR.z + .9);
  P.yaw = 0; P.pitch = .5;
  window.focus();
}
function grab() {
  P.envelopeReady = false; envelope.visible = false; P.carrying = true; carryEnv.visible = true;
  setPhase("carrying");
}
function deliver() {
  P.carrying = false; carryEnv.visible = false;
  // envelope slides from the IN tray into the scanner
  const env = box(.5, .03, .32, envelopeMat, -.7, 1.22, .75, boothDesk);
  const t0 = performance.now();
  (function slide() {
    const k = Math.min(1, (performance.now() - t0) / 900);
    env.position.set(-.7 + 1.5 * k, 1.22 + .25 * Math.sin(k * Math.PI), .75 - .25 * k);
    scanSlot.material.emissiveIntensity = .2 + k;
    if (k < 1) requestAnimationFrame(slide); else boothDesk.remove(env);
  })();
  say(inspector, "Hmm… let me see…", 1800);
  setPhase("judging");
  setTimeout(() => toOS("deliver"), 900);
}

/* ======================= Input ======================= */

addEventListener("keydown", e => {
  if (!P.started) return;
  if (e.code === "Escape" && P.seated) { stand(); return; }
  if (P.seated) return;
  P.keys.add(e.code);
  if (e.code === "KeyE" && current) current.act();
});
addEventListener("keyup", e => P.keys.delete(e.code));
addEventListener("blur", () => P.keys.clear());

canvas.addEventListener("click", () => { if (P.started && !P.seated && document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
addEventListener("mousemove", e => {
  if (P.seated) return;
  if (document.pointerLockElement === canvas || e.buttons === 1) {
    P.yaw -= e.movementX * .0026;
    P.pitch = clamp(P.pitch + e.movementY * .002, .12, 1.15);
  }
});
addEventListener("wheel", e => { P.dist = clamp(P.dist + e.deltaY * .004, 3.5, 10); }, { passive: true });

$("#btn-start").onclick = () => {
  $("#start").classList.add("hide"); P.started = true;
  canvas.requestPointerLock && canvas.requestPointerLock();
  say(player, "Another day at the office…", 2500);
};
$("#btn-stand").onclick = stand;

/* ======================= Simulation ======================= */

function collidePlayer(pos) {
  const r = .35;
  pos.x = clamp(pos.x, -RW / 2 + .5, RW / 2 - .5);
  pos.z = clamp(pos.z, -RD / 2 + .5, RD / 2 - .5);
  for (const c of colliders) {
    const cx = clamp(pos.x, c.minX, c.maxX), cz = clamp(pos.z, c.minZ, c.maxZ);
    const dx = pos.x - cx, dz = pos.z - cz, d = Math.hypot(dx, dz);
    if (d < r) {
      if (d > 1e-4) { pos.x = cx + dx / d * r; pos.z = cz + dz / d * r; }
      else { pos.z = c.maxZ + r; }
    }
  }
}

function updatePlayer(dt) {
  if (P.seated) return;
  const k = P.keys;
  const f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
  const s = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
  const fwd = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
  const right = new THREE.Vector3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  const dir = fwd.multiplyScalar(f).add(right.multiplyScalar(s));
  let speed = 0;
  if (dir.lengthSq() > 0) {
    dir.normalize();
    speed = k.has("ShiftLeft") || k.has("ShiftRight") ? 7 : 4;
    const pos = player.g.position;
    pos.addScaledVector(dir, speed * dt);
    collidePlayer(pos);
    const target = Math.atan2(dir.x, dir.z);
    let diff = target - player.g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.g.rotation.y += diff * Math.min(1, dt * 12);
  }
  animWalk(player, dt, speed);
}

function updateBoss(dt, now) {
  if (B.state === "wait") {
    B.t -= dt;
    if (B.t <= 0) { B.state = "walk"; B.i = 1; boss.g.visible = true; B.warned = B.chatted = false; }
    return;
  }
  const [tx, tz] = BOSS_PATH[B.i];
  const pos = boss.g.position;
  const dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
  const sp = 1.7;
  if (d < .05) {
    B.i++;
    if (B.i >= BOSS_PATH.length) { B.state = "wait"; B.t = rand(16, 32); boss.g.visible = false; animWalk(boss, dt, 0); return; }
  } else {
    pos.x += dx / d * Math.min(d, sp * dt); pos.z += dz / d * Math.min(d, sp * dt);
    boss.g.rotation.y = Math.atan2(dx, dz);
  }
  animWalk(boss, dt, sp);
  // the boss looks over your shoulder while you forge
  const behindYou = Math.hypot(pos.x - CHAIR.x, pos.z - (CHAIR.z + 1.5)) < 3.2;
  if (behindYou && P.seated && P.phase === "forging" && !B.warned) {
    B.warned = true; toOS("boss-near");
    say(boss, "Hmm? What are you working on?", 2500);
  }
  if (!P.seated && !B.chatted && near(pos, 2.2)) {
    B.chatted = true;
    say(boss, P.carrying ? "What's in the envelope?" : "Shouldn't you be at your desk?", 2200);
  }
}

const tmp = new THREE.Vector3();
function updateCamera(dt) {
  if (P.seated) {
    camera.position.lerp(tmp.set(CHAIR.x + .25, 1.95, CHAIR.z + 1.25), Math.min(1, dt * 6));
    camera.lookAt(MY_DESK.x, 1.3, MY_DESK.z - .3);
    return;
  }
  const t = player.g.position;
  const cp = Math.cos(P.pitch);
  const want = tmp.set(t.x + Math.sin(P.yaw) * cp * P.dist, 1.4 + Math.sin(P.pitch) * P.dist, t.z + Math.cos(P.yaw) * cp * P.dist);
  camera.position.lerp(want, Math.min(1, dt * 10));
  if (P.shake > 0) { P.shake -= dt; camera.position.x += rand(-.15, .15); camera.position.y += rand(-.1, .1); }
  camera.lookAt(t.x, 1.4, t.z);
  walls.forEach(w => { w.mat.opacity = w.outside(camera.position) ? .1 : 1; w.mat.depthWrite = w.mat.opacity > .5; });
}

function updateBubbles(now) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (now > b.until) { b.el.remove(); bubbles.splice(i, 1); continue; }
    const p = b.ch.g.position.clone(); p.y += 2.95 * b.ch.scale + (b.ch.g.position.y < 0 ? -.2 : 0);
    p.project(camera);
    const vis = p.z < 1 && !(P.seated && b.ch !== boss);
    b.el.style.display = vis ? "" : "none";
    b.el.style.left = (p.x * .5 + .5) * innerWidth + "px";
    b.el.style.top = (-p.y * .5 + .5) * innerHeight + "px";
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  updatePlayer(dt);
  updateBoss(dt, now);
  // idle life: coworkers type, inspector bobs, printer blinks
  [kevin, dana].forEach((c, i) => { c.armL.rotation.x = -1.1 + Math.sin(now / 90 + i) * .12; c.armR.rotation.x = -1.1 + Math.cos(now / 80 + i) * .12; });
  inspector.head.position.y = 2.02 + Math.sin(now / 700) * .04;
  if (P.seated) { player.armL.rotation.x = -1.1 + Math.sin(now / 85) * .1; player.armR.rotation.x = -1.1 + Math.cos(now / 95) * .1; }
  printerLight.material.emissiveIntensity = P.printing ? (Math.sin(now / 80) > 0 ? 1.5 : .1) : P.envelopeReady ? 1.2 : .3;
  envelope.position.y = .99 + (P.envelopeReady ? Math.abs(Math.sin(now / 300)) * .05 : 0);
  updateCamera(dt);
  updatePrompt();
  updateBubbles(now);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// handy in the devtools console while prototyping
window.forged = { P, player, boss: B, sit, stand, setPhase };

})();
