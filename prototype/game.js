/* Forged — UI/UX prototype.
 * Online-order fraud (see docs/online-fraud-redesign.md); the content and the
 * IEEE-CIS row builder are in orders.js.
 * No AI anywhere: the inspector verdict, clerk replies and memo are canned/mock
 * so the desk can be played and judged on feel alone. Everything the real
 * backend would replace is marked "MOCK".
 */
(() => {
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = arr => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]);
const money = n => "$" + Math.round(n).toLocaleString("en-US");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* When this page runs inside the 3D office (index.html), it is the screen of
 * the player's computer: submitting prints the envelope in the world, and the
 * world tells us when it was delivered or when the boss walks behind us. */
const EMBED = window.parent !== window;
const post = (type, data = {}) => { if (EMBED) parent.postMessage({ src: "forged-os", type, ...data }, "*"); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ======================= Backend API =======================
 * Point the game at a server with ?api=http://localhost:8000 on os.html or on
 * index.html (the office passes it through). With no API set, or if a call
 * fails or times out, every feature falls back to the offline mocks below.
 * The adapters (adaptVerdict, the clerk and round handlers) accept a few
 * field-name variants until docs/contracts.md is final. */
const API = (() => {
  const from = loc => { try { return new URLSearchParams(loc.search).get("api") || ""; } catch (e) { return ""; } };
  return (from(location) || (EMBED ? from(parent.location) : "") || window.FORGED_API || "").replace(/\/$/, "");
})();
async function api(method, path, body, ms = 6000) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(API + path, { method, signal: ctl.signal,
      headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`${method} ${path} → HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}
let offlineWarned = false;
function offline(err) {
  console.warn("[forged] API call failed, using the offline mock:", err && err.message || err);
  if (!offlineWarned) { offlineWarned = true; toast("Inspector server unreachable — playing offline", "bad"); }
}

/* ======================= Content =======================
 * The order content (shops, cards, plan cards, ranks, the IEEE-CIS row builder
 * and the scripted Gus) lives in orders.js as window.ForgedOrders. */

const O = window.ForgedOrders;
const price = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const LEVELS = {
  1: {
    name: "Sunny Diner Supply", short: "Sunny Diner", icon: "🥞", difficulty: "Easy",
    swatches: ["#f4a63a", "#1f8a8a", "#fff6e2"],
    inspector: { name: "Gus", personality: "Cheerful fraud robot, easily distracted by pie" },
    clerk: { name: "Brenda", avatar: "🥪", quirk: "always on lunch break",
      hello: "Sunny Diner support, Brenda speaking. Make it quick hon, my sandwich is getting warm.",
      keywords: ["lunch", "quick", "sandwich", "fast", "easy", "pie"],
      replies: {
        good: ["Oh that's fine, sure, I'll push it through after lunch.", "Short and sweet. I like you.", "Lunch AND a nice note? Approved-ish."],
        meh: ["Uh-huh. Sure. Whatever. *chews*", "Is this gonna take long? Because lunch.", "I'll… look at it. Later. Maybe."],
        bad: ["That's a LOT of words for a Tuesday.", "Hon, I'm on break. Why is this so long?", "This smells fishy. Or is that my tuna?"],
      } },
    memo: O.MEMOS[1],
    lines: {
      idle: ["Mmm… pie. Oh! Send me whatever.", "Is it lunch yet? Orders are so boring.", "I flagged my own lunch order once."],
      pass: ["Looks like a regular! Approved.", "Yep! Totally normal customer!", "Such a loyal shopper. APPROVED."],
      catch: ["Hey… wait a minute.", "Hold on…", "Nice try!"],
    },
  },
  2: {
    name: "St. Mercy Pharmacy", short: "St. Mercy", icon: "🏥", difficulty: "Medium",
    swatches: ["#9fd8c4", "#2f6fd6", "#ffffff"],
    inspector: { name: "Ms. Procedure", personality: "Procedural fraud robot, reads every order in a monotone" },
    clerk: { name: "Theo", avatar: "😰", quirk: "terrified of the manager",
      hello: "St. Mercy patient support. H-hi. Is this approved? Does the manager know about this?",
      keywords: ["manager", "approved", "policy", "signed", "urgent", "compliance"],
      replies: {
        good: ["Oh thank goodness, if it's approved I won't get yelled at.", "Policy-compliant? Bless you.", "The manager signed? Okay. Okay okay okay."],
        meh: ["I… I guess? Please don't tell anyone I asked.", "Should I forward this to the manager? No? Okay.", "*sweats nervously* Sure."],
        bad: ["The manager is going to SEE this. I can't.", "This doesn't feel like policy…", "Oh no. Oh no no no."],
      } },
    memo: O.MEMOS[2],
    lines: {
      idle: ["Please submit orders in triplicate.", "I have read the fraud handbook four times.", "Procedure is a comfort."],
      pass: ["Order complete. Approved.", "Compliant. Moving on.", "This meets section 4.2. Approved."],
      catch: ["Irregularity detected.", "Non-compliant.", "That violates procedure."],
    },
  },
  3: { name: "Port Nocturne Shipping", short: "Port Nocturne", icon: "🚢", difficulty: "Hard", swatches: ["#1d2a44", "#ff9a2e", "#f4efe6"], inspector: { name: "Old Salt", personality: "Gruff, remembers everything" }, locked: true },
  4: { name: "Neon Arcade Holdings", short: "Neon Arcade", icon: "🕹️", difficulty: "Boss", swatches: ["#ff2bd6", "#19e3ff", "#120014"], inspector: { name: "GL1TCH", personality: "Paranoid, flags anything unusual" }, locked: true },
};

/* Every plan the player sends gets a name for the corkboard and the collection,
 * e.g. "👵 Grandma's account · 🧪 Test the card". Filled in as plans are made. */
const SCHEMES = {};

const PERKS = [
  { id: "cookies", ico: "🍪", name: "Cookie Jar", desc: "New devices look familiar to Gus.", cost: 600 },
  { id: "patience", ico: "⏳", name: "Patience", desc: "Cards never die while you wait.", cost: 500 },
  { id: "night", ico: "🌙", name: "Night Shift", desc: "Double pay, more suspicion.", cost: 900 },
  { id: "redraw", ico: "🔄", name: "Lucky Draw", desc: "Redraw your hand once per round.", cost: 400 },
  { id: "smooth", ico: "😎", name: "Smooth Talker", desc: "Support chat works better.", cost: 500 },
  { id: "shred", ico: "🗑️", name: "Paper Shredder", desc: "One caught trick is not learned.", cost: 1200 },
];

const UNLOCKS = [
  { id: "neighbor", ico: "🏡", name: "The Neighbor", desc: "New disguise: shops from next door.", cost: 800 },
  { id: "clone", ico: "📱", name: "The Phone Clone", desc: "New disguise: their account, their phone.", cost: 900 },
  { id: "dossier", ico: "📂", name: "Dossier", desc: "Reveals the fake memo rule next round.", cost: 600, consumable: true },
];

const INSPECTOR_STAGES = [
  { upTo: 3, emoji: "😴", prop: "📎", title: "Sleepy Intern" },
  { upTo: 6, emoji: "🧐", prop: "🔍", title: "Clerk with a Magnifier" },
  { upTo: 9, emoji: "🕵️", prop: "🔦", title: "Auditor with a UV Lamp" },
  { upTo: 99, emoji: "🤖", prop: "🧿", title: "Cyborg with a Monocle" },
];

/* which blank of the plan to circle in the forensic replay, per tell */
const TELL_REGION = {
  email_risky: "who", email_mismatch: "who", yahoo: "who", new_card: "who", foreign_card: "who", ip_far: "who", proxy: "who",
  emulator: "who", new_device: "who", device_reuse: "who", device_mobile: "who",
  far_ship: "where", new_address: "where", gift_card: "what", amount_unusual: "what",
  amount_jump: "trick", velocity: "trick", night: "when", friday: "when",
};
const TELL_LABELS = O.TELL_LABELS;

/* ======================= Player rank =======================
 * Saved across runs. Each round gives XP (more when it works); every rank adds
 * one more blank to the plan, so a new player starts with two choices. */
const XP_KEY = "forged.xp";
const loadXp = () => {
  const q = loc => { try { return +new URLSearchParams(loc.search).get("rank"); } catch (e) { return 0; } };
  const forced = q(location) || (EMBED ? q(parent.location) : 0); // ?rank=5 on either page to test a rank
  if (forced >= 1 && forced <= O.RANKS.length) return O.RANKS[forced - 1].xp;
  try { return +localStorage.getItem(XP_KEY) || 0; } catch (e) { return 0; }
};
const saveXp = () => { try { localStorage.setItem(XP_KEY, String(S.xp)); } catch (e) { /* only this visit */ } };
const rank = () => O.rankFor(S.xp);

/* ======================= Dossier ======================= */

const DOSSIER_ENTRIES = {
  "heat-basics":     { icon: "🔥", title: "Heat",              text: "Risky cards and getting caught raise your heat. Above 40 % Gus gets suspicious of everything. Heat cools down between rounds." },
  "version-bump":    { icon: "🧠", title: "Gus Learns",        text: "Every time Gus catches you, he remembers what gave you away and watches for it harder. Keep changing your plan." },
  "memo-deduction":  { icon: "📝", title: "Memo Rules",        text: "Two of the three memo rules are real: Gus actually watches for those. The third is a decoy." },
  "shop-intro":      { icon: "🛒", title: "The Shop",          text: "Between rounds you can buy perks and new disguises. Perks last the whole run (3 max)." },
  "route-goods":     { icon: "📦", title: "Get the Goods",     text: "WHERE decides who gets the loot. Cousin's garage is close to the victim, the overseas warehouse is safe but far, and gift card codes go to your secret inbox." },
  "boss-patrol":     { icon: "🕴️", title: "The Boss",          text: "The boss patrols the office. If he walks behind your desk, press Space to hide the screen. In the office, keep the envelope out of his sight." },
  "tells-explained": { icon: "🔍", title: "What Gus Checks",   text: "Who's buying, from where, what, when, and how fast. The blank that gave you away glows red after a catch." },
  "streak-bonus":    { icon: "🔥", title: "Streaks",           text: "Getting away with it several rounds in a row builds a streak. Changing your plan keeps it alive." },
  "campaigns":       { icon: "🃏", title: "Tricks",            text: "A trick turns one order into a few: test the card with $1 first, warm it up with a normal buy, or come back next week. Gus checks every order, and one catch blocks the card." },
  "persuasion":      { icon: "😎", title: "Support Chat",      text: "The support agent has a quirk (shown in the window header). A short note that plays to it lowers Gus's suspicion." },
};

const DOSSIER_STORAGE = "forged-dossier";
const DOSSIER_SEEN_STORAGE = "forged-dossier-seen";
let dossierUnlocked = (() => { try { return new Set(JSON.parse(localStorage.getItem(DOSSIER_STORAGE)) || []); } catch { return new Set(); } })();
let dossierSeen = (() => { try { return new Set(JSON.parse(localStorage.getItem(DOSSIER_SEEN_STORAGE)) || []); } catch { return new Set(); } })();

function saveDossier() { try { localStorage.setItem(DOSSIER_STORAGE, JSON.stringify([...dossierUnlocked])); } catch {} }
function saveDossierSeen() { try { localStorage.setItem(DOSSIER_SEEN_STORAGE, JSON.stringify([...dossierSeen])); } catch {} }

function unlockDossierEntry(id) {
  if (!DOSSIER_ENTRIES[id] || dossierUnlocked.has(id)) return false;
  dossierUnlocked.add(id); saveDossier();
  updateDossierBadge();
  toast(`📂 New dossier entry: ${DOSSIER_ENTRIES[id].title}`, "dossier");
  return true;
}

function updateDossierBadge() {
  const btn = $("#btn-dossier");
  if (!btn) return;
  const unseen = [...dossierUnlocked].filter(id => !dossierSeen.has(id)).length;
  let badge = $(".dossier-badge", btn);
  if (unseen > 0) {
    if (!badge) { badge = document.createElement("span"); badge.className = "dossier-badge"; btn.appendChild(badge); }
    badge.textContent = unseen;
  } else if (badge) badge.remove();
}

function renderDossier() {
  const panel = $("#dossier-entries");
  if (!panel) return;
  // mark all unlocked as seen
  dossierUnlocked.forEach(id => dossierSeen.add(id));
  saveDossierSeen(); updateDossierBadge();
  const total = Object.keys(DOSSIER_ENTRIES).length;
  const locked = total - dossierUnlocked.size;
  panel.innerHTML = Object.entries(DOSSIER_ENTRIES).map(([id, e]) => {
    if (dossierUnlocked.has(id)) return `<div class="dossier-entry"><span class="dossier-icon">${e.icon}</span><div><b>${e.title}</b><p>${e.text}</p></div></div>`;
    return `<div class="dossier-entry dossier-locked"><span class="dossier-icon">❓</span><div><b>???</b><p>Play more to discover this entry.</p></div></div>`;
  }).join("") + (locked > 0 ? `<div class="dossier-footer">${locked} more to discover</div>` : `<div class="dossier-footer">All entries unlocked!</div>`);
}

/* ======================= Progressive Tips ======================= */

const TIPS_STORAGE = "forged-tips-seen";
let tipsSeen = (() => { try { return new Set(JSON.parse(localStorage.getItem(TIPS_STORAGE)) || []); } catch { return new Set(); } })();
function saveTips() { try { localStorage.setItem(TIPS_STORAGE, JSON.stringify([...tipsSeen])); } catch {} }

function showTip(id, text, dossierEntryId) {
  if (tipsSeen.has(id)) return;
  tipsSeen.add(id); saveTips();
  toast(text, "tip");
  if (dossierEntryId) unlockDossierEntry(dossierEntryId);
}

/* ======================= State ======================= */

const S = {
  level: 1, round: 0, money: 0, heat: 0, version: 1,
  perks: [], unlocks: [], dossier: false, shredUsed: false,
  history: [], cards: [], caughtCount: 0, streak: 0,
  hist: null, learned: {}, session: null, // what Gus remembers this run, and how often he learned each tell from you
  xp: 0, rankUp: null, // the player's rank (saved), and a rank reached this round
  // per round
  scheme: null, holder: null, inv: null, plan: {}, hands: {}, active: null, redrawn: false, persuasion: 0,
  memo: [], submitted: false, bossTimer: null, bossWindow: false, rows: null,
  roundId: null, // from POST /round/start; null when offline
  patches: 0, shame: [], // retrains this run caused, and what each one learned
};
S.xp = loadXp();

/* ======================= Sound (tiny WebAudio synth) ======================= */

let actx = null, sfxOut = null;
// the office's sound settings (audio.js: M / [ / ]) live in localStorage, shared with this page
function soundSettings() {
  try { const s = JSON.parse(localStorage.getItem("forged.audio.v1") || "null"); if (s) return { muted: !!s.muted, vol: +s.vol || 0 }; } catch (e) {}
  return { muted: false, vol: .7 };
}
function sfx(kind) {
  const snd = soundSettings();
  if (snd.muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (!sfxOut) { sfxOut = actx.createGain(); sfxOut.connect(actx.destination); }
    sfxOut.gain.value = Math.min(1, snd.vol / .7); // .7 is the default volume, which plays at full level
    const t = actx.currentTime;
    const tone = (f, d, type = "square", v = .08, f2 = null, at = 0) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t + at);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + at + d);
      g.gain.setValueAtTime(v, t + at); g.gain.exponentialRampToValueAtTime(.0001, t + at + d);
      o.connect(g).connect(sfxOut); o.start(t + at); o.stop(t + at + d);
    };
    const noise = (d, v = .2, at = 0) => {
      const b = actx.createBuffer(1, actx.sampleRate * d, actx.sampleRate), ch = b.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
      const s = actx.createBufferSource(), g = actx.createGain(); s.buffer = b; g.gain.value = v;
      s.connect(g).connect(sfxOut); s.start(t + at);
    };
    ({
      click: () => tone(660, .06, "square", .04),
      pick: () => tone(520, .08, "triangle", .08, 780),
      squirt: () => noise(.18, .12),
      splash: () => { noise(.3, .15); tone(180, .2, "sine", .1, 90); },
      stamp: () => { noise(.08, .5); tone(90, .15, "sine", .3, 50); },
      copy: () => { tone(110, .9, "sawtooth", .03, 140); noise(.9, .04); },
      snip: () => { noise(.05, .3); noise(.05, .3, .09); },
      pen: () => tone(900, .15, "sine", .03, 1300),
      chunk: () => { noise(.12, .5); tone(70, .25, "square", .15, 40); },
      scan: () => tone(300, .9, "sawtooth", .03, 900),
      cash: () => { tone(988, .1, "square", .07); tone(1319, .35, "square", .07, null, .1); },
      buzz: () => { tone(110, .5, "sawtooth", .12, 80); },
      steps: () => { [0, .35, .7, 1.05].forEach(a => tone(70, .1, "sine", .2, 50, a)); },
      whoosh: () => noise(.3, .1),
      msg: () => tone(880, .08, "sine", .05, 1100),
      bad: () => tone(200, .2, "square", .06, 120),
    })[kind]?.();
  } catch (e) { /* audio is optional */ }
}

/* ======================= Stage scaling ======================= */

const stage = $("#stage");
let scale = 1;
function fit() {
  const vp = $("#viewport");
  scale = Math.min(vp.clientWidth / 1600, vp.clientHeight / 900);
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
}
addEventListener("resize", fit); fit();
if (EMBED) {
  // inside the 3D office: the outbox is a printer and the inspector is down the hall
  document.body.classList.add("embedded");
  $(".outbox-label").textContent = "PRINT — drop the envelope here, then deliver it";
  $("#insp-win-title").textContent = "Printer · Gus down the hall";
  $(".env-label").textContent = "DRAG TO PRINT";
  $("#envelope").title = "Drag me onto PRINT";
  $("#btn-quit").textContent = "Quit to title";
}
function toStage(cx, cy, el = stage) {
  const r = el.getBoundingClientRect();
  return { x: (cx - r.left) / scale, y: (cy - r.top) / scale };
}

/* ======================= Screens & overlays ======================= */

function show(id) {
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === "screen-" + id));
}
function overlay(id, on = true) { $("#overlay-" + id).classList.toggle("show", on); }

function toast(text, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind; t.textContent = text;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 2700);
}

document.addEventListener("click", e => {
  const go = e.target.closest("[data-go]");
  if (go) { sfx("click"); if (go.dataset.go === "levels") renderLevels(); show(go.dataset.go); }
  const mn = e.target.closest("[data-menu]");
  if (mn) { sfx("click"); openMenu(mn.dataset.menu); }
  const cl = e.target.closest("[data-close]");
  if (cl) { sfx("click"); cl.closest(".overlay").classList.remove("show"); }
});

/* ======================= Level select ======================= */

function renderLevels() {
  $("#level-cards").innerHTML = Object.entries(LEVELS).map(([n, L]) => `
    <button class="level-card ${L.locked ? "locked" : ""}" data-level="${n}"
      style="--lc-desk:${L.swatches[0]};--lc-paper:#fffaf0;--lc-ink:#1b1b1b">
      <div class="lc-art"><span class="lc-num">LEVEL ${n}</span>${L.icon}</div>
      <div class="lc-body">
        <div class="lc-name">${L.name}</div>
        <div><span class="lc-diff">${L.difficulty}</span></div>
        <div class="lc-row"><b>Inspector:</b> ${L.inspector.name}</div>
        <div class="lc-row" style="opacity:.75">${L.inspector.personality}</div>
        <div class="lc-swatches">${L.swatches.map(c => `<i style="background:${c}"></i>`).join("")}</div>
      </div>
      ${L.locked ? `<div class="lc-lock">COMING SOON</div>` : ""}
    </button>`).join("");
  $$(".level-card").forEach(c => c.onclick = () => {
    if (c.classList.contains("locked")) { sfx("bad"); toast("Stretch level — not built yet", "bad"); return; }
    sfx("pick"); startRun(+c.dataset.level);
  });
}

/* ======================= Run / round flow ======================= */

function startRun(level) {
  Object.assign(S, { level, round: 0, money: 0, heat: 0, version: 1, perks: [], unlocks: [], dossier: false,
    shredUsed: false, history: [], cards: [], caughtCount: 0, streak: 0, patches: 0, shame: [],
    hist: O.newHistory(), learned: {}, session: "s" + Date.now().toString(36), holder: null, xp: loadXp(), rankUp: null });
  stage.dataset.level = level;
  $("#desk-mess").innerHTML = "";
  const L = LEVELS[level];
  $("#tb-level").textContent = L.name;
  $("#case-client").textContent = O.SHOPS[level].domain;
  $("#memo-to").textContent = L.inspector.name;
  $("#clerk-avatar").innerHTML = faceSVG(LOOKS.clerk);
  $("#clerk-name").textContent = L.clerk.name;
  $("#clerk-sub").textContent = "Customer support · " + L.clerk.quirk;
  $("#clerk-quirk").textContent = "quirk: " + L.clerk.quirk;
  show("desk");
  nextRound();
}

function nextRound() {
  S.round++;
  S.heat = Math.round(S.heat * 0.6);
  const prev = S.holder; // a new stolen card every round
  Object.assign(S, { scheme: null, inv: null, plan: {}, hands: {}, active: null, redrawn: false, persuasion: 0, submitted: false,
    printed: false, delivered: false, lastResult: null, rows: null, holder: pick(O.HOLDERS.filter(h => h !== prev)) });
  $("#tb-round").textContent = S.round;
  $("#invoice").innerHTML = ""; $("#invoice").className = "paper plan";
  $("#strip").innerHTML = "";
  $("#scheme-banner").textContent = "";
  $("#chat").innerHTML = ""; $("#persuade-fill").style.width = "0%";
  $("#envelope").classList.remove("printed");
  dealMemo();
  renderInspector();
  startPlanning();
  startRoundOnServer();
}

/* POST /round/start: real memo (decoy hidden) and inspector version. The mock
 * memo stays on screen until (and unless) the server answers. */
async function startRoundOnServer() {
  S.roundId = null;
  if (!API) return;
  const round = S.round;
  try {
    const r = await api("POST", "/round/start", { level: S.level, player: playerName() });
    if (S.round !== round) return; // the player already moved on
    S.roundId = r.round_id ?? r.roundId ?? null;
    if (Array.isArray(r.memo) && r.memo.length) {
      // `real` is never shown directly: only the Dossier unlock reveals the decoy
      S.memo = r.memo.map(m => typeof m === "string" ? { text: m } : { text: m.text ?? m.rule, tell: m.tell ?? m.feature, real: m.real })
        .map(m => ({ ...m, mark: null }));
      renderMemo();
    }
    const v = +(r.inspector_version ?? r.version);
    if (Number.isFinite(v) && v > 0) { S.version = v; renderInspector(); updateHud(); }
    if (r.case_file) S.serverCaseFile = r.case_file; // TODO: render once the case file shape is in docs/contracts.md
  } catch (e) { offline(e); }
}

function dealMemo() {
  const L = LEVELS[S.level];
  const reals = shuffle(L.memo.filter(m => m.real)).slice(0, 2);
  const decoy = pick(L.memo.filter(m => !m.real));
  S.memo = shuffle([...reals, decoy]).map(m => ({ ...m, mark: null }));
  renderMemo();
}

function renderMemo() {
  const reveal = S.dossier;
  $("#memo-rules").innerHTML = S.memo.map((m, i) => `
    <li data-i="${i}" class="${m.mark || ""} ${reveal && m.real === false ? "revealed-decoy" : ""}">${m.text}${m.mark ? `<span class="mark">${m.mark.toUpperCase()}</span>` : ""}</li>`).join("");
  $$("#memo-rules li").forEach(li => li.onclick = () => {
    const m = S.memo[li.dataset.i];
    m.mark = m.mark === null ? "real" : m.mark === "real" ? "fake" : null;
    sfx("pen"); renderMemo();
    showTip("first-memo-mark", "📝 One memo rule is fake — figure out which to break it safely.", "memo-deduction");
  });
}

/* the victim: whose card is on your desk this round. More detail as you rank up */
function renderCaseFile() {
  const h = S.holder, r = rank();
  if (!h) { $("#case-body").innerHTML = ""; return; }
  const phone = h.phone === "iphone" ? "an iPhone" : "an Android phone";
  $("#case-body").innerHTML = `
    <div class="victim">
      <div class="victim-face">${h.phone === "iphone" ? "🧑‍🦰" : "🧔"}</div>
      <div><div class="victim-name">${h.name}</div><div class="victim-city">📍 ${h.city}</div></div>
    </div>
    <ul class="victim-facts">
      <li>💳 Their card is on your desk.</li>
      ${r.n >= 2 ? `<li>📱 Always shops from ${phone}.</li><li>📧 ${h.email}</li>` : ""}
      ${r.n >= 3 ? `<li>🛒 People here spend about ${price(O.SHOPS[S.level].typical)}.</li>` : ""}
    </ul>`;
}
function hideSchemeTip() { $("#scheme-tip").classList.remove("show"); }

/* ======================= The plan =======================
 * One sentence with blanks. The glowing blank's hand of cards is dealt into
 * the dock; picking a card fills it and moves on. The orders Gus scores (and
 * the data rows) are built from the plan behind the scenes. */

const SLOT_WORDS = { who: "I'll pose as", what: "and buy", when: "at", where: "then send it to", trick: "with the trick" };
const SLOT_ICO = { who: "🎭", what: "🛒", when: "⏰", where: "📦", trick: "🃏" };
const SLOT_ASK = { who: "Who do you pretend to be?", what: "What do you buy?", when: "When?", where: "Where does it go?", trick: "Any trick?" };
const factsOf = o => O.facts(S.level, S.holder, o, { perks: S.perks });
const campaignTotal = () => S.inv ? S.inv.orders.reduce((a, o) => a + factsOf(o).amount, 0) : 0;
const planReady = () => !!S.plan && rank().slots.every(sl => S.plan[sl]);

function cardFor(slot, id) {
  if (slot === "what") { const i = O.itemOf(O.SHOPS[S.level], { sku: id }); return { id, ico: i.ico, name: i.name, line: price(i.price) }; }
  return O.find({ who: O.PERSONAS, when: O.WHENS, where: O.WHERES, trick: O.TRICKS }[slot], id);
}

function startPlanning() {
  const L = LEVELS[S.level], r = rank();
  S.inv = { orders: [], cur: 0, coverEmail: "" };
  dealAll();
  S.active = r.slots[0];
  // fewer windows for new players: the support chat and the memo arrive with the ranks
  $("#win-clerk").classList.toggle("win-off", !r.windows.includes("clerk"));
  $("#win-memo").classList.toggle("win-off", !r.windows.includes("memo"));
  $("#win-case").style.top = r.windows.includes("memo") ? "352px" : "76px"; // the victim moves up while there's no memo
  renderCaseFile();
  rebuild();
  if (r.windows.includes("clerk")) clerkSay(L.clerk.hello);
  inspectorSay(pick(L.lines.idle));
  scheduleBoss();
  post("phase", { phase: "forging" });
  if (!guidedDone() && S.round === 1 && EMBED) setTimeout(() => startGuided(), 350);
  else if (!tutorialDone() && S.round === 1 && !EMBED) setTimeout(() => startTutorial(0), 350);
}

function dealAll() {
  rank().slots.forEach(sl => { if (sl !== "where") S.hands[sl] = O.dealHand(sl, { level: S.level, plan: S.plan, unlocks: S.unlocks }); });
}

/* the orders, the scheme name and the screen, after any change to the plan */
function rebuild() {
  S.inv.orders = S.plan.what ? O.buildCampaign(S.level, S.plan) : [];
  S.inv.cur = 0;
  const who = cardFor("who", S.plan.who || "me"), trick = S.plan.trick && S.plan.trick !== "none" ? cardFor("trick", S.plan.trick) : null;
  S.scheme = (S.plan.who || "me") + "+" + (S.plan.trick || "none") + (S.plan.custom ? "+custom" : "");
  SCHEMES[S.scheme] = { name: who.name + (trick ? " · " + trick.name : "") + (S.plan.custom ? " (custom)" : ""), icon: trick ? trick.ico : who.ico, pay: 1 };
  renderPlan(); renderHand(); updateHud();
}

function nextEmpty(from) {
  const sl = rank().slots, i = sl.indexOf(from);
  return [...sl.slice(i + 1), ...sl.slice(0, i + 1)].find(s => !S.plan[s]) || null;
}

function playCard(i) {
  const sl = S.active, card = sl && (S.hands[sl] || [])[i];
  if (!card || S.submitted) return;
  S.plan[sl] = card.id;
  if (sl === "what") { // WHERE depends on what you buy: physical goods need an address, codes an inbox
    S.hands.where = O.dealHand("where", { level: S.level, plan: S.plan });
    if (S.plan.where && !S.hands.where.some(c => c.id === S.plan.where)) delete S.plan.where;
  }
  if (sl === "who") delete S.plan.custom;
  sfx("pick");
  S.active = nextEmpty(sl);
  rebuild();
  if (planReady()) {
    guideCheck("plan-ready");
    showTip("first-plan", EMBED ? "✉️ Plan ready! Drag the envelope onto PRINT." : "✉️ Plan ready! Drag the envelope into the outbox.");
  }
}

function selectSlot(sl) {
  if (S.submitted || !rank().slots.includes(sl)) return;
  if (sl === "where" && !S.plan.what) { sfx("bad"); toast("Pick what to buy first"); sl = "what"; }
  S.active = sl; sfx("click");
  renderPlan(); renderHand();
}

/* Mastermind: swap one part of the disguise at a time (click to cycle) */
function tweak(id) {
  if (S.submitted || !S.plan.who) return;
  const t = O.TWEAKS.find(x => x.id === id);
  const kit = { ...O.find(O.PERSONAS, S.plan.who).kit, ...(S.plan.custom || {}) };
  const opts = t.options.filter(op => !op.unlock || S.unlocks.includes(op.unlock) || (op.unlock === "residential" && S.unlocks.includes("neighbor")) || (op.unlock === "cloner" && S.unlocks.includes("clone")));
  const next = opts[(opts.findIndex(op => op.id === kit[id]) + 1) % opts.length];
  S.plan.custom = { ...(S.plan.custom || {}), [id]: next.id };
  sfx("pen"); rebuild();
}

function renderPlan() {
  const P = $("#invoice"), r = rank();
  if (!S.inv) { P.innerHTML = ""; return; }
  const results = S.lastResult && S.lastResult.results;
  const kit = S.plan.who ? { ...O.find(O.PERSONAS, S.plan.who).kit, ...(S.plan.custom || {}) } : null;
  const tweaks = r.custom ? `<div class="pl-tweaks ${kit ? "" : "off"}">${O.TWEAKS.map(t => {
    const op = kit && t.options.find(o => o.id === kit[t.id]);
    return `<button class="pl-tweak" data-tweak="${t.id}" ${kit && !S.submitted ? "" : "disabled"} title="Click to swap">${t.ico} ${op ? op.label : t.name}</button>`;
  }).join("")}</div>` : "";
  const rows = r.slots.map(sl => {
    const id = S.plan[sl], c = id && cardFor(sl, id);
    return `<div class="pl-row region ${S.active === sl ? "active" : ""} ${c ? "filled" : ""}" data-region="${sl}">
      <span class="pl-words">${SLOT_WORDS[sl]}</span>
      <button class="pl-slot" data-slot="${sl}" ${S.submitted ? "disabled" : ""}>
        <span class="pl-ico">${c ? c.ico : SLOT_ICO[sl]}</span><span class="pl-name">${c ? c.name : "…"}</span></button>
    </div>${sl === "who" ? tweaks : ""}`;
  }).join("");
  const n = S.inv.orders.length;
  const loot = S.inv.orders.reduce((a, o) => { const f = factsOf(o); return a + (f.ship.toYou ? f.amount : 0); }, 0);
  const res = results ? `<span class="pl-results">${S.inv.orders.map((o, i) => `<i class="${results[i] && results[i].declined ? "bad" : "ok"}">${factsOf(o).item.ico}${results[i] && results[i].declined ? "✗" : "✓"}</i>`).join("")}</span>`
    : n > 1 ? `<span class="pl-orders">${n} orders</span>` : "";
  P.innerHTML = `
    <div class="pl-head"><div class="pl-title">THE PLAN</div><div class="pl-sub">${O.SHOPS[S.level].domain}<br>${S.holder.name}'s card</div></div>
    <div class="pl-rows">${rows}</div>
    <div class="pl-foot">${res}<span class="pl-loot">Loot <b>${price(loot)}</b></span></div>
    ${S.lastResult ? `<div class="t-verdict ${S.lastResult.caught ? "bad" : "ok"}">${S.lastResult.caught ? "CAUGHT" : "GOT AWAY"}</div>` : ""}`;
  // forensic replay: the blanks that gave you away
  if (S.lastResult && S.lastResult.caught) S.lastResult.tells.slice(0, 2).forEach(t => t[2] && P.querySelector(`[data-region="${t[2]}"]`)?.setAttribute("data-tell", t[0]));
  P.classList.toggle("forensic", !!(S.lastResult && S.lastResult.caught));
  $$(".pl-slot", P).forEach(b => b.onclick = () => selectSlot(b.dataset.slot));
  $$(".pl-tweak", P).forEach(b => b.onclick = () => tweak(b.dataset.tweak));
  updateDebug();
}

/* the hand: the cards for the glowing blank, in the dock */
function renderHand() {
  const sl = S.active, cards = sl && !S.submitted ? (S.hands[sl] || []) : [];
  $("#hand-ask").textContent = sl && !S.submitted ? SLOT_ASK[sl] : "YOUR HAND";
  $("#tools").innerHTML = cards.length ? cards.map((c, i) => `
    <button class="hcard ${S.plan[sl] === c.id ? "chosen" : ""}" data-i="${i}">
      <span class="key">${i + 1}</span><span class="hc-ico">${c.ico}</span><span class="hc-name">${c.name}</span><span class="hc-line">${c.line}</span></button>`).join("") +
    (S.perks.includes("redraw") && !S.redrawn && sl !== "where" ? `<button class="hcard redraw" id="btn-redraw" title="Lucky Draw: once per round">🔄<span class="hc-name">Redraw</span></button>` : "")
    : `<div class="hand-done">${S.submitted ? "Sent! Fingers crossed." : planReady() ? "✓ Plan ready! Drag the envelope →" : "Click a blank in the plan"}</div>`;
  $$(".hcard[data-i]").forEach(b => b.onclick = () => playCard(+b.dataset.i));
  const rd = $("#btn-redraw");
  if (rd) rd.onclick = () => { S.redrawn = true; S.hands[sl] = O.dealHand(sl, { level: S.level, plan: S.plan, unlocks: S.unlocks }); sfx("whoosh"); renderHand(); };
  $("#envelope").classList.toggle("ready", planReady());
}
const renderTools = renderHand;

/* the risk of the cards you picked shows up as heat when you send the plan */
function planHeat() {
  return ["who", "when", "where", "trick"].reduce((a, sl) => { const c = S.plan[sl] && cardFor(sl, S.plan[sl]); return a + (c && c.heat || 0); }, 0);
}

function dropTool() { hidePopover(); }
function hint(text) { $("#tool-hint").textContent = text; $("#tool-hint").classList.toggle("show", !!text); }
function hidePopover() { $("#popover").classList.remove("show"); }

/* ======================= Heat / HUD ======================= */

function addHeat(n) {
  if (S.perks.includes("night")) n *= 1.3;
  const wasBelowThreshold = S.heat < 50;
  S.heat = clamp(S.heat + n, 0, 100);
  updateHud();
  if (wasBelowThreshold && S.heat >= 50) showTip("first-heat-50", "🔥 Heat is above 50% — the inspector gets a suspicion bonus!", "heat-basics");
}

function updateHud() {
  $("#heat-fill").style.width = S.heat + "%";
  $("#heat-num").textContent = Math.round(S.heat) + "%";
  $("#tb-money").textContent = money(S.money);
  $("#tb-perks").innerHTML = S.perks.map(id => `<span title="${PERKS.find(p => p.id === id).name}">${PERKS.find(p => p.id === id).ico}</span>`).join("");
  const r = rank();
  $("#tb-rank").textContent = "⭐".repeat(r.n) + " " + r.title;
  $("#edits-left").textContent = r.n < O.RANKS.length ? `${S.xp - r.xp}/${O.RANKS[r.n].xp - r.xp} XP to the next rank` : "Max rank";
  $("#envelope").classList.toggle("ready", planReady());
  updateDebug();
  const st = stageFor(S.version);
  post("hud", { level: S.level, money: S.money, heat: S.heat, version: S.version, round: S.round,
    patches: S.patches, shame: S.shame,
    inspector: LEVELS[S.level].inspector.name, emoji: st.emoji, clerk: LEVELS[S.level].clerk });
}

const tellLabel = name => TELL_LABELS[name] || String(name).replace(/_/g, " ");
function stageFor(v) { return INSPECTOR_STAGES.find(s => v <= s.upTo); }

/* ======================= Portraits =======================
 * Front views of the office's blocky characters (world.js buildHead), drawn as SVG so the
 * computer shows the same people as the 3D office. Same skin, hair and features per person. */
const LOOKS = {
  inspector: { skin: "#f1c27d", hair: "messy", hairColor: "#8a5a35", lids: true, mouth: "o", nose: "big", brows: "flat" },
  clerk: { skin: "#e0a77a", hair: "curly", hairColor: "#b8342a", earrings: true, mouth: "grin", brows: "raised" },
};
function shadeHex(hex, k) { // darken (k < 0) or lighten a #rrggbb colour
  const n = parseInt(hex.slice(1), 16), f = c => clamp(Math.round(c + 255 * k), 0, 255);
  return "#" + [n >> 16, n >> 8 & 255, n & 255].map(c => f(c).toString(16).padStart(2, "0")).join("");
}
// stage: inspector upgrade 0 sleepy intern, 1 reading glasses, 2 UV goggles, 3 cyborg (-1 = plain)
function faceSVG(look, stage = -1) {
  const L = look, ink = "#1a1210", o = `stroke="${ink}" stroke-width="3.5" stroke-linejoin="round"`;
  const lids = L.lids && stage <= 0, cyborg = stage === 3;
  const parts = [];
  // ears + earrings
  parts.push(`<rect x="10" y="46" width="10" height="16" fill="${L.skin}" ${o}/><rect x="80" y="46" width="10" height="16" fill="${L.skin}" ${o}/>`);
  if (L.earrings) parts.push(`<circle cx="13" cy="66" r="3.4" fill="#ffd23f" ${o.replace("3.5", "2")}/><circle cx="87" cy="66" r="3.4" fill="#ffd23f" ${o.replace("3.5", "2")}/>`);
  // head with a soft shadow on one side
  parts.push(`<rect x="18" y="22" width="64" height="68" fill="${L.skin}" ${o}/><rect x="60" y="24" width="20" height="64" fill="${shadeHex(L.skin, -.08)}" opacity=".55"/>`);
  // hair
  const hc = L.hairColor;
  if (L.hair === "messy") parts.push(`<rect x="15" y="14" width="70" height="15" fill="${hc}" ${o}/>
    <rect x="24" y="5" width="11" height="13" fill="${hc}" ${o} transform="rotate(-14 29 12)"/><rect x="44" y="3" width="11" height="14" fill="${hc}" ${o} transform="rotate(10 49 10)"/><rect x="63" y="5" width="11" height="13" fill="${hc}" ${o} transform="rotate(28 68 12)"/>`);
  if (L.hair === "curly") parts.push([20, 33, 46, 59, 72, 80].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 15 : 19}" r="9" fill="${hc}" ${o}/>`).join("") +
    [26, 50, 74].map(x => `<circle cx="${x}" cy="10" r="8" fill="${hc}" ${o}/>`).join(""));
  // brows
  const by = 37, raised = L.brows === "raised";
  parts.push(`<rect x="28" y="${by}" width="18" height="4.5" fill="${hc}"/><rect x="54" y="${by - (raised ? 4 : 0)}" width="18" height="4.5" fill="${hc}"/>`);
  // eyes (they blink); the cyborg's right eye is a laser
  const eye = (cx, laser) => laser
    ? `<circle cx="${cx}" cy="51" r="8" fill="#ff2b2b" ${o.replace("3.5", "2.5")}/><circle cx="${cx - 2}" cy="49" r="2.4" fill="#fff" opacity=".9"/>`
    : `<g class="pf-eye"><circle cx="${cx}" cy="51" r="9.5" fill="#fff" ${o.replace("3.5", "2.5")}/><circle cx="${cx}" cy="52" r="4.6" fill="${ink}"/></g>`;
  parts.push(eye(37, false));
  if (cyborg) parts.push(`<rect x="51" y="30" width="29" height="46" rx="2" fill="#9aa0a6" ${o.replace("3.5", "2.5")}/><circle cx="56" cy="35" r="1.4" fill="${ink}"/><circle cx="75" cy="71" r="1.4" fill="${ink}"/>`);
  parts.push(eye(63, cyborg));
  if (lids) parts.push(`<rect x="26" y="41" width="22" height="9" fill="${L.skin}"/><line x1="26" y1="50" x2="48" y2="50" stroke="${ink}" stroke-width="2.5"/>
    <rect x="52" y="41" width="22" height="9" fill="${L.skin}"/><line x1="52" y1="50" x2="74" y2="50" stroke="${ink}" stroke-width="2.5"/>`);
  // nose
  const nose = shadeHex(L.skin, -.12);
  parts.push(L.nose === "big" ? `<rect x="43" y="55" width="14" height="16" fill="${nose}" ${o.replace("3.5", "2")}/>` : `<circle cx="50" cy="61" r="5.5" fill="${nose}"/>`);
  // mouth
  if (L.mouth === "o") parts.push(`<circle cx="50" cy="79" r="4.6" fill="none" stroke="${ink}" stroke-width="3.2"/>`);
  else if (L.mouth === "grin") parts.push(`<rect x="36" y="74" width="28" height="9" fill="${ink}"/><rect x="39" y="75" width="22" height="3.6" fill="#fff"/>`);
  else parts.push(`<rect x="40" y="77" width="20" height="4" fill="${ink}"/>`);
  // upgrades
  if (stage === 1) parts.push(`<g fill="none" stroke="${ink}" stroke-width="2.6"><circle cx="37" cy="51" r="12"/><circle cx="63" cy="51" r="12"/><line x1="49" y1="50" x2="51" y2="50"/></g>`);
  if (stage === 2) parts.push(`<g stroke="#3a1a6a" stroke-width="3.4"><circle cx="37" cy="51" r="13.5" fill="#b77dff" fill-opacity=".55"/><circle cx="63" cy="51" r="13.5" fill="#b77dff" fill-opacity=".55"/><line x1="50" y1="50" x2="50" y2="50"/><line x1="18" y1="50" x2="23.5" y2="50"/><line x1="76.5" y1="50" x2="82" y2="50"/></g>`);
  if (cyborg) parts.push(`<line x1="34" y1="3" x2="34" y2="16" stroke="#9aa0a6" stroke-width="2.6"/><circle cx="34" cy="3" r="3.2" fill="#ff2b2b"/>`);
  const bg = ["", "", "#e9dcff", "#ffd6d6"][stage] || "";
  return `<svg class="portrait" viewBox="0 0 100 100" aria-hidden="true">${bg ? `<rect width="100" height="100" fill="${bg}"/>` : ""}${parts.join("")}</svg>`;
}
function stageIndex(v) { return INSPECTOR_STAGES.findIndex(s => v <= s.upTo); }

function renderInspector() {
  const L = LEVELS[S.level], st = stageFor(S.version);
  $("#insp-portrait").innerHTML = faceSVG(LOOKS.inspector, stageIndex(S.version));
  $("#insp-name").textContent = L.inspector.name; $("#insp-title").textContent = st.title;
  $("#insp-version").textContent = "Inspector v" + S.version;
}
function inspectorSay(text) {
  $("#insp-line").textContent = text;
  const f = $("#insp-face"); f.classList.remove("talk"); void f.offsetWidth; f.classList.add("talk");
}

/* ======================= Clerk chat (MOCK scoring) ======================= */

function addMsg(who, text) {
  const m = document.createElement("div"); m.className = "msg " + who; m.textContent = text;
  $("#chat").appendChild(m); $("#chat").scrollTop = 1e6;
}
function clerkSay(text) { addMsg("them", text); sfx("msg"); }

// MOCK: short + matches the clerk's quirk = convincing. The server scores this with an LLM.
function mockClerk(text) {
  const L = LEVELS[S.level];
  const hits = L.clerk.keywords.filter(k => text.toLowerCase().includes(k)).length;
  const score = clamp(30 + hits * 25 - Math.max(0, text.length - 90) * .5 + rand(-10, 10), 0, 100);
  return { score, reply: pick(L.clerk.replies[score > 60 ? "good" : score > 35 ? "meh" : "bad"]) };
}

$("#chat-form").addEventListener("submit", async e => {
  e.preventDefault();
  const input = $("#chat-text"), text = input.value.trim();
  if (!text || !S.inv || S.submitted) return;
  input.value = ""; addMsg("me", text); sfx("click");
  S.inv.coverEmail = ((S.inv.coverEmail || "") + " " + text).trim();
  const round = S.round, av = $("#clerk-avatar"); av.classList.add("typing");
  let res = null;
  if (API && S.roundId) {
    try {
      const r = await api("POST", "/clerk", { round_id: S.roundId, text });
      const score = +(r.persuasion ?? r.persuasion_score ?? r.score);
      const reply = r.reply ?? r.text;
      if (Number.isFinite(score) && reply) res = { score, reply, fromServer: true };
      else throw new Error("unexpected /clerk response");
    } catch (err) { offline(err); }
  }
  res = res || mockClerk(text);
  await sleep(res.fromServer ? 0 : 700 + rand(0, 600));
  av.classList.remove("typing");
  if (S.round !== round) return;
  const score = clamp(res.score + (S.perks.includes("smooth") ? 20 : 0), 0, 100);
  S.persuasion = Math.max(S.persuasion, score);
  $("#persuade-fill").style.width = S.persuasion + "%";
  clerkSay(res.reply);
  S.clerkReplies = (S.clerkReplies || 0) + 1;
  showTip("first-persuade", "😎 Persuasion lowers the inspector's suspicion. Match the clerk's quirk!", "persuasion");
  guideCheck("clerk-sent");
  updateDebug();
});

/* ======================= Draggable windows ======================= */

$$(".win").forEach(win => {
  const bar = $(".win-title", win);
  bar.addEventListener("pointerdown", e => {
    $$(".win").forEach(w => w.classList.remove("front")); win.classList.add("front");
    const sx = e.clientX, sy = e.clientY, ox = win.offsetLeft, oy = win.offsetTop;
    bar.setPointerCapture(e.pointerId);
    const mv = ev => {
      win.style.left = clamp(ox + (ev.clientX - sx) / scale, -win.offsetWidth + 80, 1560) + "px";
      win.style.top = clamp(oy + (ev.clientY - sy) / scale, 70, 840) + "px";
    };
    const up = () => { bar.removeEventListener("pointermove", mv); bar.removeEventListener("pointerup", up); };
    bar.addEventListener("pointermove", mv); bar.addEventListener("pointerup", up);
  });
});

/* ======================= Envelope → outbox ======================= */

$("#envelope").addEventListener("pointerdown", e => {
  if (!S.inv || S.submitted) return;
  e.preventDefault();
  dropTool();
  const env = $("#envelope");
  const ghost = env.cloneNode(true); ghost.removeAttribute("id"); ghost.classList.add("env-ghost");
  ghost.style.width = env.offsetWidth * scale + "px"; ghost.style.height = env.offsetHeight * scale + "px";
  ghost.style.left = e.clientX + "px"; ghost.style.top = e.clientY + "px";
  document.body.appendChild(ghost);
  env.style.visibility = "hidden"; sfx("whoosh");
  const ob = $("#outbox");
  const over = ev => document.elementsFromPoint(ev.clientX, ev.clientY).includes(ob);
  const mv = ev => { ghost.style.left = ev.clientX + "px"; ghost.style.top = ev.clientY + "px"; ob.classList.toggle("hover", over(ev)); };
  const up = ev => {
    document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up);
    ghost.remove(); env.style.visibility = ""; ob.classList.remove("hover");
    if (over(ev)) trySubmit();
  };
  document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
});

function trySubmit() {
  if (!planReady()) { sfx("bad"); stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake"); toast("Fill in every blank of the plan first", "bad"); return; }
  addHeat(planHeat());
  if (EMBED) {
    // in the office the envelope is printed, then carried to the inspector by hand
    S.submitted = S.printed = true; clearTimeout(S.bossTimer); dropTool();
    sfx("chunk"); toast("🖨️ Printing the order slip… grab it at the printer and drop it in Gus's tray", "good");
    $("#envelope").classList.add("printed");
    post("print");
    guideCheck("submitted");
    return;
  }
  guideCheck("submitted");
  submit();
}

window.addEventListener("message", e => {
  const m = e.data;
  if (!m || m.src !== "forged-world") return;
  if (m.type === "deliver" && S.printed && !S.delivered) { S.delivered = true; submit(); }
  if (m.type === "boss-near") { bossWalk(); showTip("first-boss", "🕴️ The boss! Press Space to hide the invoice!", "boss-patrol"); }
  if (m.type === "heat" && Number.isFinite(+m.amount)) addHeat(+m.amount);
  if (m.type === "paused") setPaused(!!m.on);
  if (m.type === "quit") quitToTitle();
  if (m.type === "tour") replayTour();
  if (m.type === "tutorial-3d-done") advanceGuideOn3D(m.step);
});

/* ======================= Inspection (MOCK verdict) ======================= */

const campaignCtx = () => ({ level: S.level, holder: S.holder, orders: S.inv.orders, hist: S.hist, session: S.session,
  round: S.round, scheme: S.scheme, campaign: S.session + "-r" + S.round, perks: S.perks });

/* the rows for the plan on screen; random parts (minutes, ids) stay put until the plan changes */
let rowCache = { key: null, rows: null };
function previewRows() {
  const key = JSON.stringify([S.round, S.inv.orders]);
  if (rowCache.key !== key) rowCache = { key, rows: O.toRows(campaignCtx()) };
  return rowCache.rows;
}

// MOCK verdict: the scripted Gus in orders.js
function mockJudge() {
  const rows = previewRows();
  const leniency = [0, 18, 10, 4, 0, 0][rank().n]; // a Rookie's first plans should mostly work
  const r = O.judgeOrders({ ...campaignCtx(), rows, memo: S.memo, version: S.version, heat: S.heat, persuasion: S.persuasion, learned: S.learned, leniency });
  const payout = Math.round(r.payout * (S.perks.includes("night") ? 2 : 1));
  return { ...r, rows, payout, line: null, newVersion: null, source: "mock" };
}

/* turn a POST /submit response into the shape the UI uses; tells are [name, weight, blank] */
function adaptVerdict(r, mock) {
  const verdict = String(r.verdict ?? "").toUpperCase();
  const caught = verdict ? ["FLAGGED", "DECLINED"].includes(verdict) : !!r.caught;
  const raw = r.top_tells ?? r.tells ?? [];
  const tells = raw.map(t => {
    const name = typeof t === "string" ? t : t.tell_type ?? t.feature ?? t.name ?? t.tell;
    const weight = typeof t === "string" ? 1 : +(t.strength ?? t.weight ?? t.score ?? 1);
    return [name, weight, TELL_REGION[name] || null];
  }).filter(t => t[0]);
  const v = +(r.new_version ?? r.version);
  return { caught, tells, payout: +(r.payout ?? (caught ? 0 : mock.payout)), results: r.results ?? mock.results, rows: mock.rows,
    line: r.inspector_line ?? r.line ?? null, newVersion: Number.isFinite(v) && v > 0 ? v : null, source: "api" };
}

async function judge() {
  const mock = mockJudge();
  mock.tells.forEach(t => t[2] = TELL_REGION[t[0]] || null); // orders.js names ticket boxes; the plan has blanks
  if (!API || !S.roundId) return mock;
  try {
    const { verdict, ...rec } = record(); // the verdict is what we're asking for
    const r = await api("POST", "/submit", { round_id: S.roundId, player: playerName(), record: rec, perks: S.perks }, 10000);
    return adaptVerdict(r, mock);
  } catch (e) { offline(e); return mock; }
}

/* fill the game columns once Gus has answered, then keep the rows */
function finishRows(res) {
  const rows = res.rows.map(r => ({ ...r }));
  rows.forEach((row, i) => {
    const x = res.results && res.results[i];
    Object.assign(row, {
      // BLOCKED: never scored, the card was already declined or reported earlier in the plan
      verdict: x ? (x.declined ? (x.reason === "flagged" ? "DECLINED" : "BLOCKED") : "APPROVED") : res.caught ? "DECLINED" : "APPROVED",
      score: x ? +x.score.toFixed(3) : null,
      top_reasons: x ? JSON.stringify(x.tells.slice(0, 3).map(t => [t[0], +t[1].toFixed(1)])) : null,
      detector_version: S.version, cover_note: S.inv.coverEmail || "",
    });
  });
  O.remember(S.hist, campaignCtx(), rows);
  storeRows(rows);
  return rows;
}

async function submit() {
  S.submitted = true; clearTimeout(S.bossTimer);
  sfx("chunk");
  const L = LEVELS[S.level];
  const ob = $("#outbox"); ob.classList.add("scanning");
  inspectorSay(`Checking your order…`);
  renderHand();
  const pending = judge(); // start the request now, the animation covers the wait

  await sleep(900);
  ob.classList.remove("scanning");
  const st = $(".inspect-stage");
  st.classList.remove("done");
  $("#big-stamp").className = "big-stamp"; $("#cash-pop").classList.remove("show");
  $("#inspect-line").textContent = `${L.inspector.name} is checking it…`;
  $("#inspect-line").classList.add("show", "reading");
  overlay("inspect"); sfx("scan");

  const [res] = await Promise.all([pending, sleep(1500)]);
  S.lastResult = res;
  S.rows = finishRows(res);
  const { caught, tells, payout } = res;
  const bs = $("#big-stamp");
  bs.textContent = caught ? "CAUGHT" : "APPROVED";
  bs.classList.add("show", caught ? "flagged" : "paid");
  sfx("stamp");
  st.classList.add("done");
  // Gus says why, in plain words: that's the only explanation the player gets
  const said = res.line || (res.reported && !tells.length ? "The cardholder called their bank. Card's dead!"
    : caught && tells.length ? `${pick(L.lines.catch)} ${cap(tellLabel(tells[0][0]))}!` : pick(L.lines[caught ? "catch" : "pass"]));
  $("#inspect-line").classList.remove("reading");
  $("#inspect-line").textContent = `${L.inspector.name}: "${said}"`;
  inspectorSay(said);
  post("verdict", { caught, line: said, payout, scheme: SCHEMES[S.scheme].name,
    vendor: `${SCHEMES[S.scheme].icon} ${SCHEMES[S.scheme].name}`, tells: tells.slice(0, 3).map(t => t[0]) });
  $("#inspect-line").classList.add("show");
  if (caught) {
    sfx("buzz"); stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake");
    S.streak = 0; S.caughtCount++;
    if (S.caughtCount === 1) showTip("first-caught", "🔍 Caught! The red blank is what gave you away.", "tells-explained");
    addHeat(12);
  }
  if (payout > 0) { // orders that got through before a catch still pay
    S.money += payout;
    if (!caught) S.streak++;
    $("#cash-pop").textContent = "+" + money(payout); $("#cash-pop").classList.add("show");
    setTimeout(() => sfx("cash"), 250);
    $("#tb-money").classList.remove("bump"); void $("#tb-money").offsetWidth; $("#tb-money").classList.add("bump");
    if (!caught) S.cards.push({ scheme: S.scheme, payout, round: S.round, isNew: true });
  }
  S.history.push({ round: S.round, scheme: S.scheme, caught, payout, version: S.version, tells: tells.map(t => t[0]) });
  // rank: every round teaches something, getting away with it teaches more
  const before = rank();
  S.xp += caught ? 1 : 2; saveXp();
  if (rank().n > before.n) S.rankUp = rank();
  renderPlan();
  updateHud();
  guideCheck("verdict-done");
}

$("#btn-after-inspect").onclick = () => { sfx("click"); overlay("inspect", false); showCorkboard(); };

/* ======================= Corkboard (retrain as a scene) ======================= */

function showCorkboard() {
  const r = S.lastResult, L = LEVELS[S.level];
  const shredded = r.caught && S.perks.includes("shred") && !S.shredUsed;
  if (shredded) S.shredUsed = true;
  // Gus weighs the tell that caught you more from now on (scripted Gus; the real model retrains)
  if (r.caught && !shredded && r.tells.length) S.learned[r.tells[0][0]] = (S.learned[r.tells[0][0]] || 0) + 1;
  const oldV = S.version;
  S.prevVersion = oldV;
  if (r.newVersion != null) S.version = r.newVersion; // the server decides when it's live
  else if (!shredded) S.version++;
  renderInspector(); updateHud();
  if (S.version > oldV) {
    S.patches++;
    showTip("first-version-bump", "🧠 The inspector leveled up — he learned from your trick!", "version-bump");
    if (r.tells.length) S.shame.push({ player: playerName(), version: S.version, trick: SCHEMES[S.scheme].name,
      learned: tellLabel(r.tells[0][0]), amount: campaignTotal(), round: S.round });
  }
  const top = r.tells.slice(0, 3);
  const pos = [[120, 60], [80, 330], [430, 300]];
  $("#cork-pins").innerHTML = `
    <div class="cork-card main" style="left:380px;top:40px;transform:rotate(-3deg)">
      <b>${SCHEMES[S.scheme].icon} ${SCHEMES[S.scheme].name}</b>
      ${S.inv.orders.length} order${S.inv.orders.length > 1 ? "s" : ""} on ${S.holder.name}'s card<br>${money(r.payout)} to you
      <div class="cc-stamp ${r.caught ? "" : "paid"}">${r.caught ? "CAUGHT" : "GOT AWAY"}</div>
    </div>` +
    (top.length ? top : [["heat", 0, null]]).map((t, i) => `
    <div class="cork-card" style="left:${pos[i][0]}px;top:${pos[i][1]}px;transform:rotate(${rand(-5, 5)}deg)">
      <b>Clue #${i + 1}</b>${tellLabel(t[0])}</div>`).join("");
  const cx = 510, cy = 130;
  $("#cork-string").innerHTML = (top.length ? top : [0]).map((_, i) =>
    `<path d="M${cx},${cy} Q${(cx + pos[i][0] + 100) / 2},${(cy + pos[i][1]) / 2 + 60} ${pos[i][0] + 105},${pos[i][1] + 10}"/>`).join("");
  $("#cork-portrait").innerHTML = faceSVG(LOOKS.inspector, stageIndex(S.version));
  $("#cork-line").textContent = shredded ? "Wait… where did that file go?" : r.caught ? "Gotcha. Never again." : "You fooled me once. Never again.";
  $("#ver-old").textContent = "v" + oldV; $("#ver-new").textContent = "v" + S.version;
  overlay("cork");
  sfx("stamp");
}

$("#btn-after-cork").onclick = () => { sfx("click"); overlay("cork", false); showBetween(); };

/* ======================= Between rounds: patch notes + shop ======================= */

function showBetween() {
  const r = S.lastResult;
  const learned = r.tells.slice(0, 2).map(t => tellLabel(t[0])).filter(Boolean);
  const n = 40 + S.round * 17 + Math.floor(rand(0, 30));
  $("#patch-title").textContent = `Inspector v${S.version}`;
  const items = learned.length
    ? learned.map(l => `<li>Gus now watches for: <b>${l}</b></li>`)
    : [`<li>No new tricks learned. <b>Clean job.</b></li>`];
  const st = stageFor(S.version);
  if (stageFor(S.version - 1) !== st) items.push(`<li>Promoted to <b>${st.title}</b></li>`);
  if (S.streak >= 2) { items.push(`<li>🔥 Streak ×${S.streak}: keep changing your plan.</li>`); showTip("first-streak", "🔥 Streak! Keep changing your plan to keep it.", "streak-bonus"); }
  if (S.rankUp) {
    items.unshift(`<li class="rank-up">⭐ <b>Rank up: ${S.rankUp.title}!</b> New: ${S.rankUp.unlocks}.</li>`);
    toast(`⭐ Rank up: ${S.rankUp.title}!`, "good"); setTimeout(() => sfx("cash"), 300);
    S.rankUp = null;
  }
  $("#patch-list").innerHTML = items.join("");
  loadPatchNotes(S.prevVersion, items.slice(learned.length ? learned.length : 1));
  const caught = S.history.filter(h => h.caught).length;
  $("#round-stats").innerHTML = `
    <div class="stat"><div class="v">${money(S.money)}</div><div class="k">Siphoned</div></div>
    <div class="stat"><div class="v">${S.history.length - caught}/${S.history.length}</div><div class="k">Got through</div></div>
    <div class="stat"><div class="v">${caught}</div><div class="k">Times caught</div></div>`;
  $("#card-row").innerHTML = S.cards.slice(-6).map(c => `
    <div class="scheme-collect ${c.isNew ? "new" : ""}"><div class="ico">${SCHEMES[c.scheme].icon}</div><b>${SCHEMES[c.scheme].name}</b><span>Round ${c.round}</span><span style="margin-top:auto;font-weight:700">${money(c.payout)}</span></div>`).join("");
  S.cards.forEach(c => c.isNew = false);
  renderShop();
  messUpDesk();
  overlay("between");
  if (S.round === 1) showTip("first-shop", "🛒 Spend your earnings in the shop — perks and unlocks carry across rounds.", "shop-intro");
}

/* GET /patch-notes?since=v: what each new version learned. Replaces the mock
 * "Now catches" lines; `extra` (promotion, streak) is kept underneath. */
async function loadPatchNotes(since, extra) {
  if (!API || since == null) return;
  const round = S.round, list = $("#patch-list");
  list.classList.add("loading");
  try {
    const r = await api("GET", `/patch-notes?since=${encodeURIComponent(since)}`);
    if (S.round !== round) return;
    const notes = Array.isArray(r) ? r : r.notes ?? r.versions ?? r.patch_notes ?? [];
    const lines = notes.flatMap(n => {
      if (typeof n === "string") return [n];
      const v = n.version != null ? `v${n.version}` : "";
      const n_ = n.invoices_trained_on ?? n.learned_from ?? n.examples ?? n.count;
      const from = n_ != null ? ` — learned from ${n_} orders` : "";
      const learned = [].concat(n.learned ?? n.catches ?? n.features ?? n.text ?? n.summary ?? []);
      return learned.map(l => `${v ? v + " " : ""}now catches: <b>${tellLabel(l)}</b>${from}.`);
    });
    if (lines.length) list.innerHTML = lines.map(l => `<li>${l}</li>`).join("") + extra.join("");
  } catch (e) { offline(e); }
  finally { list.classList.remove("loading"); }
}

function renderShop() {
  $("#shop-money").textContent = money(S.money);
  const perkItem = p => {
    const owned = S.perks.includes(p.id);
    const full = S.perks.length >= 3;
    return `<button class="shop-item ${owned ? "owned" : ""}" data-perk="${p.id}" ${owned || full || S.money < p.cost ? "disabled" : ""}>
      <span class="si-top"><span>${p.ico} ${p.name}</span><span class="price">${owned ? "OWNED" : money(p.cost)}</span></span>${p.desc}</button>`;
  };
  $("#shop-perks").innerHTML = PERKS.map(perkItem).join("");
  $("#shop-unlocks").innerHTML = UNLOCKS.map(u => {
    const owned = u.consumable ? S.dossier : S.unlocks.includes(u.id);
    return `<button class="shop-item ${owned ? "owned" : ""}" data-unlock="${u.id}" ${owned || S.money < u.cost ? "disabled" : ""}>
      <span class="si-top"><span>${u.ico} ${u.name}</span><span class="price">${owned ? "OWNED" : money(u.cost)}</span></span>${u.desc}</button>`;
  }).join("");
  $$("[data-perk]").forEach(b => b.onclick = () => {
    const p = PERKS.find(x => x.id === b.dataset.perk);
    S.money -= p.cost; S.perks.push(p.id); sfx("cash"); toast(`${p.ico} ${p.name} active`, "good"); renderShop(); updateHud();
  });
  $$("[data-unlock]").forEach(b => b.onclick = () => {
    const u = UNLOCKS.find(x => x.id === b.dataset.unlock);
    S.money -= u.cost; sfx("cash");
    if (u.consumable) S.dossier = true; else S.unlocks.push(u.id);
    toast(`${u.ico} ${u.name} unlocked`, "good"); renderShop(); updateHud();
  });
}

$("#btn-next-round").onclick = () => {
  sfx("pick"); overlay("between", false);
  const hadDossier = S.dossier;
  nextRound();
  // dossier reveals the decoy for exactly one round
  if (hadDossier) { renderMemo(); S.dossier = false; }
};
function quitToTitle() {
  $$(".overlay").forEach(o => o.classList.remove("show"));
  clearTimeout(S.bossTimer); S.bossWindow = false; $("#boss-prompt").classList.remove("show");
  if (tut.on) endTutorial(true);
  dropTool(); hidePopover(); hideSchemeTip(); $("#debug-panel").classList.remove("show");
  Object.assign(S, { inv: null, submitted: false });
  show("title");
}
$("#btn-quit").onclick = () => { sfx("click"); quitToTitle(); };

/* ======================= Guided first round =======================
 * Walks the player through a full scheme → forge → clerk → submit → print →
 * deliver → verdict loop, with spotlight hints on the desk and green arrows
 * in the 3D world. Replaces the auto-start of the old 12-step UI tour for
 * round 1. The old tour remains accessible via the "Tutorial" button. */

const GUIDE_KEY = "forged-guided-done-v2";
const GUIDE = { on: false, step: 0, waitingFor3D: null };

// no "sit down" step: a run only starts once you're at the computer
const GUIDE_STEPS = [
  { id: "scheme",    instr: "Fill in the plan: click a card at the bottom.",
    spotlight: ["#invoice"] },
  { id: "submit",    instr: EMBED ? "Drag the envelope onto PRINT." : "Drag the envelope into the OUTBOX.",
    spotlight: ["#envelope"] },
  { id: "pickup",    world: true,  label: "Grab at printer",      instr: "Walk to the printer and press E to grab it." },
  { id: "deliver",   world: true,  label: "Drop in IN tray",      instr: "Carry it to Gus's IN tray and press E." },
  { id: "verdict",   instr: "Gus is checking your order..." },
  { id: "done",      instr: "You got it! More cards unlock as you rank up.", auto: true },
];

function guidedDone() { try { return localStorage.getItem(GUIDE_KEY) === "1"; } catch { return false; } }

function startGuided() {
  GUIDE.on = true; GUIDE.step = 0; GUIDE.waitingFor3D = null;
  post("tutorial-active", { on: true });
  renderGuideCard();
  advanceGuidePhase();
}

function advanceGuidePhase() {
  const step = GUIDE_STEPS[GUIDE.step];
  if (!step) return endGuided();
  if (step.world) {
    post("tutorial-phase", { phase: step.id, label: step.label || "" });
    GUIDE.waitingFor3D = step.id;
  }
}

function advanceGuide() {
  if (!GUIDE.on) return;
  GUIDE.step++;
  if (GUIDE.step >= GUIDE_STEPS.length) return endGuided();
  GUIDE.waitingFor3D = null;
  renderGuideCard();
  advanceGuidePhase();
  // auto-advance steps that don't wait
  const step = GUIDE_STEPS[GUIDE.step];
  if (step.auto) setTimeout(() => endGuided(), 2000);
}

function advanceGuideOn3D(worldStep) {
  if (!GUIDE.on) return;
  const step = GUIDE_STEPS[GUIDE.step];
  if (!step || !step.world) return;
  // Map world step names to guide step ids
  if (worldStep === "sat" && step.id === "sit") advanceGuide();
  else if (worldStep === "grabbed" && step.id === "pickup") advanceGuide();
  else if (worldStep === "delivered" && step.id === "deliver") advanceGuide();
}

function endGuided() {
  GUIDE.on = false; GUIDE.waitingFor3D = null;
  post("tutorial-active", { on: false });
  try { localStorage.setItem(GUIDE_KEY, "1"); } catch {}
  // Clean up the guide card
  const card = $(".guide-card");
  if (card) card.remove();
  toast("Tutorial complete — good luck, forger!", "good");
}

function renderGuideCard() {
  const step = GUIDE_STEPS[GUIDE.step];
  if (!step) return;
  let card = $(".guide-card");
  if (!card) {
    card = document.createElement("div");
    card.className = "guide-card";
    stage.appendChild(card);
  }
  const spotlight = step.spotlight || [];
  const skipBtn = step.skippable ? `<button class="btn btn-ghost btn-small guide-skip">Skip →</button>` : "";
  card.innerHTML = `<div class="guide-step">GUIDED TUTORIAL · STEP ${GUIDE.step + 1}/${GUIDE_STEPS.length}</div>
    <p class="guide-instr">${step.instr}</p>${skipBtn}`;
  card.style.display = step.world && EMBED ? "none" : "";
  // Position the card
  if (spotlight.length) {
    const r = tutRect(spotlight);
    if (r && r.y > 600) { // low targets (the envelope): above them, so the card doesn't cover what it points at
      card.style.left = clamp(r.x + r.w - 380, 20, 1200) + "px";
      card.style.top = Math.max(r.y - 150, 80) + "px";
    } else if (r) {
      card.style.left = Math.min(r.x + r.w + 20, 1100) + "px";
      card.style.top = Math.max(r.y, 80) + "px";
    }
  } else {
    card.style.left = "550px"; card.style.top = "30px";
  }
  // Skip button
  const skipEl = $(".guide-skip", card);
  if (skipEl) skipEl.onclick = () => { sfx("click"); advanceGuide(); };
}

// Hook: advance guide when specific game events happen
function guideCheck(event, data) {
  if (!GUIDE.on) return;
  const step = GUIDE_STEPS[GUIDE.step];
  if (!step) return;
  switch (step.id) {
    case "scheme": if (event === "plan-ready") advanceGuide(); break;
    case "submit": if (event === "submitted") advanceGuide(); break;
    case "verdict": if (event === "verdict-done") handleGuidedVerdict(); break;
  }
}

function handleGuidedVerdict() {
  if (!GUIDE.on) return;
  const r = S.lastResult;
  if (r && r.caught) {
    // Special card for caught during tutorial
    const card = $(".guide-card");
    if (card) {
      const tells = r.tells.slice(0, 2).map(t => tellLabel(t[0])).join(", ");
      card.style.display = "";
      card.style.left = "400px"; card.style.top = "200px";
      card.innerHTML = `<div class="guide-step">CAUGHT!</div>
        <p class="guide-instr">Gus noticed: <b>${tells || "something suspicious"}</b>.<br>That's okay: every failure is a lesson.</p>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn btn-small" id="guide-continue">Continue anyway</button>
        </div>`;
      $("#guide-continue").onclick = () => { sfx("click"); advanceGuide(); };
    }
  } else {
    advanceGuide();
  }
}

/* ======================= Guided tutorial (12-step UI tour) =======================
 * Dims the screen, cuts a hole around one part, and points at it with an
 * arrow and a card. Runs once per browser (the first scheme pick), and any
 * time from Game Menu → Tutorial. */

const TUT_KEY = "forged-tutorial-done-v2"; // v2: the plan cards replaced the invoice tour
// the old tour picked a scheme first; plans have no scheme picker, so nothing to lock
function lockSchemes() {}
// Steps with `until` are hands-on: the player does the thing, the card turns green and moves on.
const TUTORIAL = [
  { at: ["#invoice", "#tools"], side: "right", title: "Make a plan",
    until: () => planReady(),
    text: () => `Fill in the blanks. <b>Click a card</b> at the bottom (or press ${kb("tool1")}–${kb("tool3")}) to fill the glowing one.` },
  { at: ["#win-inspector"], side: "left", title: "Fool Gus",
    text: () => `Gus is the shop's fraud robot. Get past him and you get paid. <b>He learns from every catch</b>, so keep changing your plan.` },
  { at: ["#envelope"], side: "left", title: EMBED ? "Print it" : "Send it", last: true,
    until: () => S.printed || S.submitted, can: () => planReady(),
    text: () => EMBED ? `Drag the envelope onto <b>PRINT</b>, then carry the slip to Gus.` : `Drag the envelope into the <b>OUTBOX</b>.` },
];

const tut = { on: false, i: 0 };
const kb = action => `<kbd>${ForgedKeys.label(action)}</kbd>`;

function tutorialDone() { try { return localStorage.getItem(TUT_KEY) === "1"; } catch (e) { return false; } }
function startTutorial(from = 0) {
  dropTool(); hidePopover();
  Object.assign(tut, { on: true, i: from, entered: -1 });
  $("#tutorial").classList.add("show");
  $("#tut-dots").innerHTML = TUTORIAL.map(() => "<i></i>").join("");
  clearInterval(tut.poll); tut.poll = setInterval(tutPoll, 200);
  showTutStep();
}

// hands-on steps: watch for the player doing the thing
function tutPoll() {
  if (!tut.on || S.paused) return;
  const st = TUTORIAL[tut.i];
  if (!st.until || tut.done) return;
  let ok = false; try { ok = st.until(); } catch (e) { ok = false; }
  if (ok) {
    tut.done = true; sfx("cash");
    $(".tut-card").classList.add("done");
    $("#tut-step").textContent = "✓ Done!";
    $("#tut-next").style.display = "none";
    clearTimeout(tut.adv);
    tut.adv = setTimeout(() => { if (tut.on && TUTORIAL[tut.i] === st) tutNext(true); }, st.hold || 1000);
  } else if (st.can) {
    const stuck = !st.can();
    $("#tut-next").style.display = stuck ? "" : "none"; // out of uses: let them move on
    $("#tut-next").textContent = "Skip step →";
  }
}
function endTutorial(unfinished = false) {
  tut.on = false;
  clearInterval(tut.poll); clearTimeout(tut.adv);
  const st = TUTORIAL[tut.i]; st && st.leave && st.leave();
  if (S.bossPractice) { S.bossPractice = false; S.bossWindow = false; clearTimeout(S.bossTimer); $("#boss-prompt").classList.remove("show"); }
  lockSchemes(false);
  $("#tutorial").classList.remove("show", "passthrough");
  if (!unfinished) try { localStorage.setItem(TUT_KEY, "1"); } catch (e) { /* it just shows again next time */ }
}

// bounding box of the target elements, in stage coordinates
function tutRect(sels) {
  const sr = stage.getBoundingClientRect();
  const rs = sels.map(q => $(q)).filter(Boolean).map(el => el.getBoundingClientRect()).filter(r => r.width);
  if (!rs.length) return null;
  const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top));
  const R = Math.max(...rs.map(r => r.right)), B = Math.max(...rs.map(r => r.bottom));
  return { x: (l - sr.left) / scale, y: (t - sr.top) / scale, w: (R - l) / scale, h: (B - t) / scale };
}

function showTutStep() {
  const step = TUTORIAL[tut.i], pad = 10;
  // windows may still be animating in: measure again once they've settled
  clearTimeout(tut.settle);
  if (!tut.settling) tut.settle = setTimeout(() => { tut.settling = true; if (tut.on) showTutStep(); tut.settling = false; }, 450);
  $("#tut-step").textContent = `Tutorial · ${tut.i + 1} of ${TUTORIAL.length}`;
  $("#tut-title").textContent = step.title;
  $("#tut-text").innerHTML = step.text();
  $$("#tut-dots i").forEach((d, k) => d.classList.toggle("on", k === tut.i));
  const action = !!step.until;
  if (tut.entered !== tut.i) { // first time showing this step
    tut.entered = tut.i; tut.done = false; clearTimeout(tut.adv);
    $(".tut-card").classList.remove("done");
    step.enter && step.enter();
  }
  if (tut.done) $("#tut-step").textContent = "✓ Done!";
  $("#tut-back").style.visibility = tut.i > 0 && !TUTORIAL[tut.i - 1].wait && !step.drill ? "visible" : "hidden";
  $("#tut-next").style.display = step.wait || action ? "none" : "";
  $("#tut-next").textContent = "Next →";
  $("#tutorial").classList.toggle("passthrough", !!step.wait || action);
  $("#tutorial").classList.toggle("nodim", !!step.noDim);
  lockSchemes(step.wait === "scheme");

  const r = tutRect(step.at), hole = $(".tut-hole"), card = $(".tut-card");
  const h = r ? { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 } : { x: 800, y: 450, w: 0, h: 0 };
  Object.assign(hole.style, { left: h.x + "px", top: h.y + "px", width: h.w + "px", height: h.h + "px" });
  hole.classList.toggle("none", !r);

  // place the card beside the hole, on the preferred side if it fits there
  const cw = card.offsetWidth, ch = card.offsetHeight, gap = 70, W = 1600, H = 900, m = 16;
  const spots = {
    right: [h.x + h.w + gap, h.y + h.h / 2 - ch / 2], left: [h.x - gap - cw, h.y + h.h / 2 - ch / 2],
    top: [h.x + h.w / 2 - cw / 2, h.y - gap - ch], bottom: [h.x + h.w / 2 - cw / 2, h.y + h.h + gap],
  };
  const fits = ([x, y]) => x >= m && y >= m && x + cw <= W - m && y + ch <= H - m;
  let pos;
  if (!r) pos = [W / 2 - cw / 2, H / 2 - ch / 2];
  else {
    const order = [step.side, "right", "left", "bottom", "top"].filter(Boolean);
    const side = order.find(sd => fits(spots[sd])) || step.side || "right";
    pos = spots[side];
  }
  const cx = clamp(pos[0], m, W - cw - m), cy = clamp(pos[1], m, H - ch - m);
  card.style.left = cx + "px"; card.style.top = cy + "px";

  // arrow from the card's edge to the hole's edge
  const line = $(".tut-line");
  if (!r) { line.setAttribute("d", ""); return; }
  const near = (px, py, b) => [clamp(px, b.x, b.x + b.w), clamp(py, b.y, b.y + b.h)];
  const [sx, sy] = near(h.x + h.w / 2, h.y + h.h / 2, { x: cx, y: cy, w: cw, h: ch });
  let [ex, ey] = near(cx + cw / 2, cy + ch / 2, h);
  const dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy) || 1;
  if (len < 30) { line.setAttribute("d", ""); return; }
  ex -= dx / len * 14; ey -= dy / len * 14; // stop just short of the outline
  const bend = Math.min(60, len * .25);
  const qx = (sx + ex) / 2 - dy / len * bend, qy = (sy + ey) / 2 + dx / len * bend;
  line.setAttribute("d", `M${sx},${sy} Q${qx},${qy} ${ex},${ey}`);
}

function tutNext(auto = false) {
  if (!auto) sfx("click");
  const st = TUTORIAL[tut.i];
  st.leave && st.leave();
  if (st.drill && S.bossPractice) { S.bossPractice = false; S.bossWindow = false; clearTimeout(S.bossTimer); $("#boss-prompt").classList.remove("show"); }
  if (tut.i >= TUTORIAL.length - 1) { endTutorial(); if (auto) toast("Tutorial complete. Good luck out there!", "good"); return; }
  tut.i++; showTutStep();
}
$("#tut-next").onclick = tutNext;
$("#tut-back").onclick = () => {
  const st = TUTORIAL[tut.i];
  if (tut.i > 0 && !TUTORIAL[tut.i - 1].wait && !st.drill) { sfx("click"); st.leave && st.leave(); tut.i--; showTutStep(); }
};
$("#tut-skip").onclick = () => { sfx("click"); endTutorial(); };
const canTour = () => !!S.inv && !S.submitted && $("#screen-desk").classList.contains("active") && !$(".overlay.show");
function replayTour() { if (canTour()) startTutorial(1); else toast("Start a round first, then open the tutorial", "bad"); }
addEventListener("resize", () => tut.on && showTutStep());

/* ======================= Player name (the leaderboard itself is in menu.js) ======================= */

const PLAYER_KEY = "forged-player";
function playerName() {
  try { return (localStorage.getItem(PLAYER_KEY) || "").trim() || "You"; } catch (e) { return "You"; }
}

/* desk gets messier as the run goes on */
function messUpDesk() {
  const props = [
    () => `<div class="prop-ring" style="left:${rand(380, 1000)}px;top:${rand(60, 700)}px;transform:scale(${rand(.6, 1)})"></div>`,
    () => `<div class="prop-sticky" style="left:${rand(1000, 1450)}px;top:${rand(380, 640)}px;transform:rotate(${rand(-10, 10)}deg) scale(.6);opacity:.9">${pick(["v" + S.version + "??", "call the mule", "USE THE VPN", "lunch @12"])}</div>`,
    () => `<div class="prop-paper" style="left:${rand(20, 300)}px;top:${rand(640, 760)}px;transform:rotate(${rand(-20, 20)}deg) scale(.5);opacity:.85">ENVELOPE<br>━━━━</div>`,
  ];
  $("#desk-mess").insertAdjacentHTML("beforeend", pick(props)());
}

/* ======================= Boss walks by ======================= */

function scheduleBoss() {
  clearTimeout(S.bossTimer);
  if (EMBED) return; // in the office the boss is a real NPC on patrol
  if (GUIDE.on) return; // skip boss during guided tutorial
  if (Math.random() < .35 && S.round > 1 || S.round === 2) {
    S.bossTimer = setTimeout(bossWalk, rand(9000, 20000));
  }
}
// tutorial practice: footsteps after a moment, no heat, repeats until the player hides in time
function tutBossDrill(delay = 1800) {
  clearTimeout(S.bossTimer);
  S.bossTimer = setTimeout(() => { if (tut.on && TUTORIAL[tut.i].drill && !S.paused) bossWalk(true); }, delay);
}
function bossWalk(practice = false) {
  if (S.paused && !practice) { S.bossTimer = setTimeout(bossWalk, 4000); return; }
  if (!practice && (S.submitted || tut.on || GUIDE.on || !$("#screen-desk").classList.contains("active") || $(".overlay.show"))) {
    if ((tut.on || GUIDE.on) && !S.submitted) S.bossTimer = setTimeout(bossWalk, 8000); // try again after the tour
    return;
  }
  sfx("steps");
  const sh = $("#boss-shadow"); sh.classList.remove("walk"); void sh.offsetWidth; sh.classList.add("walk");
  $("#boss-prompt").classList.add("show");
  S.bossWindow = true; S.bossPractice = practice;
  S.bossTimer = setTimeout(bossSaw, 2000);
}
function bossSaw() {
  if (!S.bossWindow) return;
  S.bossWindow = false; $("#boss-prompt").classList.remove("show");
  if (S.bossPractice) { // tutorial: no heat, just try again
    S.bossPractice = false; sfx("bad");
    toast(`Too slow! Press ${ForgedKeys.label("hide")} when the banner shows. Again…`, "bad");
    tutBossDrill(2200); return;
  }
  sfx("buzz"); addHeat(15); toast("The boss saw something… +15 heat", "bad");
  inspectorSay("Huh? What's the boss looking at?");
}
function hideInvoice() {
  if (!S.bossWindow) return;
  S.bossWindow = false; clearTimeout(S.bossTimer);
  $("#boss-prompt").classList.remove("show");
  const np = $("#newspaper"); np.classList.add("show"); sfx("whoosh");
  toast("Smooth. Just reading the paper.", "good");
  if (S.bossPractice) { S.bossPractice = false; tut.hid = true; }
  setTimeout(() => np.classList.remove("show"), 1700);
}

/* ======================= Debug: the data rows (hidden from players) =======================
 * Players never see rows or columns. With ?debug on the page (or the office) URL,
 * D opens the current order's IEEE-CIS row and the CSV export. */

const DEBUG = (() => {
  const has = loc => { try { return new URLSearchParams(loc.search).has("debug"); } catch (e) { return false; } };
  return has(location) || (EMBED && has(parent.location));
})();
function record() {
  if (!S.inv) return { note: "make a plan first" };
  return {
    mode: "online", level: S.level, scheme: S.scheme, campaign_id: S.session + "-r" + S.round,
    plan: { ...S.plan }, rank: rank().n, orders: S.inv.orders.map(o => ({ ...o })),
    cover_note: S.inv.coverEmail || "", persuasion: Math.round(S.persuasion), // Smooth Talker raises this
    after_hours: S.perks.includes("night"), // Night Shift: pays double
    detector_version: S.version, heat: Math.round(S.heat),
    verdict: S.lastResult && S.submitted ? (S.lastResult.caught ? "DECLINED" : "APPROVED") : null,
    rows: S.rows || previewRows(),
  };
}
const compact = row => Object.fromEntries(Object.entries(row).filter(([, v]) => v != null && v !== ""));
function updateDebug() {
  if (!$("#debug-panel").classList.contains("show")) return;
  if (!S.inv || !S.inv.orders.length) { $("#debug-title").textContent = "No order yet"; $("#debug-json").textContent = "Pick what to buy first."; return; }
  const rows = S.rows || previewRows();
  $("#debug-title").textContent = `${rows.length} order${rows.length > 1 ? "s" : ""} as IEEE-CIS rows`;
  $("#debug-json").textContent = rows.map((r, i) => `// order ${i + 1}\n` + JSON.stringify(compact(r), null, 2)).join("\n\n") +
    "\n\n// Blank columns (V1-V339 and the rest) are empty (NaN), as in most rows of the dataset.";
}
function toggleDebug() { if (!DEBUG) return; $("#debug-panel").classList.toggle("show"); updateDebug(); }

/* every sent order is kept in this browser and can be exported as a CSV with the dataset's columns */
const ROWS_KEY = "forged.ieee.rows";
function storedRows() { try { return JSON.parse(localStorage.getItem(ROWS_KEY) || "[]"); } catch (e) { return []; } }
function storeRows(rows) {
  try { localStorage.setItem(ROWS_KEY, JSON.stringify([...storedRows(), ...rows].slice(-3000))); } catch (e) { /* only this round's rows are lost */ }
}
function downloadCsv() {
  const all = storedRows();
  if (!all.length) { sfx("bad"); toast("No orders sent yet: play a round first", "bad"); return; }
  const cell = v => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const csv = [O.COLUMNS.join(","), ...all.map(r => O.COLUMNS.map(c => cell(r[c])).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "forged_ieee_rows.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`⬇ ${all.length} rows exported`, "good");
}
if ($("#btn-csv")) $("#btn-csv").onclick = () => { sfx("click"); downloadCsv(); };
window.forgedRows = { all: storedRows, csv: downloadCsv, clear: () => { try { localStorage.removeItem(ROWS_KEY); } catch (e) {} } };

const paintDebugKey = () => { $("#debug-key").textContent = ForgedKeys.label("detector"); };
paintDebugKey(); ForgedKeys.onChange(paintDebugKey);
if ($("#btn-debug")) $("#btn-debug").onclick = () => { sfx("click"); toggleDebug(); };
if ($("#btn-dossier")) $("#btn-dossier").onclick = () => { sfx("click"); renderDossier(); overlay("dossier"); };

/* ======================= Pause & Game Menu =======================
 * Esc opens the Game Menu (menu.js). Inside the office the office page owns the
 * menu, so the computer asks for it with a "menu" message and is told when the
 * game is paused or resumed. On its own, os.html runs the menu itself. */

function openMenu(screen = "pause") {
  hidePopover(); hideSchemeTip();
  if (EMBED) post("menu", { screen });
  else ForgedMenu.open(screen);
}
function setPaused(on) {
  if (!!S.paused === on) return;
  S.paused = on;
  if (on) {
    clearTimeout(S.bossTimer);
    S.pausedWindow = S.bossWindow;
    dropTool(); hidePopover();
  } else if (tut.on && TUTORIAL[tut.i].drill && !tut.hid) {
    S.bossWindow = false; $("#boss-prompt").classList.remove("show"); tutBossDrill();
  } else if (S.pausedWindow) {
    S.bossTimer = setTimeout(bossSaw, 2000); // a fresh 2 seconds to hide the invoice
  } else if (!EMBED && S.inv && !S.submitted) scheduleBoss();
}
if (!EMBED) ForgedMenu.init({
  office: false,
  onPause: setPaused,
  onQuit: quitToTitle,
  canTour, onTour: replayTour,
  getStats: () => ({ money: S.money, patches: S.patches, shame: S.shame, round: S.round }),
});

/* ======================= Keyboard & mouse ======================= */

// mute / volume keys work while seated too: the office's audio.js owns the setting
document.addEventListener("keydown", e => {
  if (e.repeat || ForgedKeys.shortcutMods(e)) return;
  const el = document.activeElement;
  if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
  const action = ["mute", "volumeDown", "volumeUp"].find(a => ForgedKeys.matches(a, e));
  if (action) post("sound-key", { action });
});
document.addEventListener("keydown", e => {
  const K = ForgedKeys, code = e.code;
  const el = document.activeElement;
  const typing = ["INPUT", "TEXTAREA"].includes(el.tagName) || el.isContentEditable;
  if (code === "Escape") {
    e.preventDefault();
    if (typing) { el.blur(); return; } // like closing chat: a second Esc opens the menu
    openMenu("pause"); return;
  }
  if (S.paused) return;
  if (tut.on && !typing) {
    const st = TUTORIAL[tut.i];
    if (st.wait) return; // picking a scheme: mouse only
    if (!st.until) { // reading steps: Enter / → / Space for next, ← for back
      if (code === "Enter" || code === "ArrowRight" || code === "Space") { e.preventDefault(); tutNext(); }
      else if (code === "ArrowLeft") $("#tut-back").click();
      return;
    }
    // hands-on steps fall through: the game's own keys work
  }
  if (K.is("hide", code) && S.bossWindow) { e.preventDefault(); el.blur?.(); hideInvoice(); return; }
  if (typing) { if (code === "Enter" && el.isContentEditable) { e.preventDefault(); el.blur(); } return; }
  if (EMBED && K.is("standUp", code)) { e.preventDefault(); post("stand"); return; }
  if (K.is("detector", code)) { e.preventDefault(); toggleDebug(); return; }
  if (!$("#screen-desk").classList.contains("active") || $(".overlay.show")) return;
  for (let i = 1; i <= 3; i++) if (K.is("tool" + i, code)) { e.preventDefault(); playCard(i - 1); return; }
  if (K.is("drop", code)) { dropTool(); return; }
  if (K.is("chat", code) && S.inv && !S.submitted && rank().windows.includes("clerk")) { e.preventDefault(); $("#chat-text").focus(); }
});

// mouse buttons can be bound too ("Mouse3" = back button…); left click stays the pointer
document.addEventListener("mousedown", e => {
  if (e.button === 0 || S.paused) return;
  const code = "Mouse" + e.button, K = ForgedKeys;
  if (EMBED && K.is("standUp", code)) { e.preventDefault(); post("stand"); }
  else if (K.is("hide", code) && S.bossWindow) { e.preventDefault(); hideInvoice(); }
});

// mouse wheel moves between the blanks of the plan
let wheelAt = 0;
$("#screen-desk").addEventListener("wheel", e => {
  if (S.paused || (tut.on && !TUTORIAL[tut.i].until) || $(".overlay.show") || !S.inv || S.submitted) return;
  if (e.target.closest(".win-body, #debug-panel, #popover")) return; // let windows scroll
  e.preventDefault();
  const now = performance.now(); if (now - wheelAt < 140) return; wheelAt = now; // trackpads send bursts
  const sl = rank().slots, i = sl.indexOf(S.active), dir = e.deltaY > 0 ? 1 : -1;
  selectSlot(sl[i < 0 ? 0 : (i + dir + sl.length) % sl.length]);
}, { passive: false });

document.addEventListener("pointerdown", e => {
  if (!e.target.closest("#popover") && !e.target.closest(".tchip") && !e.target.closest(".tool")) { if (S.tool) dropTool(); else hidePopover(); }
});

})();
