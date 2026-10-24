/* rooms/records-room.js: see PLUGINS.md. Builds on window.FW from world.js.
 *
 * THE RECORDS & MAIL ROOM (x 13…22, z 0…10), east of the main office.
 * A dusty archive plus mailroom with three things that matter to the loop:
 *  - Pneumatic tube: send the envelope to the inspector without walking it past
 *    the boss. Costs ~6 s in transit, and 25% of the time it jams and spits it back.
 *  - The archive: "Dig through the archive" pops up a clipboard with the
 *    inspector's last 5 verdicts (scheme, vendor, caught, tells) as intel.
 *  - The shredder: after a CAUGHT verdict, shred the evidence (sends `shred`).
 * Everything is built once; onUpdate only moves things. */
(() => {
"use strict";
const FW = window.FW;
if (!FW) return;
const { THREE, M, box, cyl, scene } = FW;
const X0 = 13, X1 = 22, Z0 = 0, Z1 = 10;

try { FW.room({ floorStyle: "carpet", x0: X0, x1: X1, z0: Z0, z1: Z1, skip: ["west"], floor: ["#b9ad94", "#a89b80"], wallColor: "#a3a184" }); }
catch (e) { console.error("[records] room failed", e); }

/* ======================= Materials ======================= */
const cabA = M("#7f8c78"), cabB = M("#8c8270"), cabC = M("#6f7f8c"), drawerDark = M("#5d6658");
const brass = M("#d1a53b"), cardboard = M("#c49a5c"), cardLid = M("#a97f45"), paperMat = M("#fffaf0");
const ink = M("#1a1210"), steel = M("#9aa0a6"), darkMetal = M("#3a3836"), red = M("#e0352b"), wood = M("#8a5a35");
const STRIP_MAT = new THREE.MeshBasicMaterial({ color: "#fffaf0", side: THREE.DoubleSide });
const UP = new THREE.Vector3(0, 1, 0);

const safe = (fn) => { try { return fn(); } catch (e) { console.error("[records]", e); } };
const near = (x, z, r) => { try { return FW.near({ x, z }, r); } catch (e) { return false; } };
const playerPos = () => FW.player && FW.player.g ? FW.player.g.position : { x: 0, z: 0 };

function plane(w, h, mat, x, y, z, ry = 0, parent = scene) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.y = ry; parent.add(m); return m;
}

/* ======================= Drawer labels (one shared atlas) ======================= */
const LABELS = ["A–C", "D–F", "G–I", "J–L", "M–O", "P–R", "S–U", "V–Z", "1987", "TAX '92", "MISC", "RECEIPTS",
  "DO NOT OPEN", "FORMS", "LOST", "BOB?", "EVIDENCE", "PENS", "SNACKS", "AUDITS", "1999", "W-2s", "MEMOS", "SECRET",
  "CLAIMS", "VENDORS", "PAID", "UNPAID", "OLD", "OLDER", "OLDEST", "???", "COUPONS", "KEYS", "INVOICES", "SHHH"];
const ATL_COLS = 6, ATL_ROWS = 6, CELL_W = 128, CELL_H = 48;
const labelTex = FW.canvasTex(ATL_COLS * CELL_W, ATL_ROWS * CELL_H, (g) => {
  LABELS.forEach((t, i) => {
    const cx = (i % ATL_COLS) * CELL_W, cy = Math.floor(i / ATL_COLS) * CELL_H;
    g.fillStyle = "#f6efd8"; g.fillRect(cx + 2, cy + 2, CELL_W - 4, CELL_H - 4);
    g.strokeStyle = "#2b1d14"; g.lineWidth = 3; g.strokeRect(cx + 3, cy + 3, CELL_W - 6, CELL_H - 6);
    g.fillStyle = t === "EVIDENCE" || t === "DO NOT OPEN" || t === "SECRET" ? "#c0281e" : "#2b1d14";
    g.font = `bold ${t.length > 8 ? 17 : 22}px 'Space Mono', monospace`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(t, cx + CELL_W / 2, cy + CELL_H / 2 + 1);
  });
});
const labelMat = new THREE.MeshBasicMaterial({ map: labelTex });
const labelGeos = LABELS.map((_, i) => {
  const geo = new THREE.PlaneGeometry(.26, .095), uv = geo.attributes.uv;
  const u0 = (i % ATL_COLS) / ATL_COLS, u1 = u0 + 1 / ATL_COLS;
  const v1 = 1 - Math.floor(i / ATL_COLS) / ATL_ROWS, v0 = v1 - 1 / ATL_ROWS;
  // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0)
  uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0); uv.needsUpdate = true;
  return geo;
});
let labelIdx = 0;

/* ======================= Furniture ======================= */
// filing cabinet with 4 labelled drawers; `face` = rotation.y so the drawers face +z when 0
const drawers = [];
function cabinet(x, z, face, mat) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = face; scene.add(g);
  box(.7, 1.45, .62, mat, 0, .725, 0, g);
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Group(); d.position.set(0, .22 + i * .34, .31); g.add(d);
    box(.62, .29, .05, drawerDark, 0, 0, 0, d);
    box(.2, .04, .05, brass, 0, -.07, .045, d);
    const lab = new THREE.Mesh(labelGeos[labelIdx++ % labelGeos.length], labelMat); lab.position.set(0, .06, .027); d.add(lab);
    drawers.push(d);
  }
  return g;
}
safe(() => {
  // north wall row
  const cols = [cabA, cabB, cabC];
  for (let i = 0; i < 9; i++) cabinet(14.6 + i * .72, .48, 0, cols[i % 3]);
  FW.collide((14.25 + 20.73) / 2, .48, 20.73 - 14.25, .7);
  // free-standing back-to-back row (the archive aisle is between it and the north row)
  for (let i = 0; i < 5; i++) {
    cabinet(16.15 + i * .72, 2.98, Math.PI, cols[(i + 1) % 3]);
    cabinet(16.15 + i * .72, 3.64, 0, cols[(i + 2) % 3]);
  }
  FW.collide((15.8 + 19.39) / 2, 3.31, 19.39 - 15.8, 1.36);
  // an open drawer, with a file sticking out (it's an archive, someone's always digging)
  if (drawers[22]) { drawers[22].position.z += .28; box(.5, .06, .4, paperMat, 0, .1, -.12, drawers[22]); }
  // a little ladder leaning on the row for "the top drawers"
  const lad = new THREE.Group(); lad.position.set(19.75, 0, 3.3); lad.rotation.z = .18; scene.add(lad);
  [-.22, .22].forEach(s => box(.06, 1.9, .06, wood, 0, .95, s, lad));
  for (let i = 0; i < 5; i++) box(.05, .05, .44, wood, 0, .3 + i * .35, 0, lad);
});

// archive boxes: one shared front label
const boxLabelMat = new THREE.MeshBasicMaterial({ map: FW.canvasTex(128, 64, (g, w, h) => {
  g.fillStyle = "#f6efd8"; g.fillRect(6, 8, w - 12, h - 16); g.strokeStyle = "#2b1d14"; g.lineWidth = 3; g.strokeRect(6, 8, w - 12, h - 16);
  g.fillStyle = "#2b1d14"; g.font = "bold 20px 'Space Mono', monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("ARCHIVE", w / 2, h / 2);
}) });
const boxLabelGeo = new THREE.PlaneGeometry(.26, .13);
function archiveBox(x, y, z, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
  box(.52, .3, .38, cardboard, 0, .15, 0, g);
  box(.55, .07, .41, cardLid, 0, .31, 0, g);
  const l = new THREE.Mesh(boxLabelGeo, boxLabelMat); l.position.set(0, .14, .195); g.add(l);
  return g;
}
safe(() => {
  // north-east corner: tall teetering stacks
  [[21.3, .65, 0], [21.3, 1.25, 0], [21.3, 1.85, .4]].forEach(([x, z, r], s) => {
    const n = 4 + s; for (let i = 0; i < n; i++) archiveBox(x + FW.rand(-.04, .04), i * .345, z + (s === 2 ? .2 : 0), r + FW.rand(-.12, .12) - Math.PI / 2);
  });
  FW.collide(21.3, 1.4, .8, 2.1);
  // by the shredder
  for (let i = 0; i < 3; i++) archiveBox(16.7, i * .345, 9.5, FW.rand(-.15, .15) + Math.PI);
  for (let i = 0; i < 2; i++) archiveBox(17.3, i * .345, 9.5, FW.rand(-.15, .15) + Math.PI);
  archiveBox(17.0, 0, 8.9, .5);
  FW.collide(17.0, 9.3, 1.3, 1.0);
});

// pigeonholes on the south wall
safe(() => {
  const g = new THREE.Group(); g.position.set(20.3, 0, 9.62); scene.add(g);
  box(2.3, 1.0, .45, wood, 0, .5, 0, g);
  const pm = M("#a8784a");
  box(2.3, 1.2, .05, pm, 0, 1.6, -.18, g);
  for (let r = 0; r <= 4; r++) box(2.3, .04, .42, pm, 0, 1.0 + r * .3, 0, g);
  for (let c = 0; c <= 6; c++) box(.04, 1.2, .42, pm, -1.15 + c * (2.3 / 6), 1.6, 0, g);
  const envCols = ["#fffaf0", "#f6e3a8", "#d9e8f6", "#f4c3b8"];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
    if (Math.random() < .35) continue;
    const e = box(.26, .03 + Math.random() * .05, .3, M(envCols[(r + c) % 4]), -1.15 + (c + .5) * (2.3 / 6) + FW.rand(-.03, .03), 1.04 + r * .3, -.05 + FW.rand(0, .12), g);
    e.rotation.y = FW.rand(-.2, .2);
  }
  const s = FW.signPlane("MAIL", "pigeonholes", .9, .3, "#1f8a8a"); s.position.set(0, 2.38, -.15); g.add(s);
  g.rotation.y = Math.PI; // face -z (into the room)
  FW.collide(20.3, 9.62, 2.4, .6);
});

// mail cart
safe(() => {
  const g = new THREE.Group(); g.position.set(18.5, 0, 7.3); g.rotation.y = .25; scene.add(g);
  const blue = M("#3a6fb0");
  box(1.1, .06, .6, blue, 0, .42, 0, g);
  box(1.1, .45, .05, blue, 0, .66, .3, g); box(1.1, .45, .05, blue, 0, .66, -.3, g);
  box(.05, .45, .6, blue, .55, .66, 0, g); box(.05, .45, .6, blue, -.55, .66, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(.04, .3, .04, darkMetal, sx * .5, .26, sz * .25, g);
    const w = cyl(.08, .08, .05, ink, sx * .5, .08, sz * .25, g); w.rotation.x = Math.PI / 2;
  }
  box(.05, .05, .6, darkMetal, -.75, 1.0, 0, g);
  [-.25, .25].forEach(s => { const b = box(.25, .05, .05, darkMetal, -.65, .95, s, g); b.rotation.z = -.4; });
  const envCols = ["#fffaf0", "#f6e3a8", "#d9e8f6"];
  for (let i = 0; i < 9; i++) {
    const e = box(.36, .03, .26, M(envCols[i % 3]), FW.rand(-.35, .35), .5 + i * .04, FW.rand(-.12, .12), g);
    e.rotation.set(FW.rand(-.3, .3), FW.rand(0, 3), FW.rand(-.3, .3));
  }
  // a parcel with a "FRAGILE" stripe
  box(.36, .3, .3, cardboard, .25, .78, .05, g); box(.37, .06, .31, red, .25, .78, .05, g);
  FW.collide(18.5, 7.3, 1.4, 1.0);
});

// signs
safe(() => {
  const q = FW.signPlane("QUIET PLEASE", "shhh… the archive is sleeping", 1.8, .55, "#2b1d14", "#ffd23f");
  q.position.set(X0 + .17, 2.3, 8.4); q.rotation.y = Math.PI / 2; scene.add(q);
  const r = FW.signPlane("RECORDS", "& MAIL ROOM", 1.4, .5, "#8c3b2a");
  r.position.set(X0 + .17, 2.3, 2.2); r.rotation.y = Math.PI / 2; scene.add(r);
  // cobwebs-ish dust bunnies on the floor
  const dust = M("#8e877a");
  [[15.2, 1.7], [19.9, 1.6], [14.4, 9.3], [21.4, 4.2], [20.0, 5.9]].forEach(([x, z]) => { const s = FW.sphere(.08, dust, x, .05, z, scene); s.scale.y = .5; });
});

/* ======================= Flickering lamp ======================= */
const lamp = { light: null, bulb: null, nextFlicker: 0, until: 0, onCol: new THREE.Color("#fff3c4"), offCol: new THREE.Color("#6b604a") };
safe(() => {
  const g = new THREE.Group(); g.position.set(17.6, 0, 5.6); scene.add(g);
  cyl(.015, .015, .5, ink, 0, 2.95, 0, g);
  const shadeMat = M("#2e5d4f");
  const shadeM = cyl(.12, .42, .26, shadeMat, 0, 2.6, 0, g);
  shadeM.material.side = THREE.DoubleSide;
  lamp.bulb = FW.sphere(.1, new THREE.MeshBasicMaterial({ color: "#fff3c4" }), 0, 2.46, 0, g);
  lamp.light = new THREE.PointLight("#ffdca0", .9, 10, 1.6); lamp.light.position.set(0, 2.35, 0); g.add(lamp.light);
});
function updateLamp(now) {
  if (!lamp.light) return;
  if (now > lamp.nextFlicker) { lamp.until = now + FW.rand(300, 900); lamp.nextFlicker = now + FW.rand(2500, 7000); }
  const on = now > lamp.until || Math.random() > .45;
  lamp.light.intensity = on ? .9 : .12;
  lamp.bulb.material.color.copy(on ? lamp.onCol : lamp.offCol);
}

/* ======================= Sounds (tiny synth, all optional) ======================= */
function synth(fn) {
  try {
    const a = FW.audio(); if (!a) return;
    if (a.state === "suspended") a.resume();
    fn(a, a.currentTime);
  } catch (e) { /* audio is optional */ }
}
function noiseBuf(a, d) {
  const b = a.createBuffer(1, Math.max(1, Math.floor(a.sampleRate * d)), a.sampleRate), ch = b.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  return b;
}
const SND = {
  whoosh: () => synth((a, t) => {
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf(a, 1.4); f.type = "bandpass"; f.Q.value = 2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3200, t + .5); f.frequency.exponentialRampToValueAtTime(500, t + 1.35);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.35, t + .25); g.gain.exponentialRampToValueAtTime(.0001, t + 1.4);
    s.connect(f).connect(g).connect(a.destination); s.start(t);
  }),
  thunk: () => synth((a, t) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + .2);
    g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.0001, t + .25);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + .3);
  }),
  jam: () => synth((a, t) => {
    // a sad "pfffbbbt" then a boing
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = noiseBuf(a, .7); f.type = "lowpass"; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(150, t + .6);
    g.gain.setValueAtTime(.3, t); g.gain.exponentialRampToValueAtTime(.0001, t + .7);
    s.connect(f).connect(g).connect(a.destination); s.start(t);
    const o = a.createOscillator(), og = a.createGain();
    o.type = "triangle"; o.frequency.setValueAtTime(220, t + .55); o.frequency.exponentialRampToValueAtTime(660, t + .75); o.frequency.exponentialRampToValueAtTime(180, t + 1.05);
    og.gain.setValueAtTime(.0001, t); og.gain.setValueAtTime(.12, t + .55); og.gain.exponentialRampToValueAtTime(.0001, t + 1.1);
    o.connect(og).connect(a.destination); o.start(t); o.stop(t + 1.15);
  }),
  shred: () => synth((a, t) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = "sawtooth"; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(95, t + 1.6);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.08, t + .1); g.gain.setValueAtTime(.08, t + 1.5); g.gain.exponentialRampToValueAtTime(.0001, t + 1.8);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + 1.85);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), ng = a.createGain();
    s.buffer = noiseBuf(a, 1.7); f.type = "highpass"; f.frequency.value = 1800;
    ng.gain.setValueAtTime(.0001, t); ng.gain.exponentialRampToValueAtTime(.18, t + .2); ng.gain.exponentialRampToValueAtTime(.0001, t + 1.7);
    s.connect(f).connect(ng).connect(a.destination); s.start(t + .15);
  }),
};

/* ======================= Pneumatic tube ======================= */
const STATION = { x: 21.6, z: 6.5 }, STATION_SPOT = { x: 20.9, z: 6.5 };
const TUBE_PTS = [[21.65, 1.25, 6.5], [21.65, 2.95, 6.5], [21.65, 2.95, .35], [X0 + .15, 2.95, .35]].map(p => new THREE.Vector3(p[0], p[1], p[2]));
const TUBE_LEN = [], TUBE_DIR = [];
let tubeTotal = 0;
for (let i = 0; i < TUBE_PTS.length - 1; i++) {
  const d = new THREE.Vector3().subVectors(TUBE_PTS[i + 1], TUBE_PTS[i]); const l = d.length();
  TUBE_LEN.push(l); TUBE_DIR.push(d.normalize()); tubeTotal += l;
}
const _tp = new THREE.Vector3();
function tubeAt(s, outPos) { // s in metres along the tube; returns segment index
  s = FW.clamp(s, 0, tubeTotal);
  for (let i = 0; i < TUBE_LEN.length; i++) {
    if (s <= TUBE_LEN[i] || i === TUBE_LEN.length - 1) { outPos.copy(TUBE_PTS[i]).addScaledVector(TUBE_DIR[i], Math.min(s, TUBE_LEN[i])); return i; }
    s -= TUBE_LEN[i];
  }
  return 0;
}

const tube = { state: "idle", t: 0, jams: 0, lastSec: -1, capsule: null, station: null, light: null, dropped: null, dropT: 0 };
safe(() => {
  // the glass tube with brass rings
  const glass = M("#bfe6ee", { transparent: true, opacity: .4 });
  for (let i = 0; i < TUBE_LEN.length; i++) {
    const a = TUBE_PTS[i], d = TUBE_DIR[i], l = TUBE_LEN[i];
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, l + .12, 14, 1, true), glass);
    seg.position.copy(a).addScaledVector(d, l / 2); seg.quaternion.setFromUnitVectors(UP, d); scene.add(seg);
    const rings = Math.max(1, Math.round(l / 1.4));
    for (let k = 0; k <= rings; k++) {
      const r = cyl(.135, .135, .07, brass, 0, 0, 0);
      r.position.copy(a).addScaledVector(d, l * k / rings); r.quaternion.setFromUnitVectors(UP, d);
    }
  }
  // wall clamps on the long runs
  // the station: a brass-and-green cabinet with a mouth
  const g = new THREE.Group(); g.position.set(STATION.x, 0, STATION.z); scene.add(g);
  box(.5, 1.25, .62, M("#2e5d4f"), 0, .625, 0, g);
  box(.56, .08, .68, brass, 0, 1.25, 0, g);
  const mouth = cyl(.17, .17, .22, brass, -.3, 1.0, 0, g); mouth.rotation.z = Math.PI / 2;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(.12, 16), new THREE.MeshBasicMaterial({ color: "#120c08" }));
  hole.position.set(-.415, 1.0, 0); hole.rotation.y = -Math.PI / 2; g.add(hole);
  box(.04, .35, .04, darkMetal, -.27, .62, .2, g); // lever
  const knob = FW.sphere(.06, red, -.27, .82, .2, g);
  tube.light = new THREE.Mesh(new THREE.SphereGeometry(.07, 12, 12), new THREE.MeshBasicMaterial({ color: "#4dff7a" }));
  tube.light.position.set(-.1, 1.38, .2); g.add(tube.light);
  tube.station = g; tube.knob = knob;
  const s = FW.signPlane("TUBE MAIL", "→ INSPECTOR · express*", 1.3, .45, "#2e5d4f", "#ffd23f");
  s.position.set(X1 - .17, 1.95, STATION.z + 1.0); s.rotation.y = -Math.PI / 2; scene.add(s);
  const fine = FW.signPlane("*usually", null, .5, .16, "#fffaf0", "#2b1d14");
  fine.position.set(X1 - .17, 1.62, STATION.z + 1.45); fine.rotation.y = -Math.PI / 2; scene.add(fine);
  FW.collide(STATION.x, STATION.z, .7, .8);

  // the capsule that flies through the tube
  const cap = new THREE.Group(); cap.visible = false; scene.add(cap);
  cyl(.075, .075, .26, M("#d8c27a"), 0, 0, 0, cap);
  cyl(.08, .08, .05, brass, 0, .14, 0, cap); cyl(.08, .08, .05, brass, 0, -.14, 0, cap);
  tube.capsule = cap;

  // the envelope the tube spits back out
  const env = box(.5, .03, .32, M("#f6e3a8"), 0, 0, 0); env.visible = false; tube.dropped = env;
});

const objectiveEl = () => document.getElementById("objective");
function setObjective(text) { const o = objectiveEl(); if (o) o.textContent = text; }

// world.js keeps the carried envelope private: find it on the player (box .5 x .03 x .32)
let carryEnvRef;
function carryEnv() {
  if (carryEnvRef !== undefined) return carryEnvRef;
  carryEnvRef = null;
  try {
    carryEnvRef = FW.player.g.children.find(c => c.isMesh && c.geometry && c.geometry.parameters &&
      Math.abs(c.geometry.parameters.width - .5) < 1e-3 && Math.abs(c.geometry.parameters.height - .03) < 1e-3) || null;
  } catch (e) {}
  return carryEnvRef;
}

const T_SUCK = 600, T_FLY = 2200, T_TOTAL = 6000, T_BACK = 1500;
function sendTube() {
  if (tube.state !== "idle" || !FW.P.carrying) return;
  FW.P.carrying = false;
  const ce = carryEnv(); if (ce) ce.visible = false;
  FW.setPhase("judging"); // no boss stop-and-search, no marker while it travels
  setObjective("Whoosh! Your order slip is in the tube…");
  Object.assign(tube, { state: "out", t: performance.now(), lastSec: -1 });
  SND.whoosh();
  FW.say(FW.player, pick(["Fly, little order slip. Fly.", "Express mail. Very express.", "Nobody saw that. Probably."]), 2200);
}
function pick(a) { return FW.pick ? FW.pick(a) : a[Math.floor(Math.random() * a.length)]; }

function arrive() {
  tube.state = "idle";
  SND.thunk();
  safe(() => { if (FW.P.seated) FW.stand(); });
  FW.wtoast("FWUMP! Your envelope shot out at the inspector's booth", "good");
  // deliver() hides the envelope, slides it into the scanner and starts the close-up
  safe(() => { FW.P.frozenUntil = 0; FW.deliver(); });
}
function jam(now) {
  tube.jams++;
  Object.assign(tube, { state: "back", t: now });
  SND.jam();
  FW.wtoast("TUBE JAMMED: it's coming back!", "bad");
}
function spitOut(now) {
  tube.state = "jammed"; tube.capsule.visible = false;
  const d = tube.dropped;
  if (d) { d.visible = true; d.position.set(STATION.x - .45, 1.0, STATION.z); tube.dropT = now; }
  FW.sfx("drop");
  FW.say(FW.player, pick([
    "<b>PFFFT!</b> The tube spat it back. Rude.",
    "Return to sender?! <b>I am</b> the sender!",
    "It's jammed. Of course it's jammed.",
    "The tube says no. The tube has <b>standards</b>.",
  ]), 3600);
  setObjective("The tube jammed! Grab your envelope by the tube.");
}
function regrab() {
  tube.state = "idle";
  if (tube.dropped) tube.dropped.visible = false;
  safe(() => FW.grab()); // sets carrying, shows the envelope in hand, phase "carrying"
}

function updateTube(now, dt) {
  const cap = tube.capsule; if (!cap) return;
  const e = now - tube.t;
  if (tube.light) {
    const busy = tube.state === "out" || tube.state === "back";
    tube.light.material.color.set(tube.state === "jammed" ? ((now / 200 | 0) % 2 ? "#e0352b" : "#401010") : busy ? ((now / 150 | 0) % 2 ? "#ffb02e" : "#4a3000") : "#4dff7a");
  }
  if (tube.station) {
    const shake = (tube.state === "out" && e < T_SUCK) || (tube.state === "back" && e > T_BACK - 300) ? .025 : 0;
    tube.station.position.x = STATION.x + (shake ? FW.rand(-shake, shake) : 0);
  }
  if (tube.state === "out") {
    if (e < T_SUCK) { cap.visible = false; }
    else if (e < T_SUCK + T_FLY) {
      const k = (e - T_SUCK) / T_FLY, s = tubeTotal * (k * k * (3 - 2 * k));
      const i = tubeAt(s, cap.position); cap.quaternion.setFromUnitVectors(UP, TUBE_DIR[i]); cap.visible = true;
    } else cap.visible = false;
    const left = Math.ceil((T_TOTAL - e) / 1000);
    if (left !== tube.lastSec && left >= 0) { tube.lastSec = left; setObjective(`Your order slip is in the tube… ${left}s`); }
    if (e >= T_TOTAL) {
      if (FW.CINE && FW.CINE.active) return; // wait for any close-up to finish
      if (Math.random() < .25) jam(now); else arrive();
    }
  } else if (tube.state === "back") {
    const k = Math.min(1, e / T_BACK), s = tubeTotal * (1 - k);
    const i = tubeAt(s, cap.position); cap.quaternion.setFromUnitVectors(UP, TUBE_DIR[i]); cap.visible = true;
    if (k >= 1) spitOut(now);
  } else if (tube.state === "jammed" && tube.dropped) {
    // envelope flops out of the mouth onto the floor
    const k = Math.min(1, (now - tube.dropT) / 700), d = tube.dropped;
    d.position.set(STATION.x - .45 - .55 * k, Math.max(.03, 1.0 + 1.2 * k - 2.4 * k * k), STATION.z + .1 * k);
    d.rotation.set(k < 1 ? k * 6 : 0, .4, 0);
  }
}

FW.addInteraction({
  label: () => "Send it by pneumatic tube (safe from the boss, ~6 s)",
  can: () => tube.state === "idle" && FW.P.carrying && FW.P.phase === "carrying" && near(STATION_SPOT.x, STATION_SPOT.z, 1.5),
  act: () => safe(sendTube),
});
FW.addInteraction({
  label: () => "Grab the envelope the tube spat out",
  can: () => tube.state === "jammed" && tube.dropped && near(tube.dropped.position.x, tube.dropped.position.z, 1.6),
  act: () => safe(regrab),
});
FW.addInteraction({
  label: () => "Peek into the tube",
  can: () => tube.state === "idle" && !FW.P.carrying && near(STATION_SPOT.x, STATION_SPOT.z, 1.3),
  act: () => FW.say(FW.player, pick(["It smells like old memos.", "Bring an envelope and I'll whoosh it.", "Someone sent a sandwich in 1994. It's still in there."]), 2600),
});

/* ======================= The archive: the inspector's catch log ======================= */
const TELLS = { ...((window.ForgedOrders && window.ForgedOrders.TELL_LABELS) || {}), new_card: "brand-new card", foreign_card: "foreign card",
  velocity: "too many orders too fast", email_risky: "anonymous email", ip_far: "IP far from home", proxy: "VPN spotted",
  emulator: "emulator", new_device: "new device", device_reuse: "device reused", far_ship: "shipped far away", gift_card: "big gift card",
  amount_jump: "card testing", night: "3 AM order", domain_mismatch: "odd sender domain", unknown_vendor: "unknown vendor", letterhead: "wrong logo", bank_changed: "bank account changed",
  amount_unusual: "amount way too big", total_mismatch: "totals don't add up", altered: "whiteout spotted", dup_number: "invoice # already paid",
  bad_po: "bad PO number", stamp_wrong: "wrong signature/stamp", copy_gen: "copy of a copy", low_legibility: "too smudged", heat: "you looked nervous" };
const tellText = t => TELLS[t] || String(t || "").replace(/_/g, " ");
let caseNo = 41;
const LOG = [
  { n: 38, scheme: "Card testing", vendor: "3 orders · sunnydiner.shop", caught: true, tells: ["amount_jump", "new_card"], old: true },
  { n: 39, scheme: "Gift card flip", vendor: "1 order · sunnydiner.shop", caught: true, tells: ["email_risky", "gift_card"], old: true },
  { n: 40, scheme: "Account takeover", vendor: "1 order · sunnydiner.shop", caught: false, tells: [], old: true },
];
const LOG_W = 640, LOG_H = 800;
const logTex = FW.canvasTex(LOG_W, LOG_H, drawLog);
function wrapCut(g, text, maxW) {
  text = String(text || ""); if (g.measureText(text).width <= maxW) return text;
  while (text.length > 1 && g.measureText(text + "…").width > maxW) text = text.slice(0, -1);
  return text + "…";
}
function drawLog(g, w, h) {
  // clipboard
  g.fillStyle = "#8a5a35"; g.beginPath(); g.moveTo(30, 0); g.arcTo(w, 0, w, h, 30); g.arcTo(w, h, 0, h, 30); g.arcTo(0, h, 0, 0, 30); g.arcTo(0, 0, w, 0, 30); g.fill();
  g.strokeStyle = "#2b1d14"; g.lineWidth = 8; g.stroke();
  g.fillStyle = "#fffaf0"; g.fillRect(34, 46, w - 68, h - 76); g.strokeStyle = "#2b1d14"; g.lineWidth = 3; g.strokeRect(34, 46, w - 68, h - 76);
  g.fillStyle = "#b8bcc2"; g.fillRect(w / 2 - 90, 14, 180, 54); g.strokeStyle = "#2b1d14"; g.lineWidth = 4; g.strokeRect(w / 2 - 90, 14, 180, 54);
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.fillStyle = "#c0281e"; g.font = "44px Bungee, Impact, sans-serif"; g.fillText("CATCH LOG", 56, 118);
  g.fillStyle = "#555"; g.font = "bold 16px 'Space Mono', monospace"; g.fillText("Property of the Inspector. DO NOT READ.", 58, 144);
  // entries, newest first
  const rows = LOG.slice(-5).reverse();
  rows.forEach((r, i) => {
    const y = 168 + i * 104;
    g.strokeStyle = "#d8cfb8"; g.lineWidth = 2; g.beginPath(); g.moveTo(50, y + 100); g.lineTo(w - 50, y + 100); g.stroke();
    // stamp
    const col = r.caught ? "#e0352b" : "#1d9a4b";
    g.save(); g.translate(118, y + 42); g.rotate(-.12);
    g.strokeStyle = col; g.lineWidth = 5; g.strokeRect(-62, -20, 124, 40);
    g.fillStyle = col; g.font = "22px Bungee, Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(r.caught ? "CAUGHT" : "APPROVED", 0, 2);
    g.restore(); g.textAlign = "left"; g.textBaseline = "alphabetic";
    g.fillStyle = "#888"; g.font = "bold 14px 'Space Mono', monospace"; g.fillText(`#${String(r.n).padStart(3, "0")}${r.old ? " · old file" : ""}`, 64, y + 88);
    g.fillStyle = "#2b1d14"; g.font = "bold 21px 'Space Mono', monospace"; g.fillText(wrapCut(g, r.scheme || "Unknown scheme", w - 260), 196, y + 26);
    g.fillStyle = "#555"; g.font = "17px 'Space Mono', monospace"; g.fillText(wrapCut(g, r.vendor || "(no vendor)", w - 260), 196, y + 52);
    g.font = "bold 16px 'Space Mono', monospace";
    if (r.caught) { g.fillStyle = "#c0281e"; g.fillText(wrapCut(g, "Caught: " + ((r.tells || []).map(tellText).join(", ") || "gut feeling"), w - 260), 196, y + 80); }
    else { g.fillStyle = "#1d9a4b"; g.fillText("Slipped right past him.", 196, y + 80); }
    if (r.shredded) {
      g.save(); g.globalAlpha = .85; g.fillStyle = "#3a3836"; g.fillRect(50, y + 4, w - 100, 92);
      g.fillStyle = "#fffaf0"; g.font = "30px Bungee, Impact, sans-serif"; g.textAlign = "center"; g.fillText("SHREDDED", w / 2, y + 62); g.restore();
    }
  });
  // intel: what he keeps catching, what got through
  const counts = {};
  LOG.forEach(r => { if (r.caught && !r.shredded) (r.tells || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }); });
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const lastPaid = LOG.slice().reverse().find(r => !r.caught);
  g.fillStyle = "#fff3b0"; g.fillRect(46, 694, w - 92, 84); g.strokeStyle = "#2b1d14"; g.lineWidth = 3; g.strokeRect(46, 694, w - 92, 84);
  g.fillStyle = "#2b1d14"; g.font = "bold 18px 'Space Mono', monospace";
  g.fillText(wrapCut(g, top ? `INTEL: he's hot on "${tellText(top)}" (${counts[top]}x)` : "INTEL: he hasn't caught a thing. Yet.", w - 120), 60, 726);
  g.fillText(wrapCut(g, lastPaid ? `Got through: ${lastPaid.scheme}` : "Nothing has got through. Gulp.", w - 120), 60, 760);
}

// the board on the north wall, above the cabinets
safe(() => {
  const m = plane(1.0, 1.25, new THREE.MeshBasicMaterial({ map: logTex }), 17.5, 2.15, .17);
  const s = FW.signPlane("ARCHIVE", "dig here", .9, .3, "#8c3b2a"); s.position.set(16.3, 2.0, .17); scene.add(s);
  return m;
});

// the pop-up clipboard: drawn in front of the camera, on top of everything
const clip = { open: false, t: 0, mesh: null, until: 0 };
safe(() => {
  const mat = new THREE.MeshBasicMaterial({ map: logTex, transparent: true, depthTest: false, depthWrite: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(.8, 1.0), mat);
  m.renderOrder = 999; m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false; scene.add(m);
  const off = new THREE.Matrix4(), sc = new THREE.Matrix4(), rot = new THREE.Matrix4();
  m.onBeforeRender = (r, s, cam) => {
    try {
      const k = Math.min(1, (performance.now() - clip.t) / 220), ease = 1 - Math.pow(1 - k, 3);
      const fov = (cam.fov || 55) * Math.PI / 180, dist = 1.0 / (.82 * 2 * Math.tan(fov / 2));
      off.makeTranslation(.0, -.04 - (1 - ease) * .6, -dist); rot.makeRotationZ((1 - ease) * .3 - .03); sc.makeScale(1, 1, 1);
      m.matrixWorld.copy(cam.matrixWorld).multiply(off).multiply(rot).multiply(sc);
    } catch (e) {}
  };
  clip.mesh = m;
});
const ARCHIVE_SPOT = { x: 17.5, z: 1.7 };
function openClip() {
  if (!clip.mesh) return;
  FW.redraw(logTex);
  clip.open = true; clip.t = performance.now(); clip.until = clip.t + 15000; clip.mesh.visible = true;
  FW.sfx("pickup");
  FW.say(FW.player, pick(["Ooh, his little diary…", "Know thy inspector.", "Dusty. Juicy."]), 2000);
}
function closeClip() { clip.open = false; if (clip.mesh) clip.mesh.visible = false; }
function updateClip(now) {
  if (!clip.open) return;
  const p = playerPos();
  if (now > clip.until || Math.hypot(p.x - ARCHIVE_SPOT.x, p.z - ARCHIVE_SPOT.z) > 2.4 || FW.P.seated || (FW.CINE && FW.CINE.active)) closeClip();
}
FW.addInteraction({
  label: () => clip.open ? "Put the file back" : "Dig through the archive (inspector's catch log)",
  can: () => near(ARCHIVE_SPOT.x, ARCHIVE_SPOT.z, 1.7),
  act: () => safe(() => clip.open ? closeClip() : openClip()),
});

/* ======================= The shredder ======================= */
const SHRED = { x: 15.2, z: 9.35 }, SHRED_SPOT = { x: 15.2, z: 8.5 };
const shred = { pending: null, busy: false, t: 0, g: null, sheet: null, strips: [] };
safe(() => {
  const g = new THREE.Group(); g.position.set(SHRED.x, 0, SHRED.z); scene.add(g);
  box(.95, .85, .62, M("#5b6770"), 0, .425, 0, g);           // bin
  box(.7, .45, .03, M("#2b2b2b", { transparent: true, opacity: .55 }), 0, .45, -.31, g); // see-through window
  box(1.0, .24, .68, darkMetal, 0, .97, 0, g);                // head
  box(.66, .03, .09, ink, 0, 1.095, 0, g);                    // slot
  box(.14, .06, .1, red, .36, 1.11, .2, g);                   // big red button
  box(.14, .06, .1, M("#1d9a4b"), .36, 1.11, .05, g);
  const s = FW.signPlane("SHRED-O-MATIC", "3000 · feeds on evidence", .82, .28, "#e0352b");
  s.position.set(0, .7, -.32); s.rotation.y = Math.PI; g.add(s);
  // a pile of old strips inside the window
  for (let i = 0; i < 10; i++) { const st = box(.02, .02, .3, paperMat, FW.rand(-.3, .3), .2 + FW.rand(0, .2), FW.rand(-.2, .2), g); st.rotation.y = FW.rand(0, 3); }
  shred.g = g;
  // the sheet that gets fed in, with a CAUGHT stamp
  const sheetTex = FW.canvasTex(128, 160, (c, w, h) => {
    c.fillStyle = "#fffaf0"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#2b1d14"; for (let i = 0; i < 7; i++) c.fillRect(14, 18 + i * 18, 60 + (i * 23) % 40, 5);
    c.save(); c.translate(w / 2, h * .7); c.rotate(-.25); c.strokeStyle = "#e0352b"; c.lineWidth = 5; c.strokeRect(-52, -16, 104, 32);
    c.fillStyle = "#e0352b"; c.font = "bold 20px Impact, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("CAUGHT", 0, 1); c.restore();
  });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(.42, .52), new THREE.MeshBasicMaterial({ map: sheetTex, side: THREE.DoubleSide }));
  sheet.visible = false; sheet.rotation.y = Math.PI; scene.add(sheet); shred.sheet = sheet;
  // strips flying out
  const geo = new THREE.PlaneGeometry(.025, .26);
  for (let i = 0; i < 28; i++) {
    const m = new THREE.Mesh(geo, STRIP_MAT); m.visible = false; scene.add(m);
    shred.strips.push({ m, v: new THREE.Vector3(), r: new THREE.Vector3(), delay: 0, live: false });
  }
  FW.collide(SHRED.x, SHRED.z, 1.1, .8);
});

function doShred() {
  const p = shred.pending; if (!p || shred.busy) return;
  shred.busy = true; shred.t = performance.now(); shred.pending = null;
  p.shredded = true; FW.redraw(logTex);
  safe(() => FW.toOS("shred", { scheme: p.scheme || "", vendor: p.vendor || "" }));
  SND.shred();
  if (shred.sheet) { shred.sheet.visible = true; shred.sheet.position.set(SHRED.x, 1.4, SHRED.z); }
  shred.strips.forEach((s, i) => {
    s.live = true; s.delay = 250 + i * 45; s.m.visible = false;
    s.m.position.set(SHRED.x + FW.rand(-.25, .25), 1.12, SHRED.z + FW.rand(-.05, .05));
    s.v.set(FW.rand(-1.4, 1.4), FW.rand(2.2, 4), FW.rand(-2.6, -.6));
    s.r.set(FW.rand(-12, 12), FW.rand(-12, 12), FW.rand(-12, 12));
  });
  FW.say(FW.player, pick([
    "What order? I see no order.",
    "Evidence? I barely know her.",
    "Shred it like it's 1999.",
    "And <i>that</i> never happened.",
  ]), 3000);
  FW.wtoast("Evidence shredded. The inspector may forget this one…", "good");
}
function updateShred(now, dt) {
  if (!shred.busy) return;
  const e = now - shred.t;
  if (shred.g) { shred.g.position.x = SHRED.x + (e < 1800 ? FW.rand(-.02, .02) : 0); shred.g.position.z = SHRED.z + (e < 1800 ? FW.rand(-.015, .015) : 0); }
  if (shred.sheet) {
    const k = Math.min(1, e / 1500);
    shred.sheet.scale.y = Math.max(.01, 1 - k);
    shred.sheet.position.y = 1.12 + .26 * shred.sheet.scale.y;
    if (k >= 1) shred.sheet.visible = false;
  }
  let alive = false;
  for (const s of shred.strips) {
    if (!s.live) continue;
    alive = true;
    if (e < s.delay) continue;
    s.m.visible = e < s.delay + 4200;
    if (!s.m.visible) { s.live = false; continue; }
    if (s.m.position.y > .02) {
      s.v.y -= 9 * dt; s.v.multiplyScalar(1 - dt * 1.5);
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.r.x * dt; s.m.rotation.y += s.r.y * dt; s.m.rotation.z += s.r.z * dt;
      if (s.m.position.y <= .02) { s.m.position.y = .02; s.m.rotation.set(-Math.PI / 2, 0, FW.rand(0, 3)); }
    }
  }
  if (!alive && e > 2000) { shred.busy = false; if (shred.g) shred.g.position.set(SHRED.x, 0, SHRED.z); }
}
FW.addInteraction({
  label: () => "Shred the evidence (last CAUGHT file)",
  can: () => !!shred.pending && !shred.busy && !FW.P.carrying && FW.P.phase !== "judging" && near(SHRED_SPOT.x, SHRED_SPOT.z, 1.5),
  act: () => safe(doShred),
});
FW.addInteraction({
  label: () => "Feed the shredder",
  can: () => !shred.pending && !shred.busy && !FW.P.carrying && near(SHRED_SPOT.x, SHRED_SPOT.z, 1.3),
  act: () => FW.say(FW.player, pick(["Nothing incriminating to feed it. Yet.", "It looks hungry.", "Come back after a CAUGHT one."]), 2400),
});

/* ======================= Verdicts from the computer ======================= */
FW.onMessage(m => {
  if (!m || m.type !== "verdict") return;
  const entry = { n: caseNo++, scheme: m.scheme || "Mystery scheme", vendor: m.vendor || "", caught: !!m.caught, tells: Array.isArray(m.tells) ? m.tells.slice(0, 3) : [] };
  LOG.push(entry); while (LOG.length > 5) LOG.shift();
  shred.pending = entry.caught ? entry : null;
  FW.redraw(logTex);
});

if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => safe(() => { FW.redraw(logTex); FW.redraw(labelTex); }));

/* ======================= Per-frame ======================= */
FW.onUpdate((dt, now) => {
  updateLamp(now);
  updateTube(now, dt);
  updateClip(now);
  updateShred(now, dt);
});

window.forgedRecords = { tube, LOG, shred, sendTube }; // devtools poking
})();
