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
// key bindings (keys.js): is a bound key or mouse button for this action held right now?
const K = window.ForgedKeys;
const held = action => K.get(action).some(c => c && P.keys.has(c));

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

// warm key light from the sun side, cool sky bounce from below/behind: a subtle warm/cool split
scene.add(new THREE.HemisphereLight("#fff4dc", "#7c86a3", 0.52));
const sun = new THREE.DirectionalLight("#ffecd0", 0.62);
sun.position.set(-8, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 24, bottom: -24, near: 1, far: 70 });
scene.add(sun);
const coolFill = new THREE.DirectionalLight("#a9c4ff", 0.16); // no shadows: tints the faces the sun misses
coolFill.position.set(10, 6, -14); scene.add(coolFill);

const RW = 26, RD = 18; // room size
/* Cartoon look to match the 2D UI: 3-band toon shading + thick black outlines
 * (inverted hull: a slightly bigger back-face copy of each mesh). */
// r128 samples .rgb of the gradient, so it has to be a grey RGBA ramp
const gradientMap = new THREE.DataTexture(new Uint8Array([104, 104, 108, 255, 190, 190, 192, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
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

/* Walls are straight runs split around doorways. Every segment collides, and a
 * segment fades out whenever it stands between the camera and the player, so
 * this works for any number of rooms. */
const walls = [];
const WALL_H = 3.2;
function wallRun(axis, fixed, from, to, doors = [], { thick = .3, color } = {}) {
  // axis "x": runs along x at z = fixed;  axis "z": runs along z at x = fixed
  const seg = (a, b, y, h, solid) => {
    const len = b - a, mid = (a + b) / 2;
    const mat = M(color || pal.wall, { transparent: true });
    if (!color) mats.wall.push(mat);
    const m = axis === "x" ? box(len, h, thick, mat, mid, y, fixed) : box(thick, h, len, mat, fixed, y, mid);
    m.castShadow = false;
    if (solid) axis === "x" ? collide(mid, fixed, len, thick) : collide(fixed, mid, thick, len);
    walls.push({ m, mat, axis, fixed, a, b });
  };
  let start = from;
  doors.slice().sort((p, q) => p.at - q.at).forEach(d => {
    const a = d.at - d.width / 2, b = d.at + d.width / 2;
    if (a > start) seg(start, a, WALL_H / 2, WALL_H, true);
    seg(a, b, WALL_H - .35, .7, false); // lintel over the doorway
    doorFrame(axis, fixed, d.at, d.width);
    start = b;
  });
  if (to > start) seg(start, to, WALL_H / 2, WALL_H, true);
}
function doorFrame(axis, fixed, at, width) {
  const trim = mats.accent;
  [-1, 1].forEach(sx => axis === "x" ? box(.12, 2.5, .4, trim, at + sx * width / 2, 1.25, fixed) : box(.4, 2.5, .12, trim, fixed, 1.25, at + sx * width / 2));
}
// does this wall segment block the line from the player to the camera?
function wallBlocks(w, cam, pl) {
  const ca = w.axis === "x" ? cam.z : cam.x, pa = w.axis === "x" ? pl.z : pl.x;
  if ((ca - w.fixed) * (pa - w.fixed) >= 0) return false;
  const t = (w.fixed - pa) / (ca - pa);
  const cross = w.axis === "x" ? pl.x + t * (cam.x - pl.x) : pl.z + t * (cam.z - pl.z);
  return cross > w.a - 1 && cross < w.b + 1;
}
// main office: doorways west (boss office), south (break room), east (records & mail)
const DOORS = { west: { at: -5, width: 1.8 }, south: { at: -6, width: 2.2 }, east: { at: 5.5, width: 2 } };
wallRun("x", -RD / 2, -RW / 2, RW / 2);
wallRun("x", RD / 2, -RW / 2, RW / 2, [DOORS.south]);
wallRun("z", -RW / 2, -RD / 2, RD / 2, [DOORS.west]);
wallRun("z", RW / 2, -RD / 2, RD / 2, [DOORS.east]);
// skirting stripe
[[RW, .32, 0, -RD / 2 + .01]].forEach(a => box(a[0], .25, a[1], mats.accent, a[2], .12, a[3]));

/* A room next to the main office: checker floor, ceiling and walls. Skip the
 * side it shares with the main office (that wall already has the doorway). */
function room({ x0, x1, z0, z1, floor = ["#d8c8a8", "#c9b894"], wallColor, skip = [], doors = {} }) {
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const tex = canvasTex(256, 256, (g) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = floor[(i + j) % 2]; g.fillRect(i * 64, j * 64, 64, 64); } });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(w / 4, d / 4);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M("#fff", { map: tex }));
  f.rotation.x = -Math.PI / 2; f.position.set(cx, .005, cz); f.receiveShadow = true; scene.add(f);
  const c = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M("#f3ead8"));
  c.rotation.x = Math.PI / 2; c.position.set(cx, WALL_H, cz); scene.add(c);
  const opt = wallColor ? { color: wallColor } : {};
  // a skipped side is shared with the main office, but only where the main office actually has a wall:
  // fill whatever part of that side sticks out past it (otherwise you see into the void)
  const fill = (axis, fixed, from, to, lo, hi) => {
    if (from < lo) wallRun(axis, fixed, from, Math.min(to, lo), [], opt);
    if (to > hi) wallRun(axis, fixed, Math.max(from, hi), to, [], opt);
  };
  if (skip.includes("north")) fill("x", z0, x0, x1, -RW / 2, RW / 2);
  if (skip.includes("south")) fill("x", z1, x0, x1, -RW / 2, RW / 2);
  if (skip.includes("west")) fill("z", x0, z0, z1, -RD / 2, RD / 2);
  if (skip.includes("east")) fill("z", x1, z0, z1, -RD / 2, RD / 2);
  if (!skip.includes("north")) wallRun("x", z0, x0, x1, doors.north, opt);
  if (!skip.includes("south")) wallRun("x", z1, x0, x1, doors.south, opt);
  if (!skip.includes("west")) wallRun("z", x0, z0, z1, doors.west, opt);
  if (!skip.includes("east")) wallRun("z", x1, z0, z1, doors.east, opt);
  return { cx, cz, floor: f, ceiling: c };
}

/* ======================= Characters: chunky cartoon people ======================= */
/* Big blocky heads with googly eyes, brows, noses and hair, in the spirit of
 * Scam With Your Friends' goofy office workers. Everything is primitives. */

/* --- modelling helpers: cached geometry, soft-edged boxes, merged multi-part "kits"
 * and fake contact shadows. Parts that share a material are merged into ONE mesh
 * (plus one outline hull), so detailed props stay cheap to draw. --- */
const GEO = new Map();
const geo = (key, make) => GEO.get(key) || GEO.set(key, make()).get(key);
const BOXG = (w, h, d) => geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const CYLG = (rt, rb, h, s = 16) => geo(`c${rt}|${rb}|${h}|${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const SPHG = (r, s = 12) => geo(`s${r}|${s}`, () => new THREE.SphereGeometry(r, s, Math.max(6, Math.round(s * .7))));
const DOMEG = r => geo(`d${r}`, () => new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2));
const ICOG = r => geo(`i${r}`, () => new THREE.IcosahedronGeometry(r, 0));
const CONEG = (r, h, s = 6) => geo(`k${r}|${h}|${s}`, () => new THREE.ConeGeometry(r, h, s));
const TORG = (r, t) => geo(`t${r}|${t}`, () => new THREE.TorusGeometry(r, t, 6, 14));
// a box with rounded edges (a "soft cube"): the ring next to each edge is pulled in, then pushed onto a radius
function RBOXG(w, h, d, r = .05) {
  return geo(`r${w}|${h}|${d}|${r}`, () => {
    r = Math.min(r, Math.min(w, h, d) * .45);
    const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4), p = g.attributes.position, n = g.attributes.normal;
    const half = [w / 2, h / 2, d / 2], v = [0, 0, 0], q = [0, 0, 0];
    for (let i = 0; i < p.count; i++) {
      v[0] = p.getX(i); v[1] = p.getY(i); v[2] = p.getZ(i);
      let len = 0;
      for (let a = 0; a < 3; a++) {
        const H = half[a];
        if (Math.abs(Math.abs(v[a]) - H / 2) < 1e-6) v[a] = Math.sign(v[a]) * (H - r * .55);
        q[a] = v[a] - clamp(v[a], r - H, H - r); len += q[a] * q[a];
      }
      len = Math.sqrt(len) || 1;
      for (let a = 0; a < 3; a++) { const inner = v[a] - q[a]; q[a] /= len; v[a] = inner + q[a] * r; }
      p.setXYZ(i, v[0], v[1], v[2]); n.setXYZ(i, q[0], q[1], q[2]);
    }
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  });
}
function mergeGeos(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); o += g.attributes.position.count * 3; g.dispose(); }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
// kit().add(geometry, x, y, z, rx, ry, rz, { line, sx, sy, sz }) ... .bake() -> { geo, hull }
const _kM = new THREE.Matrix4(), _kQ = new THREE.Quaternion(), _kE = new THREE.Euler(), _kP = new THREE.Vector3(), _kS = new THREE.Vector3(), _kB = new THREE.Vector3();
function kit() {
  const parts = [], hull = [];
  const k = {
    add(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, { line = .028, sx = 1, sy = 1, sz = 1 } = {}) {
      _kQ.setFromEuler(_kE.set(rx, ry, rz));
      const base = g.index ? g.toNonIndexed() : g.clone();
      parts.push(base.clone().applyMatrix4(_kM.compose(_kP.set(x, y, z), _kQ, _kS.set(sx, sy, sz))));
      if (line) { // outline hull: the same part grown by `line` on every side
        if (!g.boundingBox) g.computeBoundingBox();
        g.boundingBox.getSize(_kB);
        hull.push(base.applyMatrix4(_kM.compose(_kP.set(x, y, z), _kQ, _kS.set(sx + 2 * line / (_kB.x || 1), sy + 2 * line / (_kB.y || 1), sz + 2 * line / (_kB.z || 1)))));
      } else base.dispose();
      return k;
    },
    bake: () => ({ geo: mergeGeos(parts), hull: hull.length ? mergeGeos(hull) : null }),
  };
  return k;
}
function place(b, mat, parent = scene, x = 0, y = 0, z = 0, ry = 0, shadow = true) {
  const m = new THREE.Mesh(b.geo, mat);
  m.position.set(x, y, z); m.rotation.y = ry; m.castShadow = shadow; m.receiveShadow = true;
  if (b.hull && !mat.transparent) m.add(new THREE.Mesh(b.hull, OUTLINE));
  parent.add(m); return m;
}
// K(material) returns that material's kit; K.place(parent) bakes and adds them all
function kits() {
  const map = new Map();
  const K = mat => map.get(mat) || map.set(mat, kit()).get(mat);
  K.bake = () => [...map].map(([mat, k]) => [mat, k.bake()]);
  K.place = (parent = scene, shadow = true) => K.bake().forEach(([mat, b]) => place(b, mat, parent, 0, 0, 0, 0, shadow));
  return K;
}
// a prop built once, then placed many times sharing the same geometry
function prefab(build) {
  let baked = null;
  return (parent = scene, x = 0, y = 0, z = 0, ry = 0, shadow = true) => {
    if (!baked) { const K = kits(); build(K); baked = K.bake(); }
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
    baked.forEach(([mat, b]) => place(b, mat, g, 0, 0, 0, 0, shadow));
    return g;
  };
}
// shared materials for props (never mutated, so sharing is safe)
const PMATS = {};
const PM = c => PMATS[c] || (PMATS[c] = M(c));
const PMF = PM; // leaves: icosahedrons are non-indexed, so they shade faceted anyway (toon ignores flatShading in r128)
const GLOW = c => PMATS[c + "/b"] || (PMATS[c + "/b"] = new THREE.MeshBasicMaterial({ color: c }));
// fake contact shadow: a soft dark blob on the floor (a plane, never a CircleGeometry: a plugin finds the boss's cone by that type)
const blobMat = new THREE.MeshBasicMaterial({ color: "#000", transparent: true, opacity: .34, depthWrite: false,
  map: canvasTex(64, 64, g => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(0,0,0,.95)"); r.addColorStop(.55, "rgba(0,0,0,.55)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }) });
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
function blob(x, z, w, d = w, parent = scene, y = .012) {
  const m = new THREE.Mesh(blobGeo, blobMat); m.scale.set(w, 1, d); m.position.set(x, y, z); m.renderOrder = 1; parent.add(m); return m;
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
  const hp = (g, mat, x, y, z, line = .028) => { const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; head.add(m); return line ? outline(m, line) : m; };
  hp(RBOXG(W, H, D, .11), skin, 0, 0, 0);                                      // soft-cube skull
  [-1, 1].forEach(sx => hp(RBOXG(.09, .17, .13, .04), skin, sx * (W / 2 + .03), -.02, 0)); // ears
  const hk = kit(); // hair, brows and mustache: one merged mesh
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
  [-1, 1].forEach(sx => hk.add(RBOXG(.21, .055, .05, .02), sx * .15, .21 + (L.brows === "raised" && sx > 0 ? .05 : 0), D / 2 + .03, 0, 0, -sx * tilt, { line: .018 }));
  // nose
  if (L.nose === "big") hp(RBOXG(.13, .17, .16, .05), M(shade(L.skin, -.12)), 0, -.06, D / 2 + .07);
  else sphere(.07, M(shade(L.skin, -.12)), 0, -.05, D / 2 + .04, head, 10);
  // mouth
  const mouth = new THREE.Group(); mouth.position.set(0, -.2, D / 2 + .01); head.add(mouth);
  if (L.mouth === "grin") { box(.3, .1, .04, INK, 0, 0, 0, mouth); box(.24, .04, .045, WHITE, 0, .02, 0, mouth); }
  else if (L.mouth === "smirk") { box(.22, .045, .04, INK, .04, .01, 0, mouth).rotation.z = .25; }
  else if (L.mouth === "frown") { [-1, 1].forEach(sx => { box(.13, .045, .04, INK, sx * .055, -.01, 0, mouth).rotation.z = sx * .35; }); }
  else if (L.mouth === "o") { mouth.add(new THREE.Mesh(new THREE.TorusGeometry(.05, .02, 8, 16), INK)); }
  else box(.2, .045, .04, INK, 0, 0, 0, mouth);
  if (L.teeth) box(.1, .06, .03, WHITE, 0, -.05, .01, mouth);
  if (L.mustache) { // lives in mouth space: mouth sits at (0, -.2, D/2 + .01)
    hk.add(RBOXG(.36, .08, .07, .03), 0, -.13, D / 2 + .03, 0, 0, 0, { line: .02 });
    [-1, 1].forEach(sx => hk.add(RBOXG(.09, .065, .06, .025), sx * .2, -.165, D / 2 + .03, 0, 0, sx * .5, { line: .02 }));
  }
  // hair: a soft cap hugging the skull, hair down the back, then the style's silhouette on top
  const top = H / 2, hl = { line: .022 };
  const cap = (h = .12, grow = .05) => hk.add(RBOXG(W + grow, h, D + grow, .05), 0, top - .01, -.005, 0, 0, 0, hl);
  const back = () => hk.add(RBOXG(W + .04, .36, .1, .04), 0, .1, -D / 2 + .02, 0, 0, 0, hl);
  if (L.hair === "spiky") {
    cap(.1); back();
    for (let i = 0; i < 5; i++) hk.add(CONEG(.1, .26), -.24 + i * .12, top + .12, rand(-.12, .1), rand(-.25, .1), 0, rand(-.4, .4), { line: .02 });
    [-1, 1].forEach(sx => hk.add(CONEG(.09, .22), sx * .14, top + .04, -.24, -.9, 0, sx * .3, { line: .02 })); // swept back
  }
  if (L.hair === "bowl") {
    hk.add(RBOXG(W + .08, .22, D + .08, .09), 0, top - .03, -.01, 0, 0, 0, hl);
    hk.add(RBOXG(W + .06, .1, .07, .035), 0, top - .11, D / 2 + .015, 0, 0, 0, hl); // fringe
    back();
  }
  if (L.hair === "bun") { cap(.12); back(); hk.add(SPHG(.15, 10), 0, top + .14, -.14, 0, 0, 0, hl); hk.add(TORG(.09, .03), 0, top + .06, -.11, Math.PI / 2 - .5, 0, 0, { line: .015 }); }
  if (L.hair === "neat") { cap(.11); back(); hk.add(RBOXG(.34, .07, D - .02, .03), .1, top + .06, 0, 0, 0, -.12, hl); }
  if (L.hair === "curly") {
    for (let i = 0; i < 9; i++) hk.add(SPHG(.12, 8), -.26 + (i % 5) * .13, top + .02 + Math.floor(i / 5) * .06, -.14 + Math.floor(i / 5) * .2, 0, 0, 0, { line: .02 });
    for (let i = 0; i < 5; i++) hk.add(SPHG(.12, 8), -.26 + i * .13, .1, -D / 2 + .02, 0, 0, 0, { line: .02 }); // curls down the back
  }
  if (L.hair === "messy") {
    cap(.12); back();
    for (let i = 0; i < 3; i++) hk.add(RBOXG(.1, .15, .1, .03), -.18 + i * .17, top + .1, rand(-.1, .1), 0, 0, rand(-.6, .6), hl);
    hk.add(CONEG(.07, .2), .3, top + .02, .05, 0, 0, -1.1, { line: .02 });
  }
  if (L.hair === "combover") {
    hk.add(RBOXG(W - .2, .05, D - .1, .02), .05, top + .02, 0, 0, 0, 0, { line: .02 });
    [-1, 1].forEach(sx => hk.add(RBOXG(.07, .2, D - .1, .03), sx * (W / 2 + .01), .05, 0, 0, 0, 0, hl));
    hk.add(RBOXG(W - .1, .12, .07, .03), 0, .02, -D / 2 - .005, 0, 0, 0, hl);
  }
  place(hk.bake(), hairM, head);
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
const BELT_M = M("#3a2a20"), GOLD_M = M("#ffd23f"), SHOE_M = M("#3b2a22"), SOLE_M = M("#d9c7a6");
const HANDS = {};
// palm + thumb merged into one mesh per side; sx = -1 left, 1 right (the thumb points at the body)
const handGeo = sx => HANDS[sx] || (HANDS[sx] = kit().add(RBOXG(.15, .15, .12, .05)).add(RBOXG(.06, .1, .065, .025), -sx * .085, .02, .03, 0, 0, -sx * .4, { line: .02 }).bake());
function makeChar({ shirt, pants = "#2b2b44", skin = "#f1c27d", look = {}, tie, name, tagColor, scale = 1 }) {
  const g = new THREE.Group();
  // one material per colour per character; geometry is shared between everyone
  const shirtM = M(shirt), pantsM = M(pants), skinM = M(skin), trimM = M(tie ? "#ffffff" : shade(shirt, .12));
  const part = (geom, mat, x, y, z, parent = g, line = .028) => {
    const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
    parent.add(m); return line ? outline(m, line) : m;
  };
  const limb = (px, py) => { const pivot = new THREE.Group(); pivot.position.set(px, py, 0); g.add(pivot); return pivot; };
  // legs: trousers, chunky shoes on a pale sole
  const legL = limb(-.15, .88), legR = limb(.15, .88);
  [legL, legR].forEach(l => {
    part(RBOXG(.21, .86, .23, .06), pantsM, 0, -.43, 0, l);
    part(RBOXG(.24, .13, .32, .05), SHOE_M, 0, -.82, .05, l);
    part(BOXG(.26, .045, .34), SOLE_M, 0, -.88, .055, l, .02);
  });
  // torso: soft block, belt + buckle, collar wings, neck, pocket, tie or buttons
  part(RBOXG(.62, .75, .36, .1), shirtM, 0, 1.25, 0);
  part(BOXG(.64, .08, .38), BELT_M, 0, .92, 0, g, .02);
  part(BOXG(.11, .08, .03), GOLD_M, 0, .92, .195, g, .015);
  [-1, 1].forEach(sx => { part(BOXG(.2, .07, .05), trimM, sx * .09, 1.6, .17, g, .02).rotation.z = sx * .45; });
  part(CYLG(.11, .12, .14, 12), skinM, 0, 1.67, 0, g, .02);
  part(BOXG(.14, .12, .02), trimM, .16, 1.42, .185, g, .015);
  if (tie) {
    const tm = M(tie);
    part(BOXG(.13, .09, .05), tm, 0, 1.55, .19, g, .02);
    part(BOXG(.11, .4, .03), tm, 0, 1.3, .19, g, .02);
    part(BOXG(.08, .08, .03), tm, 0, 1.1, .19, g, .02).rotation.z = Math.PI / 4;
  } else [1.42, 1.24, 1.06].forEach(y => part(SPHG(.022, 6), INK, 0, y, .185, g, 0));
  // arms: sleeve, cuff, mitten hand with a thumb on the inside
  const armL = limb(-.4, 1.58), armR = limb(.4, 1.58);
  [[armL, -1], [armR, 1]].forEach(([a, sx]) => {
    part(RBOXG(.17, .6, .19, .06), shirtM, 0, -.29, 0, a);
    part(RBOXG(.18, .08, .2, .03), trimM, 0, -.58, 0, a, .02);
    place(handGeo(sx), skinM, a, 0, -.7, 0);
  });
  blob(0, 0, .95, .75, g, .015); // contact shadow (sinks under the floor when seated)
  const face = buildHead(Object.assign({ skin }, look));
  const head = face.head; head.position.y = 2.02; g.add(head);
  const tex = tagTex({ label: name, color: tagColor });
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex })); // walls hide it, so tags no longer show through rooms
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

const BULB = new THREE.MeshBasicMaterial({ color: "#fff3c4" });
const SCREEN_GEO = new THREE.PlaneGeometry(.9, .52);
const cable = (pts, r = .012) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2]))), 20, r, 5);
const NOLINE = { line: 0 };

/* office chair: soft seat + back, gas lift, 5-star base on casters. Local origin = seat centre on the floor, the sitter faces -z */
const chairPF = prefab(K => {
  K(mats.accent).add(RBOXG(.64, .1, .6, .05), 0, .5, 0).add(RBOXG(.58, .6, .09, .05), 0, .98, .31);
  const dk = K(dark);
  dk.add(BOXG(.07, .42, .05), 0, .7, .34).add(BOXG(.3, .04, .3), 0, .435, 0, 0, 0, 0, { line: .015 })
    .add(CYLG(.035, .035, .32, 10), 0, .28, 0).add(CYLG(.07, .07, .06, 12), 0, .1, 0);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2;
    dk.add(BOXG(.05, .045, .3), Math.sin(a) * .17, .09, Math.cos(a) * .17, 0, a, 0, { line: .015 });
    K(INK).add(SPHG(.035, 8), Math.sin(a) * .31, .035, Math.cos(a) * .31, 0, 0, 0, NOLINE);
  }
});

/* desk: drawer pedestal, legs + modesty panel, monitor with bezel/stand/cable, keyboard with key rows,
 * mouse on a pad, mug, pen cup and an anglepoise lamp. Front (+z) is where the chair goes. */
const deskPF = prefab(K => {
  K(wood).add(RBOXG(2.2, .08, 1.1, .03), 0, .76, 0);
  const cab = K(PM("#e4d8c2"));
  cab.add(RBOXG(.52, .7, .98, .03), -.76, .37, -.02);
  [.6, .38, .16].forEach(y => {
    cab.add(RBOXG(.46, .19, .03, .012), -.76, y, .48, 0, 0, 0, { line: .015 });
    K(metal).add(BOXG(.16, .03, .03), -.76, y + .04, .505, 0, 0, 0, { line: .012 });
  });
  const dk = K(dark);
  [-.47, .47].forEach(z => dk.add(BOXG(.07, .74, .07), 1.0, .37, z));
  dk.add(BOXG(1.45, .4, .03), .22, .52, -.5, 0, 0, 0, { line: .02 });
  dk.add(RBOXG(1.0, .62, .06, .025), 0, 1.38, -.33)              // bezel
    .add(RBOXG(.56, .36, .1, .04), 0, 1.36, -.4)                   // back hump
    .add(BOXG(.08, .36, .05), 0, 1.0, -.43)                         // neck
    .add(RBOXG(.38, .025, .24, .01), 0, .812, -.4, 0, 0, 0, { line: .015 }) // foot
    .add(cable([[.06, 1.2, -.46], [.12, .95, -.5], [.18, .8, -.61], [.24, .4, -.63], [.3, .015, -.6]]), 0, 0, 0, 0, 0, 0, NOLINE)
    .add(cable([[.5, .815, .02], [.47, .812, -.12], [.25, .812, -.25], [.12, .812, -.3]], .007), 0, 0, 0, 0, 0, 0, NOLINE)
    .add(CYLG(.11, .13, .04, 14), -.85, .82, -.3);                  // lamp base
  K(GLOW("#49d16a")).add(SPHG(.012, 6), -.44, 1.1, -.297, 0, 0, 0, NOLINE); // power LED
  K(PM("#fff27a")).add(BOXG(.11, .11, .006), .52, 1.58, -.296, 0, 0, .25, { line: .008 }).add(BOXG(.1, .1, .006), .53, 1.46, -.296, 0, 0, -.15, { line: .008 });
  // keyboard + mouse
  K(PM("#ececec")).add(RBOXG(.62, .03, .2, .01), 0, .815, .05, 0, 0, 0, { line: .015 })
    .add(SPHG(.045, 10), .5, .83, .08, 0, 0, 0, { line: .015, sy: .55, sz: 1.35 });
  const keys = K(PM("#55565e"));
  for (let r = 0; r < 3; r++) for (let i = 0; i < 11; i++) keys.add(BOXG(.042, .014, .034), -.25 + i * .05, .836, -.005 + r * .045, 0, 0, 0, NOLINE);
  keys.add(BOXG(.24, .014, .03), 0, .836, .13, 0, 0, 0, NOLINE);
  K(PM("#33415c")).add(BOXG(.28, .008, .24), .5, .804, .08, 0, 0, 0, { line: .01 });
  // mug of coffee, pen cup
  K(PM("#ffffff")).add(CYLG(.06, .05, .12, 14), .75, .86, .1).add(TORG(.035, .012), .81, .86, .1, 0, 0, 0, { line: .01 });
  K(PM("#5a3420")).add(CYLG(.052, .052, .01, 14), .75, .917, .1, 0, 0, 0, NOLINE);
  K(metal).add(CYLG(.045, .04, .12, 10), -.5, .86, -.32, 0, 0, 0, { line: .015 });
  K(PM("#ffd23f")).add(BOXG(.016, .18, .016), -.51, .94, -.32, 0, 0, .15, { line: .01 }).add(BOXG(.016, .18, .016), -.48, .94, -.33, .1, 0, -.2, { line: .01 });
  // anglepoise lamp: two arm segments, elbow joint, shade, warm bulb
  K(metal).add(BOXG(.03, .354, .03), -.85, 1.01, -.35, -.286, 0, 0, { line: .015 })
    .add(BOXG(.03, .289, .03), -.85, 1.215, -.26, 1.326, 0, 0, { line: .015 })
    .add(SPHG(.03, 8), -.85, 1.18, -.4, 0, 0, 0, { line: .015 });
  K(mats.accent2).add(CYLG(.05, .13, .15, 14), -.85, 1.2, -.1, -.35, 0, 0);
  K(BULB).add(SPHG(.035, 8), -.85, 1.13, -.07, 0, 0, 0, NOLINE);
});

function desk(x, z, { flip = false, screen = screenMat, chair = true } = {}) {
  const g = deskPF(scene, x, 0, z, flip ? Math.PI : 0);
  const scr = new THREE.Mesh(SCREEN_GEO, screen); scr.position.set(0, 1.38, -.296); g.add(scr);
  blob(0, -.05, 2.6, 1.5, g);
  if (chair) { chairPF(g, 0, 0, .95); blob(0, .95, .95, .95, g); }
  collide(x, z, 2.3, 1.2);
  return g;
}

/* cubicle partitions for a desk at the origin: a back panel and one side panel (east), fabric with a trim cap */
const cubiclePF = prefab(K => {
  K(PM("#7f93a8")).add(RBOXG(2.5, 1.15, .06, .025), 0, .66, -.7).add(RBOXG(.06, 1.15, 1.35, .025), 1.27, .66, -.02);
  const trim = K(PM("#e9e3d6"));
  trim.add(RBOXG(2.58, .05, .1, .02), 0, 1.26, -.7).add(RBOXG(.1, .05, 1.43, .02), 1.27, 1.26, -.02);
  [-1.2, 1.2].forEach(x => trim.add(BOXG(.06, .085, .3), x, .04, -.7, 0, 0, 0, { line: .015 }));
  trim.add(BOXG(.3, .085, .06), 1.27, .04, .6, 0, 0, 0, { line: .015 });
  K(PM("#fffaf0")).add(BOXG(.22, .28, .01), -.95, .98, -.665, 0, 0, .06, { line: .01 }).add(BOXG(.2, .14, .01), .85, 1.0, -.665, 0, 0, -.08, { line: .01 });
  K(PM("#ff8fb1")).add(BOXG(.12, .12, .01), 1.235, 1.0, .2, 0, Math.PI / 2, .1, { line: .008 });
});
function cubicle(x, z) {
  cubiclePF(scene, x, 0, z);
  collide(x, z - .7, 2.6, .12); collide(x + 1.27, z - .02, .12, 1.45);
}

/* plants: pot with rim and soil, then a bush, a tall fiddle-leaf tree or a cactus */
const potKit = K => {
  K(PM("#c56a3c")).add(CYLG(.28, .21, .46, 16), 0, .23, 0).add(CYLG(.31, .31, .08, 16), 0, .47, 0);
  K(PM("#4a3020")).add(CYLG(.27, .27, .02, 16), 0, .505, 0, 0, 0, 0, NOLINE);
};
const PLANTS = {
  bush: prefab(K => {
    potKit(K);
    K(PMF("#3f9b4f")).add(ICOG(.48), 0, .98, 0, .3, .5, 0, { line: .04 }).add(ICOG(.34), .26, 1.25, .1, .7, 0, .2, { line: .035 });
    K(PMF("#2f7d3f")).add(ICOG(.32), -.24, 1.2, -.12, .2, 1, 0, { line: .035 }).add(ICOG(.26), .02, 1.45, -.05, .5, .3, .1, { line: .03 });
  }),
  tall: prefab(K => {
    potKit(K);
    K(PM("#6b4a2e")).add(CYLG(.035, .05, 1.2, 8), 0, 1.05, 0, 0, 0, 0, { line: .015 }).add(CYLG(.02, .03, .45, 6), .12, 1.5, 0, 0, 0, -.6, { line: .012 });
    K(PMF("#3f9b4f")).add(ICOG(.32), 0, 1.78, 0, .4, 0, 0, { line: .035, sy: .8 }).add(ICOG(.26), -.22, 2.02, -.05, 0, .6, .3, { line: .03 })
      .add(ICOG(.2), .08, 2.22, .1, .2, 0, 0, { line: .03 });
    K(PMF("#58b25f")).add(ICOG(.27), .3, 1.55, .08, 0, .4, 0, { line: .03, sy: .8 }).add(ICOG(.2), -.25, 1.45, .12, .3, 0, 0, { line: .03 });
  }),
  cactus: prefab(K => {
    potKit(K);
    K(PM("#4f9a5a")).add(CYLG(.15, .17, .75, 12), 0, .88, 0).add(SPHG(.15, 12), 0, 1.255, 0)
      .add(CYLG(.07, .07, .24, 10), .2, .95, 0, 0, 0, Math.PI / 2).add(CYLG(.07, .07, .3, 10), .3, 1.1, 0).add(SPHG(.07, 10), .3, 1.25, 0)
      .add(CYLG(.065, .065, .2, 10), -.18, .8, 0, 0, 0, Math.PI / 2).add(CYLG(.065, .065, .22, 10), -.26, .91, 0).add(SPHG(.065, 10), -.26, 1.02, 0);
    K(PM("#ff6fa3")).add(SPHG(.06, 8), 0, 1.42, 0, 0, 0, 0, { line: .015 }).add(SPHG(.04, 8), .3, 1.33, 0, 0, 0, 0, { line: .012 });
  }),
};
function plant(x, z, kind = "bush", { y = 0, scale = 1, solid = true } = {}) {
  const g = PLANTS[kind](scene, x, y, z, rand(0, 6.28)); g.scale.setScalar(scale);
  if (solid) { blob(x, z, .9, .9); collide(x, z, .6, .6); }
  return g;
}

// one per-frame hook for the little animations below (clock hands, printer paper, scanner glow)
const POLISH = {};
function polishTick(dt, now) {
  const s = Date.now() / 1000 - TZ_SECS, TAU = Math.PI * 2;
  if (POLISH.clock) {
    POLISH.clock.s.rotation.z = -Math.floor(s % 60) / 60 * TAU;
    POLISH.clock.m.rotation.z = -((s / 60) % 60) / 60 * TAU;
    POLISH.clock.h.rotation.z = -((s / 3600) % 12) / 12 * TAU;
  }
  if (POLISH.paper) {
    const pp = POLISH.paper; pp.visible = P.printing;
    if (pp.visible) { const k = (now % 650) / 650; pp.position.z = PRINTER.z + .42 + k * .32; pp.position.y = 1.0 - k * .025; }
  }
  if (POLISH.glow) {
    const em = scanSlot.material.emissive, gm = POLISH.glow.material;
    gm.color.copy(em); gm.opacity = Math.min(.6, .1 + scanSlot.material.emissiveIntensity * .3);
  }
}
const TZ_SECS = new Date().getTimezoneOffset() * 60;
setTimeout(() => window.FW && window.FW.onUpdate(polishTick)); // FW exists once this script has finished

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
cubicle(-3, 2); cubicle(-3, -3);
{ // rug under the coworker pod (flat, walkable; ends 0.8 m short of the boss's x = -5.5 lane)
  const rugTex = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = "#a9483a"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#e8c27a"; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
    g.strokeStyle = "#5a2a24"; g.lineWidth = 4; g.strokeRect(30, 30, w - 60, h - 60);
    g.fillStyle = "#c9654f";
    for (let j = 0; j < 7; j++) { const y = 70 + j * 62; g.beginPath(); g.moveTo(w / 2, y - 24); g.lineTo(w / 2 + 40, y); g.lineTo(w / 2, y + 24); g.lineTo(w / 2 - 40, y); g.closePath(); g.fill(); }
  });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 8), M("#ffffff", { map: rugTex }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(-3, .008, -.3); rug.receiveShadow = true; scene.add(rug);
}
const kevin = makeChar({ shirt: "#7a5cff", look: { hair: "bowl", hairColor: "#c98a3a", glasses: true, teeth: true, mouth: "grin", brows: "raised" }, name: "KEVIN", tagColor: "#555" });
kevin.g.position.set(-3, 0, 2.95); kevin.g.rotation.y = Math.PI; seatPose(kevin, true);
const dana = makeChar({ shirt: "#3fae6a", skin: "#a8714a", look: { hair: "bun", hairColor: "#1e1410", lids: true, mouth: "flat", brows: "flat" }, name: "DANA", tagColor: "#555" });
dana.g.position.set(-3, 0, -2.05); dana.g.rotation.y = Math.PI; seatPose(dana, true);

/* --- printer --- */
const PRINTER = { x: -8, z: -7.6 };
{
  const pg = new THREE.Group(); pg.position.set(PRINTER.x, 0, PRINTER.z); scene.add(pg);
  const K = kits();
  K(PM("#e9e6df")).add(RBOXG(1.4, .9, .9, .06), 0, .45, 0);
  K(PM("#cfcac0")).add(RBOXG(1.42, .25, .92, .05), 0, 1.02, 0);
  K(mats.accent2).add(RBOXG(1.0, .05, .5, .02), 0, 1.17, -.05, 0, 0, 0, { line: .02 });
  const dk = K(dark);
  [.3, .6].forEach(y => dk.add(BOXG(1.3, .016, .012), 0, y, .452, 0, 0, 0, NOLINE));       // paper drawer seams
  [.47, .19].forEach(y => dk.add(RBOXG(.34, .045, .04, .015), 0, y, .46, 0, 0, 0, { line: .012 }));
  K(INK).add(BOXG(1.0, .045, .012), 0, 1.0, .463, 0, 0, 0, NOLINE);                          // output slot
  const card = K(PM("#c9a46a"));                                                              // paper reams on the floor
  card.add(BOXG(.5, .32, .36), 1.12, .16, -.08).add(BOXG(.5, .32, .36), 1.1, .48, -.1, 0, .14, 0);
  K(PM("#f4f1ea")).add(BOXG(.3, .1, .005), 1.12, .18, .1, 0, 0, 0, { line: .008 });
  K.place(pg);
  // paper input tray on the back, tilted up
  const feed = new THREE.Group(); feed.position.set(0, 1.3, -.42); feed.rotation.x = .5; pg.add(feed);
  const F = kits();
  F(dark).add(BOXG(.9, .02, .42)).add(BOXG(.02, .12, .42), -.45, .05, 0, 0, 0, 0, { line: .012 }).add(BOXG(.02, .12, .42), .45, .05, 0, 0, 0, 0, { line: .012 });
  F(PM("#fffaf0")).add(BOXG(.8, .07, .36), 0, .045, .01, 0, 0, 0, { line: .015 });
  F.place(feed);
  // control panel: little LCD and three buttons
  const panel = new THREE.Group(); panel.position.set(.42, 1.18, .3); panel.rotation.x = .3; pg.add(panel);
  const C = kits();
  C(PM("#3a3a40")).add(RBOXG(.42, .06, .22, .02));
  C(GLOW("#9fe8c8")).add(BOXG(.16, .01, .08), -.08, .032, -.02, 0, 0, 0, NOLINE);
  [["#e0352b", .06], ["#ffd23f", .12], ["#49d16a", .18]].forEach(([c, x]) => C(PM(c)).add(CYLG(.022, .022, .02, 10), x - .03, .035, .02, 0, 0, 0, { line: .01 }));
  C.place(panel);
  blob(0, 0, 1.8, 1.3, pg); blob(1.12, -.08, .8, .6, pg);
  collide(PRINTER.x + 1.12, PRINTER.z - .09, .6, .45);
  // a sheet sliding out while it prints (animated in polishTick)
  POLISH.paper = new THREE.Mesh(BOXG(.42, .006, .3), PM("#fffaf0"));
  POLISH.paper.position.set(PRINTER.x, 1.0, PRINTER.z + .45); POLISH.paper.visible = false; scene.add(POLISH.paper);
}
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
{ // counter: soft body, cream front panels, kick plate, trim, bell, "take a number" dispenser
  const K = kits();
  K(mats.accent).add(RBOXG(3.2, 1.05, .8, .04), 0, .52, .6);
  K(wood).add(RBOXG(3.3, .08, .95, .03), 0, 1.08, .6);
  const cream = K(PM("#f7ecd6"));
  [-1.05, 0, 1.05].forEach(x => cream.add(RBOXG(.88, .6, .03, .015), x, .55, 1.012, 0, 0, 0, { line: .015 }));
  K(dark).add(BOXG(3.22, .1, .05), 0, .05, 1.0, 0, 0, 0, { line: .015 })
    .add(CYLG(.08, .09, .025, 14), .2, 1.133, .88, 0, 0, 0, { line: .012 })
    .add(CYLG(.012, .012, .04, 8), .2, 1.22, .88, 0, 0, 0, { line: .01 }).add(SPHG(.02, 8), .2, 1.245, .88, 0, 0, 0, { line: .01 })
    .add(CYLG(.012, .012, .16, 6), -1.38, 1.45, .82, 0, 0, 0, { line: .01 });
  K(mats.accent2).add(BOXG(3.24, .05, .04), 0, .98, 1.01, 0, 0, 0, { line: .015 });
  K(GOLD_M).add(DOMEG(.07), .2, 1.145, .88, 0, 0, 0, { line: .012 });
  K(PM("#e0352b")).add(RBOXG(.2, .26, .16, .05), -1.38, 1.25, .82);
  K(PM("#fffaf0")).add(BOXG(.08, .004, .12), -1.38, 1.2, .93, .5, 0, 0, { line: .008 });
  K.place(boothDesk);
  const num = signPlane("TAKE A NUMBER", null, .62, .14, "#2b1d14"); num.position.set(-1.38, 1.6, .82); boothDesk.add(num);
  blob(BOOTH.x, BOOTH.z + .6, 3.7, 1.4);
}
collide(BOOTH.x, BOOTH.z + .6, 3.4, 1.0);
const scanner = place(kit().add(RBOXG(.9, .45, .6, .05)).bake(), PM("#3a3a40"), boothDesk, .8, 1.35, .5);
const scanSlot = new THREE.Mesh(new THREE.PlaneGeometry(.6, .06), new THREE.MeshStandardMaterial({ color: "#000", emissive: "#7cff9a", emissiveIntensity: .2 }));
scanSlot.position.set(.8, 1.45, .805); boothDesk.add(scanSlot);
{ // scanner details: lid, accent bezel round the slot, vents, feet, and a glow that follows the slot colour
  const K = kits();
  K(PM("#5a5a64")).add(RBOXG(.94, .07, .64, .03), .8, 1.6, .5);
  K(mats.accent).add(BOXG(.7, .025, .02), .8, 1.495, .81, 0, 0, 0, { line: .01 }).add(BOXG(.7, .025, .02), .8, 1.405, .81, 0, 0, 0, { line: .01 })
    .add(BOXG(.025, .115, .02), .4625, 1.45, .81, 0, 0, 0, { line: .01 }).add(BOXG(.025, .115, .02), 1.1375, 1.45, .81, 0, 0, 0, { line: .01 });
  const ink = K(INK);
  [1.27, 1.22, 1.17].forEach(y => ink.add(BOXG(.5, .014, .01), .8, y, .803, 0, 0, 0, NOLINE));
  [-.38, .38].forEach(dx => ink.add(BOXG(.1, .02, .5), .8 + dx, 1.125, .5, 0, 0, 0, NOLINE));
  K(GLOW("#ff5a4a")).add(SPHG(.018, 6), 1.12, 1.54, .8, 0, 0, 0, NOLINE);
  K.place(boothDesk);
  POLISH.glow = new THREE.Mesh(new THREE.PlaneGeometry(.78, .22), new THREE.MeshBasicMaterial({ color: "#7cff9a", transparent: true, opacity: .15, blending: THREE.AdditiveBlending, depthWrite: false }));
  POLISH.glow.position.set(.8, 1.45, .816); boothDesk.add(POLISH.glow);
}
const inTray = box(.6, .08, .45, M("#c9c3b6"), -.7, 1.16, .75, boothDesk);
const inLabel = signPlane("IN", null, .4, .16, "#e0352b"); inLabel.position.set(-.7, 1.28, .99); boothDesk.add(inLabel);
const boothSign = signPlane("ACCOUNTS PAYABLE", "INSPECTOR ON DUTY", 4.2, 1.0, "#1f8a8a");
boothSign.position.set(BOOTH.x, 2.85, BOOTH.z - .5); scene.add(boothSign);
[-1.8, 1.8].forEach(dx => cyl(.02, .02, .5, dark, BOOTH.x + dx, 3.5, BOOTH.z - .5));
const glassMat = new THREE.MeshStandardMaterial({ color: "#bfe8ff", transparent: true, opacity: .25, roughness: .1 });
[-1.75, 1.75].forEach(dx => { const gl = box(.06, 1.6, 1.6, glassMat, BOOTH.x + dx, 1.4, BOOTH.z + .1); gl.castShadow = false; collide(BOOTH.x + dx, BOOTH.z + .1, .1, 1.6); });
const inspector = makeChar({ shirt: "#f4f4f4", pants: "#555", tie: "#1f8a8a", look: { hair: "messy", hairColor: "#8a5a35", lids: true, mouth: "o", nose: "big" }, name: "GUS · v1", tagColor: "#1f8a8a" });
inspector.g.position.set(BOOTH.x, 0, BOOTH.z - .3); seatPose(inspector, false);
chairPF(scene, BOOTH.x, 0, BOOTH.z - .3, Math.PI); blob(BOOTH.x, BOOTH.z - .3, .95, .95); // faces the counter
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
{ // chunky wooden frame round the corkboard
  const K = kits(), f = K(wood), z = -RD / 2 + .19;
  f.add(RBOXG(4.26, .13, .07, .025), 3, 1.9 + 1.31, z).add(RBOXG(4.26, .13, .07, .025), 3, 1.9 - 1.31, z)
    .add(RBOXG(.13, 2.5, .07, .025), 3 - 2.065, 1.9, z).add(RBOXG(.13, 2.5, .07, .025), 3 + 2.065, 1.9, z);
  K.place();
}

/* --- clerk --- */
const CLERK_DESK = { x: 8, z: 4 };
desk(CLERK_DESK.x, CLERK_DESK.z, { flip: true });
plant(CLERK_DESK.x - .72, CLERK_DESK.z + .32, "bush", { y: .8, scale: .3, solid: false }); // desk succulent
const clerk = makeChar({ shirt: "#f4a63a", skin: "#e0a77a", look: { hair: "curly", hairColor: "#b8342a", earrings: true, mouth: "grin", brows: "raised" }, name: "BRENDA · CLERK", tagColor: "#a4581c" });
clerk.g.position.set(CLERK_DESK.x, 0, CLERK_DESK.z - .95); seatPose(clerk, false);
const lunchSign = signPlane("ON LUNCH", null, .8, .25, "#e0352b"); lunchSign.position.set(CLERK_DESK.x + .7, .95, CLERK_DESK.z + .56); scene.add(lunchSign);

/* --- boss office door + boss --- */
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
plant(-12.2, 8.2, "tall"); plant(12.2, 8.2, "bush"); plant(12.2, -8.2, "bush"); plant(-1, -8.2, "cactus"); plant(12.3, -2.6, "tall");
{ // water cooler: soft body, drip tray, hot/cold taps, cup tube
  const K = kits(), x = -12.3, z = -8.2;
  K(PM("#e8e8e8")).add(RBOXG(.5, 1.0, .5, .05), x, .5, z);
  K(dark).add(RBOXG(.3, .03, .14, .01), x, .62, z + .27, 0, 0, 0, { line: .012 });
  K(PM("#e0352b")).add(BOXG(.05, .06, .06), x - .08, .8, z + .27, 0, 0, 0, { line: .012 });
  K(PM("#2f6fd6")).add(BOXG(.05, .06, .06), x + .08, .8, z + .27, 0, 0, 0, { line: .012 });
  K(PM("#cfd6dc")).add(CYLG(.04, .035, .24, 10), x + .3, .72, z + .1, 0, 0, 0, { line: .012 });
  K.place(); blob(x, z, .85, .85);
}
const jug = cyl(.26, .26, .5, M("#7cc6ff", { transparent: true, opacity: .7 }), -12.3, 1.25, -8.2); jug.castShadow = false; collide(-12.3, -8.2, .7, .7);
// the emergency exit sits on the south wall east of the break room, so it opens onto the outside
const EXIT_X = 6;
const exitSign = signPlane("EXIT", null, 1, .35, "#1d9a4b"); exitSign.position.set(EXIT_X, 2.6, RD / 2 - .17); exitSign.rotation.y = Math.PI; scene.add(exitSign);
// the emergency exit under the sign: double metal doors with push bars and wired-glass windows
const exitDoor = (() => {
  const zf = RD / 2 - .16, g = new THREE.Group(); g.position.x = EXIT_X; scene.add(g);
  const frame = M("#2e2a28"), metalDoor = M("#6f8f86"), chrome = M("#c9ced3"), red = M("#e0352b");
  box(.12, 2.42, .12, frame, -.86, 1.21, zf, g); box(.12, 2.42, .12, frame, .86, 1.21, zf, g); box(1.84, .12, .12, frame, 0, 2.42, zf, g);
  const leaves = [-1, 1].map(side => {
    const hinge = new THREE.Group(); hinge.position.set(side * .8, 0, zf - .04); g.add(hinge);
    const leaf = box(.78, 2.3, .06, metalDoor, -side * .39, 1.17, 0, hinge);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(.28, .4), new THREE.MeshStandardMaterial({ color: "#bfe8ff", transparent: true, opacity: .5, roughness: .1 }));
    win.position.set(-side * .39, 1.65, -.035); win.rotation.y = Math.PI; hinge.add(win);
    cyl(.025, .025, .6, chrome, -side * .42, 1.05, -.09, hinge).rotation.z = Math.PI / 2;  // push bar
    [-.25, .25].forEach(dx => box(.03, .03, .06, chrome, -side * .42 + dx, 1.05, -.06, hinge));
    return hinge;
  });
  box(1.4, .02, .9, M("#3a3a40"), 0, .01, zf - .55, g);                          // floor mat
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.0, .35), new THREE.MeshBasicMaterial({ color: "#3dff8a", transparent: true, opacity: .25 }));
  glow.position.set(0, 2.6, zf - .02); glow.rotation.y = Math.PI; g.add(glow);         // the sign glows
  const alarm = new THREE.Mesh(new THREE.BoxGeometry(.18, .12, .05), red); alarm.position.set(1.15, 1.5, zf - .02); g.add(alarm);
  collide(0, zf, 1.9, .3);
  return { leaves };
})();
let exitOpenUntil = 0;


/* --- windows with half-drawn blinds on the north wall (all geometry sits in front of the wall face) --- */
const WALL_N = -RD / 2 + .15; // inner face of the north wall
const skyTex = canvasTex(512, 384, (g, w, h) => {
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#7cc6ff"); sky.addColorStop(1, "#d8f0ff");
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = "#fff6c8"; g.beginPath(); g.arc(400, 90, 34, 0, 7); g.fill();
  g.fillStyle = "#ffffff"; [[90, 70, 46], [140, 60, 36], [300, 120, 30], [336, 112, 24]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); });
  const bld = [[0, 150, 70], [70, 210, 60], [130, 120, 80], [210, 190, 50], [260, 100, 70], [330, 170, 60], [390, 135, 70], [460, 200, 52]];
  bld.forEach(([x, top, bw], i) => {
    g.fillStyle = i % 2 ? "#8aa0b8" : "#9db3c9"; g.fillRect(x, top, bw, h - top);
    g.fillStyle = "#e9f4ff"; for (let y = top + 14; y < h - 10; y += 26) for (let wx = x + 10; wx < x + bw - 12; wx += 18) g.fillRect(wx, y, 8, 12);
  });
});
const windowPF = prefab(K => {
  const W = 2.0, H = 1.5, y = 1.85, z = WALL_N, fr = K(PM("#f7f3ea"));
  fr.add(BOXG(W + .16, .08, .08), 0, y + H / 2 + .04, z + .04).add(BOXG(W + .16, .08, .08), 0, y - H / 2 - .04, z + .04)
    .add(BOXG(.08, H, .08), -W / 2 - .04, y, z + .04).add(BOXG(.08, H, .08), W / 2 + .04, y, z + .04)
    .add(BOXG(.05, H, .05), 0, y, z + .03, 0, 0, 0, { line: .015 })
    .add(RBOXG(W + .3, .06, .2, .02), 0, y - H / 2 - .1, z + .1);                     // sill
  const bl = K(PM("#efe4cc"));
  bl.add(RBOXG(W + .1, .08, .1, .02), 0, y + H / 2 - .02, z + .11);                   // headrail
  for (let i = 0; i < 12; i++) bl.add(BOXG(W - .04, .012, .075), 0, y + H / 2 - .1 - i * .065, z + .1, .45, 0, 0, { line: .008 });
  bl.add(BOXG(W, .03, .06), 0, y + H / 2 - .1 - 12 * .065, z + .1, 0, 0, 0, { line: .012 }); // bottom bar
  K(dark).add(BOXG(.01, .9, .01), W / 2 - .12, y + .25, z + .16, 0, 0, 0, NOLINE).add(SPHG(.025, 6), W / 2 - .12, y - .2, z + .16, 0, 0, 0, { line: .01 });
});
const skyGeo = new THREE.PlaneGeometry(2.0, 1.5), skyMat = new THREE.MeshBasicMaterial({ map: skyTex });
[-10.6, -4.5, 10.9].forEach(x => {
  windowPF(scene, x, 0, 0, 0, false);
  const sky = new THREE.Mesh(skyGeo, skyMat); sky.position.set(x, 1.85, WALL_N + .005); scene.add(sky);
});

/* --- wall clock showing the real time (hands turned in polishTick) --- */
{
  const cg = new THREE.Group(); cg.position.set(-1.4, 2.45, WALL_N); scene.add(cg);
  const K = kits();
  K(dark).add(CYLG(.36, .36, .06, 28), 0, 0, .03, Math.PI / 2, 0, 0);
  K(PM("#fffaf0")).add(CYLG(.32, .32, .02, 28), 0, 0, .065, Math.PI / 2, 0, 0, NOLINE);
  const ticks = K(INK);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ticks.add(BOXG(.02, i % 3 ? .04 : .07, .01), Math.sin(a) * .27, Math.cos(a) * .27, .078, 0, 0, -a, NOLINE); }
  K(PM("#e0352b")).add(SPHG(.025, 8), 0, 0, .1, 0, 0, 0, { line: .01 });
  K.place(cg, false);
  const hand = (w, len, mat, z) => { const h = new THREE.Group(); h.position.z = z; cg.add(h); const m = new THREE.Mesh(BOXG(w, len, .01), mat); m.position.y = len / 2 - .03; h.add(m); return h; };
  POLISH.clock = { h: hand(.035, .19, INK, .083), m: hand(.025, .27, INK, .088), s: hand(.01, .29, PM("#e0352b"), .093) };
}

/* --- motivational posters --- */
const posterTexs = [];
function poster(lines, sub, bg, fg, art, x, z, ry) {
  const w = 1.1, h = 1.5;
  const tex = canvasTex(512, 698, (g, cw, ch) => {
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
    g.strokeStyle = "#fff"; g.lineWidth = 12; g.strokeRect(24, 24, cw - 48, ch - 48);
    art(g, cw, ch);
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
    lines.forEach((t, i) => {
      let fs = 110; g.font = `${fs}px Bungee, Impact, sans-serif`;
      while (g.measureText(t).width > cw - 90 && fs > 20) { fs -= 4; g.font = `${fs}px Bungee, Impact, sans-serif`; }
      g.fillText(t, cw / 2, ch * .66 + i * 86 - (lines.length - 1) * 30);
    });
    g.fillStyle = "#fff"; g.font = "bold 24px 'Space Mono', monospace"; g.fillText(sub, cw / 2, ch * .9);
  });
  posterTexs.push(tex);
  const grp = new THREE.Group(); grp.position.set(x, 1.85, z); grp.rotation.y = ry; scene.add(grp);
  place(kit().add(BOXG(w + .08, h + .08, .03), 0, 0, -.015, 0, 0, 0, { line: .015 }).bake(), dark, grp, 0, 0, 0, 0, false);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M("#ffffff", { map: tex })); m.position.z = .002; grp.add(m);
}
poster(["SYNERGY"], "TOGETHER WE INVOICE", "#2f6fd6", "#ffd23f", (g, w) => {
  g.globalAlpha = .9; g.fillStyle = "#ffd23f"; g.beginPath(); g.arc(w / 2 - 60, 220, 110, 0, 7); g.fill();
  g.fillStyle = "#ff8fb1"; g.beginPath(); g.arc(w / 2 + 60, 220, 110, 0, 7); g.fill(); g.globalAlpha = 1;
}, -RW / 2 + .17, 1.5, Math.PI / 2);
poster(["TRUST THE", "PROCESS"], "DON'T ASK QUESTIONS", "#1d9a4b", "#ffffff", (g, w) => {
  g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineWidth = 8; g.font = "bold 34px 'Space Mono', monospace"; g.textAlign = "center"; g.textBaseline = "middle";
  [["IDEA", 110], ["???", 220], ["$$$", 330]].forEach(([t, y], i) => {
    g.strokeRect(w / 2 - 80, y - 36, 160, 72); g.fillText(t, w / 2, y);
    if (i < 2) { g.beginPath(); g.moveTo(w / 2, y + 36); g.lineTo(w / 2, y + 74); g.stroke(); }
  });
}, RW / 2 - .17, -5.2, -Math.PI / 2);
poster(["HANG IN", "THERE"], "IT'S ALMOST FRIDAY", "#f4a63a", "#2b1d14", (g, w) => {
  g.strokeStyle = "#6b4a2e"; g.lineWidth = 16; g.beginPath(); g.moveTo(40, 90); g.lineTo(w - 40, 110); g.stroke();
  g.fillStyle = "#555"; g.strokeStyle = "#555"; g.lineWidth = 14;
  [-30, 30].forEach(dx => { g.beginPath(); g.moveTo(w / 2 + dx, 100); g.lineTo(w / 2 + dx * .6, 180); g.stroke(); });
  g.beginPath(); g.arc(w / 2, 250, 70, 0, 7); g.fill();
  g.beginPath(); g.moveTo(w / 2 - 60, 210); g.lineTo(w / 2 - 50, 150); g.lineTo(w / 2 - 15, 190); g.fill();
  g.beginPath(); g.moveTo(w / 2 + 60, 210); g.lineTo(w / 2 + 50, 150); g.lineTo(w / 2 + 15, 190); g.fill();
  g.fillStyle = "#fff"; [-25, 25].forEach(dx => { g.beginPath(); g.arc(w / 2 + dx, 245, 16, 0, 7); g.fill(); });
  g.fillStyle = "#111"; [-25, 25].forEach(dx => { g.beginPath(); g.arc(w / 2 + dx + 3, 248, 7, 0, 7); g.fill(); });
}, 2, RD / 2 - .17, Math.PI);
if (document.fonts) document.fonts.ready.then(() => posterTexs.forEach(t => redraw(t)));

/* --- floor cable cover from the coworker pod to the wall, then a raceway up to the ceiling --- */
{
  const K = kits();
  K(PM("#e8c13a")).add(RBOXG(.2, .03, 5.1, .012), -2.4, .015, -6.3, 0, 0, 0, { line: .012 });
  K(PM("#f2efe8")).add(BOXG(.1, 3.2, .05), -2.4, 1.6, WALL_N + .025, 0, 0, 0, { line: .015 });
  K.place(scene, false);
}

/* --- hanging lamps: warm pools of light --- */
const lampPF = prefab(K => {
  K(dark).add(CYLG(.13, .13, .03, 14), 0, 3.185, 0).add(CYLG(.012, .012, .14, 6), 0, 3.11, 0, 0, 0, 0, { line: .01 })
    .add(CYLG(.05, .05, .05, 12), 0, 3.06, 0, 0, 0, 0, { line: .012 });
  K(mats.accent2).add(CYLG(.1, .36, .28, 20), 0, 2.95, 0).add(TORG(.355, .022), 0, 2.815, 0, Math.PI / 2, 0, 0, { line: .012 }); // shade + rolled rim
  K(BULB).add(SPHG(.11, 10), 0, 2.82, 0, 0, 0, 0, NOLINE);
});
[[-8, 1], [-3, -.5], [8, -4.5], [8, 3.5], [2, 6]].forEach(([x, z]) => {
  lampPF(scene, x, 0, z, 0, false);
  const l = new THREE.PointLight("#fff1dc", .25, 6, 2); l.position.set(x, 2.75, z); scene.add(l);
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
  const K = kits(), tx = RW / 2 - .22;
  K(dark).add(RBOXG(.12, 1.9, 3.3, .05), tx, 2.1, 0)                         // soft bezel
    .add(RBOXG(.14, .14, 2.2, .05), tx, 1.0, 0)                              // soundbar
    .add(BOXG(.05, .3, .05), tx + .02, 1.1, 0, 0, 0, 0, { line: .012 });      // soundbar bracket
  K(PM("#55565e")).add(BOXG(.012, .035, .3), tx - .065, 1.19, 0, 0, 0, 0, NOLINE); // badge on the chin
  K(GLOW("#ff5a4a")).add(SPHG(.018, 6), tx - .065, 1.19, 1.45, 0, 0, 0, NOLINE);   // standby LED
  K.place(scene, false);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.74), new THREE.MeshBasicMaterial({ map: tvTex }));
  screen.rotation.y = -Math.PI / 2; screen.position.set(RW / 2 - .3, 2.1, 0); scene.add(screen);
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
const SFX_HOOKS = {};
function sfx(kind) {
  if (SFX_HOOKS[kind]) { try { SFX_HOOKS[kind](); } catch (e) {} return; }
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
  for (const fn of MSG_HOOKS) { try { fn(m); } catch (err) { console.error("[forged] plugin message failed", err); } }
  if (m.type === "stand") stand();
  if (m.type === "menu") ForgedMenu.open(m.screen || "pause");
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
  { label: () => "Clock out early", can: () => near({ x: EXIT_X, z: RD / 2 - 1 }, 1.6), act: () => {
      exitOpenUntil = performance.now() + 1600; sfx("door");
      if (P.carrying) say(player, "Leave with a forged invoice in my hand? Bold.", 2600);
      else say(player, pick(["Not before quota. The boss would notice.", "One more invoice. Then I'm out.", "The parking lot looks free… but my desk looks profitable."]), 2600);
    } },
  { label: () => "Look at the corkboard", can: () => near({ x: 3, z: -RD / 2 + 1.2 }, 1.8), act: () => wtoast(pins.length ? `${pins.length} trick${pins.length > 1 ? "s" : ""} pinned. ${pins.filter(p => p.caught).length} caught.` : "Empty… for now.") },
  { label: () => "Small talk with the Boss", can: () => boss.g.visible && near(boss.g.position, 1.8), act: () => say(boss, pick(["Shouldn't you be at your desk?", "Numbers. I want numbers.", "Nice weather for compliance."]), 2400) },
];
let current = null;
function updatePrompt() {
  current = P.seated || !P.started || CINE.active ? null : INTERACTIONS.find(i => i.can());
  const el = $("#prompt");
  el.classList.toggle("show", !!current);
  if (current) el.innerHTML = `<kbd>${K.label("interact")}</kbd>${current.label()}`;
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
  if (!P.started || P.paused) return;
  if (e.code === "Escape") { e.preventDefault(); ForgedMenu.open("pause"); return; }
  if (P.seated || CINE.active) return;
  if (["Tab", "F3", "F5", "Space"].includes(e.code)) e.preventDefault(); // focus jumps, reload, scrolling
  if (K.is("playerList", e.code)) { ForgedMenu.showPlayerList(true); return; }
  P.keys.add(e.code);
  if (e.repeat) return;
  if (K.is("interact", e.code) && current) current.act();
  if (K.is("camera", e.code)) setFirstPerson(!P.fp);
});
addEventListener("keyup", e => {
  P.keys.delete(e.code);
  if (K.is("playerList", e.code)) ForgedMenu.showPlayerList(false);
});
addEventListener("blur", () => { P.keys.clear(); ForgedMenu.showPlayerList(false); });

// mouse buttons can be bound like keys: right-click interacts by default (Minecraft's "use")
canvas.addEventListener("contextmenu", e => e.preventDefault());
addEventListener("mousedown", e => {
  if (!P.started || P.paused || P.seated || e.button === 0) return;
  const code = "Mouse" + e.button;
  P.keys.add(code);
  if (K.is("interact", code) && current) { e.preventDefault(); current.act(); }
  if (K.is("camera", code)) setFirstPerson(!P.fp);
});
addEventListener("mouseup", e => P.keys.delete("Mouse" + e.button));

// Esc while the mouse is captured: the browser releases it and swallows the key, so open the menu here
document.addEventListener("pointerlockchange", () => {
  if (!document.pointerLockElement && P.started && !P.seated && !P.paused && !ForgedMenu.isOpen()) ForgedMenu.open("pause");
});

// some browsers (and embedded previews) refuse pointer lock: that's fine, drag-to-look still works
function lockMouse() { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
canvas.addEventListener("click", () => { if (P.started && !P.seated && document.pointerLockElement !== canvas) lockMouse(); });
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
  if (on) { P.pitch = .05; wtoast(`First person — scroll out (or press ${K.label("camera")}) to go back`); }
  else { P.pitch = clamp(P.pitch, .3, 1.15); P.dist = MIN_DIST; }
}

$("#btn-start").onclick = () => {
  $("#start").classList.add("hide"); P.started = true;
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch (e) {}
  lockMouse();
  say(player, "Another day at the office…", 2500);
};
/* ======================= Game Menu (menu.js) =======================
 * Esc pauses everything: the office freezes (player, boss, camera) and the
 * computer is told so its own timers stop. */

ForgedMenu.init({
  office: true,
  onPause(on) {
    P.paused = on; P.keys.clear(); ForgedMenu.showPlayerList(false);
    toOS("paused", { on });
    if (on && document.pointerLockElement) document.exitPointerLock();
  },
  onResume() {
    if (!P.started) return;
    if (P.seated) { OS.focus(); OS.contentWindow && OS.contentWindow.focus(); }
    else { try { const r = canvas.requestPointerLock(); r && r.catch && r.catch(() => {}); } catch (e) { /* click the office to capture the mouse */ } }
  },
  onQuit() {
    P.started = false;
    stand();
    Object.assign(P, { carrying: false, envelopeReady: false, printing: false });
    carryEnv.visible = envelope.visible = false;
    setPhase("idle"); toOS("quit");
    if (document.pointerLockElement) document.exitPointerLock();
    $("#start").classList.remove("hide");
  },
  canTour: () => P.seated && P.phase === "forging",
  onTour: () => toOS("tour"),
  getStats: () => P.hud ? { money: P.hud.money, patches: P.hud.patches || 0, shame: P.hud.shame || [], round: P.hud.round } : null,
});

// on-screen key hints follow the player's bindings
function paintHints() {
  const move = ["forward", "left", "back", "right"].map(a => K.label(a)).join("");
  $("#controls").innerHTML = `<kbd>${move}</kbd> move · <kbd>${K.label("sprint")}</kbd> sprint · <kbd>Mouse</kbd> look · ` +
    `<kbd>${K.label("camera")}</kbd> camera · <kbd>${K.labels("interact")}</kbd> interact · <kbd>${K.label("playerList")}</kbd> leaderboard · <kbd>Esc</kbd> menu`;
  $("#bezel-hint").innerHTML = `<kbd>${K.label("standUp")}</kbd> stand up · <kbd>Esc</kbd> menu`;
}
paintHints(); K.onChange(paintHints);

/* ======================= Simulation ======================= */

function collidePlayer(pos) {
  const r = .35;
  pos.x = clamp(pos.x, -40, 40);
  pos.z = clamp(pos.z, -40, 40);
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
  const f = (held("forward") ? 1 : 0) - (held("back") ? 1 : 0);
  const s = (held("right") ? 1 : 0) - (held("left") ? 1 : 0);
  const dir = _dir.set(-Math.sin(P.yaw) * f + Math.cos(P.yaw) * s, 0, -Math.cos(P.yaw) * f - Math.sin(P.yaw) * s);
  let speed = 0;
  if (dir.lengthSq() > 0) {
    dir.normalize();
    speed = held("sprint") ? 7 : 4;
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
  walls.forEach(w => { w.mat.opacity = wallBlocks(w, camera.position, t) ? .1 : 1; w.mat.depthWrite = w.mat.opacity > .5; });
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

const UPDATERS = [], MSG_HOOKS = [];
let last = performance.now();
function loop(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (P.paused) { renderer.render(scene, camera); requestAnimationFrame(loop); return; } // Game Menu open: freeze
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
  { const open = now < exitOpenUntil ? .55 : 0; exitDoor.leaves.forEach((h, i) => { h.rotation.y += ((i ? -open : open) - h.rotation.y) * Math.min(1, dt * 8); }); }
  for (const fn of UPDATERS) { try { fn(dt, now); } catch (e) { console.error("[forged] plugin update failed", e); } }
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

/* ======================= Plugin API =======================
 * Rooms and features live in their own files (prototype/rooms/*.js, audio.js,
 * voice.js, features.js) loaded after this one. They build on `window.FW`
 * instead of editing world.js, so several people can work in parallel. */
window.FW = {
  THREE, scene, camera, renderer,
  // building blocks
  M, mats, box, cyl, sphere, outline, collide, walls, EXIT_X, signPlane, canvasTex, redraw, wallRun, room, doorFrame, DOORS, RW, RD, WALL_H,
  makeChar, animWalk, seatPose, standPose, characters, buildHead, glasses,
  // state
  P, player, B, BOSS_PATH, CHAIR, MY_DESK, PRINTER, BOOTH, IN_TRAY, CLERK_DESK, CINE, get pal() { return pal; }, PALETTES,
  npcs: { kevin, dana, inspector, clerk, boss },
  // actions and effects
  say, wtoast, sfx, toOS, setPhase, sit, stand, grab, deliver, near, flashVignette, burstConfetti,
  rand, pick, clamp, money,
  // hooks
  onUpdate: fn => UPDATERS.push(fn),
  onMessage: fn => MSG_HOOKS.push(fn),
  addInteraction: it => INTERACTIONS.push(it),
  setSfx: (kind, fn) => { SFX_HOOKS[kind] = fn; },
  audio: () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} return actx; },
};

})();
