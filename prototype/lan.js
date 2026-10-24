/* lan.js: LAN multiplayer, for up to 4 players (the owner included) in one office.
 * serve.py hosts the room at ws://<host>/lan; lan_room.py has its rules and
 * docs/superpowers/specs/2026-10-24-lan-multiplayer-design.md the design. This file:
 *   - adds LAN game to the Clock in card: your name, who's here and the address to share
 *     (open the page with ?lan to go straight there)
 *   - sends where you are 10 times a second and draws everyone else, in their own look
 *   - shares the desks (FW.assignDesks, FW.onDeskChange), verdicts, standings (hold Tab) and Gus's brain
 *   - the owner's browser walks the boss and rolls the fire drills; everyone else mirrors them
 * Debug from the console: forgedLan.state(), forgedLan.leave()
 */
(() => {
"use strict";
const FW = window.FW;
if (!FW) return;
const { P, B, player } = FW;
const { boss, inspector } = FW.npcs;
const $ = s => document.querySelector(s);
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const param = k => { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } };
const API = param("api") || ""; // with a server, the server shares Gus and this file leaves him alone
const NAME_KEY = "forged-player"; // the leaderboard name, shared with menu.js and game.js
const SEND_MS = 100, PING_MS = 5000, MAX = 4;
// the room gives everyone their own colour (lan_room.py), worn as the shirt and the name tag: red, blue, green, purple
const COLORS = ["#e0352b", "#2f6fd6", "#1d9a4b", "#8e44ad"];
const colorOf = p => COLORS[p && p.color] || COLORS[0];
const FRESH_BRAIN = { version: 1, learned: {}, memory: [] };
// a private address means a LAN game; a public one (a hosting service or a tunnel) is an online game
const ON_LAN = !location.hostname || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$|^\[?::1\]?$/.test(location.hostname);
const MODE = ON_LAN ? "LAN game" : "Online game";
const r2 = v => Math.round(v * 100) / 100;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// status: off | connecting | in | full | nohost | lost | left
const lan = { ws: null, status: "off", id: null, owner: null, share: "", players: [], brains: {}, deskKey: "", wanted: 0, ready: false, applying: false };
const avatars = new Map(); // player id → { ch, env, name, desk, look, tx, tz, ry, sp, f, placed, seated }
const inRoom = () => lan.status === "in";
const isOwner = () => inRoom() && lan.owner === lan.id;
const me = () => lan.players.find(p => p.id === lan.id);
const send = msg => { if (lan.ws && lan.ws.readyState === 1) lan.ws.send(JSON.stringify(msg)); };
function myName() { try { return (localStorage.getItem(NAME_KEY) || "").trim(); } catch (e) { return ""; } }

/* ======================= Lobby: on the Clock in card ======================= */

const card = $("#start .start-card");
const lanBtn = document.createElement("button");
lanBtn.id = "btn-lan"; lanBtn.type = "button"; lanBtn.textContent = `👥 ${MODE}`;
($("#btn-customize") || $("#btn-start")).insertAdjacentElement("afterend", lanBtn);
const panel = document.createElement("div");
panel.id = "lan-panel";
panel.innerHTML = `
  <div class="lan-head"><b>${MODE}</b><span id="lan-status"></span></div>
  <label class="lan-name">Your name <input id="lan-name" maxlength="16" spellcheck="false" autocomplete="off" placeholder="Forger"></label>
  <ol id="lan-list"></ol>
  <div id="lan-note"></div>
  <button type="button" id="lan-leave">Leave the room</button>`;
lanBtn.insertAdjacentElement("afterend", panel);
const nameInput = $("#lan-name");
nameInput.value = myName();

const chip = document.createElement("div"); // in the office: a small card under the HUD
chip.id = "lan-chip"; chip.className = "hud-card"; chip.style.display = "none";
$("#hud").appendChild(chip);

function showPanel(on) { panel.classList.toggle("show", on); if (card) card.classList.toggle("lan-open", on); }
lanBtn.addEventListener("click", e => {
  e.stopPropagation();
  const open = !panel.classList.contains("show");
  showPanel(open);
  if (open && !lan.ws && !inRoom()) connect();
});
$("#lan-leave").addEventListener("click", () => leaveRoom("left"));
nameInput.addEventListener("change", () => {
  const name = nameInput.value.trim().slice(0, 16);
  try { localStorage.setItem(NAME_KEY, name); } catch (e) {}
  if (name) send({ t: "name", name });
});
// clocking in during a LAN game: start next to your own desk, not on top of everyone else
$("#btn-start").addEventListener("click", () => {
  if (!inRoom()) return;
  player.g.position.set(FW.MY_DESK.x, 0, FW.MY_DESK.z + 2.2); player.g.rotation.y = Math.PI;
});

const STATUS = { connecting: "Connecting…", full: "This office is full: all 4 desks are taken.", nohost: "No LAN host at this address.",
  lost: "Lost the host.", left: "You left the room." };
function setStatus(s) { lan.status = s; renderLobby(); renderChip(); }
function renderLobby() {
  const owner = lan.players.find(p => p.id === lan.owner);
  $("#lan-status").textContent = inRoom() ? `${lan.players.length}/${MAX} here` : STATUS[lan.status] || "";
  $("#lan-list").innerHTML = !inRoom() ? "" : lan.players.map(p => `
    <li style="--color:${colorOf(p)}"><span class="lan-desk">${p.desk}</span>
      <span class="lan-who">${esc(p.name)}${p.id === lan.owner ? " 👑" : ""}${p.id === lan.id ? " <i>(you)</i>" : ""}</span>
      <span class="lan-where">${p.started ? "in the office" : "at the door"}</span></li>`).join("");
  $("#lan-note").innerHTML = inRoom()
    ? `${ON_LAN ? "Friends on your network open" : "Friends anywhere can open"} <b>${esc(lan.share || location.origin + "/?lan")}</b>. Clock in whenever you like.${owner ? ` 👑 ${esc(owner.name)} owns the room: the boss follows their game.` : ""}`
    : lan.status === "nohost" ? `To host, run <code>python3 serve.py</code> in the <code>prototype</code> folder and open the address it prints. Up to ${MAX} players, you included.`
    : lan.status === "full" ? "Try again when someone leaves." : "";
  $("#lan-leave").style.display = inRoom() ? "" : "none";
  lanBtn.textContent = inRoom() ? `👥 ${MODE} · ${lan.players.length}/${MAX}` : `👥 ${MODE}`;
}
function renderChip() {
  chip.style.display = inRoom() ? "" : "none";
  if (inRoom()) chip.innerHTML = `<span class="lan-dot" style="background:${colorOf(me())}"></span>` +
    `<b>${ON_LAN ? "LAN" : "Online"}</b> · ${lan.players.length}/${MAX} · desk ${FW.MY_DESK.n}${isOwner() ? " · 👑" : ""}`;
}

/* ======================= Connection ======================= */

function connect() {
  if (lan.ws) return;
  if (!/^https?:$/.test(location.protocol)) return setStatus("nohost");
  let ws;
  try { ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/lan`); } catch (e) { return setStatus("nohost"); }
  lan.ws = ws; setStatus("connecting");
  ws.onopen = () => send({ t: "hello", name: myName(), look: FW.getLook() });
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (err) { return; }
    try { onMessage(m); } catch (err) { console.error("[lan] message failed", m && m.t, err); }
  };
  ws.onclose = () => {
    if (lan.ws !== ws) return;
    lan.ws = null;
    if (inRoom()) leaveRoom("lost");
    else if (lan.status === "connecting") setStatus("nohost");
  };
}

function onMessage(m) {
  if (m.t === "welcome") return enterRoom(m);
  if (m.t === "full") return setStatus("full");
  if (!inRoom()) return;
  if (m.t === "players") applyRoster(m);
  else if (m.t === "snap") applySnap(m);
  else if (m.t === "verdict") showVerdict(m);
  else if (m.t === "brain") onBrain(m);
  else if (m.t === "bust") onBust(m);
  else if (m.t === "drill" && window.forgedFeatures) forgedFeatures.fireDrill(); // the owner's fire drill runs here too
}

function enterRoom(m) {
  Object.assign(lan, { id: m.id, share: m.share || "", brains: { ...(m.brains || {}) }, ready: false });
  lan.status = "in";
  P.live = true; // a shared office never pauses (world.js)
  const mine = (m.players || []).find(p => p.id === m.id);
  // the room named you if you hadn't picked a name: keep it, so the boards know which row is yours
  if (mine && !myName()) { try { localStorage.setItem(NAME_KEY, mine.name); } catch (e) {} nameInput.value = mine.name; }
  applyRoster(m);
  pushBrain();
  if (mine) FW.wtoast(`You're in the ${MODE.toLowerCase()}, at desk ${mine.desk}`, "good");
}

function leaveRoom(why) {
  const ws = lan.ws, was = inRoom();
  lan.ws = null;
  if (ws) { ws.onclose = null; try { ws.close(); } catch (e) {} }
  for (const id of [...avatars.keys()]) dropAvatar(id);
  Object.assign(lan, { id: null, owner: null, players: [], brains: {}, deskKey: "", wanted: 0, ready: false });
  bossAt.have = false;
  Object.assign(B, { remote: false, faceAt: null }); // this browser walks the boss again
  P.live = false;
  setStatus(why);
  wearMyColor(); // your own shirt again
  if (!was) return;
  lan.applying = true;
  try { FW.assignDesks({ [FW.MY_DESK.n]: "You" }, FW.MY_DESK.n); } finally { lan.applying = false; } // the coworkers come back
  ForgedMenu.setRoom(null);
  if (!API) FW.toOS("gus-solo");
  if (why === "lost") FW.wtoast(`Lost the ${ON_LAN ? "LAN host" : "server"}: you're playing solo now`, "bad");
}

/* ======================= Who's here, and at which desk ======================= */

function applyRoster(m) {
  const first = !lan.ready, wasOwner = isOwner();
  lan.players = Array.isArray(m.players) ? m.players : [];
  lan.owner = m.owner;
  const here = new Set(lan.players.map(p => p.id));
  for (const [id, a] of [...avatars]) if (!here.has(id)) { FW.wtoast(`${a.name} left the office`); dropAvatar(id); }
  for (const p of lan.players) {
    if (p.id === lan.id) continue;
    if (!avatars.has(p.id)) {
      avatars.set(p.id, makeAvatar(p));
      if (!first) FW.wtoast(`${p.name} joined, at desk ${p.desk}`, "good");
    }
    syncAvatar(avatars.get(p.id), p);
  }
  lan.ready = true;
  syncDesks(m);
  wearMyColor();
  setBossAuthority(first, wasOwner);
  ForgedMenu.setRoom(lan.players);
  renderLobby(); renderChip();
}

// everyone's desks, with "You" at yours: world.js sends the coworkers away and moves your chair
function syncDesks(m) {
  const mine = me();
  if (!mine) return;
  let desk = mine.desk;
  if (lan.wanted) {
    if (m.refused === lan.wanted) { FW.wtoast(`Someone beat you to desk ${lan.wanted}`, "bad"); lan.wanted = 0; }
    else if (desk === lan.wanted) lan.wanted = 0;
    else desk = lan.wanted; // our move is still on its way to the room: don't snap back yet
  }
  const map = {};
  for (const p of lan.players) if (p.id !== lan.id) map[p.desk] = p.name;
  map[desk] = "You";
  const key = JSON.stringify(map);
  if (key === lan.deskKey && desk === FW.MY_DESK.n) return;
  lan.deskKey = key;
  lan.applying = true;
  try { FW.assignDesks(map, desk); } finally { lan.applying = false; }
}
// you took a free desk with E (world.js): ask the room, which answers with everyone's desks
FW.onDeskChange(d => {
  renderChip();
  if (!inRoom() || lan.applying) return;
  lan.wanted = d.n;
  send({ t: "desk", n: d.n });
});

/* ======================= The other players ======================= */

const envMat = FW.M("#f2e2b8"); // the order slip they carry (world.js's envelope colour)
// their look from Customize, in their room colour, so no two players look alike
const wornLook = p => Object.assign({}, FW.DEFAULT_LOOK, p.look || {}, { shirt: colorOf(p) });
const lookKey = p => JSON.stringify(p.look || {}) + colorOf(p);
function makeAvatar(p) {
  const L = wornLook(p);
  const ch = FW.makeChar({ shirt: L.shirt, pants: L.pants, skin: L.skin, tie: L.tie, name: p.name, tagColor: colorOf(p),
    look: { hair: L.hair, hairColor: L.hairColor, brows: L.brows, mouth: L.mouth, nose: L.nose, glasses: L.glasses, earrings: L.earrings, mustache: L.mustache } });
  ch.g.visible = false;
  const env = FW.box(.5, .03, .32, envMat, 0, -.74, .16, ch.armR);
  env.rotation.set(Math.PI / 2, 0, .25); env.visible = false;
  return { id: p.id, ch, env, name: p.name, color: colorOf(p), look: lookKey(p), tx: 0, tz: 0, ry: 0, sp: 0, f: 0, placed: false, seated: false };
}
function syncAvatar(a, p) {
  if (lookKey(p) !== a.look) { a.look = lookKey(p); FW.restyleChar(a.ch, wornLook(p)); }
  if (p.name !== a.name || colorOf(p) !== a.color) { a.name = p.name; a.color = colorOf(p); FW.setTag(a.ch, p.name, a.color); }
}
// you wear your room colour too: on screen only, your saved look in Customize is left alone
let wornKey = "";
function wearMyColor() {
  const mine = me(), look = FW.getLook(), key = mine ? JSON.stringify(look) + colorOf(mine) : "";
  if (key === wornKey) return;
  wornKey = key;
  FW.dressPlayer(mine ? { ...look, shirt: colorOf(mine) } : look);
}
function dropAvatar(id) {
  const a = avatars.get(id);
  if (!a) return;
  if (a.ch.g.parent) a.ch.g.parent.remove(a.ch.g);
  const i = FW.characters.indexOf(a.ch);
  if (i >= 0) FW.characters.splice(i, 1);
  avatars.delete(id);
}

function applySnap(m) {
  for (const [id, x, z, ry, sp, f] of m.p || []) {
    const a = avatars.get(id);
    if (!a) continue; // you, or someone the roster hasn't introduced yet
    Object.assign(a, { tx: x, tz: z, ry, sp, f });
    if (!a.placed) { a.ch.g.position.set(x, 0, z); a.ch.g.rotation.y = ry; a.placed = true; }
  }
  if (m.b && !isOwner()) mirrorSnap(m.b);
}

function updateAvatar(a, dt, now) {
  const g = a.ch.g, on = a.placed && !!(a.f & 4); // clocked in
  g.visible = on;
  if (!on) return;
  const seated = !!(a.f & 1), carrying = !!(a.f & 2);
  const dx = a.tx - g.position.x, dz = a.tz - g.position.z;
  if (dx * dx + dz * dz > 16) { g.position.x = a.tx; g.position.z = a.tz; } // a jump: no sliding across the office
  else { const k = Math.min(1, dt * 12); g.position.x += dx * k; g.position.z += dz * k; }
  g.rotation.y += wrap(a.ry - g.rotation.y) * Math.min(1, dt * 12);
  if (seated !== a.seated) { a.seated = seated; if (seated) FW.seatPose(a.ch, true); else FW.standPose(a.ch); }
  if (seated) { a.ch.armL.rotation.x = -1.1 + Math.sin(now / 85 + a.id) * .1; a.ch.armR.rotation.x = -1.1 + Math.cos(now / 95 + a.id) * .1; }
  else { FW.animWalk(a.ch, dt, a.sp); if (carrying) a.ch.armR.rotation.x = -.7; }
  a.env.visible = carrying && !seated;
  a.ch.tag.visible = FW.camera.position.distanceTo(g.position) > 3.2;
}

/* ======================= The boss: the owner's browser walks him, everyone else follows ======================= */

function setBossAuthority(first, wasOwner) {
  if (!isOwner()) { B.remote = true; return; }
  if (!B.remote) return;
  B.remote = false; B.faceAt = null; // the owner left: this browser walks him on from where he is
  if (B.state === "wait") B.t = Math.min(B.t, FW.rand(6, 14));
  if (!first && !wasOwner) FW.wtoast("👑 You own the room now: the boss follows your game", "good");
}

const bossAt = { x: 0, z: 0, ry: 0, cx: 0, cz: 0, mv: false, have: false };
function mirrorSnap(b) {
  const now = performance.now();
  if (b.st !== B.state) {
    if (b.st === "walk" && B.state === "wait") { B.warned = B.chatted = B.busted = false; B.sus = 0; FW.sfx("door"); } // he's heading out
    B.state = b.st;
  }
  B.i = b.i;
  if (b.pz > 0) B.pauseUntil = Math.max(B.pauseUntil, now + b.pz);
  boss.g.visible = !!b.vis;
  Object.assign(bossAt, { x: b.x, z: b.z, ry: b.ry, mv: b.mv });
  if (!bossAt.have || b.st === "wait" || Math.hypot(b.x - bossAt.cx, b.z - bossAt.cz) > 4) { bossAt.cx = b.x; bossAt.cz = b.z; boss.g.rotation.y = b.ry; }
  bossAt.have = true;
}
function mirrorBoss(dt) {
  if (!bossAt.have || B.state === "wait") return; // at his desk: boss-office.js seats him
  const k = Math.min(1, dt * 10);
  bossAt.cx += (bossAt.x - bossAt.cx) * k; bossAt.cz += (bossAt.z - bossAt.cz) * k;
  boss.g.position.x = bossAt.cx; boss.g.position.z = bossAt.cz; // last word every frame, after features.js's drill walk
  boss.g.rotation.y += wrap(bossAt.ry - boss.g.rotation.y) * k;
  FW.animWalk(boss, dt, bossAt.mv ? 1.7 : 0);
}

let bossSent = 0, bossPrev = null, bossState = B.state;
function sendBoss(now) {
  if (B.state === "drill" && bossState !== "drill") send({ t: "drill" }); // a fire drill: everyone runs it
  bossState = B.state;
  if (now - bossSent < SEND_MS) return;
  const p = boss.g.position, mv = !!bossPrev && Math.hypot(p.x - bossPrev.x, p.z - bossPrev.z) > .01;
  bossSent = now; bossPrev = { x: p.x, z: p.z };
  send({ t: "boss", x: r2(p.x), z: r2(p.z), ry: r2(wrap(boss.g.rotation.y)), vis: boss.g.visible, st: B.state, i: B.i,
    pz: Math.max(0, Math.round(B.pauseUntil - now)), mv });
}
function onBust(m) { // the owner: the boss caught another player with their slip, so he stops on everyone's screen
  B.pauseUntil = Math.max(B.pauseUntil, performance.now() + 2800);
  B.faceAt = { x: m.x, z: m.z };
  FW.say(boss, `${esc(m.name)}! What's in the envelope?!`, 2600);
}
let bustSeen = 0;
function watchBust() { // guests: world.js stamps B.bustedAt when the boss catches you; the owner's boss has to stop too
  if (!B.bustedAt || B.bustedAt === bustSeen) return;
  bustSeen = B.bustedAt;
  if (B.remote) send({ t: "bust", x: r2(player.g.position.x), z: r2(player.g.position.z) });
}

/* ======================= Verdicts, standings and Gus ======================= */

let hud = null, scoreKey = "";
FW.onMessage(m => {
  if (m.type === "hud") hud = m;
  if (!inRoom()) return;
  if (m.type === "verdict") send({ t: "verdict", caught: !!m.caught, payout: +m.payout || 0, scheme: String(m.scheme || ""), line: String(m.line || "") });
  if (m.type === "gus-learned") taught(m);
  if (m.type === "hud") {
    const key = `${m.money}|${m.patches}|${m.round}`;
    if (key !== scoreKey) { scoreKey = key; send({ t: "score", money: m.money, patches: m.patches || 0, round: m.round || 0 }); }
    pushBrain();
  }
});

function showVerdict(m) {
  const a = avatars.get(m.id);
  // your own verdict on screen comes first: theirs still goes on the corkboard, the TV and a toast
  if (!FW.CINE.active && P.phase !== "judging") {
    FW.say(inspector, `<span class="stamp">${m.caught ? "CAUGHT" : "APPROVED"}</span><b>${esc(m.name)}</b>: "${esc(m.line)}"`, 5000, m.caught ? "flagged" : "paid");
    P.stampAt = performance.now();
  }
  FW.pinVerdict({ caught: !!m.caught, scheme: m.scheme, vendor: m.name });
  FW.wtoast(m.caught ? `${m.name} got caught` : `${m.name} got away with ${FW.money(m.payout)}`, m.caught ? "bad" : "good");
  if (a && a.ch.g.visible) FW.say(a.ch, m.caught ? FW.pick(["Ugh!", "Busted…", "He's good."]) : FW.pick(["Ka-ching!", "Too easy.", "Payday!"]), 2200);
}

const roomBrain = level => lan.brains[level] || FRESH_BRAIN;
// the room's Gus for the shop you're playing: game.js swaps it in for yours (and never saves it over yours)
function pushBrain() {
  if (API || !hud || !inRoom()) return;
  const b = roomBrain(hud.level);
  if (!hud.lanBrain || hud.version !== b.version) FW.toOS("gus-brain", { level: hud.level, ...b });
}
// your win taught Gus: tell the room, and count it here already so the hud that follows matches
function taught(m) {
  if (API) return;
  const b = JSON.parse(JSON.stringify(roomBrain(m.level)));
  b.version += 1;
  for (const [t, n] of Object.entries(m.tells || {})) b.learned[t] = (b.learned[t] || 0) + n;
  b.memory = [...b.memory, ...(m.memory || [])].slice(-40);
  lan.brains[m.level] = b;
  send({ t: "learned", level: m.level, tells: m.tells || {}, memory: m.memory || [] });
}
function onBrain(m) {
  const before = roomBrain(m.level).version, mine = me();
  lan.brains[m.level] = m.brain;
  if (m.by && (!mine || m.by !== mine.name) && m.brain.version > before && hud && hud.level === m.level)
    FW.wtoast(`${m.by} fooled ${hud.inspector || "Gus"}: he's studying the trick (v${m.brain.version})`);
  pushBrain();
}

/* ======================= Every frame: you out, everyone else in ======================= */

let sentAt = 0, pingAt = 0, stateKey = "", lastPos = null, sentLook = "", lookAt = 0;
function sendState(now) {
  if (now - sentAt < SEND_MS) return;
  const pos = player.g.position;
  const sp = lastPos ? Math.min(9, Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z) / Math.max(.05, (now - sentAt) / 1000)) : 0;
  sentAt = now; lastPos = { x: pos.x, z: pos.z };
  const f = (P.seated ? 1 : 0) | (P.carrying ? 2 : 0) | (P.started ? 4 : 0);
  const s = { t: "state", x: r2(pos.x), z: r2(pos.z), ry: r2(wrap(player.g.rotation.y)), sp: Math.round(sp * 10) / 10, f };
  const key = `${s.x}|${s.z}|${s.ry}|${s.sp}|${f}`;
  if (key === stateKey && now - pingAt < PING_MS) return;
  stateKey = key; pingAt = now;
  send(s);
}
function watchLook(now) { // changed your look in Customize: show the others
  if (now < lookAt) return;
  lookAt = now + 1000;
  const look = FW.getLook(), key = JSON.stringify(look);
  if (sentLook && key !== sentLook) send({ t: "look", look });
  sentLook = key;
  wearMyColor(); // Customize just dressed you in your own shirt: back into your room colour
}

FW.onUpdate((dt, now) => {
  if (!inRoom()) return;
  for (const a of avatars.values()) updateAvatar(a, dt, now);
  if (isOwner()) sendBoss(now); else mirrorBoss(dt);
  watchBust();
  watchLook(now);
  sendState(now);
});
// a background tab draws no frames: keep it in the room anyway
setInterval(() => { if (inRoom() && performance.now() - pingAt > PING_MS) { pingAt = performance.now(); send({ t: "ping" }); } }, PING_MS);

window.forgedLan = {
  state: () => ({ status: lan.status, id: lan.id, owner: lan.owner, desk: FW.MY_DESK.n, bossRemote: B.remote,
    players: lan.players.map(p => `${p.desk}:${p.name}${p.started ? "*" : ""}`), avatars: avatars.size, brains: lan.brains }),
  leave: () => leaveRoom("left"),
};
renderLobby();
if (param("lan") !== null) { showPanel(true); connect(); }
})();
