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
const swatches = (key, label, colors, allowNone) => `<div class="cz-row"><span class="cz-label">${label}</span><div class="cz-sw">
  ${allowNone ? `<button class="cz-none ${!look[key] ? "on" : ""}" data-col="${key}" data-v="" title="None">✕</button>` : ""}
  ${colors.map(c => `<button class="${look[key] === c ? "on" : ""}" style="background:${c}" data-col="${key}" data-v="${c}" title="${c}"></button>`).join("")}</div></div>`;
const toggle = (key, label) => `<label class="cz-tog"><input type="checkbox" data-tog="${key}" ${look[key] ? "checked" : ""}> ${label}</label>`;

function renderOpts() {
  $("#cz-opts").innerHTML = `
    <div class="cz-group"><div class="cz-sub">Hair</div>${stepper("hair", "Style")}${swatches("hairColor", "Colour", HAIR_COLORS)}</div>
    <div class="cz-group"><div class="cz-sub">Face</div>${swatches("skin", "Skin", SKINS)}${stepper("brows", "Eyebrows")}${stepper("mouth", "Mouth")}${stepper("nose", "Nose")}</div>
    <div class="cz-group"><div class="cz-sub">Clothes</div>${swatches("shirt", "Shirt", SHIRTS)}${swatches("pants", "Trousers", PANTS)}${swatches("tie", "Tie", TIES, true)}</div>
    <div class="cz-group"><div class="cz-sub">Accessories</div><div class="cz-togs">${toggle("glasses", "Glasses")}${toggle("earrings", "Earrings")}${toggle("mustache", "Mustache")}</div></div>`;
}
function apply() { FW.restyleChar(preview, look); renderOpts(); }

root.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.step) {
    const opts = CHOICES[b.dataset.step], i = Math.max(0, opts.findIndex(o => o[0] === look[b.dataset.step]));
    look[b.dataset.step] = opts[(i + +b.dataset.dir + opts.length) % opts.length][0]; apply();
  } else if (b.dataset.col) { look[b.dataset.col] = b.dataset.v || null; apply(); }
  else if (b.dataset.cz === "random") {
    look = { ...look, skin: pick(SKINS), hairColor: pick(HAIR_COLORS), shirt: pick(SHIRTS), pants: pick(PANTS), tie: Math.random() < .35 ? pick(TIES) : null,
      hair: pick(CHOICES.hair)[0], brows: pick(CHOICES.brows)[0], mouth: pick(CHOICES.mouth)[0], nose: pick(CHOICES.nose)[0],
      glasses: Math.random() < .3, earrings: Math.random() < .25, mustache: Math.random() < .2 };
    apply();
  } else if (b.dataset.cz === "reset") { look = { ...FW.DEFAULT_LOOK }; apply(); }
  else if (b.dataset.cz === "cancel") close(false);
  else if (b.dataset.cz === "done") close(true);
});
root.addEventListener("change", e => { const t = e.target.closest("[data-tog]"); if (t) { look[t.dataset.tog] = t.checked; apply(); } });

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
canvas.addEventListener("pointerdown", e => { drag = e.clientX; vel = 0; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", e => { if (drag == null) return; const d = (e.clientX - drag) * .012; spin += d; vel = d; drag = e.clientX; });
canvas.addEventListener("pointerup", () => { drag = null; });
function frame(now) {
  const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
  if (drag == null) { vel *= .92; spin += vel + dt * .45; }
  turntable.rotation.y = spin;
  preview.head.position.y = 2.02 + Math.sin(now / 600) * .015;
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
  FW.restyleChar(preview, look); renderOpts();
  root.classList.add("show");
  if (document.pointerLockElement) document.exitPointerLock();
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
