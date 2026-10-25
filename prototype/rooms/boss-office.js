/* rooms/boss-office.js: see PLUGINS.md. Builds on window.FW from world.js.
 *
 * THE BOSS'S OFFICE (x -22..-13, z -10..0), entered through the west doorway
 * of the main office (x = -13, z = -5).
 *  - The boss now lives here: his patrol starts and ends at his big leather
 *    chair, and he sits there (visible) between patrols.
 *  - E "Read the boss's planner" (only while he's out): draws his next ~20 s of
 *    patrol on the floor as a glowing dashed line with 5 s markers.
 *  - E "Sneak the PRE-APPROVED stamp" (while carrying the envelope): gold seal
 *    on the envelope, the boss's cone ignores you for the rest of that carry,
 *    and the computer gets `boss-seal`.
 *  - Risk: if he walks back in (or is sitting there) and catches you inside,
 *    you're busted (+15 heat) and escorted out.
 */
(() => {
"use strict";
const FW = window.FW;
if (!FW) return;
const { THREE, M, box, cyl, sphere, collide, signPlane, canvasTex, B, P } = FW;
const boss = FW.npcs && FW.npcs.boss;
const player = FW.player;
if (!boss || !player || !B || !FW.BOSS_PATH) return;

const X0 = -22, X1 = -13, Z0 = -10, Z1 = 0;
const WALL = "#8c3b3b"; // pompous burgundy

/* ======================= Shell ======================= */

FW.room({ floorStyle: "wood", x0: X0, x1: X1, z0: Z0, z1: Z1, skip: ["east"], floor: ["#6b4a33", "#5a3c28"], wallColor: WALL });
// (the 1 m corner past the main office's west wall is filled by FW.room itself)

const scene = FW.scene;
const gold = M("#e8b422"), darkWood = M("#4a2c1a"), wood = M("#7a4a2a"), leather = M("#5a1f14"),
  ink = M("#1a1210"), white = M("#ffffff"), steel = M("#5c6168"), green = M("#2f8a3e");
const add = m => { scene.add(m); return m; };

// wainscot stripe in gold along the walls
box(9, .12, .06, gold, (X0 + X1) / 2, 1.0, Z0 + .18);
box(9, .12, .06, gold, (X0 + X1) / 2, 1.0, Z1 - .18);
box(.06, .12, 10, gold, X0 + .18, 1.0, (Z0 + Z1) / 2);

/* --- rug: red with a gold border and a big monogram --- */
const rugTex = canvasTex(512, 410, (g, w, h) => {
  g.fillStyle = "#9c1c1c"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#e8b422"; g.lineWidth = 18; g.strokeRect(20, 20, w - 40, h - 40);
  g.lineWidth = 6; g.strokeRect(48, 48, w - 96, h - 96);
  g.fillStyle = "#e8b422"; g.font = "bold 220px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("B", w / 2, h / 2 + 10);
  for (const [x, y] of [[70, 70], [w - 70, 70], [70, h - 70], [w - 70, h - 70]]) { g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill(); }
});
const rug = add(new THREE.Mesh(new THREE.PlaneGeometry(5, 4), M("#fff", { map: rugTex })));
rug.rotation.x = -Math.PI / 2; rug.rotation.z = Math.PI / 2; rug.position.set(-17.4, .012, -5); rug.receiveShadow = true;

/* --- window with a fake skyline, behind the desk --- */
const skyTex = canvasTex(512, 256, (g, w, h) => {
  const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#ff9a5a"); sky.addColorStop(1, "#ffd9a0");
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  g.fillStyle = "#fff4c2"; g.beginPath(); g.arc(380, 120, 34, 0, 7); g.fill();
  let x = 0; let seed = 7;
  const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  while (x < w) {
    const bw = 30 + r() * 45, bh = 60 + r() * 150;
    g.fillStyle = r() > .5 ? "#3b2a4a" : "#4d3560"; g.fillRect(x, h - bh, bw, bh);
    g.fillStyle = "#ffe27a";
    for (let wy = h - bh + 10; wy < h - 10; wy += 18) for (let wx = x + 6; wx < x + bw - 8; wx += 12) if (r() > .55) g.fillRect(wx, wy, 6, 9);
    x += bw + 2;
  }
  g.fillStyle = "#e8b422"; g.font = "bold 22px Impact, sans-serif"; g.fillText("BOSS TOWER", 210, 60); // he named one after himself
});
const win = add(new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.4), new THREE.MeshBasicMaterial({ map: skyTex })));
win.rotation.y = Math.PI / 2; win.position.set(X0 + .17, 1.95, -5);
box(.1, .12, 3.0, gold, X0 + .19, 2.7, -5); box(.1, .12, 3.0, gold, X0 + .19, 1.2, -5);
box(.1, 1.6, .12, gold, X0 + .19, 1.95, -6.45); box(.1, 1.6, .12, gold, X0 + .19, 1.95, -3.55);
box(.1, 1.4, .06, gold, X0 + .19, 1.95, -5);
box(.3, .08, 3.1, darkWood, X0 + .3, 1.14, -5); // sill

/* --- portrait of the boss on the north wall --- */
const portraitTex = canvasTex(320, 400, (g, w, h) => {
  g.fillStyle = "#3a5a40"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#1b1b1b"; g.fillRect(70, 270, 180, 130);                // suit
  g.fillStyle = "#e0352b"; g.fillRect(150, 275, 20, 110);                // tie
  g.fillStyle = "#f1c27d"; g.fillRect(85, 90, 150, 170);                 // big square head
  g.fillStyle = "#555"; g.fillRect(100, 78, 125, 18); g.fillRect(80, 110, 12, 60); g.fillRect(228, 110, 12, 60); // combover
  g.fillStyle = "#fff"; g.beginPath(); g.arc(130, 150, 18, 0, 7); g.arc(190, 150, 18, 0, 7); g.fill();
  g.fillStyle = "#1a1210"; g.beginPath(); g.arc(134, 152, 8, 0, 7); g.arc(194, 152, 8, 0, 7); g.fill();
  g.lineWidth = 8; g.strokeStyle = "#555"; g.beginPath(); g.moveTo(110, 120); g.lineTo(148, 132); g.moveTo(210, 120); g.lineTo(172, 132); g.stroke();
  g.fillStyle = "#d9a066"; g.fillRect(148, 160, 26, 40);                 // nose
  g.fillStyle = "#555"; g.fillRect(118, 208, 86, 16);                    // mustache
  g.fillStyle = "#e8b422"; g.font = "bold 30px Georgia, serif"; g.textAlign = "center"; g.fillText("★ HIM ★", w / 2, 48);
});
box(1.6, 1.95, .08, gold, -17.4, 1.95, Z0 + .2);
const portrait = add(new THREE.Mesh(new THREE.PlaneGeometry(1.36, 1.7), new THREE.MeshBasicMaterial({ map: portraitTex })));
portrait.position.set(-17.4, 1.95, Z0 + .25);
const plaque = add(signPlane("OUR FOUNDER", "VISIONARY · 3 HANDICAP", 1.2, .3, "#2b1d14", "#e8b422"));
plaque.position.set(-17.4, .78, Z0 + .2);

/* --- trophy shelf --- */
const SHELF = { x: -20.4, z: Z0 + .3 };
box(2.4, .1, .5, darkWood, SHELF.x, 2.25, SHELF.z); box(2.4, .1, .5, darkWood, SHELF.x, .05, SHELF.z);
[-1.17, 1.17].forEach(dx => box(.08, 2.25, .5, darkWood, SHELF.x + dx, 1.12, SHELF.z));
[.75, 1.5].forEach(y => box(2.35, .06, .48, darkWood, SHELF.x, y, SHELF.z));
function trophy(x, y, s = 1, mat = gold) {
  cyl(.1 * s, .14 * s, .06 * s, ink, x, y + .03 * s, SHELF.z);
  cyl(.03 * s, .03 * s, .14 * s, mat, x, y + .13 * s, SHELF.z);
  cyl(.15 * s, .06 * s, .2 * s, mat, x, y + .3 * s, SHELF.z);
  [-1, 1].forEach(sx => { const h = new THREE.Mesh(new THREE.TorusGeometry(.06 * s, .015 * s, 6, 12), mat); h.position.set(x + sx * .16 * s, y + .32 * s, SHELF.z); scene.add(h); });
}
trophy(-21.2, .78, 1.3); trophy(-20.4, .78, .9); trophy(-19.7, .78, 1.1, M("#c0c0c0"));
trophy(-21.0, 1.53, 1.0); trophy(-19.9, 1.53, 1.5);
sphere(.12, M("#ffffff"), -20.5, .2, SHELF.z, scene); // a "championship" golf ball on a cushion
box(.3, .08, .3, M("#9c1c1c"), -20.5, .1, SHELF.z);
const tro1 = add(signPlane("#1 BOSS", "SELF-AWARDED", .7, .2, "#2b1d14", "#e8b422")); tro1.position.set(-20.4, 1.0, SHELF.z + .26);
const tro2 = add(signPlane("PARTICIPANT", "OFFICE 5K · 2019", .7, .2, "#2b1d14", "#c0c0c0")); tro2.position.set(-19.9, 1.66, SHELF.z + .26);
collide(SHELF.x, SHELF.z, 2.45, .6);

/* --- fish tank on a cabinet --- */
const TANK = { x: -14.7, z: Z0 + .5 };
box(1.7, .9, .7, darkWood, TANK.x, .45, TANK.z);
const water = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, .75, .55), new THREE.MeshBasicMaterial({ color: "#4fb3e8", transparent: true, opacity: .45, depthWrite: false })));
water.position.set(TANK.x, 1.3, TANK.z);
box(1.56, .06, .6, ink, TANK.x, .93, TANK.z); box(1.56, .06, .6, ink, TANK.x, 1.69, TANK.z);
box(1.4, .05, .45, M("#e8d49a"), TANK.x, .98, TANK.z); // sand
cyl(.05, .07, .3, M("#3f9b4f"), TANK.x - .5, 1.13, TANK.z); cyl(.04, .06, .22, M("#3f9b4f"), TANK.x + .55, 1.1, TANK.z - .1);
const castle = box(.22, .2, .16, M("#b0a090"), TANK.x + .25, 1.1, TANK.z + .05);
box(.06, .1, .06, M("#b0a090"), .08, .14, 0, castle);
const fish = [["#ff8a1f", 0], ["#ffd23f", 2.1], ["#ff4f9a", 4.2]].map(([c, ph]) => {
  const g = new THREE.Group(); scene.add(g);
  box(.16, .1, .05, M(c), 0, 0, 0, g);
  const tail = box(.06, .1, .03, M(c), -.1, 0, 0, g); tail.rotation.z = .6;
  sphere(.015, ink, .06, .02, .03, g, 6);
  return { g, ph };
});
const tankSign = add(signPlane("DO NOT TAP", "THEY ARE CFOs", .7, .2, "#2b1d14")); tankSign.position.set(TANK.x, .6, TANK.z + .36);
collide(TANK.x, TANK.z, 1.75, .8);

/* --- filing safe --- */
const SAFE = { x: -21.3, z: -1.0 };
box(.9, 1.2, .9, steel, SAFE.x, .6, SAFE.z);
const dial = cyl(.13, .13, .05, M("#c0c0c0"), SAFE.x + .47, .8, SAFE.z); dial.rotation.z = Math.PI / 2;
box(.04, .3, .06, ink, SAFE.x + .48, .5, SAFE.z - .2);
const safeSign = add(signPlane("TAX STUFF", "DO NOT", .6, .2, "#e0352b")); safeSign.rotation.y = Math.PI / 2; safeSign.position.set(SAFE.x + .46, 1.05, SAFE.z);
collide(SAFE.x, SAFE.z, .95, .95);

/* --- putting green along the south wall --- */
const TEE = { x: -18.6, z: -1.0 }, HOLE = { x: -15.2, z: -1.0 };
box(4.4, .03, .9, green, -16.9, .015, -1.0);
const hole = add(new THREE.Mesh(new THREE.CircleGeometry(.09, 16), new THREE.MeshBasicMaterial({ color: "#111" })));
hole.rotation.x = -Math.PI / 2; hole.position.set(HOLE.x, .035, HOLE.z);
cyl(.012, .012, 1.0, white, HOLE.x, .5, HOLE.z);
const flag = box(.3, .2, .01, M("#e0352b"), HOLE.x + .15, .9, HOLE.z);
const ball = sphere(.05, white, TEE.x, .08, TEE.z, scene);
// putter leaning on the wall
const putter = new THREE.Group(); putter.position.set(-19.4, 0, -.35); putter.rotation.z = -.25; scene.add(putter);
cyl(.015, .015, 1.0, M("#c0c0c0"), 0, .55, 0, putter); box(.06, .14, .04, ink, 0, 1.06, 0, putter); box(.16, .05, .05, M("#c0c0c0"), .06, .04, 0, putter);
const motto = add(signPlane("SYNERGY", "(MY IDEA)", 1.4, .5, "#1f3a5a", "#e8b422")); motto.rotation.y = Math.PI; motto.position.set(-16.9, 2.0, Z1 - .17);

/* --- the big desk --- */
const DESK = { x: -19.0, z: -5, w: 1.4, d: 3.0, top: .92 };
box(DESK.w + .1, .1, DESK.d + .1, darkWood, DESK.x, DESK.top, DESK.z);              // top
box(.1, DESK.top - .05, DESK.d, wood, DESK.x + DESK.w / 2 - .05, (DESK.top - .05) / 2, DESK.z); // modesty panel (visitor side)
[-1, 1].forEach(sz => box(DESK.w - .1, DESK.top - .05, .7, wood, DESK.x, (DESK.top - .05) / 2, DESK.z + sz * (DESK.d / 2 - .35))); // pedestals
// drawer pulls on the boss's side
[-1, 1].forEach(sz => [.3, .6].forEach(y => box(.04, .05, .25, gold, DESK.x - DESK.w / 2 - .02, y, DESK.z + sz * (DESK.d / 2 - .35))));
// the secret drawer (south pedestal, top) slides out when you sneak the stamp
const drawer = box(.08, .2, .55, wood, DESK.x - DESK.w / 2 - .01, .72, DESK.z - (DESK.d / 2 - .35));
box(.04, .05, .2, gold, -.05, 0, 0, drawer);
const drawerStamp = new THREE.Group(); drawerStamp.position.set(.2, .12, 0); drawer.add(drawerStamp);
box(.12, .06, .12, gold, 0, 0, 0, drawerStamp); cyl(.03, .03, .1, darkWood, 0, .08, 0, drawerStamp);
const DRAWER_X = drawer.position.x;
// gold trim on the visitor side + nameplate
box(.06, .08, DESK.d + .1, gold, DESK.x + DESK.w / 2 + .01, DESK.top - .1, DESK.z);
box(.18, .26, 1.0, darkWood, DESK.x + DESK.w / 2 - .15, DESK.top + .18, DESK.z);
const nameplate = add(signPlane("THE BOSS", null, .95, .22, "#2b1d14", "#e8b422"));
nameplate.rotation.y = Math.PI / 2; nameplate.position.set(DESK.x + DESK.w / 2 - .05, DESK.top + .18, DESK.z);
// desk clutter: lamp, mug, phone, stack of "APPROVED", a huge DENIED stamp
const lampG = new THREE.Group(); lampG.position.set(DESK.x - .2, DESK.top + .05, DESK.z + 1.15); scene.add(lampG);
cyl(.1, .12, .05, gold, 0, 0, 0, lampG); cyl(.015, .015, .45, gold, 0, .22, 0, lampG);
const lampShade = cyl(.08, .18, .16, M("#2f7a4a"), 0, .48, 0, lampG); lampShade.castShadow = false;
const bulb = new THREE.Mesh(new THREE.SphereGeometry(.06, 8, 8), new THREE.MeshBasicMaterial({ color: "#fff3c4" })); bulb.position.y = .42; lampG.add(bulb);
cyl(.07, .06, .15, white, DESK.x + .3, DESK.top + .12, DESK.z + .7);
const mugSign = add(signPlane("#1 BOSS", null, .16, .06, "#ffffff", "#e0352b")); mugSign.rotation.y = Math.PI / 2; mugSign.position.set(DESK.x + .375, DESK.top + .13, DESK.z + .7);
box(.25, .08, .18, ink, DESK.x - .1, DESK.top + .09, DESK.z - .4);                                   // phone
for (let i = 0; i < 4; i++) box(.3, .02, .4, M("#fffaf0"), DESK.x, DESK.top + .06 + i * .022, DESK.z - 1.0).rotation.y = (i % 2 ? .15 : -.1);
const deniedStamp = new THREE.Group(); deniedStamp.position.set(DESK.x + .25, DESK.top + .05, DESK.z - .6); scene.add(deniedStamp);
box(.2, .08, .14, M("#e0352b"), 0, .04, 0, deniedStamp); cyl(.04, .04, .14, darkWood, 0, .15, 0, deniedStamp); sphere(.06, darkWood, 0, .25, 0, deniedStamp);
// THE PLANNER: a fat red book, open towards the visitor side
const PLANNER = { x: DESK.x + .25, z: DESK.z + 1.05 };
const plannerTex = canvasTex(256, 160, (g, w, h) => {
  g.fillStyle = "#fffaf0"; g.fillRect(0, 0, w, h);
  g.fillStyle = "#2b1d14"; g.fillRect(w / 2 - 2, 0, 4, h);
  g.font = "bold 18px 'Space Mono', monospace"; g.fillStyle = "#e0352b"; g.fillText("PATROL", 12, 26); g.fillText("GOLF", w / 2 + 12, 26);
  g.font = "13px 'Space Mono', monospace"; g.fillStyle = "#2b1d14";
  ["9:00 loom", "9:05 glare", "9:10 loom", "9:15 sit"].forEach((s, i) => g.fillText(s, 12, 52 + i * 24));
  ["10:00 golf", "11:00 golf", "12:00 lunch", "1:00 golf"].forEach((s, i) => g.fillText(s, w / 2 + 12, 52 + i * 24));
});
const plannerCover = box(.62, .05, .48, M("#b02020", { emissive: "#ff3b3b", emissiveIntensity: 0 }), PLANNER.x, DESK.top + .07, PLANNER.z);
const plannerPage = add(new THREE.Mesh(new THREE.PlaneGeometry(.44, .58), new THREE.MeshBasicMaterial({ map: plannerTex })));
plannerPage.rotation.x = -Math.PI / 2; plannerPage.rotation.z = Math.PI / 2; plannerPage.position.set(PLANNER.x, DESK.top + .1, PLANNER.z);
collide(DESK.x, DESK.z, DESK.w + .1, DESK.d + .1);

/* --- the big leather chair (boss sits here, facing the door) --- */
const SEAT = { x: -20.4, z: -5 };
const chair = new THREE.Group(); chair.position.set(SEAT.x - .05, 0, SEAT.z); scene.add(chair);
cyl(.06, .06, .4, ink, 0, .2, 0, chair); box(.7, .05, .7, ink, 0, .03, 0, chair);
box(.85, .16, .85, leather, 0, .5, 0, chair);                                 // seat
box(.18, 1.7, .95, leather, -.45, 1.2, 0, chair);                             // tall back
[-1, 1].forEach(sz => box(.3, 1.3, .15, leather, -.35, 1.25, sz * .5, chair)); // wings
[-1, 1].forEach(sz => box(.7, .12, .14, leather, .02, .82, sz * .48, chair));  // armrests
[-.4, 0, .4].forEach(y => [-.25, .25].forEach(z => sphere(.03, gold, -.35, 1.2 + y, z, chair, 6))); // buttons
collide(SEAT.x - .1, SEAT.z, .9, .95);

/* --- a sad little stool for employees --- */
cyl(.18, .15, .42, M("#9aa0a6"), -17.6, .21, -5.9);
const stoolSign = add(signPlane("SIT.", null, .3, .12, "#2b1d14")); stoolSign.rotation.x = -Math.PI / 2; stoolSign.position.set(-17.6, .43, -5.9);
collide(-17.6, -5.9, .4, .4);

// sign above the doorway, inside
const doorSign = add(signPlane("KNOCK FIRST", "(DON'T)", 1.3, .35, "#2b1d14", "#e8b422"));
doorSign.rotation.y = -Math.PI / 2; doorSign.position.set(X1 - .2, 2.6, -6.6);

/* ======================= The boss lives here ======================= */
/* Patrol: chair -> out the doorway -> the original loop through the main
 * office -> back to the chair. Mutate in place so world.js keeps its array. */
const SPEED = 1.7; // matches updateBoss
const OUT = [[SEAT.x, SEAT.z], [SEAT.x, -2.8], [-16.5, -2.8], [-14, -5]];
const LOOP = FW.BOSS_PATH.slice(); // the original [-12.2,-5] ... [-12.2,-5] loop
const BACK = [[-14, -5], [-16.5, -2.8], [SEAT.x, -2.8], [SEAT.x, SEAT.z]];
FW.BOSS_PATH.length = 0;
OUT.concat(LOOP, BACK).forEach(p => FW.BOSS_PATH.push(p));
let RETURN_IDX = OUT.length + LOOP.length; // B.i heading to this point = he's coming back in

/* Level 3: an unpredictable patrol. Each time he heads out he picks one of these loops through the
 * main office (all start and end at his door), and about half the time he doubles back partway
 * ("…did I leave the stapler?"). The planner on his desk still shows the real route, so peeking pays. */
const ROUTES = [
  LOOP, // the usual: down the west aisle, back up between the desk blocks
  [[-12.2, -5], [-10.4, -5.6], [-5.5, -5.6], [-5.5, 5.4], [-10.4, 5.4], [-10.4, -5], [-12.2, -5]], // the usual, backwards
  [[-12.2, -5], [-10.4, -6.3], [-.3, -6.3], [4.6, -2.6], [4.6, 6.2], [-.3, 6.2], [-.3, -5.6], [-10.4, -5.6], [-12.2, -5]], // past the printer to Gus's side
  [[-12.2, -5], [-10.4, -5], [-10.4, 5.4], [-.3, 6.3], [10.6, 6.3], [10.6, -2.2], [4.6, -2.2], [4.6, -6.3], [-10.4, -6.3], [-12.2, -5]], // the long way round, by the clerk
];
let lastRoute = 0;
function pickRoute(rules) {
  let loop = LOOP;
  if (rules && rules.randomRoutes) {
    let k; do { k = Math.floor(Math.random() * ROUTES.length); } while (k === lastRoute && Math.random() < .7); // rarely the same twice
    lastRoute = k; loop = ROUTES[k].map(p => p.slice());
    if (Math.random() < .5) { // double back: halfway back toward the last corner, then on again
      const i = 2 + Math.floor(Math.random() * (loop.length - 4));
      const [ax, az] = loop[i - 1], [bx, bz] = loop[i];
      loop.splice(i + 1, 0, [bx + (ax - bx) * .5, bz + (az - bz) * .5], [bx, bz]);
    }
  }
  FW.BOSS_PATH.length = 0;
  OUT.concat(loop, BACK).forEach(p => FW.BOSS_PATH.push(p));
  RETURN_IDX = OUT.length + loop.length;
}
if (FW.onBossWalk) FW.onBossWalk(pickRoute);
boss.g.position.set(SEAT.x, 0, SEAT.z);

// his vision cone (a child of boss.g) shouldn't show while he sits
const cone = boss.g.children.find(c => c.geometry && c.geometry.type === "CircleGeometry");

const inOffice = (p, m = 0) => p.x < X1 - .3 - m && p.x > X0 && p.z > Z0 && p.z < Z1;
const bossOut = () => B.state === "walk" && !inOffice(boss.g.position);

/* ======================= Planner: the next ~20 s of patrol on the floor ======================= */

const ROUTE_SECS = 20, DASH_STEP = .55, MAX_DASH = Math.ceil(ROUTE_SECS * SPEED / DASH_STEP) + 4;
const dashGeo = new THREE.PlaneGeometry(.34, .12);
const dashes = [];
for (let i = 0; i < MAX_DASH; i++) {
  const m = new THREE.Mesh(dashGeo, new THREE.MeshBasicMaterial({ color: "#ff3b8a", transparent: true, opacity: 0, depthWrite: false }));
  m.rotation.order = "XYZ"; m.rotation.x = -Math.PI / 2; m.position.y = .035; m.visible = false; m.renderOrder = 2;
  scene.add(m); dashes.push({ m, t: 0 });
}
const timeLabels = [5, 10, 15, 20].map(s => {
  const tex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = "#ff3b8a"; g.beginPath(); g.arc(32, 32, 26, 0, 7); g.arc(96, 32, 26, 0, 7); g.fill(); g.fillRect(32, 6, 64, 52);
    g.fillStyle = "#fff"; g.font = "bold 34px 'Space Mono', monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s + "s", w / 2, h / 2 + 2);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(.7, .35, 1); sp.visible = false; sp.renderOrder = 9; scene.add(sp);
  return { sp, s };
});
const route = { active: false, start: 0, used: 0 };

// walk the path from where he is now, emitting a dash every DASH_STEP metres
function predictRoute(now) {
  const pos = boss.g.position;
  const delay = Math.max(0, (B.pauseUntil - now) / 1000);
  let x = pos.x, z = pos.z, dist = 0, next = DASH_STEP * .5, n = 0, totalLeft = 0;
  const budget = Math.max(0, ROUTE_SECS - delay) * SPEED;
  timeLabels.forEach(l => l.sp.visible = false);
  let li = 0;
  for (let i = Math.max(1, B.i); i < FW.BOSS_PATH.length; i++) {
    const [tx, tz] = FW.BOSS_PATH[i];
    const dx = tx - x, dz = tz - z, seg = Math.hypot(dx, dz);
    if (seg > 1e-3) {
      const ux = dx / seg, uz = dz / seg, a = Math.atan2(-uz, ux);
      while (next <= dist + seg && next <= budget && n < MAX_DASH) {
        const k = next - dist, d = dashes[n++];
        d.m.position.set(x + ux * k, .035, z + uz * k); d.m.rotation.z = a; d.m.visible = true;
        d.t = delay + next / SPEED;
        // a "5s / 10s / ..." label where the time crosses
        if (li < timeLabels.length && d.t >= timeLabels[li].s) { const l = timeLabels[li++]; l.sp.position.set(x + ux * k, .5, z + uz * k); l.sp.visible = true; }
        next += DASH_STEP;
      }
    }
    dist += seg; x = tx; z = tz;
  }
  totalLeft = delay + dist / SPEED;
  for (let i = n; i < MAX_DASH; i++) dashes[i].m.visible = false;
  route.used = n; route.active = n > 0; route.start = now;
  return totalLeft;
}
function clearRoute() {
  route.active = false;
  dashes.forEach(d => { d.m.visible = false; });
  timeLabels.forEach(l => l.sp.visible = false);
}
function updateRoute(now) {
  if (!route.active) return;
  const el = (now - route.start) / 1000;
  if (el > ROUTE_SECS + .5) { clearRoute(); return; }
  const fade = Math.min(1, (ROUTE_SECS + .5 - el) / 2.5);
  for (let i = 0; i < route.used; i++) {
    const d = dashes[i];
    if (el > d.t) { d.m.visible = false; continue; } // he's already walked past it
    d.m.material.opacity = fade * (.55 + .4 * Math.sin(now / 140 - d.t * 2.4));
  }
  timeLabels.forEach(l => { if (l.sp.visible && el > l.s) l.sp.visible = false; });
}

function readPlanner() {
  const now = performance.now();
  const left = predictRoute(now);
  FW.sfx("pickup");
  FW.wtoast(`Planner: "9:00 Loom. 9:05 Glare. 9:15 Big chair." Route shown for ${ROUTE_SECS} s. Back at his desk in ~${Math.round(left)} s.`, "good");
  FW.say(player, "<i>*flip flip*</i>", 1200);
  if (P.tutorialOn) FW.toOS("tutorial-3d-done", { step: "planner-read" }); // the tutorial's last step
}
// the tutorial's planner step: the green arrow points at the planner
if (FW.tutTargets) FW.tutTargets.planner = { x: DESK.x + DESK.w / 2 + .6, z: PLANNER.z, y: 2.0 };

/* ======================= The PRE-APPROVED stamp ======================= */

const DRAWER_SPOT = { x: DESK.x - DESK.w / 2 - .55, z: DESK.z - (DESK.d / 2 - .35) - .2 };
let sealed = false, forcedBlind = false, drawerOpenAt = -1e9;
// gold seal on the carried envelope: find world.js's carried envelope mesh, else mimic its transform
const sealMat = M("#ffcc22", { emissive: "#ffb000", emissiveIntensity: .35 });
let carryEnv = player.g.children.find(c => c.isMesh && c.geometry && c.geometry.type === "BoxGeometry" && c.geometry.parameters &&
  Math.abs(c.geometry.parameters.width - .5) < 1e-3 && Math.abs(c.geometry.parameters.height - .03) < 1e-3);
let sealHolder = carryEnv;
if (!sealHolder) { sealHolder = new THREE.Group(); sealHolder.position.set(.52, 1.05, .12); sealHolder.rotation.set(Math.PI / 2, 0, .25); player.g.add(sealHolder); }
const seal = new THREE.Group(); sealHolder.add(seal); seal.visible = false;
[-1, 1].forEach(s => {
  const disc = cyl(.085, .085, .012, sealMat, .1, s * .022, 0, seal);
  disc.castShadow = false;
  // two little ribbon tails
  [-1, 1].forEach(t => { const r = box(.03, .008, .09, M("#e0352b"), .1 + t * .03, s * .02, .1, seal); r.rotation.y = t * .3; });
});

function takeStamp(now) {
  sealed = true; seal.visible = true; drawerOpenAt = now;
  FW.sfx("slam"); FW.sfx("pickup");
  FW.say(player, "<b>*KA-CHUNK*</b> Pre-approved!", 1600, "paid");
  FW.wtoast("Gold seal: PRE-APPROVED BY THE BOSS. The boss won't look twice at it.", "good");
  try { FW.burstConfetti(DRAWER_SPOT.x, 1.0, DRAWER_SPOT.z); } catch (e) {}
  FW.toOS("boss-seal", {});
}
function dropSeal() {
  sealed = false; seal.visible = false;
  if (forcedBlind) { B.busted = false; forcedBlind = false; }
}

/* ======================= Getting caught in here ======================= */

let lastBustAt = -1e9, lastShooAt = -1e9, ejectAt = 0, warnedOut = false, seated = false;
const BUST_LINES = [
  "What are you doing in MY office?!",
  "Is that… my chair? You're not even sitting in it. Somehow worse.",
  "Snooping? On company time? On MY company time?!",
];
function bust(now) {
  lastBustAt = now;
  const ms = 2500;
  if (P.tutorialOn) { // the tutorial never costs heat: he just shoos you out
    FW.say(boss, "Out of my office! …New hire, huh. Don't let me catch you again.", ms);
    P.frozenUntil = Math.max(P.frozenUntil || 0, now + ms);
    if (B.state === "walk") B.pauseUntil = now + ms;
    FW.sfx("busted");
    FW.wtoast("Caught in the boss's office! (No heat in the tutorial. In a real game: +15.)", "bad");
    ejectAt = now + ms;
    return;
  }
  FW.say(boss, FW.pick(BUST_LINES), ms);
  P.frozenUntil = Math.max(P.frozenUntil || 0, now + ms);
  if (B.state === "walk") B.pauseUntil = now + ms;
  P.shake = .3;
  FW.flashVignette(); FW.sfx("busted");
  FW.wtoast(sealed ? "Caught in the boss's office! He took the stamp back. +15 heat" : "Caught in the boss's office! +15 heat", "bad");
  FW.toOS("heat", { amount: 15 });
  if (sealed) dropSeal();
  ejectAt = now + ms;
}
function eject() {
  ejectAt = 0;
  if (!inOffice(player.g.position, -.3)) return;
  player.g.position.set(-11.9, 0, -5);
  player.g.rotation.y = Math.PI / 2;
  P.yaw = -Math.PI / 2;
  FW.say(boss, "And close the door. We don't have a door. Close it anyway.", 2400);
}

/* ======================= Interactions ======================= */

FW.addInteraction({
  label: () => "Sneak the PRE-APPROVED stamp",
  can: () => P.carrying && !sealed && FW.near(DRAWER_SPOT, 1.0),
  act: () => takeStamp(performance.now()),
});
FW.addInteraction({
  label: () => "Read the boss's planner",
  can: () => bossOut() && FW.near({ x: DESK.x + DESK.w / 2 + .6, z: PLANNER.z }, 1.1),
  act: readPlanner,
});
let putt = null;
FW.addInteraction({
  label: () => "Practice the boss's putt",
  can: () => !putt && !P.carrying && FW.near(TEE, .95),
  act: () => {
    const sink = Math.random() < .35;
    putt = { t0: performance.now(), sink, end: sink ? HOLE.x : HOLE.x + FW.rand(-1.2, .7), endZ: HOLE.z + (sink ? 0 : FW.rand(-.3, .3)) };
    FW.sfx("step");
  },
});
FW.addInteraction({
  label: () => "Try the safe",
  can: () => FW.near({ x: SAFE.x + .9, z: SAFE.z }, .8),
  act: () => FW.wtoast(FW.pick(["Locked. The combination is probably his golf score.", "You try 1-2-3-4. It's 1-2-3-5. Of course it is.", "You hear… a single, lonely receipt inside."])),
});

/* ======================= Every frame ======================= */

FW.onUpdate((dt, now) => {
  // --- the boss at his desk ---
  try {
    if (B.state === "wait") {
      if (!seated) {
        boss.g.position.set(SEAT.x, 0, SEAT.z);
        FW.seatPose(boss, false);
        seated = true; warnedOut = false;
      }
      boss.g.visible = true;
      boss.g.position.x = SEAT.x; boss.g.position.z = SEAT.z;
      boss.g.rotation.y = Math.PI / 2 + Math.sin(now / 1500) * (FW.level && FW.level().glassOffice ? .5 : .22); // smug swivel (wider on level 2: he scans the floor through the glass)
      boss.armR.rotation.x = -.3 + Math.max(0, Math.sin(now / 900)) * -.9; // drumming the desk
      boss.armL.rotation.x = -.6;
      if (cone) cone.visible = !!(FW.level && FW.level().glassOffice); // level 2: he watches the floor through his glass wall
    } else {
      if (seated) { FW.standPose(boss); seated = false; }
      if (cone) cone.visible = B.state !== "drill"; // no cone while he's out at the fire-drill headcount
    }
  } catch (e) { console.error("[boss-office] seat", e); }

  // --- the stamp: blind cone while you carry a sealed envelope ---
  try {
    if (sealed && !P.carrying) dropSeal();
    if (sealed) {
      B.sus = 0;
      if (!B.busted) { B.busted = true; forcedBlind = true; } // world.js only builds suspicion while !B.busted
      if (cone && B.state === "walk" && now >= B.pauseUntil) cone.material.color.set("#8fe36b");
      seal.rotation.y = Math.sin(now / 300) * .15;
    }
    // drawer slides out and back
    const dk = (now - drawerOpenAt) / 1400;
    const open = dk < 0 || dk > 1 ? 0 : Math.sin(dk * Math.PI);
    drawer.position.x = DRAWER_X - open * .45;
    drawerStamp.visible = !sealed || (dk >= 0 && dk < .5);
  } catch (e) { console.error("[boss-office] stamp", e); }

  // --- planner glow (hint) and route ---
  try {
    plannerCover.material.emissiveIntensity = bossOut() ? .35 + .3 * Math.sin(now / 250) : 0;
    updateRoute(now);
    if (route.active && B.state === "wait") clearRoute(); // he's home, plan's over
  } catch (e) { console.error("[boss-office] route", e); }

  // --- risk: caught inside ---
  try {
    if (ejectAt && now >= ejectAt) eject();
    const pp = player.g.position;
    const playerIn = P.started && !P.seated && !(FW.CINE && FW.CINE.active) && inOffice(pp);
    if (playerIn && now - lastBustAt > 6000 && now >= (P.frozenUntil || 0)) {
      if (B.state === "walk" && B.i >= RETURN_IDX && inOffice(boss.g.position)) bust(now);
      else if (B.state === "wait" && P.carrying) bust(now);
      else if (B.state === "wait" && now - lastShooAt > 7000) {
        lastShooAt = now;
        FW.say(boss, FW.pick(["Do you have an appointment? No? OUT.", "Don't touch the fish.", "This is a <i>boss-only</i> zone."]), 2200);
      } else if (B.state === "walk" && B.i < OUT.length && !warnedOut && inOffice(boss.g.position)) {
        warnedOut = true;
        FW.say(boss, "Don't touch anything while I'm gone.", 2200);
      }
    }
  } catch (e) { console.error("[boss-office] bust", e); }

  // --- ambient: fish, flag, putt ---
  try {
    const t = now / 1000;
    fish.forEach((f, i) => {
      const a = t * (.5 + i * .15) + f.ph;
      f.g.position.set(TANK.x + Math.sin(a) * .55, 1.2 + i * .12 + Math.sin(a * 2.3) * .04, TANK.z + Math.cos(a * .7) * .12);
      f.g.rotation.y = Math.cos(a) >= 0 ? 0 : Math.PI;
    });
    flag.rotation.y = Math.sin(t * 2) * .2;
    if (putt) {
      const k = Math.min(1, (now - putt.t0) / 1300), e = 1 - (1 - k) * (1 - k);
      if (k < 1) ball.position.set(TEE.x + (putt.end - TEE.x) * e, .08, TEE.z + (putt.endZ - TEE.z) * e);
      else if (!putt.done) {
        putt.done = true;
        if (putt.sink) { ball.position.y = -.2; FW.sfx("cash"); FW.wtoast("Hole in one! Don't tell him.", "good"); }
        else FW.wtoast(FW.pick(["Lipped out. Just like his quarterly targets.", "Wide. The boss would call that a gimme."]));
      }
      if (now - putt.t0 > 3200) { ball.position.set(TEE.x, .08, TEE.z); putt = null; }
    }
  } catch (e) { console.error("[boss-office] ambient", e); }
});

})();
