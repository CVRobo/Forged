/* security-bot.js: see PLUGINS.md. Builds on window.FW from world.js.
 *
 * LEVEL 4's SECOND ROAMER: GUARD-B0T, the bank's little hovering security drone.
 *  - It patrols the main office on its own loop (the printer side and the east side, by
 *    Gus's booth and the clerk), pausing at corners to scan. Only on levels whose rules
 *    say `securityBot` (level 4).
 *  - Its cyan cone sweeps side to side. Walls and closed doors block it (FW.sightBlocked).
 *  - Same suspicion meter as the boss: carrying the slip in its cone fills it, and so does
 *    the slip sitting at the printer. Full = +10 heat (the printer: once per print, shared
 *    with the boss through B.printerBusted).
 *  - The boss's planner also draws its next ~20 s (FW.roamer.predict, used by boss-office.js).
 */
(() => {
"use strict";
const FW = window.FW;
if (!FW) return;
const { THREE, M, box, cyl, sphere, canvasTex, B, P } = FW;
const player = FW.player;

const SPEED = 1.25, PAUSE = 1.2;            // m/s; seconds it stops to scan at each corner
const R = 4.6, HALF = .5, SWEEP = .55;      // cone reach, half-angle, how far it sweeps either side
const RATE = 1.7;                            // suspicion per second while it sees something
// its loop: along the printer side, then around Gus's booth and the clerk, and back up the middle aisle
const ROUTE = [[-.3, -6.5], [-6.6, -6.5], [-.3, -6.5], [4.6, -6.5], [4.6, -2.2], [11, -2.2], [11, 6.3], [-.3, 6.3]];
const PRINTER_TRAY = { x: FW.PRINTER.x, z: FW.PRINTER.z + .55 };

/* ---------- the model ---------- */
const g = new THREE.Group(); g.visible = false; FW.scene.add(g);
const rig = new THREE.Group(); g.add(rig); // bobs up and down
const shell = M("#1d3557"), pink = new THREE.MeshBasicMaterial({ color: "#e0352b" }), cyan = new THREE.MeshBasicMaterial({ color: "#ffb300" }); // "pink" = alert red, "cyan" = calm amber
const bodyM = sphere(.42, shell, 0, 1.0, 0, rig); bodyM.scale.set(1, .85, 1);
box(.86, .08, .86, M("#c9a227"), 0, .9, 0, rig).scale.set(1, 1, 1);           // glowing belt
box(.56, .2, .1, M("#05010a"), 0, 1.12, .38, rig);                    // visor
const eyes = [-.12, .12].map(x => { const e = new THREE.Mesh(new THREE.BoxGeometry(.09, .09, .02), cyan); e.position.set(x, 1.12, .44); rig.add(e); return e; });
cyl(.3, .32, .14, M("#0f1b2d"), 0, 1.36, 0, rig);                     // security cap
box(.5, .03, .2, M("#0f1b2d"), 0, 1.3, .3, rig);                        // its peak
box(.09, .09, .02, M("#c9a227"), 0, 1.38, .3, rig);                     // badge
cyl(.015, .015, .2, M("#9aa0a6"), 0, 1.52, 0, rig);
const bulb = new THREE.Mesh(new THREE.SphereGeometry(.06, 10, 8), pink.clone()); bulb.position.set(0, 1.66, 0); rig.add(bulb);
cyl(.2, .28, .18, shell, 0, .5, 0, rig);                               // neck to the hover base
const base = new THREE.Mesh(new THREE.CircleGeometry(.42, 24), new THREE.MeshBasicMaterial({ color: "#ffb300", transparent: true, opacity: .45, depthWrite: false }));
base.rotation.x = -Math.PI / 2; base.position.y = .03; g.add(base);
// name tag
const tagTex = canvasTex(256, 48, (c, w, h) => {
  c.fillStyle = "#1d3557"; c.fillRect(0, 0, w, h); c.strokeStyle = "#c9a227"; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4);
  c.fillStyle = "#c9a227"; c.font = "bold 26px 'Space Mono', monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("GUARD-B0T", w / 2, h / 2 + 1);
});
const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex })); tag.scale.set(1.1, .21, 1); tag.position.y = 2.0; g.add(tag);
// its vision cone (flat on the floor, in its own group so it can sweep)
const coneMat = new THREE.MeshBasicMaterial({ color: "#ffb300", transparent: true, opacity: .18, depthWrite: false, side: THREE.DoubleSide });
const cone = new THREE.Mesh(new THREE.CircleGeometry(R, 28, -Math.PI / 2 - HALF, HALF * 2), coneMat);
cone.rotation.x = -Math.PI / 2; cone.position.y = .045; FW.scene.add(cone); cone.visible = false;

const me = { g, scale: .75 }; // for FW.say: its speech bubble floats just above it

/* ---------- state ---------- */
const bot = { i: 1, pauseUntil: 0, sus: 0, busted: false, facing: 0, look: 0, t: 0, frozenUntil: 0, nextBeat: 0, was: false };
g.position.set(ROUTE[0][0], 0, ROUTE[0][1]);
const active = () => !!(FW.level && FW.level().securityBot) && P.started;

function sees(x, z) {
  const p = g.position, vx = x - p.x, vz = z - p.z;
  if (Math.hypot(vx, vz) > R) return false;
  let a = Math.atan2(vx, vz) - bot.look; a = Math.atan2(Math.sin(a), Math.cos(a));
  return Math.abs(a) < HALF && !FW.sightBlocked(p.x, p.z, x, z);
}

function update(dt, now) {
  const on = active() && B.state !== "drill";
  g.visible = cone.visible = !!(FW.level && FW.level().securityBot) && B.state !== "drill";
  if (!on) { if (bot.sus) { bot.sus = 0; FW.setSus(B.sus || 0); } return; }
  bot.t += dt;
  // move along the loop (stopping at corners, or while it's busy "reporting" you)
  if (now >= bot.pauseUntil && now >= bot.frozenUntil) {
    const [tx, tz] = ROUTE[bot.i], dx = tx - g.position.x, dz = tz - g.position.z, d = Math.hypot(dx, dz);
    if (d < .05) { bot.i = (bot.i + 1) % ROUTE.length; bot.pauseUntil = now + PAUSE * 1000; }
    else {
      const step = Math.min(d, SPEED * dt);
      g.position.x += dx / d * step; g.position.z += dz / d * step;
      const want = Math.atan2(dx, dz);
      let da = want - bot.facing; da = Math.atan2(Math.sin(da), Math.cos(da));
      bot.facing += da * Math.min(1, dt * 6);
    }
  }
  // the cone sweeps (faster while it's stopped to scan)
  const scanning = now < bot.pauseUntil;
  bot.look = bot.facing + Math.sin(bot.t * (scanning ? 2.6 : 1.4)) * SWEEP;
  g.rotation.y = bot.look;
  rig.position.y = Math.sin(bot.t * 3) * .05;
  bulb.material.color.set(Math.sin(bot.t * 6) > 0 ? "#e0352b" : "#4a0f0c"); // the siren light
  if (FW.shapeCone) FW.shapeCone(cone, g.position.x, g.position.z, bot.look, R, HALF); // stops at walls, like the boss's
  else { cone.position.x = g.position.x; cone.position.z = g.position.z; cone.rotation.z = bot.look; }

  // what it notices
  if (!P.carrying) bot.busted = false; // a fresh carry is a fresh chance
  const you = P.carrying && !P.seated && !bot.busted && sees(player.g.position.x, player.g.position.z);
  const slip = (P.envelopeReady || P.printing) && !B.printerBusted && sees(PRINTER_TRAY.x, PRINTER_TRAY.z);
  if ((you || slip) && now >= bot.frozenUntil) {
    if (bot.sus === 0) { FW.say(me, "<b>BEEP?</b>", 1000); FW.sfx("huh"); }
    bot.sus += dt * RATE;
    if (bot.sus >= 1) {
      bot.sus = 0; bot.frozenUntil = now + 2400;
      if (you) {
        bot.busted = true; P.frozenUntil = Math.max(P.frozenUntil || 0, now + 2400);
        FW.say(me, "UNAUTHORIZED PAPERWORK DETECTED. REPORTING.", 2400);
        FW.wtoast("The guard bot scanned your envelope! +10 heat", "bad");
      } else {
        B.printerBusted = true;
        FW.say(me, "UNATTENDED DOCUMENT AT PRINTER. LOGGED.", 2400);
        FW.wtoast("The guard bot logged your slip at the printer! +10 heat", "bad");
      }
      FW.toOS("heat", { amount: 10 });
      FW.sfx("busted"); P.shake = .3; FW.flashVignette();
    }
  } else bot.sus = Math.max(0, bot.sus - dt * .8);
  // shares the boss's meter: whichever of them is more suspicious
  FW.setSus(Math.max(bot.sus, B.sus || 0));
  if (bot.sus > 0 && !(B.sus > 0) && now > bot.nextBeat) { FW.sfx("heart"); bot.nextBeat = now + 520 - bot.sus * 240; }
  coneMat.color.set(bot.sus > 0 || now < bot.frozenUntil ? "#e0352b" : "#ffb300");
  coneMat.opacity = .16 + bot.sus * .3;
  eyes.forEach(e => e.material = bot.sus > 0 ? pink : cyan);
}
FW.onUpdate(update);

/* ---------- the planner (boss-office.js) and the minimap ---------- */
// its next `secs` seconds as points { x, z, t } every `step` metres, corner pauses included
function predict(secs, step = .55, now = performance.now()) {
  const out = [];
  let x = g.position.x, z = g.position.z, t = Math.max(0, (Math.max(bot.pauseUntil, bot.frozenUntil) - now) / 1000), i = bot.i, carry = step * .5;
  for (let n = 0; n < 40 && t < secs; n++) {
    const [tx, tz] = ROUTE[i], dx = tx - x, dz = tz - z, seg = Math.hypot(dx, dz);
    let k = carry;
    while (k <= seg && t + k / SPEED < secs) { out.push({ x: x + dx / seg * k, z: z + dz / seg * k, t: t + k / SPEED, a: Math.atan2(-dz, dx) }); k += step; }
    carry = k - seg; t += seg / SPEED + PAUSE; x = tx; z = tz; i = (i + 1) % ROUTE.length;
  }
  return out;
}
FW.roamer = { active: () => active() && g.visible, predict, bot, group: g, R, HALF, cone }; // features.js draws it on the minimap

FW.onMinimap && FW.onMinimap((c, mx, mz) => {
  if (!g.visible) return;
  c.fillStyle = "#ffb300"; c.beginPath(); c.arc(mx(g.position.x), mz(g.position.z), 4.5, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#1d3557"; c.font = "bold 7px sans-serif"; c.textAlign = "center"; c.fillText("S", mx(g.position.x), mz(g.position.z) + 2.5);
});
})();
