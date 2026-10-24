/* Forged — character customization.
 * Opens from the Clock in screen ("Customize") and from Esc → Options → Customize character.
 * Left: your character turning on a little stage (drag to spin). Right: curated options.
 * The look is applied to the player with FW.setLook (world.js), which also saves it.
 */
(() => {
"use strict";
const FW = window.FW;
if (!FW) return;
const { THREE } = FW;
const $ = (s, el = document) => el.querySelector(s);

/* ---------------- options (curated so every combination looks good) ---------------- */
const SKINS = ["#ffe0bd", "#f1c27d", "#e0ac69", "#c68642", "#a8714a", "#8d5524", "#6b3e1f", "#4a2a14"];
const HAIR_COLORS = ["#1a1210", "#2b1d14", "#5a3a22", "#8a5a35", "#c98a3a", "#e3c16f", "#b8342a", "#8d8d8d", "#e8e4dc", "#5b7bd6"];
const SHIRTS = ["#e0352b", "#f4a63a", "#ffd23f", "#3fae6a", "#1f8a8a", "#2f6fd6", "#7a5cff", "#e75aa3", "#f4f4f4", "#3a3a40"];
const PANTS = ["#2b2b44", "#1b1b1b", "#5a5f69", "#3d5a80", "#6b4a33", "#c7b08a", "#2f4f3a"];
const TIES = ["#1f8a8a", "#e0352b", "#2f6fd6", "#ffd23f", "#7a5cff", "#1b1b1b"];
const CHOICES = {
  hair: [["spiky", "Spiky"], ["bowl", "Bowl"], ["bun", "Bun"], ["neat", "Neat"], ["curly", "Curly"], ["messy", "Messy"], ["combover", "Comb-over"]],
  brows: [["flat", "Flat"], ["raised", "Raised"], ["angry", "Angry"], ["worried", "Worried"]],
  mouth: [["smirk", "Smirk"], ["grin", "Grin"], ["flat", "Flat"], ["frown", "Frown"], ["o", "Surprised"]],
  nose: [["round", "Round"], ["big", "Big"]],
};
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// in a LAN or online room (lan.js) everyone wears their own shirt colour: { mine, taken: { colour: name } } or null
const room = () => (window.forgedLan && forgedLan.shirts && forgedLan.shirts()) || null;
const freeShirts = () => { const r = room(); return r ? SHIRTS.filter(c => !r.taken[c]) : SHIRTS; };

let look = FW.getLook(), saved = null, onDone = null;

/* ---------------- UI ---------------- */
const root = document.createElement("div");
root.id = "cz";
root.innerHTML = `
  <div class="cz-card">
    <div class="cz-head"><h2>Customize</h2><div class="cz-head-btns"><button class="cz-btn" data-cz="random">🎲 Randomize</button><button class="cz-btn" data-cz="reset">Reset</button></div></div>
    <div class="cz-body">
      <div class="cz-stage"><canvas id="cz-canvas"></canvas><div class="cz-hint">Drag to spin</div></div>
      <div class="cz-opts" id="cz-opts"></div>
    </div>
    <div class="cz-foot"><button class="cz-btn" data-cz="cancel">Cancel</button><button class="cz-btn primary" data-cz="done">Done</button></div>
  </div>`;
document.body.appendChild(root);

const stepper = (key, label) => {
  const opts = CHOICES[key], cur = opts.find(o => o[0] === look[key]) || opts[0];
  return `<div class="cz-row"><span class="cz-label">${label}</span>
    <div class="cz-step"><button data-step="${key}" data-dir="-1" aria-label="Previous ${label}">◀</button><span>${cur[1]}</span><button data-step="${key}" data-dir="1" aria-label="Next ${label}">▶</button></div></div>`;
};
const swatches = (key, label, colors, allowNone) => {
  const taken = key === "shirt" && room() ? room().taken : {}; // another player's shirt colour can't be picked
  return `<div class="cz-row"><span class="cz-label">${label}</span><div class="cz-sw">
  ${allowNone ? `<button class="cz-none ${!look[key] ? "on" : ""}" data-col="${key}" data-v="" title="None">✕</button>` : ""}
  ${colors.map(c => taken[c] ? `<button class="taken" style="background:${c}" disabled title="${esc(taken[c])} wears this"></button>`
    : `<button class="${look[key] === c ? "on" : ""}" style="background:${c}" data-col="${key}" data-v="${c}" title="${c}"></button>`).join("")}</div></div>`;
};
const toggle = (key, label) => `<label class="cz-tog"><input type="checkbox" data-tog="${key}" ${look[key] ? "checked" : ""}> ${label}</label>`;

function renderOpts() {
  $("#cz-opts").innerHTML = `
    <div class="cz-group"><div class="cz-sub">Hair</div>${stepper("hair", "Style")}${swatches("hairColor", "Colour", HAIR_COLORS)}</div>
    <div class="cz-group"><div class="cz-sub">Face</div>${swatches("skin", "Skin", SKINS)}${stepper("brows", "Eyebrows")}${stepper("mouth", "Mouth")}${stepper("nose", "Nose")}</div>
    <div class="cz-group"><div class="cz-sub">Clothes</div>${swatches("shirt", "Shirt", SHIRTS)}${room() ? `<p class="cz-note">Everyone here wears their own shirt colour: faded ones are taken.</p>` : ""}${swatches("pants", "Trousers", PANTS)}${swatches("tie", "Tie", TIES, true)}</div>
    <div class="cz-group"><div class="cz-sub">Accessories</div><div class="cz-togs">${toggle("glasses", "Glasses")}${toggle("earrings", "Earrings")}${toggle("mustache", "Mustache")}</div></div>`;
}
function apply() { FW.restyleChar(preview, look); renderOpts(); }

// detect which group a click lands in → switch camera mode
const FACE_KEYS = new Set(["hair", "hairColor", "skin", "brows", "mouth", "nose"]);
const FACE_TOGS = new Set(["glasses", "earrings", "mustache"]);
const BODY_KEYS = new Set(["shirt", "pants", "tie"]);

root.addEventListener("click", e => {
  lastInteraction = performance.now();
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.step) {
    const opts = CHOICES[b.dataset.step], i = Math.max(0, opts.findIndex(o => o[0] === look[b.dataset.step]));
    look[b.dataset.step] = opts[(i + +b.dataset.dir + opts.length) % opts.length][0]; apply();
    if (FACE_KEYS.has(b.dataset.step)) setCamMode("face");
  } else if (b.dataset.col) {
    look[b.dataset.col] = b.dataset.v || null; apply();
    if (FACE_KEYS.has(b.dataset.col)) setCamMode("face");
    else if (BODY_KEYS.has(b.dataset.col)) setCamMode("body");
  }
  else if (b.dataset.cz === "random") {
    look = { ...look, skin: pick(SKINS), hairColor: pick(HAIR_COLORS), shirt: pick(freeShirts()), pants: pick(PANTS), tie: Math.random() < .35 ? pick(TIES) : null,
      hair: pick(CHOICES.hair)[0], brows: pick(CHOICES.brows)[0], mouth: pick(CHOICES.mouth)[0], nose: pick(CHOICES.nose)[0],
      glasses: Math.random() < .3, earrings: Math.random() < .25, mustache: Math.random() < .2 };
    apply(); setCamMode("body");
  } else if (b.dataset.cz === "reset") { look = { ...FW.DEFAULT_LOOK, ...(room() ? { shirt: room().mine } : {}) }; apply(); setCamMode("body"); }
  else if (b.dataset.cz === "cancel") close(false);
  else if (b.dataset.cz === "done") close(true);
});
root.addEventListener("change", e => {
  lastInteraction = performance.now();
  const t = e.target.closest("[data-tog]"); if (t) { look[t.dataset.tog] = t.checked; apply(); if (FACE_TOGS.has(t.dataset.tog)) setCamMode("face"); }
});

/* ---------------- the turning preview ---------------- */
const canvas = $("#cz-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight("#fff4dc", "#7c86a3", .7));
const key = new THREE.DirectionalLight("#ffecd0", .75); key.position.set(2, 4, 3); scene.add(key);
const camera = new THREE.PerspectiveCamera(32, 1, .1, 50);
camera.position.set(0, 1.55, 5.4); camera.lookAt(0, 1.2, 0);
const turntable = new THREE.Group(); scene.add(turntable);
const disc = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .08, 40), FW.M("#f4a63a")); disc.position.y = -.04; turntable.add(disc);
const preview = FW.makeChar({ shirt: look.shirt, pants: look.pants, skin: look.skin, tie: look.tie, name: "", tagColor: "#000", parent: turntable, track: false });
preview.tag.visible = false;
FW.restyleChar(preview, look);

let spin = .5, vel = 0, drag = null, raf = 0, last = 0;

/* --- camera mode: "body" (default full-body spin) or "face" (zoomed head, no auto-spin) --- */
const CAM_BODY = { px: 0, py: 1.55, pz: 5.4, tx: 0, ty: 1.2, tz: 0 };
const CAM_FACE = { px: 0, py: 2.05, pz: 3.2, tx: 0, ty: 2.0, tz: 0 };
let camMode = "body", lastInteraction = 0, spinTarget = null;
const _camPos = new THREE.Vector3(), _camTgt = new THREE.Vector3();
const PI2 = Math.PI * 2;

function setCamMode(mode) {
  if (mode === camMode) return;
  camMode = mode; lastInteraction = performance.now();
  if (mode === "face") {
    // snap rotation toward the nearest forward-facing angle (character faces camera at multiples of 2π)
    spinTarget = Math.round(spin / PI2) * PI2;
    vel = 0;
  } else {
    spinTarget = null;
  }
}

canvas.addEventListener("pointerdown", e => { drag = e.clientX; vel = 0; canvas.setPointerCapture(e.pointerId); lastInteraction = performance.now(); setCamMode("body"); });
canvas.addEventListener("pointermove", e => { if (drag == null) return; const d = (e.clientX - drag) * .012; spin += d; vel = d; drag = e.clientX; lastInteraction = performance.now(); });
canvas.addEventListener("pointerup", () => { drag = null; });

function frame(now) {
  const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
  const idle = now - lastInteraction;
  if (drag == null) {
    vel *= .92;
    if (camMode === "face" && spinTarget != null) {
      // lerp toward the forward-facing angle
      spin += (spinTarget - spin) * Math.min(1, dt * 5);
    } else if (camMode === "body" && idle > 5000) {
      // resume gentle auto-rotation only after 5 s idle
      spin += vel + dt * .45;
    } else {
      // just coast on residual velocity (after drag or recent interaction)
      spin += vel;
    }
  }
  turntable.rotation.y = spin;
  preview.head.position.y = 2.02 + Math.sin(now / 600) * .015;
  // camera lerp toward current mode target
  const lf = 1 - Math.pow(.04, dt); // exponential ease (~92% per second)
  const m = camMode === "face" ? CAM_FACE : CAM_BODY;
  camera.position.lerp(_camPos.set(m.px, m.py, m.pz), lf);
  camera.lookAt(_camTgt.set(m.tx, m.ty, m.tz));
  // idle timer: revert face → body after 15 s
  if (camMode === "face" && idle > 15000) setCamMode("body");
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);
}

/* ---------------- open / close ---------------- */
function open(done) {
  saved = FW.getLook(); look = { ...saved }; onDone = done || null;
  const r = room(); if (r) look.shirt = r.mine; // in a room, start from the shirt you're actually wearing there
  FW.restyleChar(preview, look); renderOpts();
  root.classList.add("show");
  if (document.pointerLockElement) document.exitPointerLock();
  camMode = "body"; camera.position.set(CAM_BODY.px, CAM_BODY.py, CAM_BODY.pz); lastInteraction = performance.now();
  last = 0; cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
}
function close(keep) {
  root.classList.remove("show"); cancelAnimationFrame(raf);
  if (keep) FW.setLook(look);
  const f = onDone; onDone = null; if (f) f(keep);
}
const isOpen = () => root.classList.contains("show");
addEventListener("keydown", e => {
  if (!isOpen()) return;
  e.stopImmediatePropagation();
  if (e.code === "Escape") { e.preventDefault(); close(false); }
  if (e.code === "Enter") { e.preventDefault(); close(true); }
}, true);

window.ForgedCustomizer = { open, close, isOpen };

// the Customize button on the Clock in card
const startBtn = document.getElementById("btn-start");
if (startBtn) {
  const b = document.createElement("button");
  b.id = "btn-customize"; b.type = "button"; b.textContent = "🎨 Customize";
  startBtn.insertAdjacentElement("afterend", b);
  b.addEventListener("click", e => { e.stopPropagation(); open(); });
}
})();
