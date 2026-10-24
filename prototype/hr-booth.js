/* Forged — HR badge-photo booth: Hilda from HR, in the main office's south-west corner
 * (a few steps west of where you start). She greets new hires once, then waits; press E
 * by her or the camera to open the character editor (customize.js). Saving = camera flash.
 * Kept clear of the boss's west lane (x −10.4) and the drill routes along z 7.8.
 */
(() => {
"use strict";
const FW = window.FW;
if (!FW || !FW.makeChar) return;
const { THREE, M, box, cyl, collide, say, wtoast, sfx, near, P, player } = FW;

const SPOT = { x: -12.05, z: 6.4 };      // where you stand for the photo
const CAM = { x: -11.15, z: 6.4 };       // tripod, pointing west at the backdrop
const HILDA_AT = { x: -11.45, z: 5.05 };  // beside the camera, facing the room
const GREET_KEY = "forged-hilda-greeted";

/* --- backdrop on the west wall: blue cloth with a FORGED logo, on a stand --- */
const backdropTex = FW.canvasTex(512, 640, (g, w, h) => {
  const grad = g.createRadialGradient(w / 2, h * .45, 30, w / 2, h * .45, h * .7);
  grad.addColorStop(0, "#6fa0e8"); grad.addColorStop(1, "#2f5bb0");
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.globalAlpha = .12; g.fillStyle = "#fff";
  for (let i = 0; i < 40; i++) g.fillRect(0, i * 16, w, 2); // cloth folds
  g.globalAlpha = 1;
  g.fillStyle = "#ffd23f"; g.font = "64px Bungee, Impact"; g.textAlign = "center"; g.fillText("FORGED", w / 2, 92);
  g.fillStyle = "#fff"; g.font = "bold 26px 'Space Mono', monospace"; g.fillText("EMPLOYEE  ID  PHOTOS", w / 2, 132);
});
const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.6), new THREE.MeshStandardMaterial({ map: backdropTex, roughness: 1 }));
backdrop.position.set(-12.72, 1.45, SPOT.z); backdrop.rotation.y = Math.PI / 2; FW.scene.add(backdrop);
const metal = M("#2e2a28"), chrome = M("#c9ced3");
cyl(.025, .025, 2.9, metal, -12.7, 1.45, SPOT.z - 1.15); cyl(.025, .025, 2.9, metal, -12.7, 1.45, SPOT.z + 1.15);
box(.05, .05, 2.4, metal, -12.7, 2.88, SPOT.z);
// an "X" taped on the floor: stand here
const tape = M("#ffd23f");
[.6, -.6].forEach(r => { const t = box(.6, .01, .08, tape, SPOT.x, .012, SPOT.z); t.rotation.y = r; t.castShadow = false; });

/* --- camera on a tripod, a softbox light, a small sign --- */
const camG = new THREE.Group(); camG.position.set(CAM.x, 0, CAM.z); camG.rotation.y = -Math.PI / 2; FW.scene.add(camG);
[0, 2.1, 4.2].forEach(a => { const leg = cyl(.02, .02, 1.35, metal, Math.sin(a) * .22, .62, Math.cos(a) * .22, camG); leg.rotation.set(Math.cos(a) * .18, 0, -Math.sin(a) * .18); });
box(.32, .22, .2, metal, 0, 1.38, 0, camG);
const lens = cyl(.08, .09, .18, M("#1b1b1b"), 0, 1.38, .17, camG); lens.rotation.x = Math.PI / 2;
const glass = new THREE.Mesh(new THREE.CircleGeometry(.065, 16), new THREE.MeshBasicMaterial({ color: "#7cc6ff" })); glass.position.set(0, 1.38, .265); camG.add(glass);
const flashBulb = new THREE.Mesh(new THREE.BoxGeometry(.1, .06, .05), new THREE.MeshBasicMaterial({ color: "#fff8d0" })); flashBulb.position.set(.1, 1.56, 0); camG.add(flashBulb);
const flashLight = new THREE.PointLight("#ffffff", 0, 4, 2); flashLight.position.set(0, 1.6, .5); camG.add(flashLight);
collide(CAM.x, CAM.z, .5, .5);
// softbox: a white umbrella on a stand, angled at the spot
const umb = new THREE.Group(); umb.position.set(-11.5, 0, 7.55); umb.rotation.y = -2.2; FW.scene.add(umb);
cyl(.02, .02, 1.9, chrome, 0, .95, 0, umb);
const box1 = cyl(.05, .45, .35, M("#fffaf0"), 0, 1.95, .1, umb); box1.rotation.x = Math.PI / 2; box1.castShadow = false;
collide(-11.5, 7.55, .4, .4);
const sign = FW.signPlane("HR · BADGE PHOTOS", "New hires: see Hilda", 1.3, .45, "#e75aa3");
sign.position.set(-12.83, 2.3, 4.6); sign.rotation.y = Math.PI / 2; FW.scene.add(sign);

/* --- Hilda from HR --- */
const hilda = FW.makeChar({ shirt: "#8e5cc4", pants: "#3a3a40", skin: "#e0ac69", look: { hair: "bun", hairColor: "#8d8d8d", glasses: true, earrings: true, mouth: "grin", brows: "raised" }, name: "HILDA · HR", tagColor: "#e75aa3" });
hilda.g.position.set(HILDA_AT.x, 0, HILDA_AT.z);
collide(HILDA_AT.x, HILDA_AT.z, .55, .55);
const clipboard = box(.32, .42, .03, M("#c69a5c"), 0, -.78, .16, hilda.armR); clipboard.rotation.x = -.5;
box(.26, .3, .01, M("#ffffff"), 0, .02, .02, clipboard);

const GREETS = ["New hire? Badge photo first! Come here, hon.", "Ooh, a fresh face! Let's get your ID photo done.", "Nobody works here without a badge photo. Come, come!"];
const CHATS = ["Chin up. No, the other up.", "Want a new look for the badge? I won't tell.", "HR sees everything. Mostly your hair."];
let greeted = false, waveUntil = 0, flashAt = -1e9;
try { greeted = localStorage.getItem(GREET_KEY) === "1"; } catch (e) {}

// white flash over the screen when the photo is taken
const flashEl = document.createElement("div");
flashEl.style.cssText = "position:fixed;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:1200;transition:opacity .6s ease-out;";
document.body.appendChild(flashEl);
function takePhoto() {
  flashAt = performance.now();
  flashEl.style.transition = "none"; flashEl.style.opacity = ".95";
  requestAnimationFrame(() => requestAnimationFrame(() => { flashEl.style.transition = "opacity .7s ease-out"; flashEl.style.opacity = "0"; }));
  sfx("upgrade");
  say(hilda, FW.pick(["Say 'fraud'! …I mean 'cheese'. *FLASH*", "*FLASH* Gorgeous. Very trustworthy.", "*FLASH* That's going on the wall."]), 3200);
  wtoast("📸 New badge photo. Your look is saved.", "good");
}

FW.addInteraction({
  label: () => "Badge photo with Hilda (customize your look)",
  can: () => P.started && !P.seated && !P.carrying && (near(HILDA_AT, 1.8) || near(SPOT, 1.2) || near(CAM, 1.3)),
  act: () => {
    if (!window.ForgedCustomizer) return;
    say(hilda, "Pick your look, then smile!", 2000);
    // stand on the X facing the camera while you choose
    player.g.position.set(SPOT.x, 0, SPOT.z); player.g.rotation.y = Math.PI / 2;
    window.ForgedCustomizer.open(saved => {
      if (saved) setTimeout(takePhoto, 150);
      else say(hilda, "Camera-shy? Come back any time.", 2200);
    });
  },
});

FW.onUpdate((dt, now) => {
  // face whoever she's talking to (you, when close)
  const px = player.g.position.x, pz = player.g.position.z, d = Math.hypot(px - HILDA_AT.x, pz - HILDA_AT.z);
  const want = d < 6 ? Math.atan2(px - HILDA_AT.x, pz - HILDA_AT.z) : Math.PI * .25;
  let diff = want - hilda.g.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  hilda.g.rotation.y += diff * Math.min(1, dt * 4);
  // greet once per browser, the first time you come within a few steps
  if (!greeted && P.started && !P.seated && d < 7) { // you clock in about 6.3 m away
    greeted = true; try { localStorage.setItem(GREET_KEY, "1"); } catch (e) {}
    say(hilda, FW.pick(GREETS), 3800); waveUntil = now + 2200;
    setTimeout(() => wtoast("Tip: talk to Hilda from HR (E) to customize your character", ""), 900);
  } else if (greeted && d < 2.2 && Math.random() < dt * .03) say(hilda, FW.pick(CHATS), 2600);
  // arms: wave when greeting, otherwise hold the clipboard
  hilda.armL.rotation.x = now < waveUntil ? -2.6 + Math.sin(now / 90) * .35 : 0;
  hilda.armR.rotation.x = -1.0;
  // the flash bulb and its light
  const f = Math.max(0, 1 - (now - flashAt) / 350);
  flashLight.intensity = f * 3; flashBulb.material.color.set(f > .05 ? "#ffffff" : "#fff8d0");
});
})();
