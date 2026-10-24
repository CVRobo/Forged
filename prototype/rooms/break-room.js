/* rooms/break-room.js: see PLUGINS.md. Builds on window.FW from world.js.
 *
 * THE BREAK ROOM, south of the main office (x -13..0, z 9..17), through the
 * doorway at z = 9, x = -6. A cosy, slightly sad office kitchen.
 *
 * Mechanics:
 *  - Coffee (E at the machine): ~30 s "Caffeinated" buff. You walk faster and
 *    the boss's suspicion fills slower. Steaming cup in your hand, HUD chip.
 *  - Donut bribe (E at the donut box): carry a donut. Walk up to Brenda, the
 *    inspector or the boss and you hand it over automatically:
 *      Brenda  -> funny bubble + a whispered hint.
 *      Gus     -> funny bubble + toOS("bribe", { target: "inspector" }); his
 *                 next close-up line is cheerful.
 *      Boss    -> he "confiscates" it and stops to eat it (pauses his patrol).
 *  - Gossip (E at the table): Pam, a chatty coworker, gives a useful hint. Hints
 *    follow the latest `tells` from verdict messages.
 *
 * The floor spot (x -10, z 15) in front of the coffee machine is kept free for
 * coworkers that features.js walks over to "get coffee". */
(() => {
"use strict";
const FW = window.FW;
if (!FW) return;
const THREE = FW.THREE;
const { M, box, cyl, collide, canvasTex } = FW;
const safe = fn => { try { return fn(); } catch (e) { console.error("[break-room]", e); } };

/* ======================= Shell ======================= */
safe(() => FW.room({ x0: -13, x1: 0, z0: 9, z1: 17, skip: ["north"], floor: ["#efe6cc", "#b9d6c8"], wallColor: "#e9d79e" }));

// shared materials and geometry, built once
const mat = {
  counter: M("#c7cfd6"), cabinet: M("#6f9fb3"), top: M("#eeeeea"), steel: M("#b4bac0"), dark: M("#2e2a28"),
  fridge: M("#f2f2ee"), red: M("#e0352b"), brown: M("#5a3620"), coffee: M("#3b2414"), mug: M("#ffffff"),
  mugB: M("#f4a63a"), mugC: M("#1f8a8a"), pink: M("#ff9ccf"), dough: M("#d9a066"), wood: M("#8a5a35"),
  sofa: M("#a0566b"), sofaDark: M("#7e3f53"), cushion: M("#c27088"), chair: M("#f4a63a"), green: M("#3f9b4f", { flatShading: true }),
  pot: M("#c56a3c"), water: new THREE.MeshStandardMaterial({ color: "#8fd3ff", transparent: true, opacity: .55, roughness: .1 }),
  glass: new THREE.MeshStandardMaterial({ color: "#bfe8ff", transparent: true, opacity: .35, roughness: .1 }),
};
const plane = (w, h, tex) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: .9 }));
const note = (g, x, y, w, h, color, lines, rot, font) => {
  g.save(); g.translate(x + w / 2, y + h / 2); g.rotate(rot || 0);
  g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(-w / 2 + 6, -h / 2 + 6, w, h);
  g.fillStyle = color; g.fillRect(-w / 2, -h / 2, w, h);
  g.fillStyle = "#e0352b"; g.beginPath(); g.arc(0, -h / 2 + 12, 8, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#2b1d14"; g.textAlign = "center"; g.textBaseline = "middle"; g.font = font || "bold 26px 'Space Mono', monospace";
  lines.forEach((l, i) => g.fillText(l, 0, -h / 2 + 46 + i * 32));
  g.restore();
};

/* ======================= South wall: counter, microwave, coffee, sink, donuts ======================= */
const COUNTER_Z = 16.45, TOP_Y = .95;
safe(() => {
  box(6.1, .88, .75, mat.cabinet, -9.8, .44, COUNTER_Z);
  box(6.2, .07, .82, mat.top, -9.8, TOP_Y - .03, COUNTER_Z - .02);
  for (let i = 0; i < 6; i++) { box(.03, .7, .02, mat.dark, -12.6 + i * 1.0 + .5, .45, COUNTER_Z - .385); box(.18, .04, .04, mat.steel, -12.6 + i * 1.0 + .3, .7, COUNTER_Z - .4); }
  box(6.1, .1, .05, mat.dark, -9.8, .05, COUNTER_Z - .37); // kick plate
  // upper cabinets, left of the coffee machine only (the machine gets its sign)
  box(2.0, .6, .4, mat.cabinet, -12.0, 2.3, 16.65);
  box(1.6, .6, .4, mat.cabinet, -7.7, 2.3, 16.65);
  collide(-9.8, COUNTER_Z, 6.2, .82);
});

// microwave, with a sad note
safe(() => {
  box(.75, .45, .45, mat.fridge, -12.25, TOP_Y + .23, 16.5);
  box(.45, .32, .02, mat.dark, -12.35, TOP_Y + .23, 16.27);
  box(.14, .32, .02, mat.steel, -11.98, TOP_Y + .23, 16.27);
  const t = canvasTex(256, 128, g => note(g, 10, 6, 236, 116, "#fff27a", ["NO FISH.", "EVER. -Mgmt"], -.04, "bold 30px 'Space Mono', monospace"));
  const p = plane(.4, .2, t); p.position.set(-12.35, TOP_Y + .56, 16.26); p.rotation.y = Math.PI; FW.scene.add(p);
});

// THE COFFEE MACHINE: south wall, centred at x = -10
const COFFEE = { x: -10, z: 16.5 };
const coffeeLight = new THREE.Mesh(new THREE.SphereGeometry(.05, 10, 10), new THREE.MeshStandardMaterial({ color: "#222", emissive: "#ff5a3a", emissiveIntensity: .4 }));
const pour = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .5, 6), mat.coffee);
safe(() => {
  const y0 = TOP_Y;
  box(.7, .85, .5, mat.dark, COFFEE.x, y0 + .43, COFFEE.z);           // body
  box(.72, .12, .52, mat.red, COFFEE.x, y0 + .9, COFFEE.z);           // red top
  box(.5, .06, .12, mat.steel, COFFEE.x, y0 + .58, COFFEE.z - .27);   // spout bar
  box(.4, .03, .3, mat.steel, COFFEE.x, y0 + .03, COFFEE.z - .12);    // drip tray
  cyl(.11, .13, .26, mat.glass, COFFEE.x + .15, y0 + .16, COFFEE.z - .14);
  cyl(.1, .12, .1, mat.coffee, COFFEE.x + .15, y0 + .08, COFFEE.z - .14);
  cyl(.12, .12, .04, mat.dark, COFFEE.x + .15, y0 + .3, COFFEE.z - .14);
  coffeeLight.position.set(COFFEE.x - .22, y0 + .75, COFFEE.z - .255); FW.scene.add(coffeeLight);
  pour.position.set(COFFEE.x - .12, y0 + .3, COFFEE.z - .27); pour.visible = false; FW.scene.add(pour);
  // stack of paper cups
  for (let i = 0; i < 4; i++) cyl(.06, .045, .12, mat.mug, COFFEE.x + .55, y0 + .06 + i * .045, COFFEE.z - .05);
  const sign = FW.signPlane("COFFEE", "BREWED: MONDAY?", 1.1, .45, "#5a3620");
  // the south wall's inner face looks north (-z), so the sign is turned to face -z
  sign.position.set(COFFEE.x, 2.35, 16.84); sign.rotation.y = Math.PI; FW.scene.add(sign);
});

// sink with a pile of dirty mugs
safe(() => {
  const sx = -8.4;
  box(.8, .05, .5, mat.steel, sx, TOP_Y + .005, COUNTER_Z - .02);
  box(.66, .04, .38, mat.dark, sx, TOP_Y + .02, COUNTER_Z - .02);
  cyl(.03, .03, .35, mat.steel, sx, TOP_Y + .18, COUNTER_Z + .2);
  box(.04, .04, .22, mat.steel, sx, TOP_Y + .34, COUNTER_Z + .1);
  const mugs = [[-.18, 0, mat.mug], [.05, .08, mat.mugB], [.2, -.05, mat.mugC], [-.02, -.06, mat.mug], [.1, .02, mat.mugB]];
  mugs.forEach(([dx, dz, m], i) => {
    const y = TOP_Y + .1 + (i > 2 ? .13 : 0);
    const c = cyl(.06, .055, .14, m, sx + dx, y, COUNTER_Z - .02 + dz);
    c.rotation.z = i > 2 ? 1.2 : 0;
    if (i <= 2) cyl(.05, .05, .01, mat.coffee, sx + dx, y + .065, COUNTER_Z - .02 + dz);
  });
  const t = canvasTex(256, 160, g => note(g, 8, 8, 240, 144, "#ffd0e4", ["YOUR MOTHER", "DOESN'T WORK", "HERE."], .05, "bold 26px 'Space Mono', monospace"));
  const p = plane(.38, .24, t); p.position.set(sx, TOP_Y + .7, 16.84); p.rotation.y = Math.PI; FW.scene.add(p);
});

// donut box (open lid), 6 donuts that can be taken
const DONUT_SPOT = { x: -7.3, z: COUNTER_Z };
const donutGeo = new THREE.TorusGeometry(.07, .035, 8, 16);
const frostings = ["#ff7eb6", "#7a4a2a", "#fff1c9", "#7ad0ff", "#ffd23f", "#ff7eb6"].map(c => M(c));
const boxDonuts = [];
const makeDonut = (fm, parent) => {
  const g = new THREE.Group();
  const d = new THREE.Mesh(donutGeo, mat.dough); d.castShadow = true; g.add(d);
  const f = new THREE.Mesh(donutGeo, fm); f.scale.set(1.02, 1.02, .7); f.position.z = .02; g.add(f);
  FW.outline(d, .012);
  parent.add(g); return g;
};
safe(() => {
  const g = new THREE.Group(); g.position.set(DONUT_SPOT.x, TOP_Y, DONUT_SPOT.z); FW.scene.add(g);
  box(.62, .07, .42, mat.pink, 0, .035, 0, g);
  // lid hinged at the back edge, flipped up so its inside faces the room
  const lid = box(.62, .02, .42, mat.pink, 0, .07, .21, g);
  lid.geometry.translate(0, 0, .21); lid.rotation.x = -1.25;
  const t = canvasTex(256, 128, (c, w, h) => { c.fillStyle = "#ff9ccf"; c.fillRect(0, 0, w, h); c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle"; c.font = "40px Bungee, Impact, sans-serif"; c.fillText("DONUTS", w / 2, h / 2 - 12); c.font = "bold 20px 'Space Mono', monospace"; c.fillText("FROM: KEVIN (TAKE 1)", w / 2, h / 2 + 30); });
  const lbl = plane(.5, .25, t); lbl.position.set(0, .012, .21); lbl.rotation.set(-Math.PI / 2, 0, Math.PI); lid.add(lbl);
  for (let i = 0; i < 6; i++) {
    const dn = makeDonut(frostings[i], g);
    dn.rotation.x = -Math.PI / 2;
    dn.position.set(-.19 + (i % 3) * .19, .085, -.08 + Math.floor(i / 3) * .16);
    boxDonuts.push(dn);
  }
});

/* ======================= West wall: fridge, vending machine ======================= */
safe(() => {
  const fx = -12.45, fz = 13.3;
  box(.85, 2.0, .85, mat.fridge, fx, 1.0, fz);
  box(.04, .5, .06, mat.steel, fx + .44, 1.55, fz - .3);
  box(.04, .7, .06, mat.steel, fx + .44, .65, fz - .3);
  box(.02, .02, .85, mat.dark, fx + .43, 1.28, fz);
  const t = canvasTex(512, 1024, g => {
    note(g, 40, 30, 300, 190, "#fff27a", ["LABEL YOUR", "FOOD.", "— Management"], -.06, "bold 34px 'Space Mono', monospace");
    note(g, 250, 230, 230, 160, "#ffd0e4", ["WHO ATE", "MY YOGURT??"], .1);
    note(g, 30, 420, 260, 170, "#b6f0c8", ["Fridge cleaned", "FRIDAYS.", "Everything goes."], .04, "bold 24px 'Space Mono', monospace");
    note(g, 280, 470, 200, 140, "#bfe3ff", ["I can see", "you, Kevin."], -.08);
    note(g, 60, 690, 380, 150, "#fff27a", ["THIS IS NOT", "A STORAGE UNIT"], .03, "bold 32px 'Space Mono', monospace");
    note(g, 200, 860, 220, 130, "#ffd0e4", ["not ur milk"], -.12);
  });
  const p = plane(.8, 1.6, t); p.position.set(fx + .435, 1.0, fz); p.rotation.y = Math.PI / 2; FW.scene.add(p);
  collide(fx, fz, .9, .9);
});
safe(() => {
  const vx = -12.4, vz = 11.0;
  box(.95, 2.1, 1.15, mat.red, vx, 1.05, vz);
  const t = canvasTex(512, 1024, (g, w, h) => {
    g.fillStyle = "#222"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#ffd23f"; g.font = "86px Bungee, Impact, sans-serif"; g.textAlign = "center"; g.fillText("SNAX", w / 2 - 50, 100);
    g.fillStyle = "#cfe8f2"; g.fillRect(24, 130, 360, 720);
    const cols = ["#e0352b", "#ffd23f", "#3fae6a", "#7a5cff", "#f4a63a", "#1f8a8a", "#ff7eb6", "#8a5a35"];
    for (let r = 0; r < 5; r++) {
      g.fillStyle = "#8a9aa2"; g.fillRect(24, 250 + r * 140, 360, 10);
      for (let c = 0; c < 4; c++) {
        g.fillStyle = cols[(r * 3 + c * 5) % cols.length]; g.fillRect(40 + c * 86, 160 + r * 140, 64, 88);
        g.fillStyle = "rgba(255,255,255,.6)"; g.fillRect(48 + c * 86, 172 + r * 140, 14, 60);
      }
    }
    g.fillStyle = "#555"; g.fillRect(400, 300, 90, 200); g.fillStyle = "#7cff9a"; g.fillRect(410, 320, 70, 40);
    g.fillStyle = "#111"; g.fillRect(410, 380, 70, 20); g.fillRect(410, 420, 70, 20);
    g.fillStyle = "#111"; g.fillRect(40, 880, 340, 100);
    g.fillStyle = "#fff"; g.font = "bold 26px 'Space Mono', monospace"; g.fillText("OUT OF ORDER*", w / 2 - 50, 950);
    g.font = "bold 18px 'Space Mono', monospace"; g.fillText("*mostly", 440, 990);
  });
  const p = plane(.95 * .9, 2.0, t); p.position.set(vx + .485, 1.05, vz); p.rotation.y = Math.PI / 2; FW.scene.add(p);
  collide(vx, vz, 1.0, 1.2);
});

/* ======================= North wall: corkboard of memos ======================= */
safe(() => {
  const t = canvasTex(1024, 640, (g, w, h) => {
    g.fillStyle = "#c08a55"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(90,54,32,${Math.random() * .25})`; g.fillRect(Math.random() * w, Math.random() * h, 4, 4); }
    g.strokeStyle = "#6b4226"; g.lineWidth = 26; g.strokeRect(0, 0, w, h);
    note(g, 50, 50, 300, 220, "#fff", ["MANDATORY FUN", "Friday 4pm", "Attendance", "tracked."], -.05);
    note(g, 380, 40, 270, 170, "#fff27a", ["Coffee is for", "CLOSERS."], .06, "bold 30px 'Space Mono', monospace");
    note(g, 690, 60, 280, 230, "#bfe3ff", ["Invoices go in", "the IN TRAY,", "not the sink.", "— Accounts"], -.03, "bold 24px 'Space Mono', monospace");
    note(g, 70, 330, 280, 200, "#ffd0e4", ["LOST:", "red stapler.", "No questions."], .07);
    note(g, 400, 280, 260, 260, "#fff", ["DAYS SINCE", "LAST AUDIT:", "", "0"], -.04, "bold 28px 'Space Mono', monospace");
    note(g, 700, 340, 270, 180, "#b6f0c8", ["Brenda: back", "from lunch", "at ??:??"], .05);
  });
  const p = plane(2.6, 1.6, t); p.position.set(-10.3, 1.75, 9.17); FW.scene.add(p);
  box(2.7, 1.7, .05, mat.brown, -10.3, 1.75, 9.14);
});

// hanging sign just inside the doorway, readable from the main office
safe(() => {
  const s1 = FW.signPlane("BREAK ROOM", "COFFEE · DONUTS · GOSSIP", 1.6, .42, "#5a3620");
  s1.position.set(-6, 2.6, 9.5); s1.rotation.y = Math.PI; FW.scene.add(s1);
  const s2 = FW.signPlane("BREAK ROOM", "COFFEE · DONUTS · GOSSIP", 1.6, .42, "#5a3620");
  s2.position.set(-6, 2.6, 9.52); FW.scene.add(s2);
  cyl(.01, .01, .4, mat.dark, -6.6, 3.0, 9.51); cyl(.01, .01, .4, mat.dark, -5.4, 3.0, 9.51);
});

/* ======================= East side: sofa, water cooler, plant ======================= */
safe(() => {
  const sx = -.6, sz = 14.6;
  box(.9, .42, 2.5, mat.sofa, sx, .3, sz);
  box(.28, .9, 2.5, mat.sofaDark, sx + .36, .65, sz);
  box(.9, .62, .25, mat.sofaDark, sx, .4, sz - 1.25 - .02); box(.9, .62, .25, mat.sofaDark, sx, .4, sz + 1.25 + .02);
  const c1 = box(.6, .14, 1.1, mat.cushion, sx - .08, .58, sz - .58); c1.rotation.z = .04;
  const c2 = box(.6, .14, 1.1, mat.cushion, sx - .08, .56, sz + .58); c2.rotation.z = -.05; // saggy
  const pillow = box(.15, .4, .4, mat.chair, sx + .15, .82, sz + .8); pillow.rotation.x = .3;
  collide(sx, sz, 1.0, 2.8);
  // water cooler
  const wx = -.55, wz = 10.7;
  box(.45, 1.0, .45, mat.fridge, wx, .5, wz);
  cyl(.2, .2, .5, mat.water, wx, 1.27, wz);
  box(.06, .06, .06, mat.red, wx - .24, .8, wz - .1); box(.06, .06, .06, mat.cabinet, wx - .24, .8, wz + .1);
  collide(wx, wz, .55, .55);
  // plant in the corner
  cyl(.25, .2, .45, mat.pot, -.6, .23, 16.45);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(.45, 0), mat.green);
  leaves.position.set(-.6, .85, 16.45); leaves.scale.y = .8; leaves.rotation.z = .5; leaves.castShadow = true; FW.scene.add(leaves); FW.outline(leaves, .04);
  collide(-.6, 16.45, .55, .55);
});

/* ======================= Round table + chairs + Pam ======================= */
const TABLE = { x: -4.2, z: 13.2 };
const chairAt = (x, z, rotY) => {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; FW.scene.add(g);
  box(.5, .07, .5, mat.chair, 0, .5, 0, g);
  box(.5, .6, .07, mat.chair, 0, .82, -.24, g);
  [[-.2, -.2], [.2, -.2], [-.2, .2], [.2, .2]].forEach(([a, b]) => box(.05, .5, .05, mat.dark, a, .25, b, g));
  collide(x, z, .5, .5);
  return g;
};
safe(() => {
  cyl(.8, .8, .07, mat.wood, TABLE.x, .76, TABLE.z);
  cyl(.06, .06, .72, mat.dark, TABLE.x, .37, TABLE.z);
  cyl(.35, .4, .04, mat.dark, TABLE.x, .02, TABLE.z);
  collide(TABLE.x, TABLE.z, 1.4, 1.4);
  // chairs face the table; chair "front" is +z in its group (back at -z)
  chairAt(TABLE.x + 1.05, TABLE.z, -Math.PI / 2);   // Pam's chair (east), facing -x
  chairAt(TABLE.x - 1.05, TABLE.z + .1, Math.PI / 2 + .2);
  chairAt(TABLE.x + .1, TABLE.z - 1.05, .1);
  // table clutter: a mug, a magazine
  cyl(.06, .055, .13, mat.mugC, TABLE.x - .25, .86, TABLE.z + .2);
  const mag = box(.3, .02, .4, M("#ffd23f"), TABLE.x + .15, .805, TABLE.z - .2); mag.rotation.y = .4;
  // a warm lamp over the table
  cyl(.02, .02, .55, mat.dark, TABLE.x, 2.93, TABLE.z);
  cyl(.12, .4, .3, mat.mugB, TABLE.x, 2.52, TABLE.z);
  const l = new THREE.PointLight("#ffd9a0", .55, 7, 2); l.position.set(TABLE.x, 2.3, TABLE.z); FW.scene.add(l);
});

let pam = null, pamMug = null;
safe(() => {
  pam = FW.makeChar({ shirt: "#ff7eb6", pants: "#3b3b5c", skin: "#c68a5e", look: { hair: "bun", hairColor: "#e8c15a", glasses: true, mouth: "grin", brows: "raised", earrings: true }, name: "PAM · GOSSIP", tagColor: "#a0566b" });
  FW.seatPose(pam, false);
  pam.g.position.x = TABLE.x + 1.0; pam.g.position.z = TABLE.z;
  pam.g.rotation.y = -Math.PI / 2;
  pamMug = cyl(.06, .055, .13, mat.mug, 0, -.78, .1, pam.armR);
});

/* ======================= HUD chip ======================= */
const chip = document.createElement("div");
chip.style.cssText = "position:fixed;left:50%;bottom:150px;transform:translateX(-50%);background:#5a3620;color:#fff;" +
  "padding:6px 14px;border-radius:20px;border:3px solid #fff;box-shadow:0 4px 0 rgba(0,0,0,.4);font:700 14px 'Space Mono',monospace;" +
  "z-index:5;display:none;pointer-events:none;white-space:nowrap";
safe(() => document.body.appendChild(chip));
let chipText = "";
const setChip = txt => { if (txt === chipText) return; chipText = txt; chip.style.display = txt ? "block" : "none"; chip.textContent = txt; };

/* ======================= Held props + steam ======================= */
const player = FW.player;
const heldCup = new THREE.Group();
const heldDonut = new THREE.Group();
const steamGeo = new THREE.SphereGeometry(.05, 8, 8);
const makeSteam = (parent, n, y0) => {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(steamGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false }));
    m.position.y = y0; parent.add(m); arr.push({ m, off: i / n, y0, sx: (Math.random() - .5) * .06 });
  }
  return arr;
};
const animSteam = (arr, now, rise, strength) => {
  for (const s of arr) {
    const t = (now / 1000 * .7 + s.off) % 1;
    s.m.position.set(s.sx + Math.sin(now / 300 + s.off * 6) * .03, s.y0 + t * rise, 0);
    const k = .6 + t * 1.4; s.m.scale.set(k, k, k);
    s.m.material.opacity = strength * .55 * (1 - t) * Math.min(1, t * 4);
  }
};
let cupSteam = [], machineSteam = [];
safe(() => {
  if (!player) return;
  heldCup.position.set(-.52, 1.02, .16); heldCup.visible = false; player.g.add(heldCup);
  cyl(.07, .055, .17, mat.mug, 0, 0, 0, heldCup);
  cyl(.062, .062, .01, mat.coffee, 0, .08, 0, heldCup);
  box(.145, .05, .145, mat.brown, 0, -.01, 0, heldCup); // cardboard sleeve
  cupSteam = makeSteam(heldCup, 6, .1);
  heldDonut.visible = false; player.g.add(heldDonut);
  makeDonut(frostings[0], heldDonut);
  const mGroup = new THREE.Group(); mGroup.position.set(COFFEE.x + .15, TOP_Y + .34, COFFEE.z - .14); FW.scene.add(mGroup);
  machineSteam = makeSteam(mGroup, 5, 0);
});
// donuts that end up in Brenda's / Gus's / the boss's hands
const npcDonut = {};
safe(() => {
  const n = FW.npcs || {};
  [["clerk", n.clerk], ["inspector", n.inspector], ["boss", n.boss]].forEach(([k, ch]) => {
    if (!ch || !ch.armL) return;
    const g = new THREE.Group(); g.position.set(0, -.8, .14); g.rotation.x = Math.PI / 2 - .3; g.visible = false; ch.armL.add(g);
    makeDonut(frostings[1 + Object.keys(npcDonut).length], g);
    npcDonut[k] = { g, until: 0 };
  });
});

/* ======================= State ======================= */
const S = {
  caffUntil: 0, brewUntil: 0, lastPos: null, lastSus: 0, crashShown: true,
  holdingDonut: false, donutsLeft: 6, refillAt: 0, bribedInspector: false, cheerShown: false, lastPhase: "",
  giveCooldown: 0, gossipIdx: 0, pamChatterAt: 0, pamSipAt: 0, tells: [], hintsHeard: 0,
};
const CAFF_MS = 30000, SPEED_BONUS = .35, SUS_TAKEBACK = .5;
const caffeinated = now => now < S.caffUntil;

/* ======================= Hints ======================= */
const TELL_HINTS = {
  domain_mismatch: "Gus has been squinting at sender emails lately. Make the domain match the vendor.",
  unknown_vendor: "He's twitchy about vendors he's never heard of. Stick to real ones.",
  letterhead: "He compares logos now. A wrong letterhead is an instant flag.",
  bank_changed: "Changed bank details? He circles those first these days.",
  amount_unusual: "Big round amounts make him suspicious. Keep it boring.",
  total_mismatch: "He's started actually adding up the line items. Make the maths work.",
  altered: "The inspector hates whiteout lately. He holds invoices up to the light.",
  dup_number: "He remembers invoice numbers now. Never reuse one.",
  bad_po: "He's checking PO numbers against the system. Get them right.",
  stamp_wrong: "He's picky about stamps and signatures this week.",
  copy_gen: "Photocopies of photocopies? He spots the blur.",
  low_legibility: "Coffee stains used to hide stuff… he's onto that now.",
  heat: "Everyone says you look nervous. Grab a coffee, act natural.",
};
const BASE_HINTS = [
  "The boss checks the printer area every patrol. Grab your printout fast.",
  "The boss only sees what's in front of him. Walk behind him.",
  "He comes out of his office every 15 to 30 seconds. Wait for him to go back in.",
  "Coffee helps. Nobody suspects a caffeinated face.",
  "Gus goes soft for donuts. Just saying.",
  "Brenda's never at her desk, but she'll do anything for a donut.",
  "The boss loves donuts more than compliance. Toss him one and he stops to eat.",
];
// alternate: a hint about the latest tells, then one from the general pool
const nextHint = () => {
  const fresh = (S.tells || []).filter(t => TELL_HINTS[t]);
  const n = S.hintsHeard++;
  if (fresh.length && n % 2 === 0) return TELL_HINTS[fresh[(n / 2) % fresh.length]];
  return BASE_HINTS[S.gossipIdx++ % BASE_HINTS.length];
};
const PAM_CHATTER = ["Did you hear? Kevin microwaved fish. AGAIN.", "Dana's been here since 6am. Suspicious.", "I heard Brenda's lunch break started in 2019.",
  "The boss reads the memos. Nobody else does.", "This coffee tastes like printer toner.", "Psst. Come here. I know things."];

/* ======================= Interactions ======================= */
const nowMs = () => performance.now();
FW.addInteraction({
  label: () => caffeinated(nowMs()) ? "Top up your coffee" : "Grab a coffee",
  can: () => !FW.P.seated && nowMs() > S.brewUntil && FW.near({ x: COFFEE.x, z: 15.55 }, 1.25),
  act: () => safe(() => {
    const now = nowMs();
    S.brewUntil = now + 900;
    FW.P.frozenUntil = Math.max(FW.P.frozenUntil || 0, now + 800);
    pour.visible = true;
    FW.sfx("print");
    setTimeout(() => safe(() => {
      pour.visible = false;
      const was = caffeinated(nowMs());
      S.caffUntil = nowMs() + CAFF_MS; S.crashShown = false;
      heldCup.visible = true;
      FW.sfx("upgrade");
      FW.wtoast(was ? "Refill! Caffeinated for another 30s" : "CAFFEINATED: you walk faster and the boss gets suspicious slower (30s)", "good");
    }), 850);
  }),
});
FW.addInteraction({
  label: () => "Take a donut",
  can: () => !FW.P.seated && !S.holdingDonut && S.donutsLeft > 0 && FW.near({ x: DONUT_SPOT.x, z: DONUT_SPOT.z - .85 }, 1.15),
  act: () => safe(() => {
    S.donutsLeft--;
    const d = boxDonuts[S.donutsLeft]; if (d) d.visible = false;
    if (S.donutsLeft === 0) S.refillAt = nowMs() + 40000;
    S.holdingDonut = true; heldDonut.visible = true;
    FW.sfx("pickup");
    FW.wtoast("Donut acquired. Walk up to Brenda, the inspector… or the boss.", "");
  }),
});
FW.addInteraction({
  label: () => "Empty box. Just crumbs.",
  can: () => !FW.P.seated && !S.holdingDonut && S.donutsLeft === 0 && FW.near({ x: DONUT_SPOT.x, z: DONUT_SPOT.z - .85 }, 1.15),
  act: () => FW.wtoast("Someone (Kevin) will bring more. Probably.", ""),
});
FW.addInteraction({
  label: () => "Gossip with Pam",
  can: () => !!pam && !FW.P.seated && FW.near({ x: TABLE.x + 1.0, z: TABLE.z }, 1.7),
  act: () => safe(() => {
    const h = nextHint();
    FW.say(pam, `<small>*leans in*</small><br>"${h}"`, 5200);
    FW.sfx("huh");
    S.pamChatterAt = nowMs() + 15000;
  }),
});

/* ======================= Messages from the computer ======================= */
FW.onMessage(m => safe(() => {
  if (!m) return;
  if (m.type === "verdict") {
    if (Array.isArray(m.tells) && m.tells.length) { S.tells = m.tells.slice(0, 3); S.hintsHeard = 0; }
    if (S.bribedInspector && S.cheerShown) { S.bribedInspector = false; S.cheerShown = false; }
  }
}));

/* ======================= Donut hand-offs ======================= */
const npcs = FW.npcs || {};
const showNpcDonut = (k, ms) => { const d = npcDonut[k]; if (d) { d.g.visible = true; d.until = nowMs() + ms; } };
const dropHeldDonut = () => { S.holdingDonut = false; heldDonut.visible = false; S.giveCooldown = nowMs() + 1500; };
function tryGiveDonut(now) {
  if (!S.holdingDonut || now < S.giveCooldown || FW.P.seated || (FW.CINE && FW.CINE.active)) return;
  const CD = FW.CLERK_DESK, IT = FW.IN_TRAY, B = FW.B;
  // the boss (only while he's out on patrol)
  if (npcs.boss && npcs.boss.g.visible && B && B.state === "walk" && FW.near(npcs.boss.g.position, 1.6)) {
    dropHeldDonut(); showNpcDonut("boss", 4500);
    B.pauseUntil = Math.max(B.pauseUntil || 0, now + 4500);
    B.sus = 0;
    FW.say(npcs.boss, FW.pick(["Is that a BRIBE? …Confiscated. *munch*", "Donuts are for MEETINGS. *chews slowly*", "I'll allow it. This once. *crumbs*"]), 4000);
    FW.sfx("pickup"); FW.wtoast("The boss stops to eat your donut", "good");
    return;
  }
  // Brenda
  if (npcs.clerk && CD && (FW.near({ x: CD.x, z: CD.z + 1.2 }, 1.7) || FW.near(npcs.clerk.g.position, 1.9))) {
    dropHeldDonut(); showNpcDonut("clerk", 20000);
    FW.say(npcs.clerk, `"A DONUT? For ME? Hon, you're my favourite."<br><small>*whispers* ${nextHint()}</small>`, 6000);
    FW.sfx("cash"); FW.toOS("bribe", { target: "clerk" });
    return;
  }
  // Gus, the inspector
  if (npcs.inspector && IT && FW.P.phase !== "judging" && FW.near(IT, 2.4)) {
    dropHeldDonut(); showNpcDonut("inspector", 25000);
    S.bribedInspector = true; S.cheerShown = false;
    FW.say(npcs.inspector, FW.pick(["Is this… a sprinkle donut?! I — this is highly irregular. *nom*", "Mmm… pie… no, DONUT. Even better. *nom*", "I'm not allowed to accept gifts. *eats it anyway*"]), 4200);
    FW.sfx("cash"); FW.toOS("bribe", { target: "inspector" });
    FW.wtoast("Gus looks… happier. Maybe he'll go easy on the next one.", "good");
  }
}

/* ======================= Per-frame ======================= */
FW.onUpdate((dt, now) => {
  const P = FW.P, B = FW.B;
  if (!player || !P) return;
  const pos = player.g.position;
  const caff = caffeinated(now);

  // --- caffeine: faster walking (nudge along the actual movement, after world.js moved and collided us)
  if (!S.lastPos) S.lastPos = pos.clone();
  if (caff && !P.seated && now >= (P.frozenUntil || 0) && !(FW.CINE && FW.CINE.active)) {
    const dx = pos.x - S.lastPos.x, dz = pos.z - S.lastPos.z, d = Math.hypot(dx, dz);
    // ignore teleports (standing up, cut scenes); cap the nudge well under the 0.35 player radius so the next
    // collision pass in updatePlayer always resolves it on the right side of any wall
    if (d > 1e-4 && d < .5) {
      const extra = Math.min(d * SPEED_BONUS, .05);
      pos.x += dx / d * extra; pos.z += dz / d * extra;
    }
  }
  S.lastPos.copy(pos);

  // --- caffeine: the boss's suspicion fills slower (take back part of each increase)
  if (B && typeof B.sus === "number") {
    if (caff && B.sus > S.lastSus && B.sus < 1 && B.state === "walk") B.sus = S.lastSus + (B.sus - S.lastSus) * (1 - SUS_TAKEBACK);
    S.lastSus = B.sus;
  }

  // --- HUD chip + cup
  if (caff) {
    setChip(P.seated ? "" : `☕ CAFFEINATED ${Math.ceil((S.caffUntil - now) / 1000)}s`);
    animSteam(cupSteam, now, .35, 1);
    heldCup.position.set(-.52, 1.02 + Math.sin(now / 90) * .006, .16); // jittery hands
  } else {
    setChip("");
    if (heldCup.visible) heldCup.visible = false;
    if (!S.crashShown) { S.crashShown = true; FW.wtoast("Caffeine crash. Back to normal speed.", ""); }
  }
  heldDonut.position.set(caff ? -.32 : -.52, caff ? 1.3 : 1.05, caff ? .3 : .16);

  // --- coffee machine: light, steam
  const brewing = now < S.brewUntil;
  coffeeLight.material.emissiveIntensity = brewing ? (Math.sin(now / 70) > 0 ? 1.6 : .2) : .45;
  animSteam(machineSteam, now, .4, brewing ? 1.4 : .35);

  // --- donut box refill
  if (S.donutsLeft === 0 && S.refillAt && now > S.refillAt) {
    S.donutsLeft = 6; S.refillAt = 0; boxDonuts.forEach(d => { d.visible = true; });
    if (FW.near({ x: -6.5, z: 13 }, 7)) FW.wtoast("Kevin brought more donuts!", "good");
  }

  // --- donut hand-offs, NPC donuts disappear once eaten
  tryGiveDonut(now);
  for (const k in npcDonut) { const d = npcDonut[k]; if (d.g.visible && now > d.until) d.g.visible = false; }

  // --- bribed inspector: cheerful close-up line once you drop the next envelope
  if (P.phase !== S.lastPhase) {
    if (P.phase === "judging" && S.bribedInspector && !S.cheerShown && npcs.inspector) {
      S.cheerShown = true;
      FW.say(npcs.inspector, FW.pick(["Ah, my donut friend! Let's see what you've got~", "Still tasting those sprinkles. Let me see, buddy!", "For you? I'll read it with my HAPPY glasses."]), 2400);
    }
    S.lastPhase = P.phase;
  }

  // --- Pam: sips her mug, chatters when you're around
  if (pam) {
    const sip = (now % 7000) / 7000;
    pam.armR.rotation.x = sip > .85 ? -1.9 + Math.sin((sip - .85) / .15 * Math.PI) * -.1 : -.6;
    pam.armL.rotation.x = -.5;
    if (now > S.pamChatterAt && FW.near(pam.g.position, 5) && !P.seated) {
      S.pamChatterAt = now + FW.rand(14000, 22000);
      FW.say(pam, FW.pick(PAM_CHATTER), 3200);
    }
  }
});

})();
