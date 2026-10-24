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
let osLoaded = false;
OS.addEventListener("load", () => { osLoaded = true; });
try { const d = OS.contentDocument; if (d && d.readyState === "complete" && d.URL !== "about:blank") osLoaded = true; } catch (e) { osLoaded = true; }
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
canvas.tabIndex = -1; // focusable, so standing up can pull the keyboard back from the computer

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize); resize();

scene.add(new THREE.HemisphereLight("#fff6e0", "#8a7a6a", 0.5));
const sun = new THREE.DirectionalLight("#ffffff", 0.55);
sun.position.set(-8, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
scene.add(sun);

const RW = 26, RD = 18; // room size
/* Cartoon look to match the 2D UI: 3-band toon shading + thick black outlines
 * (inverted hull: a slightly bigger back-face copy of each mesh). */
// r128 samples .rgb of the gradient, so it has to be a grey RGBA ramp
const gradientMap = new THREE.DataTexture(new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
gradientMap.needsUpdate = true;
const M = (color, o = {}) => {
  const { roughness, metalness, ...rest } = o;
  return new THREE.MeshToonMaterial({ color, gradientMap, ...rest });
};
const mats = { wall: [], accent: M("#1f8a8a"), accent2: M("#f4a63a") };
const colliders = [];

const OUTLINE = new THREE.MeshBasicMaterial({ color: "#1a1210", side: THREE.BackSide });
function outline(m, t = .028) {
  if (m.material.transparent) return m;
  m.geometry.computeBoundingBox();
  const s = new THREE.Vector3(); m.geometry.boundingBox.getSize(s);
  const o = new THREE.Mesh(m.geometry, OUTLINE);
  o.scale.set((s.x + 2 * t) / (s.x || 1), (s.y + 2 * t) / (s.y || 1), (s.z + 2 * t) / (s.z || 1));
  m.add(o); return m;
}

function box(w, h, d, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  parent.add(m); return outline(m);
}
function cyl(rt, rb, h, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 20), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  parent.add(m); return outline(m);
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

// ceiling faces down only, so it shows in first person but is culled from the third-person camera above
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), M("#f3ead8"));
ceiling.rotation.x = Math.PI / 2; ceiling.position.y = 3.2; scene.add(ceiling);

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

/* ======================= Characters: chunky cartoon people ======================= */
/* Big blocky heads with googly eyes, brows, noses and hair, in the spirit of
 * Scam With Your Friends' goofy office workers. Everything is primitives. */

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

const INK = M("#1a1210"), WHITE = M("#ffffff");
function sphere(r, mat, x, y, z, parent, segs = 14) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, segs, segs), mat);
  m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
}
function shade(hex, k) { const c = new THREE.Color(hex); c.offsetHSL(0, 0, k); return "#" + c.getHexString(); }

// head local space: centre at 0, face towards +z, about 0.66 wide/tall
function buildHead(look) {
  const L = Object.assign({ skin: "#f1c27d", hair: "spiky", hairColor: "#3b2416", brows: "flat", mouth: "flat", nose: "round" }, look);
  const head = new THREE.Group();
  const skin = M(L.skin), hairM = M(L.hairColor);
  const W = L.wide ? .74 : .64, H = .66, D = .58;
  box(W, H, D, skin, 0, 0, 0, head);
  [-1, 1].forEach(sx => box(.08, .16, .12, skin, sx * (W / 2 + .03), -.02, 0, head)); // ears
  // eyes: big white balls with pupils that look around
  const eyes = [], pupils = [];
  [-1, 1].forEach(sx => {
    const e = sphere(.105, WHITE, sx * .15, .06, D / 2 + .01, head);
    e.scale.z = .6; eyes.push(e);
    pupils.push(sphere(.05, INK, sx * .15, .06, D / 2 + .075, head, 10));
  });
  // heavy sleepy lids
  const lids = [-1, 1].map(sx => { const l = box(.23, .1, .1, skin, sx * .15, .12, D / 2 + .04, head); l.visible = !!L.lids; return l; });
  // brows
  const tilt = { flat: 0, angry: .45, worried: -.35, raised: 0 }[L.brows] || 0;
  [-1, 1].forEach(sx => {
    const b = box(.2, .05, .05, hairM, sx * .15, .21 + (L.brows === "raised" && sx > 0 ? .05 : 0), D / 2 + .03, head);
    b.rotation.z = -sx * tilt;
  });
  // nose
  if (L.nose === "big") box(.13, .17, .16, M(shade(L.skin, -.12)), 0, -.06, D / 2 + .07, head);
  else sphere(.07, M(shade(L.skin, -.12)), 0, -.05, D / 2 + .04, head, 10);
  // mouth
  const mouth = new THREE.Group(); mouth.position.set(0, -.2, D / 2 + .01); head.add(mouth);
  if (L.mouth === "grin") { box(.3, .1, .04, INK, 0, 0, 0, mouth); box(.24, .04, .045, WHITE, 0, .02, 0, mouth); }
  else if (L.mouth === "smirk") { box(.22, .045, .04, INK, .04, .01, 0, mouth).rotation.z = .25; }
  else if (L.mouth === "frown") { [-1, 1].forEach(sx => { box(.13, .045, .04, INK, sx * .055, -.01, 0, mouth).rotation.z = sx * .35; }); }
  else if (L.mouth === "o") { mouth.add(new THREE.Mesh(new THREE.TorusGeometry(.05, .02, 8, 16), INK)); }
  else box(.2, .045, .04, INK, 0, 0, 0, mouth);
  if (L.teeth) box(.1, .06, .03, WHITE, 0, -.05, .01, mouth);
  if (L.mustache) {
    box(.34, .07, .06, hairM, 0, .07, .02, mouth);
    [-1, 1].forEach(sx => { box(.08, .06, .06, hairM, sx * .19, .04, .02, mouth).rotation.z = sx * .5; });
  }
  // hair
  const top = H / 2;
  if (L.hair === "spiky") for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(.1, .24, 6), hairM);
    c.position.set(-.24 + i * .12, top + .08, rand(-.12, .1)); c.rotation.z = rand(-.4, .4); head.add(outline(c, .02));
  }
  if (L.hair === "bowl") { box(W + .06, .16, D + .06, hairM, 0, top - .02, -.01, head); box(W + .06, .12, .06, hairM, 0, top - .12, D / 2 + .02, head); }
  if (L.hair === "bun") { box(W + .04, .12, D + .04, hairM, 0, top, 0, head); sphere(.15, hairM, 0, top + .16, -.12, head); }
  if (L.hair === "neat") { box(W + .04, .1, D + .04, hairM, 0, top, 0, head); }
  if (L.hair === "curly") for (let i = 0; i < 9; i++) sphere(.12, hairM, -.26 + (i % 5) * .13, top + .02 + Math.floor(i / 5) * .06, -.14 + Math.floor(i / 5) * .2, head, 8);
  if (L.hair === "messy") {
    box(W + .04, .12, D + .04, hairM, 0, top, 0, head);
    for (let i = 0; i < 3; i++) box(.1, .14, .1, hairM, -.18 + i * .17, top + .1, rand(-.1, .1), head).rotation.z = rand(-.6, .6);
  }
  if (L.hair === "combover") {
    box(W - .2, .05, D - .1, hairM, .05, top + .02, 0, head);
    [-1, 1].forEach(sx => box(.06, .2, D - .1, hairM, sx * (W / 2 + .01), .05, 0, head));
  }
  if (L.glasses) glasses(head, D, "#1a1210");
  if (L.earrings) [-1, 1].forEach(sx => sphere(.04, M("#ffd23f"), sx * (W / 2 + .05), -.14, .02, head, 8));
  return { head, eyes, pupils, lids, D, W };
}
function glasses(head, D, color, lens) {
  const g = new THREE.Group(); head.add(g);
  const frame = M(color);
  [-1, 1].forEach(sx => {
    const r = new THREE.Mesh(new THREE.TorusGeometry(.11, .022, 8, 20), frame);
    r.position.set(sx * .15, .06, D / 2 + .1); g.add(r);
    if (lens) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(.1, 16), new THREE.MeshBasicMaterial({ color: lens, transparent: true, opacity: .65 }));
      l.position.copy(r.position); g.add(l);
    }
  });
  box(.1, .025, .025, frame, 0, .07, D / 2 + .1, g);
  return g;
}

const characters = [];
function makeChar({ shirt, pants = "#2b2b44", skin = "#f1c27d", look = {}, tie, name, tagColor, scale = 1 }) {
  const g = new THREE.Group();
  const limb = (w, h, d, mat, px, py) => {
    const pivot = new THREE.Group(); pivot.position.set(px, py, 0); g.add(pivot);
    box(w, h, d, mat, 0, -h / 2, 0, pivot); return pivot;
  };
  const legL = limb(.2, .85, .22, M(pants), -.15, .88), legR = limb(.2, .85, .22, M(pants), .15, .88);
  [legL, legR].forEach(l => box(.24, .1, .3, M("#2e2a28"), 0, -.86, .05, l)); // shoes
  box(.62, .75, .36, M(shirt), 0, 1.25, 0, g);
  if (tie) { box(.1, .5, .03, M(tie), 0, 1.3, .19, g); box(.14, .08, .04, M(tie), 0, 1.55, .19, g); }
  const armL = limb(.16, .66, .18, M(shirt), -.4, 1.58), armR = limb(.16, .66, .18, M(shirt), .4, 1.58);
  [armL, armR].forEach(a => box(.15, .14, .15, M(skin), 0, -.72, 0, a));
  const face = buildHead(Object.assign({ skin }, look));
  const head = face.head; head.position.y = 2.02; g.add(head);
  const tex = tagTex({ label: name, color: tagColor });
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  tag.scale.set(1.6, .3, 1); tag.position.y = 2.72; tag.renderOrder = 10; g.add(tag);
  g.scale.setScalar(scale);
  scene.add(g);
  const ch = { g, legL, legR, armL, armR, head, face, tag, tagTex: tex, walkT: 0, scale, blinkAt: rand(1, 4) };
  characters.push(ch);
  return ch;
}

// everyone's googly eyes follow a target (you); they blink now and then
const _v = new THREE.Vector3();
function updateFaces(now, target) {
  const t = now / 1000;
  for (const ch of characters) {
    if (!ch.g.visible || !ch.head.visible) continue;
    _v.copy(ch === player ? camera.position : target); ch.head.worldToLocal(_v);
    const len = Math.hypot(_v.x, _v.y, _v.z) || 1;
    const lx = clamp(_v.x / len, -1, 1) * .045, ly = clamp(_v.y / len, -1, 1) * .035;
    ch.face.pupils.forEach((p, i) => { p.position.x = (i ? .15 : -.15) + lx; p.position.y = .06 + ly; });
    const blink = t > ch.blinkAt && t < ch.blinkAt + .12;
    if (t > ch.blinkAt + .12) ch.blinkAt = t + rand(2, 5);
    ch.face.eyes.forEach(e => e.scale.y = blink ? .12 : 1);
  }
}

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
  leaves.position.set(x, .95, z); leaves.castShadow = true; scene.add(leaves); outline(leaves, .04);
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
const kevin = makeChar({ shirt: "#7a5cff", look: { hair: "bowl", hairColor: "#c98a3a", glasses: true, teeth: true, mouth: "grin", brows: "raised" }, name: "KEVIN", tagColor: "#555" });
kevin.g.position.set(-3, 0, 2.95); kevin.g.rotation.y = Math.PI; seatPose(kevin, true);
const dana = makeChar({ shirt: "#3fae6a", skin: "#a8714a", look: { hair: "bun", hairColor: "#1e1410", lids: true, mouth: "flat", brows: "flat" }, name: "DANA", tagColor: "#555" });
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
const inspector = makeChar({ shirt: "#f4f4f4", pants: "#555", tie: "#1f8a8a", look: { hair: "messy", hairColor: "#8a5a35", lids: true, mouth: "o", nose: "big" }, name: "GUS · v1", tagColor: "#1f8a8a" });
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
const clerk = makeChar({ shirt: "#f4a63a", skin: "#e0a77a", look: { hair: "curly", hairColor: "#b8342a", earrings: true, mouth: "grin", brows: "raised" }, name: "BRENDA · CLERK", tagColor: "#a4581c" });
clerk.g.position.set(CLERK_DESK.x, 0, CLERK_DESK.z - .95); seatPose(clerk, false);
const lunchSign = signPlane("ON LUNCH", null, .8, .25, "#e0352b"); lunchSign.position.set(CLERK_DESK.x + .7, .95, CLERK_DESK.z + .56); scene.add(lunchSign);

/* --- boss office door + boss --- */
const door = box(.1, 2.4, 1.6, M("#5b3a22"), -RW / 2 + .2, 1.2, -5);
const bossPlate = signPlane("BOSS", null, .8, .3, "#2b1d14"); bossPlate.rotation.y = Math.PI / 2; bossPlate.position.set(-RW / 2 + .27, 2.6, -5); scene.add(bossPlate);
const boss = makeChar({ shirt: "#1b1b1b", pants: "#111", tie: "#e0352b", look: { hair: "combover", hairColor: "#555", wide: true, brows: "angry", mouth: "frown", mustache: true, nose: "big" }, name: "THE BOSS", tagColor: "#e0352b", scale: 1.12 });
const BOSS_PATH = [[-12.2, -5], [-10.4, -5], [-10.4, 5.4], [-5.5, 5.4], [-5.5, -5.6], [-10.4, -5.6], [-12.2, -5]];
boss.g.position.set(-12.2, 0, -5); boss.g.visible = false;
const B = { state: "wait", t: rand(14, 22), i: 0, warned: false, chatted: false, sus: 0, busted: false, pauseUntil: 0 };
// vision cone on the floor (Hitman-style): get caught in it carrying the envelope and he stops you
const CONE_R = 4.2, CONE_HALF = .55;
const coneMat = new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: .22, depthWrite: false, side: THREE.DoubleSide });
const cone = new THREE.Mesh(new THREE.CircleGeometry(CONE_R / 1.12, 28, -Math.PI / 2 - CONE_HALF, CONE_HALF * 2), coneMat);
cone.rotation.x = -Math.PI / 2; cone.position.y = .04; boss.g.add(cone);

/* --- props --- */
plant(-12.2, 8.2); plant(12.2, 8.2); plant(12.2, -8.2); plant(-1, -8.2);
cyl(.3, .3, 1.0, M("#e8e8e8"), -12.3, .5, -8.2); const jug = cyl(.26, .26, .5, M("#7cc6ff", { transparent: true, opacity: .7 }), -12.3, 1.25, -8.2); jug.castShadow = false; collide(-12.3, -8.2, .7, .7);
const exitSign = signPlane("EXIT", null, 1, .35, "#1d9a4b"); exitSign.position.set(0, 2.6, RD / 2 - .17); exitSign.rotation.y = Math.PI; scene.add(exitSign);

/* --- hanging lamps: warm pools of light --- */
[[-8, 1], [-3, -.5], [8, -4.5], [8, 3.5], [2, 6]].forEach(([x, z]) => {
  cyl(.01, .01, .8, dark, x, 3.8, z);
  const shade = cyl(.1, .36, .28, mats.accent2, x, 3.3, z);
  shade.castShadow = false;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 10), new THREE.MeshBasicMaterial({ color: "#fff3c4" }));
  bulb.position.set(x, 3.14, z); scene.add(bulb);
  const l = new THREE.PointLight("#fff1dc", .25, 6, 2); l.position.set(x, 3.0, z); scene.add(l);
});

/* --- the inspector visibly evolves with each detector version (design doc §9) --- */
const STAGES = [
  { upTo: 3, name: "Sleepy Intern", gear: "a red stapler" },
  { upTo: 6, name: "Clerk with a Magnifier", gear: "a magnifying glass" },
  { upTo: 9, name: "Auditor with a UV Lamp", gear: "a UV lamp" },
  { upTo: 99, name: "Cyborg with a Monocle", gear: "a laser monocle" },
];
const stageOf = v => STAGES.findIndex(s => v <= s.upTo);
const inspGear = STAGES.map(() => { const g = new THREE.Group(); g.visible = false; boothDesk.add(g); return g; });
// 0: stapler + coffee
box(.34, .09, .12, M("#e0352b"), -.15, 1.17, .3, inspGear[0]);
cyl(.07, .06, .16, M("#fff"), .25, 1.2, .35, inspGear[0]);
// 1: magnifying glass held up to the face
{
  const lens = new THREE.Mesh(new THREE.TorusGeometry(.17, .035, 8, 24), dark); lens.position.set(.22, 1.62, .05); inspGear[1].add(lens);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(.16, 20), new THREE.MeshBasicMaterial({ color: "#bfe8ff", transparent: true, opacity: .45 }));
  glass.position.copy(lens.position); inspGear[1].add(glass);
  box(.05, .32, .05, M("#8a5a35"), .3, 1.36, .05, inspGear[1]).rotation.z = .4;
}
// 2: UV desk lamp bathing the counter in purple
{
  cyl(.15, .18, .05, dark, -1.2, 1.15, .4, inspGear[2]);
  box(.04, .55, .04, dark, -1.2, 1.42, .4, inspGear[2]);
  const head = cyl(.05, .2, .2, M("#5a2ca0"), -1.05, 1.68, .45, inspGear[2]); head.rotation.z = -.9;
  const uv = new THREE.PointLight("#a35cff", 1.6, 4, 2); uv.position.set(-.9, 1.5, .5); inspGear[2].add(uv);
}
// 3: cyborg red glow over the booth (the face parts live on his head, below)
{
  const red = new THREE.PointLight("#ff3030", 1.2, 3.5, 2); red.position.set(0, 1.8, .6); inspGear[3].add(red);
}
// the inspector's face changes with each stage too
const inspLooks = (() => {
  const h = inspector.head, D = inspector.face.D;
  const specs = glasses(h, D, "#1a1210");                       // v4-6: reading glasses
  const goggles = glasses(h, D, "#3a1a6a", "#b77dff");          // v7-9: UV goggles
  goggles.scale.set(1.15, 1.15, 1);
  const cyborg = new THREE.Group(); h.add(cyborg);              // v10+: metal plate, laser eye, antenna
  box(.36, .5, .06, metal, .17, .02, D / 2 + .02, cyborg);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(.085, 12, 12), new THREE.MeshBasicMaterial({ color: "#ff2b2b" }));
  eye.position.set(.15, .06, D / 2 + .08); cyborg.add(eye);
  cyl(.015, .015, .35, metal, -.15, .5, 0, cyborg);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 8), new THREE.MeshBasicMaterial({ color: "#ff2b2b" }));
  tip.position.set(-.15, .7, 0); cyborg.add(tip);
  return [null, specs, goggles, cyborg];
})();
let shownStage = -1;
setTimeout(() => showStage(1, false));
function showStage(v, announce) {
  const s = stageOf(v);
  if (s === shownStage) return;
  inspGear.forEach((g, i) => g.visible = i === s);
  inspLooks.forEach((g, i) => { if (g) g.visible = i === s; });
  inspector.face.lids.forEach(l => l.visible = s === 0);
  inspector.face.pupils[1].visible = inspector.face.eyes[1].visible = s !== 3;
  if (announce && shownStage >= 0) {
    say(inspector, `⬆ UPGRADE: ${STAGES[s].name}<br><small>now armed with ${STAGES[s].gear}</small>`, 4500, "flagged");
    wtoast(`The inspector got smarter: ${STAGES[s].name}`, "bad"); sfx("upgrade");
  }
  shownStage = s;
}

/* --- "detector live" TV on the east wall: the model improving, visible in the room --- */
const tvHistory = [];
let tvVersion = 1;
const tvTex = canvasTex(1024, 576, (g, w, h) => {
  g.fillStyle = "#101418"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#7cff9a"; g.font = "44px Bungee, Impact"; g.textAlign = "left"; g.fillText("DETECTOR LIVE", 40, 70);
  g.fillStyle = "#fff"; g.font = "bold 30px 'Space Mono'"; g.textAlign = "right"; g.fillText(`INSPECTOR v${tvVersion}`, w - 40, 66);
  const caught = tvHistory.filter(r => r.caught).length;
  const rate = tvHistory.length ? Math.round(caught / tvHistory.length * 100) : 0;
  g.textAlign = "left"; g.fillStyle = "#aaa"; g.font = "24px 'Space Mono'";
  g.fillText(tvHistory.length ? `catch rate ${rate}% over ${tvHistory.length} attempt${tvHistory.length > 1 ? "s" : ""}` : "waiting for the first invoice…", 40, 115);
  const base = h - 70, maxH = 300, bw = 60;
  g.strokeStyle = "#333"; g.lineWidth = 2; g.beginPath(); g.moveTo(40, base); g.lineTo(w - 40, base); g.stroke();
  tvHistory.slice(-12).forEach((r, i) => {
    const x = 60 + i * (bw + 15), bh = r.caught ? maxH : maxH * .45;
    g.fillStyle = r.caught ? "#e0352b" : "#1d9a4b"; g.fillRect(x, base - bh, bw, bh);
    g.fillStyle = "#fff"; g.font = "bold 20px 'Space Mono'"; g.textAlign = "center"; g.fillText("v" + r.version, x + bw / 2, base + 28);
    g.fillText(r.caught ? "✗" : "$", x + bw / 2, base - bh - 10);
  });
});
{
  const frame = box(.12, 1.9, 3.3, dark, RW / 2 - .22, 2.1, 0);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.74), new THREE.MeshBasicMaterial({ map: tvTex }));
  screen.rotation.y = -Math.PI / 2; screen.position.set(RW / 2 - .3, 2.1, 0); scene.add(screen);
  frame.castShadow = false;
}

// canvases drawn at startup used fallback fonts: redraw them once Bungee / Space Mono are loaded
if (document.fonts) document.fonts.ready.then(() => [tvTex, corkTex, myScreenTex].forEach(t => redraw(t)));

/* --- objective marker: a bobbing diamond + floor ring on whatever to do next --- */
const markerMat = new THREE.MeshBasicMaterial({ color: "#ffd23f" });
const marker = outline(new THREE.Mesh(new THREE.OctahedronGeometry(.26, 0), markerMat), .04);
marker.scale.y = 1.5; scene.add(marker);
const ring = new THREE.Mesh(new THREE.RingGeometry(.65, .82, 40), new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false }));
ring.rotation.x = -Math.PI / 2; ring.position.y = .03; scene.add(ring);

/* --- the player's desk gets messier every round (design doc §4) --- */
let messCount = 0;
function messUpDesk() {
  if (messCount >= 10) return;
  const x = MY_DESK.x + rand(-.95, .95), z = MY_DESK.z + rand(-.05, .45);
  const kind = messCount++ % 4;
  if (kind === 0) cyl(.06, .05, .13, M(pick(["#fff", "#e0352b", "#1f8a8a"])), x, .865, z);
  if (kind === 1) for (let i = 0; i < 3; i++) box(.3, .02, .4, M("#fffaf0"), x, .81 + i * .022, z).rotation.y = rand(-.4, .4);
  if (kind === 2) box(.16, .01, .16, M("#fff27a"), x, .805, z).rotation.y = rand(-.6, .6);
  if (kind === 3) { const d = new THREE.Mesh(new THREE.TorusGeometry(.08, .04, 8, 16), M("#e89ac7")); d.rotation.x = Math.PI / 2; d.position.set(x, .83, z); scene.add(d); outline(d, .015); }
}

/* ======================= Player ======================= */

const player = makeChar({ shirt: "#e0352b", look: { hair: "spiky", hairColor: "#2b1d14", brows: "raised", mouth: "smirk" }, name: "YOU", tagColor: "#e0352b" });
player.g.position.set(-5.5, 0, 7);
player.g.rotation.y = Math.PI;
// held in the right hand, upright, so it reads from the camera behind you
const carryEnv = box(.5, .03, .32, envelopeMat, .52, 1.05, .12, player.g); carryEnv.rotation.set(Math.PI / 2, 0, .25); carryEnv.visible = false;

const P = { fp: false, frozenUntil: 0, lastStep: 0, stampAt: 0, started: false, seated: false, carrying: false, phase: "idle", yaw: .6, pitch: .55, dist: 6.5,
  keys: new Set(), envelopeReady: false, printing: false, scheme: "", shake: 0, hud: null };

/* ======================= Sound (tiny WebAudio synth, same style as the computer) ======================= */

let actx = null;
function sfx(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const t = actx.currentTime;
    const tone = (f, d, type = "square", v = .06, f2 = null, at = 0) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t + at);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + at + d);
      g.gain.setValueAtTime(v, t + at); g.gain.exponentialRampToValueAtTime(.0001, t + at + d);
      o.connect(g).connect(actx.destination); o.start(t + at); o.stop(t + at + d);
    };
    const noise = (d, v = .2, at = 0) => {
      const b = actx.createBuffer(1, actx.sampleRate * d, actx.sampleRate), ch = b.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
      const s = actx.createBufferSource(), g = actx.createGain(); s.buffer = b; g.gain.value = v;
      s.connect(g).connect(actx.destination); s.start(t + at);
    };
    ({
      step: () => tone(rand(85, 105), .05, "sine", .05, 60),
      print: () => { for (let i = 0; i < 6; i++) tone(220 + (i % 2) * 40, .14, "sawtooth", .02, null, i * .2); },
      pickup: () => tone(500, .12, "triangle", .08, 900),
      drop: () => { noise(.08, .25); tone(160, .15, "sine", .1, 90); },
      cash: () => { tone(988, .1, "square", .06); tone(1319, .35, "square", .06, null, .1); },
      buzz: () => tone(110, .5, "sawtooth", .1, 80),
      huh: () => tone(300, .25, "triangle", .07, 520),
      busted: () => { tone(880, .12, "square", .07); tone(660, .12, "square", .07, null, .13); tone(440, .3, "square", .07, null, .26); },
      door: () => { noise(.15, .15); tone(140, .2, "sine", .08, 90, .05); },
      heart: () => { tone(60, .12, "sine", .2, 45); tone(55, .12, "sine", .16, 40, .16); },
      slam: () => { noise(.12, .5); tone(80, .3, "sine", .3, 40); },
      whoosh: () => noise(.25, .08),
      upgrade: () => [0, .1, .2, .3].forEach((a, i) => tone(330 * (1 + i * .25), .15, "square", .05, null, a)),
    })[kind]?.();
  } catch (e) { /* audio is optional */ }
}

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
  osLoaded = true; // any message means the computer is up
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
    setTag(inspector, `${h.inspector.toUpperCase()} · v${h.version}`, (PALETTES[h.level] || PALETTES[1]).accent);
  }
  if (!prev || prev.level !== h.level) applyPalette(h.level, h.clerk);
  showStage(h.version, !!prev);
  if (tvVersion !== h.version) { tvVersion = h.version; redraw(tvTex); }
}

function applyPalette(level, clerkInfo) {
  pal = PALETTES[level] || PALETTES[1];
  redraw(floorTex);
  mats.wall.forEach(m => m.color.set(pal.wall));
  mats.accent.color.set(pal.accent); mats.accent2.color.set(pal.accent2);
  scene.background = new THREE.Color(pal.bg);
  if (clerkInfo) setTag(clerk, clerkInfo.name.toUpperCase() + " · CLERK", "#a4581c");
}

let printSeq = 0;
function startPrinting() {
  const id = ++printSeq;
  P.printing = true; setPhase("printing"); sfx("print");
  setTimeout(() => {
    if (id !== printSeq || P.phase !== "printing") return;
    stand();
    wtoast("🖨️ Printing… go grab it", "good");
  }, 900);
  setTimeout(() => {
    if (id !== printSeq) return;
    P.printing = false; P.envelopeReady = true; envelope.visible = true;
    setPhase("pickup");
  }, 2600);
}

function onVerdict(m) {
  const cls = m.caught ? "flagged" : "paid";
  say(inspector, `<span class="stamp">${m.caught ? "FLAGGED" : "PAID"}</span>"${m.line}"`, 6000, cls);
  pins.push({ x: 60 + (pins.length % 4) * 230, y: 130 + Math.floor(pins.length / 4 % 3) * 160, r: rand(-.12, .12), scheme: m.scheme, vendor: m.vendor, caught: m.caught });
  redraw(corkTex);
  if (m.caught) { if (!CINE.active) P.shake = .5; wtoast("FLAGGED — the inspector pinned your trick to the corkboard", "bad"); }
  else wtoast(`PAID +${money(m.payout)}`, "good");
  scanSlot.material.emissive.set(m.caught ? "#e0352b" : "#7cff9a"); scanSlot.material.emissiveIntensity = 1.2;
  setTimeout(() => { scanSlot.material.emissive.set("#7cff9a"); scanSlot.material.emissiveIntensity = .2; }, 3000);
  tvHistory.push({ caught: m.caught, version: tvVersion }); redraw(tvTex);
  messUpDesk();
  if (CINE.active) scanVerdict(m);
  else { P.stampAt = performance.now(); setTimeout(() => sfx(m.caught ? "buzz" : "cash"), 350); }
  setPhase("result");
}

/* ======================= Objective marker ======================= */

function markerTarget() {
  if (P.seated || !P.started) return null;
  if (P.phase === "pickup") return { x: PRINTER.x, z: PRINTER.z + .95, y: 1.9 };
  if (P.phase === "carrying") return { x: IN_TRAY.x, z: IN_TRAY.z - .4, y: 2.0 };
  if (P.phase === "judging" || P.phase === "printing") return null;
  return { x: CHAIR.x, z: CHAIR.z + .3, y: 2.2 };
}
function updateMarker(now) {
  const t = markerTarget();
  marker.visible = ring.visible = !!t;
  if (!t) return;
  marker.position.set(t.x, t.y + Math.sin(now / 250) * .15, t.z);
  marker.rotation.y = now / 600;
  ring.position.set(t.x, .03, t.z);
  const k = 1 + Math.sin(now / 300) * .08; ring.scale.set(k, k, k);
}

/* ======================= Interactions ======================= */

const near = (v, r) => Math.hypot(player.g.position.x - v.x, player.g.position.z - v.z) < r;
const INTERACTIONS = [
  { label: () => "Use your computer", can: () => !P.carrying && near(CHAIR, 1.7), act: sit },
  { label: () => "Grab the invoice", can: () => P.envelopeReady && !P.carrying && near({ x: PRINTER.x, z: PRINTER.z + .9 }, 1.8), act: grab },
  { label: () => "Drop it in the IN tray", can: () => P.carrying && near(IN_TRAY, 1.9), act: deliver },
  { label: () => `Talk to ${P.hud ? P.hud.clerk.name : "Brenda"}`, can: () => near({ x: CLERK_DESK.x, z: CLERK_DESK.z + 1.2 }, 2.2) || near({ x: CLERK_DESK.x, z: CLERK_DESK.z - 1.6 }, 1.6), act: () => say(clerk, P.hud ? `"${P.hud.clerk.hello}" <br><small>(Send your cover note from your computer.)</small>` : `"I'm on lunch, hon. Email me."`, 3800) },
  { label: () => `Chat with ${P.hud ? P.hud.inspector : "Gus"}`, can: () => !P.carrying && P.phase !== "judging" && !(P.phase === "result" && bubbles.some(b => b.ch === inspector)) && near(IN_TRAY, 1.9), act: () => say(inspector, pick(["Mmm… pie.", "Did you know I have a stapler?", "I read every invoice. Mostly.", "Is it lunch yet?"]), 2600) },
  { label: () => "Look at the corkboard", can: () => near({ x: 3, z: -RD / 2 + 1.2 }, 1.8), act: () => wtoast(pins.length ? `${pins.length} trick${pins.length > 1 ? "s" : ""} pinned. ${pins.filter(p => p.caught).length} caught.` : "Empty… for now.") },
  { label: () => "Small talk with the Boss", can: () => boss.g.visible && near(boss.g.position, 1.8), act: () => say(boss, pick(["Shouldn't you be at your desk?", "Numbers. I want numbers.", "Nice weather for compliance."]), 2400) },
];
let current = null;
function updatePrompt() {
  current = P.seated || !P.started || CINE.active ? null : INTERACTIONS.find(i => i.can());
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
    const mon = $("#monitor");
    mon.classList.add("show", "booting");
    const ready = () => {
      if (!P.seated) return;
      // re-fit the OS to the screen size it actually has now that it is visible
      try { OS.contentWindow.dispatchEvent(new Event("resize")); } catch (e) {}
      setTimeout(() => {
        mon.classList.remove("booting");
        OS.focus(); OS.contentWindow && OS.contentWindow.focus();
      }, 450);
    };
    // the load event can fire before this script runs (or be unreadable on file://), so never wait more than 1.2s
    if (osLoaded) ready();
    else { let done = false; const go = () => { if (!done) { done = true; osLoaded = true; ready(); } };
      OS.addEventListener("load", go, { once: true }); setTimeout(go, 1200); }
  }, 450);
}
function stand() {
  if (!P.seated) return;
  P.seated = false;
  $("#monitor").classList.remove("show");
  standPose(player);
  player.head.visible = player.tag.visible = !P.fp;
  document.body.classList.remove("seated");
  player.g.position.set(CHAIR.x, 0, CHAIR.z + .9);
  P.yaw = 0; P.pitch = P.fp ? .05 : .5;
  P.keys.clear();
  OS.blur(); canvas.focus({ preventScroll: true });
}
function grab() {
  P.envelopeReady = false; envelope.visible = false; P.carrying = true; carryEnv.visible = true; sfx("pickup");
  setPhase("carrying");
}
function deliver() {
  P.carrying = false; carryEnv.visible = false; sfx("drop");
  // envelope slides from the IN tray into the scanner
  const env = box(.5, .03, .32, envelopeMat, -.7, 1.22, .75, boothDesk);
  const t0 = performance.now();
  (function slide() {
    const k = Math.min(1, (performance.now() - t0) / 900);
    env.position.set(-.7 + 1.5 * k, 1.22 + .25 * Math.sin(k * Math.PI), .75 - .25 * k);
    scanSlot.material.emissiveIntensity = .2 + k;
    if (k < 1) requestAnimationFrame(slide); else { boothDesk.remove(env); env.geometry.dispose(); }
  })();
  say(inspector, "Hmm… let me see…", 1800);
  setPhase("judging");
  setTimeout(() => { toOS("deliver"); startScanScene(); }, 900);
}

/* ======================= Booth close-up: "why I caught you" ======================= */
/* After you drop the envelope the camera cuts to the counter: your invoice is
 * scanned, the fields that tipped the inspector off are circled, then the stamp
 * slams. Tells come from the computer's verdict message (`tells`). */

const TELL_ROWS = { domain_mismatch: 0, unknown_vendor: 0, letterhead: 0, bank_changed: 1, amount_unusual: 2, total_mismatch: 2,
  altered: 3, dup_number: 3, bad_po: 3, stamp_wrong: 4, copy_gen: 5, low_legibility: 5, heat: 5 };
const TELL_SHORT = { domain_mismatch: "odd sender", unknown_vendor: "who is this?", letterhead: "wrong logo", bank_changed: "bank changed",
  amount_unusual: "way too big", total_mismatch: "doesn't add up", altered: "whiteout!", dup_number: "already paid", bad_po: "bad PO",
  stamp_wrong: "wrong stamp", copy_gen: "copy of a copy", low_legibility: "stained", heat: "you look nervous" };
const ROW_LABELS = ["Sender", "Bank account", "Amount", "Invoice # / PO", "Signature / stamp", "Scan quality"];
const scanDoc = { vendor: "", marks: [], verdict: null };
const scanTex = canvasTex(512, 640, (g, w, h) => {
  g.fillStyle = "#fffaf0"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#2b1d14"; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
  g.textAlign = "left";
  g.fillStyle = "#1f8a8a"; g.font = "44px Bungee, Impact"; g.fillText("INVOICE", 30, 70);
  g.fillStyle = "#2b1d14"; g.font = "bold 24px 'Space Mono', monospace"; g.fillText((scanDoc.vendor || "scanning…").slice(0, 26), 30, 110);
  ROW_LABELS.forEach((label, i) => {
    const y = 175 + i * 72, hit = scanDoc.marks.find(m => m.row === i);
    if (hit) { g.fillStyle = "rgba(224,53,43,.18)"; g.fillRect(20, y - 34, w - 40, 58); g.strokeStyle = "#e0352b"; g.lineWidth = 5; g.strokeRect(20, y - 34, w - 40, 58); }
    g.fillStyle = "#888"; g.font = "18px 'Space Mono', monospace"; g.fillText(label, 34, y - 10);
    g.fillStyle = "#2b1d14"; g.fillRect(34, y + 2, 170 + (i * 53) % 150, 8);
    if (hit) { g.fillStyle = "#e0352b"; g.font = "bold 24px 'Space Mono', monospace"; g.textAlign = "right"; g.fillText("⚠ " + hit.label, w - 34, y + 10); g.textAlign = "left"; }
  });
  if (scanDoc.verdict === "paid") { g.fillStyle = "#1d9a4b"; g.font = "bold 26px 'Space Mono', monospace"; g.fillText("✓ nothing suspicious", 34, h - 36); }
});
const scanPaper = new THREE.Mesh(new THREE.PlaneGeometry(.9, 1.12), new THREE.MeshBasicMaterial({ map: scanTex }));
scanPaper.rotation.x = -.3; // the inspector holds it up to you
scanPaper.position.set(BOOTH.x - .5, 1.62, BOOTH.z + .45); scanPaper.rotation.y = .18; scanPaper.visible = false; scene.add(scanPaper);
const scanBeam = new THREE.Mesh(new THREE.PlaneGeometry(.96, .04), new THREE.MeshBasicMaterial({ color: "#7cff9a", transparent: true, opacity: .9 }));
scanBeam.position.z = .01; scanPaper.add(scanBeam);
const stampTex = canvasTex(512, 200, (g, w, h) => {
  const paid = scanDoc.verdict === "paid", col = paid ? "#1d9a4b" : "#e0352b";
  g.strokeStyle = col; g.lineWidth = 18; g.strokeRect(14, 14, w - 28, h - 28);
  g.fillStyle = col; g.font = "110px Bungee, Impact"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(paid ? "PAID" : "FLAGGED", w / 2, h / 2 + 6);
});
const stampMark = new THREE.Mesh(new THREE.PlaneGeometry(.72, .28), new THREE.MeshBasicMaterial({ map: stampTex, transparent: true }));
stampMark.position.set(0, -.05, .012); stampMark.rotation.z = .25; stampMark.visible = false; scanPaper.add(stampMark);
// the big rubber stamp itself
const stampTool = new THREE.Group(); stampTool.visible = false; scanPaper.add(stampTool);
stampTool.rotation.x = Math.PI / 2; // handle points at the camera, rubber faces the paper
box(.5, .1, .24, M("#e0352b"), 0, 0, 0, stampTool);
cyl(.05, .05, .3, M("#8a5a35"), 0, .2, 0, stampTool);
sphere(.1, M("#8a5a35"), 0, .38, 0, stampTool);

const CINE = { active: false, phase: "", t: 0, landed: false };
const CINE_CAM = new THREE.Vector3(BOOTH.x - .25, 1.95, BOOTH.z + 2.7), CINE_LOOK = new THREE.Vector3(BOOTH.x - .25, 1.65, BOOTH.z + .4);

function startScanScene() {
  Object.assign(scanDoc, { vendor: "", marks: [], verdict: null }); redraw(scanTex);
  scanPaper.visible = scanBeam.visible = true; stampMark.visible = stampTool.visible = false;
  Object.assign(CINE, { active: true, phase: "scan", t: performance.now(), landed: false });
  P.frozenUntil = Infinity; animWalk(player, 0, 0);
  player.g.visible = false; // you'd be standing right in the shot
}
function scanVerdict(m) {
  if (!CINE.active) return;
  scanDoc.vendor = m.vendor || "";
  scanDoc.verdict = m.caught ? "flagged" : "paid";
  // only circle what tipped him off when he actually caught you
  const tells = m.caught ? (m.tells || []).filter(t => TELL_ROWS[t] !== undefined).slice(0, 3) : [];
  if (m.caught && !tells.length) tells.push("heat"); // older computer builds don't send tells yet
  const seen = new Set();
  scanDoc.marks = tells.filter(t => !seen.has(TELL_ROWS[t]) && seen.add(TELL_ROWS[t])).map(t => ({ row: TELL_ROWS[t], label: TELL_SHORT[t] }));
  redraw(scanTex); redraw(stampTex);
  Object.assign(CINE, { phase: "mark", t: performance.now() });
  scanBeam.visible = false;
  if (scanDoc.marks.length) sfx("huh");
}
function endScanScene() {
  CINE.active = false; P.frozenUntil = 0;
  player.g.visible = true;
  P.keys.clear(); // keys pressed during the close-up shouldn't make you walk off
  if (P.phase === "judging") setPhase("result");
  stampTool.visible = false;
  setTimeout(() => { if (!CINE.active) scanPaper.visible = false; }, 4000);
}
function updateCine(now) {
  if (!CINE.active) return;
  const e = now - CINE.t;
  if (CINE.phase === "scan") {
    scanBeam.position.y = Math.sin(e / 260) * .52;
    // the computer waits 0.9s then gives /submit up to 10s: wait a bit longer than that before giving up
    if (e > 12500) endScanScene();
  } else if (CINE.phase === "mark" && e > 900) {
    Object.assign(CINE, { phase: "stamp", t: now });
    stampTool.visible = true; sfx("whoosh");
  } else if (CINE.phase === "stamp") {
    // hang in the air (slow-mo), then slam
    const base = scanPaper.position, k = Math.min(1, e / 650), fall = k < .7 ? k * .15 : .105 + Math.pow((k - .7) / .3, 3) * .895;
    stampTool.position.set(0, -.05 + (1 - fall) * .8, .07 + (1 - fall) * .45); // swings down from above
    if (k >= 1 && !CINE.landed) {
      CINE.landed = true; stampMark.visible = true; P.stampAt = now - 350;
      sfx("slam"); P.shake = scanDoc.verdict === "paid" ? .25 : .55;
      if (scanDoc.verdict === "paid") { burstConfetti(base.x, base.y + .3, base.z + .3); sfx("cash"); }
      else { flashVignette(); sfx("buzz"); }
    }
    if (CINE.landed) { const up = Math.min(1, Math.max(0, e - 800) / 500); stampTool.position.set(0, -.05 + up * .8, .07 + up * .45); }
    if (e > 2600) endScanScene();
  }
}

/* ======================= Juice: confetti, vignette, heartbeat ======================= */

const confetti = [];
const confGeo = new THREE.PlaneGeometry(.1, .06);
function burstConfetti(x, y, z, n = 110) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(confGeo, new THREE.MeshBasicMaterial({ color: pick(["#1d9a4b", "#4dff7a", "#ffd23f", "#f4a63a", "#1f8a8a", "#fff"]), side: THREE.DoubleSide }));
    m.position.set(x, y, z); scene.add(m);
    confetti.push({ m, v: new THREE.Vector3(rand(-2.2, 2.2), rand(2.5, 5.5), rand(-.5, 2.8)), r: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), life: rand(1.8, 3) });
  }
}
function updateConfetti(dt) {
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.life -= dt; c.v.y -= 9 * dt; c.v.multiplyScalar(1 - dt * .6);
    c.m.position.addScaledVector(c.v, dt);
    if (c.m.position.y < .03) { c.m.position.y = .03; c.v.set(0, 0, 0); c.r.set(0, 0, 0); c.m.rotation.x = -Math.PI / 2; }
    c.m.rotation.x += c.r.x * dt; c.m.rotation.y += c.r.y * dt; c.m.rotation.z += c.r.z * dt;
    if (c.life <= 0) { scene.remove(c.m); c.m.material.dispose(); confetti.splice(i, 1); }
  }
}
function flashVignette() { const v = $("#vignette"); v.classList.remove("flash"); void v.offsetWidth; v.classList.add("flash"); }

/* ======================= Input ======================= */

addEventListener("keydown", e => {
  if (!P.started) return;
  if (e.code === "Escape" && P.seated) { stand(); return; }
  if (P.seated || CINE.active) return;
  P.keys.add(e.code);
  if (e.code === "KeyE" && current) current.act();
  if (e.code === "KeyV") setFirstPerson(!P.fp);
});
addEventListener("keyup", e => P.keys.delete(e.code));
addEventListener("blur", () => P.keys.clear());

canvas.addEventListener("click", () => { if (P.started && !P.seated && document.pointerLockElement !== canvas) canvas.requestPointerLock(); });
addEventListener("mousemove", e => {
  if (P.seated) return;
  if (document.pointerLockElement === canvas || e.buttons === 1) {
    P.yaw -= e.movementX * .0026;
    P.pitch = P.fp ? clamp(P.pitch + e.movementY * .002, -1.1, 1.2) : clamp(P.pitch + e.movementY * .002, .12, 1.15);
  }
});
// zooming in past the closest third-person distance drops into first person; scrolling out comes back
const MIN_DIST = 3.5;
addEventListener("wheel", e => {
  if (P.seated || !P.started) return;
  if (P.fp) { if (e.deltaY > 0) setFirstPerson(false); return; }
  const next = P.dist + e.deltaY * .004;
  if (next < MIN_DIST && P.dist <= MIN_DIST + .05 && e.deltaY < 0) setFirstPerson(true);
  P.dist = clamp(next, MIN_DIST, 10);
}, { passive: true });
function setFirstPerson(on) {
  if (P.fp === on) return;
  P.fp = on;
  player.head.visible = player.tag.visible = !on;
  document.body.classList.toggle("fp", on);
  if (on) { P.pitch = .05; wtoast("First person — scroll out (or press V) to go back"); }
  else { P.pitch = clamp(P.pitch, .3, 1.15); P.dist = MIN_DIST; }
}

$("#btn-start").onclick = () => {
  $("#start").classList.add("hide"); P.started = true;
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (e) {}
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

const _dir = new THREE.Vector3(), _bub = new THREE.Vector3();
function updatePlayer(dt, now) {
  if (P.seated) return;
  if (now < P.frozenUntil) { animWalk(player, dt, 0); return; }
  const k = P.keys;
  const f = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
  const s = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
  const dir = _dir.set(-Math.sin(P.yaw) * f + Math.cos(P.yaw) * s, 0, -Math.cos(P.yaw) * f - Math.sin(P.yaw) * s);
  let speed = 0;
  if (dir.lengthSq() > 0) {
    dir.normalize();
    speed = k.has("ShiftLeft") || k.has("ShiftRight") ? 7 : 4;
    const pos = player.g.position;
    pos.addScaledVector(dir, speed * dt);
    collidePlayer(pos);
    const target = P.fp ? P.yaw + Math.PI : Math.atan2(dir.x, dir.z);
    let diff = target - player.g.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.g.rotation.y += diff * Math.min(1, dt * 12);
  }
  if (P.fp) player.g.rotation.y = P.yaw + Math.PI;
  animWalk(player, dt, speed);
  const step = Math.floor(player.walkT / Math.PI);
  if (speed > 0 && step !== P.lastStep) { P.lastStep = step; sfx("step"); }
}

let shownSus = -1;
function setSus(v) {
  const r = Math.round(v * 50) / 50;
  if (r !== shownSus) { shownSus = r; $("#vignette").style.setProperty("--sus", r); }
}
function updateBoss(dt, now) {
  if (B.state === "wait") {
    if (B.sus) { B.sus = 0; setSus(0); }
    B.t -= dt;
    if (B.t <= 0) { B.state = "walk"; B.i = 1; boss.g.visible = true; B.warned = B.chatted = B.busted = false; B.sus = 0; sfx("door"); }
    return;
  }
  const [tx, tz] = BOSS_PATH[B.i];
  const pos = boss.g.position;
  const dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz);
  const sp = 1.7;
  if (now < B.pauseUntil) {
    // stopped to interrogate you: face the player
    boss.g.rotation.y = Math.atan2(player.g.position.x - pos.x, player.g.position.z - pos.z);
    animWalk(boss, dt, 0);
    return;
  }
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
  // vision cone: carrying the envelope inside it builds suspicion
  const vx = player.g.position.x - pos.x, vz = player.g.position.z - pos.z, vd = Math.hypot(vx, vz);
  let ang = Math.atan2(vx, vz) - boss.g.rotation.y; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
  const inView = !P.seated && vd < CONE_R && Math.abs(ang) < CONE_HALF;
  if (inView && P.carrying && !B.busted) {
    if (B.sus === 0) { say(boss, "Hm?", 900); sfx("huh"); }
    B.sus += dt * 1.3;
    if (B.sus >= 1) {
      B.busted = true; B.sus = 0;
      B.pauseUntil = now + 2800; P.frozenUntil = now + 2800;
      say(boss, "What's in the envelope?! …Fine. Get back to work.", 2800);
      wtoast("Spotted by the boss with the envelope! +10 heat", "bad");
      toOS("heat", { amount: 10 });
      sfx("busted"); P.shake = .3; flashVignette();
    }
  } else B.sus = Math.max(0, B.sus - dt * .8);
  if (B.sus > 0 && now > (P.nextBeat || 0)) { sfx("heart"); P.nextBeat = now + 520 - B.sus * 240; }
  setSus(B.sus);
  coneMat.color.set(B.sus > 0 || now < B.pauseUntil ? "#e0352b" : "#ffd23f");
  coneMat.opacity = .22 + B.sus * .3;
  if (!P.seated && !B.chatted && !P.carrying && near(pos, 2.2)) {
    B.chatted = true;
    say(boss, "Shouldn't you be at your desk?", 2200);
  }
}

const tmp = new THREE.Vector3();
const _look = new THREE.Vector3();
function updateCamera(dt) {
  if (CINE.active) {
    camera.position.lerp(CINE_CAM, Math.min(1, dt * 5));
    if (P.shake > 0) { P.shake -= dt; camera.position.x += rand(-.06, .06); camera.position.y += rand(-.05, .05); }
    camera.lookAt(CINE_LOOK);
    walls.forEach(w => { w.mat.opacity = 1; w.mat.depthWrite = true; });
    return;
  }
  if (P.seated) {
    camera.position.lerp(tmp.set(CHAIR.x + .25, 1.95, CHAIR.z + 1.25), Math.min(1, dt * 6));
    camera.lookAt(MY_DESK.x, 1.3, MY_DESK.z - .3);
    return;
  }
  if (P.fp) {
    const t = player.g.position, bob = player.head.position.y - 2.02;
    camera.position.set(t.x - Math.sin(P.yaw) * .12, 1.78 + bob, t.z - Math.cos(P.yaw) * .12);
    if (P.shake > 0) { P.shake -= dt; camera.position.x += rand(-.05, .05); camera.position.y += rand(-.04, .04); }
    const c = Math.cos(P.pitch);
    camera.lookAt(camera.position.x - Math.sin(P.yaw) * c, camera.position.y - Math.sin(P.pitch), camera.position.z - Math.cos(P.yaw) * c);
    walls.forEach(w => { w.mat.opacity = 1; w.mat.depthWrite = true; });
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
    const p = _bub.copy(b.ch.g.position); p.y += 2.95 * b.ch.scale + (b.ch.g.position.y < 0 ? -.2 : 0);
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
  updatePlayer(dt, now);
  updateBoss(dt, now);
  // idle life: coworkers type, inspector bobs, printer blinks
  [kevin, dana].forEach((c, i) => { c.armL.rotation.x = -1.1 + Math.sin(now / 90 + i) * .12; c.armR.rotation.x = -1.1 + Math.cos(now / 80 + i) * .12; });
  inspector.head.position.y = 2.02 + Math.sin(now / 700) * .04;
  if (P.seated) { player.armL.rotation.x = -1.1 + Math.sin(now / 85) * .1; player.armR.rotation.x = -1.1 + Math.cos(now / 95) * .1; }
  printerLight.material.emissiveIntensity = P.printing ? (Math.sin(now / 80) > 0 ? 1.5 : .1) : P.envelopeReady ? 1.2 : .3;
  envelope.position.y = .99 + (P.envelopeReady ? Math.abs(Math.sin(now / 300)) * .05 : 0);
  // inspector slams his stamp on a verdict
  const st = (now - (P.stampAt || -1e9)) / 700;
  if (st < 1) inspector.armR.rotation.x = st < .5 ? -.3 - st * 4.8 : -2.7 + (st - .5) * 4.8;
  else inspector.armR.rotation.x = -.3;
  updateMarker(now);
  updateCine(now);
  updateConfetti(dt);
  updateFaces(now, _look.set(player.g.position.x, 1.9, player.g.position.z));
  // name tags ignore depth, so hide them when the camera gets right on top of someone
  [kevin, dana, inspector, clerk, boss].forEach(c => { c.tag.visible = camera.position.distanceTo(c.g.position) > 3.2; });
  updateCamera(dt);
  updatePrompt();
  updateBubbles(now);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// handy in the devtools console while prototyping
window.forged = { P, player, boss: B, camera, CINE, sit, stand, setPhase, grab, deliver };

})();
