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
 * The order content (shops, cards, toolkit, starter campaigns, the IEEE-CIS row
 * builder and the scripted Gus) lives in orders.js as window.ForgedOrders. */

const O = window.ForgedOrders;
const price = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
const cap = s => s.replace(/\b\w/g, c => c.toUpperCase());

const LEVELS = {
  1: {
    name: "Sunny Diner Supply", short: "Sunny Diner", icon: "🥞", difficulty: "Easy",
    swatches: ["#f4a63a", "#1f8a8a", "#fff6e2"],
    inspector: { name: "Gus", personality: "Cheerful risk engine, easily distracted by pie" },
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
      pass: ["Looks like a regular! Approved.", "Yep! Totally normal customer! Shipping it!", "Such a loyal shopper. APPROVED."],
      catch: ["Hey… that card is acting weird.", "Hold on, that's not a real customer!", "I may be sleepy but I'm not THAT sleepy."],
    },
  },
  2: {
    name: "St. Mercy Pharmacy", short: "St. Mercy", icon: "🏥", difficulty: "Medium",
    swatches: ["#9fd8c4", "#2f6fd6", "#ffffff"],
    inspector: { name: "Ms. Procedure", personality: "Procedural risk engine, reads every order in a monotone" },
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
      idle: ["Please submit orders in triplicate.", "I have read the risk handbook four times.", "Procedure is a comfort."],
      pass: ["Order complete. Processing. Approved.", "Compliant. Moving on.", "This meets section 4.2. Approved."],
      catch: ["Irregularity detected. Filing a report.", "That order violates procedure.", "Non-compliant. Declined."],
    },
  },
  3: { name: "Port Nocturne Shipping", short: "Port Nocturne", icon: "🚢", difficulty: "Hard", swatches: ["#1d2a44", "#ff9a2e", "#f4efe6"], inspector: { name: "Old Salt", personality: "Gruff, remembers everything" }, locked: true },
  4: { name: "Neon Arcade Holdings", short: "Neon Arcade", icon: "🕹️", difficulty: "Boss", swatches: ["#ff2bd6", "#19e3ff", "#120014"], inspector: { name: "GL1TCH", personality: "Paranoid, flags anything unusual" }, locked: true },
};

/* the starter campaigns: name, icon, payout multiplier, risk and the hover tips */
const SCHEMES = O.SCHEMES;
const schemeTips = id => O.SCHEMES[id];
const RISK = ["", "Low", "Medium", "High"];
const riskBadge = tip => tip.risk
  ? `<span class="sc-risk r${tip.risk}">Risk ${"●".repeat(tip.risk)}${"○".repeat(3 - tip.risk)} ${RISK[tip.risk]}</span>`
  : `<span class="sc-risk">Risk: up to you</span>`;

const USED_KEY = "forged-schemes-used";
function usedSchemes() { try { return JSON.parse(localStorage.getItem(USED_KEY) || "[]"); } catch (e) { return []; } }
function markSchemeUsed(id) {
  try { const u = usedSchemes(); if (!u.includes(id)) localStorage.setItem(USED_KEY, JSON.stringify([...u, id])); } catch (e) { /* not remembered */ }
}

const TOOLS = O.TOOLS;

const PERKS = [
  { id: "cookies", ico: "🍪", name: "Cookie Jar", desc: "Stolen browser cookies: new devices look familiar.", cost: 600 },
  { id: "patience", ico: "⏳", name: "Patience", desc: "Cards never get reported while you wait.", cost: 500 },
  { id: "night", ico: "🌙", name: "Night Shift", desc: "Double pay, more suspicion.", cost: 900 },
  { id: "mules", ico: "📦", name: "Mule Network", desc: "Drop addresses cost no heat.", cost: 700 },
  { id: "smooth", ico: "😎", name: "Smooth Talker", desc: "Support persuasion bonus.", cost: 500 },
  { id: "shred", ico: "🗑️", name: "Paper Shredder", desc: "One caught trick is not learned.", cost: 1200 },
];

const UNLOCKS = [
  { id: "residential", ico: "🏠", name: "Residential Proxies", desc: "New IP: a neighbor's home internet.", cost: 800 },
  { id: "cloner", ico: "📱", name: "Device Cloner", desc: "New device: a copy of the cardholder's phone.", cost: 900 },
  { id: "budget", ico: "➕", name: "Extra Edit", desc: "+1 change per round.", cost: 1000 },
  { id: "dossier", ico: "📂", name: "Dossier", desc: "Reveals the fake memo rule next round.", cost: 600, consumable: true },
];

const INSPECTOR_STAGES = [
  { upTo: 3, emoji: "😴", prop: "📎", title: "Sleepy Intern" },
  { upTo: 6, emoji: "🧐", prop: "🔍", title: "Clerk with a Magnifier" },
  { upTo: 9, emoji: "🕵️", prop: "🔦", title: "Auditor with a UV Lamp" },
  { upTo: 99, emoji: "🤖", prop: "🧿", title: "Cyborg with a Monocle" },
];

/* which ticket box to highlight in the forensic replay, per tell */
const TELL_REGION = O.TELL_BOX;
const TELL_LABELS = O.TELL_LABELS;

/* ======================= Dossier ======================= */

const DOSSIER_ENTRIES = {
  "heat-basics":     { icon: "🔥", title: "Heat",              text: "Every risky change and repeated scheme raises your heat bar. Above 40 % Gus gets a free suspicion bonus on every order. Heat decays 40 % between rounds, so one bad round won't ruin you, but two in a row will." },
  "version-bump":    { icon: "🧠", title: "Gus Learns",        text: "Every time you're caught (or even succeed sloppily), Gus is retrained. His version number goes up, and the tell that tripped you gets weighed more from then on. Vary your tricks." },
  "memo-deduction":  { icon: "📝", title: "Memo Rules",        text: "Two of the three memo rules are real: Gus actually watches for those. The third is a decoy. Mark them as you learn which is fake so you can break the fake rule safely." },
  "shop-intro":      { icon: "🛒", title: "The Shop",          text: "Between rounds you can buy perks (passive bonuses, max 3) and unlocks (new toolkit options or one-shot intel). The Dossier unlock reveals which memo rule is the decoy for one round." },
  "route-goods":     { icon: "📦", title: "Get the Goods",     text: "If every order ships to the cardholder's home (or emails the code to them), you get nothing and the campaign won't send. At least one order needs a drop address or your burner inbox." },
  "boss-patrol":     { icon: "🕴️", title: "The Boss",          text: "The boss patrols the office. If he walks behind your desk while you work, press Space to hide the screen, or take +15 heat. In the 3D office, his vision cone can catch you carrying the envelope." },
  "tells-explained": { icon: "🔍", title: "What Gus Checks",   text: "Gus reads one row per order: the card and its history, the email, the device and IP, the address, the item, and the timing. Each toolkit choice changes some of these. Press D to see the exact row." },
  "streak-bonus":    { icon: "🔥", title: "Scheme Streaks",    text: "Using the same scheme twice in a row adds a USED warning and extra heat. Succeeding with different schemes in a row builds a streak. Streaks don't pay more, they just prove you're versatile." },
  "campaigns":       { icon: "➕", title: "Campaigns",         text: "+ Next order copies the current order so you can add a step: a test charge, a second buy days later. Gus scores every order and remembers every card, email, device and address for the whole run. One declined order blocks the card for the rest of the campaign." },
  "persuasion":      { icon: "😎", title: "Support Chat",      text: "The support agent has a quirk (shown in the window header). Work their keywords into a short note for the best score. High persuasion lowers Gus's suspicion, so it's worth the effort." },
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
  // per round
  scheme: null, holder: null, inv: null, uses: {}, edits: 0, maxEdits: 6, persuasion: 0,
  memo: [], tool: null, submitted: false, bossTimer: null, bossWindow: false, rows: null,
  roundId: null, // from POST /round/start; null when offline
  patches: 0, shame: [], // retrains this run caused, and what each one learned
};

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
    hist: O.newHistory(), learned: {}, session: "s" + Date.now().toString(36), holder: null });
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
  Object.assign(S, { scheme: null, inv: null, uses: {}, edits: 0, persuasion: 0, tool: null, submitted: false,
    printed: false, delivered: false, lastResult: null, rows: null, holder: pick(O.HOLDERS.filter(h => h !== prev)) });
  post("phase", { phase: "briefing" });
  S.maxEdits = 6 + (S.unlocks.includes("budget") ? 1 : 0);
  TOOLS.forEach(t => S.uses[t.id] = 0);
  $("#tb-round").textContent = S.round;
  $("#invoice").innerHTML = ""; $("#invoice").className = "paper ticket";
  $("#strip").innerHTML = "";
  $("#scheme-banner").textContent = "";
  $("#chat").innerHTML = ""; $("#persuade-fill").style.width = "0%";
  $("#envelope").classList.remove("printed");
  renderCaseFile();
  dealMemo();
  renderInspector();
  renderTools(); updateHud();
  showBriefing();
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

function renderCaseFile() {
  const shop = O.SHOPS[S.level], h = S.holder;
  $("#case-body").innerHTML = `
    <span class="case-tab">STOLEN CARD ON YOUR DESK</span>
    ${h ? `<table class="case-table">
      <tr><td><b>${h.name}</b><br><small style="opacity:.6">${h.city}</small></td>
        <td class="mono">${h.email}<br><small style="opacity:.6">always shops from ${h.phone === "iphone" ? "an iPhone" : "an Android phone"}</small></td></tr>
    </table>` : ""}
    <span class="case-tab">THE SHOP</span>
    <table class="case-table">
      <tr><td>Website</td><td class="mono">${shop.domain}</td></tr>
      <tr><td>Usual order</td><td class="mono">${price(shop.typical)}</td></tr>
    </table>
    <span class="case-tab">CATALOG</span>
    <table class="case-table">${shop.catalog.map(i => `<tr><td>${i.ico} ${i.name}</td><td class="mono">${price(i.price)}</td></tr>`).join("")}</table>
    <span class="case-tab">NOTES</span>
    <ul class="case-notes">${shop.notes.map(n => `<li>${n}</li>`).join("")}</ul>`;
}

function showBriefing() {
  const L = LEVELS[S.level];
  $("#brief-kicker").textContent = `ROUND ${S.round} · ${L.name.toUpperCase()} · ${L.inspector.name.toUpperCase()} v${S.version}`;
  const last = S.history.slice(-2).map(h => h.scheme);
  const used = usedSchemes();
  $("#scheme-cards").innerHTML = Object.entries(SCHEMES).map(([id, sc]) => {
    const repeat = last.filter(s => s === id).length;
    const tip = schemeTips(id), fresh = !used.includes(id);
    return `<button class="scheme-card ${fresh ? "fresh" : ""}" data-scheme="${id}">
      ${repeat ? `<span class="sc-warn">USED ${repeat}× · +HEAT</span>` : fresh ? `<span class="sc-new">NEW · hover for tips</span>` : ""}
      <div class="sc-ico">${sc.icon}</div>
      <div class="sc-name">${sc.name}</div>
      <div class="sc-desc">${tip.simple}</div>
      <div class="sc-foot">
        ${riskBadge(tip)}
        <span class="sc-pay">Payout ×${sc.pay}</span>
      </div>
    </button>`;
  }).join("");
  $$(".scheme-card").forEach(c => {
    c.onclick = () => {
      if (c.disabled) return; // locked during the tutorial
      sfx("pick"); hideSchemeTip(); overlay("briefing", false); beginForge(c.dataset.scheme);
    };
    if (c.classList.contains("fresh")) {
      c.onmouseenter = c.onfocus = () => showSchemeTip(c);
      c.onmouseleave = c.onblur = hideSchemeTip;
    }
  });
  overlay("briefing");
  if (!guidedDone() && S.round === 1 && EMBED) setTimeout(() => startGuided(), 350);
  else if (!tutorialDone() && S.round === 1) setTimeout(() => startTutorial(0), 350);
}

/* hover tips for a scheme the player hasn't used yet */
function showSchemeTip(card) {
  const id = card.dataset.scheme, sc = SCHEMES[id], tip = schemeTips(id), el = $("#scheme-tip");
  el.innerHTML = `
    <div class="st-head"><span>${sc.icon} ${sc.name}</span>${riskBadge(tip)}</div>
    <div class="st-sub good">Recommended</div>
    <ul>${tip.good.map(([i, t]) => `<li><span>${i}</span>${t}</li>`).join("")}</ul>
    <div class="st-sub bad">Ill-advised</div>
    <ul>${tip.bad.map(([i, t]) => `<li><span>${i}</span>${t}</li>`).join("")}</ul>
    <div class="st-tells"><b>What gives it away:</b> ${tip.tells}</div>`;
  // beside the card: to the right for the first two, to the left for the last two
  const sr = stage.getBoundingClientRect(), r = card.getBoundingClientRect();
  const x = (r.left - sr.left) / scale, y = (r.top - sr.top) / scale, w = r.width / scale, tw = 360;
  const right = x + w + 14 + tw <= 1600 - 16 && x < 800;
  el.style.left = (right ? x + w + 14 : x - 14 - tw) + "px";
  el.classList.add("show");
  el.style.top = clamp(y - 20, 16, 900 - el.offsetHeight - 16) + "px";
}
function hideSchemeTip() { $("#scheme-tip").classList.remove("show"); }

/* ======================= Order ticket =======================
 * One checkout in 5 boxes. Nothing is typed: the buttons in each box (or the
 * toolkit, 1-6) swap what's in it. Card, email, device and IP belong to the
 * persona and apply to every order; address, item and time are per order. */

const BOXES = [
  { id: "card", ico: "💳", title: "Card", chips: ["card"] },
  { id: "buyer", ico: "👤", title: "Buyer", chips: ["email"] },
  { id: "ship", ico: "📦", title: "Ship to", chips: ["ship"] },
  { id: "device", ico: "💻", title: "Device & IP", chips: ["device", "proxy"] },
  { id: "cart", ico: "🛒", title: "Cart & time", chips: ["item", "clock"] },
];
const CHIP_LABEL = { card: "Swap card", email: "Change email", ship: "Change address", device: "Device", proxy: "IP", item: "Item", clock: "Time" };
const CAMPAIGN_TOOLS = ["card", "email", "proxy", "device"];
const MAX_ORDERS = 5;
const curOrder = () => S.inv.orders[S.inv.cur];
const factsOf = o => O.facts(S.level, S.holder, o, { perks: S.perks });
const campaignTotal = () => S.inv ? S.inv.orders.reduce((a, o) => a + factsOf(o).amount, 0) : 0;

function beginForge(schemeId) {
  const L = LEVELS[S.level];
  S.scheme = schemeId;
  markSchemeUsed(schemeId);
  S.inv = { orders: SCHEMES[schemeId].build(O.SHOPS[S.level]), cur: 0, coverEmail: "", no: Math.floor(rand(10200, 99800)) };
  $("#scheme-banner").textContent = `${SCHEMES[schemeId].icon} ${SCHEMES[schemeId].name}`;
  renderTicket();
  clerkSay(L.clerk.hello);
  inspectorSay(pick(L.lines.idle));
  scheduleBoss();
  updateHud();
  post("phase", { phase: "forging" });
  if (tut.on && TUTORIAL[tut.i].wait === "scheme") setTimeout(() => { tut.i++; showTutStep(); }, 350);
  guideCheck("scheme-picked");
}

function shipLine(f) {
  const h = S.holder;
  return { billing: `${h.city}: ${h.name.split(" ")[0]}'s home`, mule: `${h.city.split(",")[0]}: 412 Elm St (your mule)`,
    reshipper: "Rotterdam forwarding warehouse", holder_email: h.email, burner_email: f.email.hijacked ? "your ProtonMail burner" : f.emailAddr }[f.ship.id];
}

function renderTicket() {
  const P = $("#invoice");
  if (!S.inv) { P.innerHTML = ""; $("#strip").innerHTML = ""; return; }
  const o = curOrder(), f = factsOf(o), h = S.holder, shop = O.SHOPS[S.level];
  const res = S.lastResult && S.lastResult.results ? S.lastResult.results[S.inv.cur] : null;
  const off = S.submitted ? "disabled" : "";
  const chips = ids => ids.map(id => id === "item"
    ? `<button class="tchip free" data-item ${off} title="Free: doesn't use an edit">🛒 ${CHIP_LABEL.item}</button>`
    : `<button class="tchip" data-tool="${id}" ${off}>${TOOLS.find(t => t.id === id).ico} ${CHIP_LABEL[id]}</button>`).join("");
  const box = (b, main, sub, hint) => `<div class="tbox region" data-region="${b.id}">
      <div class="tbox-head"><span class="tbox-title">${b.ico} ${b.title}</span><span class="tchips">${chips(b.chips)}</span></div>
      <div class="tbox-main">${main}</div><div class="tbox-sub">${sub}</div>${hint ? `<div class="tbox-hint">${hint}</div>` : ""}</div>`;
  const account = f.email.hijacked ? `Their real account: ${Math.round(f.email.accountDays / 365)} years, ${f.email.pastOrders} orders` : "Account created today";
  const phone = h.phone === "iphone" ? "iPhone" : "Android phone";
  const verdictTxt = res && (res.declined ? { card_reported: "CARD REPORTED", card_blocked: "CARD BLOCKED" }[res.reason] || "DECLINED" : "APPROVED");
  P.innerHTML = `
    <div class="t-head">
      <div class="t-logo">${LEVELS[S.level].icon}</div>
      <div class="t-id"><div class="t-shop">${shop.domain}</div><div class="t-no">Order #${shop.prefix}-${S.inv.no + S.inv.cur}</div></div>
      <div class="t-step">ORDER ${S.inv.cur + 1}<small>of ${S.inv.orders.length}</small></div>
    </div>
    <div class="t-grid">
      ${box(BOXES[0], `${cap(f.card.brand)} ${f.card.type} ••••${f.card.last4}`, `${h.name} · ${f.card.foreign ? "issued abroad" : h.city}`, f.card.sub)}
      ${box(BOXES[1], f.emailAddr, account, f.email.sub)}
      ${box(BOXES[2], f.ship.label, shipLine(f), f.ship.sub)}
      ${box(BOXES[3], f.dev.clone ? `Cloned ${phone}` : f.dev.label, `${f.dev.os} · ${f.dev.browser} · ${f.dev.screen}`, `🌐 ${f.proxy.label}: ${f.proxy.dist2} mi from the billing address`)}
      ${box(BOXES[4], `${f.item.ico} ${f.item.name}`, `⏰ ${f.clock.label}`, f.clock.sub)}
    </div>
    <div class="t-foot">
      <div class="t-route ${f.ship.toYou ? "you" : "victim"}">${f.ship.toYou ? "✓ The goods reach you" : "✗ The goods go to the cardholder"}</div>
      <div class="t-total">TOTAL <b>${price(f.amount)}</b></div>
    </div>
    ${verdictTxt ? `<div class="t-verdict ${res.declined ? "bad" : "ok"}">${verdictTxt}</div>` : ""}`;
  // forensic replay: what tipped Gus off on this order
  if (res) res.tells.slice(0, 2).forEach(t => t[2] && P.querySelector(`[data-region="${t[2]}"]`)?.setAttribute("data-tell", t[0]));
  P.classList.toggle("forensic", !!(res && res.declined));
  $$(".tchip[data-tool]", P).forEach(b => b.onclick = e => { e.stopPropagation(); selectTool(b.dataset.tool); });
  const ib = $(".tchip[data-item]", P);
  if (ib) ib.onclick = e => { e.stopPropagation(); openCart(ib); };
  renderStrip();
  updateDebug();
}

/* the campaign strip under the ticket: one panel per order */
function renderStrip() {
  const el = $("#strip");
  const results = S.lastResult && S.lastResult.results;
  const n = S.inv.orders.length;
  const panels = S.inv.orders.map((o, i) => {
    const f = factsOf(o), r = results && results[i];
    return `<button class="sp ${i === S.inv.cur ? "cur" : ""} ${f.ship.toYou ? "you" : ""}" data-i="${i}" title="Show order ${i + 1}">
      <span class="sp-n">#${i + 1}</span><span class="sp-ico">${f.item.ico}</span>
      <span class="sp-amt">${price(f.amount)}</span><span class="sp-when">${f.clock.label}</span>
      ${r ? `<span class="sp-st ${r.declined ? "bad" : "ok"}">${r.declined ? "✗" : "✓"}</span>` : ""}
      ${n > 1 && !S.submitted ? `<span class="sp-x" data-x="${i}" title="Remove this order">×</span>` : ""}</button>`;
  }).join("");
  const toYou = S.inv.orders.reduce((a, o) => { const f = factsOf(o); return a + (f.ship.toYou ? f.amount : 0); }, 0);
  el.innerHTML = `<div class="strip-label">CAMPAIGN<small>${n} order${n > 1 ? "s" : ""} · ${price(toYou)} to you</small></div>
    <div class="strip-panels">${panels}${!S.submitted && n < MAX_ORDERS ? `<button class="sp sp-add" id="sp-add" title="Copy this order as the next step">+ Next order</button>` : ""}</div>`;
  $$(".sp[data-i]", el).forEach(b => b.onclick = e => {
    const x = e.target.closest("[data-x]");
    if (x) { removeOrder(+x.dataset.x); return; }
    S.inv.cur = +b.dataset.i; sfx("click"); hidePopover(); renderTicket();
  });
  const add = $("#sp-add");
  if (add) add.onclick = addOrder;
}

function addOrder() {
  if (!S.inv || S.submitted || S.inv.orders.length >= MAX_ORDERS) return;
  S.inv.orders.splice(S.inv.cur + 1, 0, { ...curOrder(), clock: "now" });
  S.inv.cur++;
  sfx("pick"); hidePopover(); renderTicket(); updateHud();
  showTip("first-campaign", "➕ Gus scores every order. One declined order blocks the card for the rest.", "campaigns");
}
function removeOrder(i) {
  if (S.submitted || S.inv.orders.length < 2) return;
  S.inv.orders.splice(i, 1);
  if (S.inv.cur >= i && S.inv.cur > 0) S.inv.cur--;
  sfx("snip"); hidePopover(); renderTicket(); updateHud();
}

/* the item is free to change: it's what you buy, not a trick */
function openCart(anchor) {
  const shop = O.SHOPS[S.level], o = curOrder();
  openPopoverAt(anchor, "🛒 Pick the item · free", shop.catalog.map(i => ({
    label: `${i.ico} ${i.name} · ${price(i.price)}`, sub: i.kind === "digital" ? "Digital: the code is emailed" : "Shipped to an address",
    current: o.sku === i.sku,
    act: () => { o.sku = i.sku; O.fixShip(shop, o); sfx("pen"); renderTicket(); updateHud(); },
  })));
}

/* ======================= Toolkit ======================= */

function toolAvailable() { return true; }

function renderTools() {
  $("#tools").innerHTML = TOOLS.map((t, i) => {
    const left = t.cap - (S.uses[t.id] || 0);
    return `<div class="tool ${left <= 0 ? "empty" : ""} ${S.tool === t.id ? "active" : ""}" data-tool="${t.id}" title="${t.name}: ${t.hint}">
      <span class="key">${i + 1}</span><span class="ico">${t.ico}</span><span class="nm">${t.name}</span>
      <span class="uses">${left}</span></div>`;
  }).join("");
  $$(".tool").forEach(el => el.onclick = () => selectTool(el.dataset.tool));
  $("#edits-left").textContent = `Changes ${S.edits}/${S.maxEdits}`;
  $("#envelope").classList.toggle("ready", S.edits >= 2);
}

function selectTool(id) {
  if (!S.inv || S.submitted) return;
  const t = TOOLS.find(x => x.id === id);
  if (S.tool === id && $("#popover").classList.contains("show")) return dropTool();
  if (S.uses[id] >= t.cap) { sfx("bad"); toast(`No ${t.name} uses left this round`, "bad"); return; }
  if (S.edits >= S.maxEdits) { sfx("bad"); toast("No changes left: time to send it!", "bad"); return; }
  S.tool = id;
  sfx("pick"); renderTools();
  const all = CAMPAIGN_TOOLS.includes(id);
  hint(`${t.hint}${all ? " (every order)" : " (this order)"}`);
  const o = curOrder(), shop = O.SHOPS[S.level];
  const opts = id === "ship" ? O.shipOptions(shop, o) : t.options;
  const anchor = $(`#invoice .tchip[data-tool="${id}"]`) || $(`#tools [data-tool="${id}"]`);
  openPopoverAt(anchor, `${t.ico} ${t.name} · ${all ? "every order" : "this order"}`, opts.map(op => {
    const locked = op.unlock && !S.unlocks.includes(op.unlock);
    const heat = id === "ship" && S.perks.includes("mules") ? 0 : op.heat;
    return { label: (locked ? "🔒 " : "") + op.label, sub: locked ? "Unlock it in the shop" : op.sub,
      current: o[id] === op.id, disabled: locked, heat, act: () => applyOption(t, op, heat) };
  }));
}

function applyOption(t, op, heat) {
  (CAMPAIGN_TOOLS.includes(t.id) ? S.inv.orders : [curOrder()]).forEach(o => o[t.id] = op.id);
  sfx({ card: "snip", email: "pen", proxy: "msg", device: "pick", ship: "chunk", clock: "click" }[t.id] || "pick");
  spend(t.id, heat);
  renderTicket();
  if (t.id === "ship" && op.toYou) {
    showTip("first-route", "📦 The goods reach you now. At least one order must, or there's no payout!", "route-goods");
    guideCheck("goods-routed");
  }
}

function dropTool() {
  S.tool = null;
  hidePopover(); hint(""); renderTools();
}

function hint(text) { $("#tool-hint").textContent = text; $("#tool-hint").classList.toggle("show", !!text); }

function spend(id, heat) {
  S.uses[id]++; S.edits++;
  addHeat(heat);
  S.tool = null; hint(""); renderTools();
  updateHud();
  guideCheck("edit");
}

document.addEventListener("pointermove", e => {
  const c = $("#tool-cursor");
  if (c) { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }
});

/* options list under (or above) a button; `heat` shows what the choice costs */
function openPopoverAt(anchor, title, options) {
  const r = anchor.getBoundingClientRect(), below = toStage(r.left, r.bottom), above = toStage(r.left, r.top);
  const pop = $("#popover");
  pop.innerHTML = `<div class="pop-title">${title}</div>` + options.map((o, i) => `
    <button class="pop-opt ${o.current ? "current" : ""}" data-i="${i}" ${o.current || o.disabled ? "disabled" : ""}>
      <span class="po-top">${o.label}${o.current ? `<i class="po-now">✓ now</i>` : o.heat ? `<i class="po-heat">+${o.heat} 🔥</i>` : ""}</span>
      <small>${o.sub}</small></button>`).join("");
  pop.classList.add("show");
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = clamp(below.x, 10, 1590 - w) + "px";
  pop.style.top = (below.y + 6 + h <= 890 ? below.y + 6 : clamp(above.y - h - 6, 10, 890 - h)) + "px";
  $$(".pop-opt", pop).forEach(b => b.onclick = ev => { ev.stopPropagation(); hidePopover(); options[b.dataset.i].act(); });
}
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
  $("#edits-left").textContent = `Changes ${S.edits}/${S.maxEdits}`;
  $("#envelope").classList.toggle("ready", S.edits >= 2);
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
  if (S.edits < 2) { sfx("bad"); stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake"); toast("Make at least 2 changes before sending", "bad"); return; }
  // validity gate (MOCK rule check): something has to reach you
  if (!S.inv.orders.some(o => factsOf(o).ship.toYou)) { sfx("bad"); toast("Nothing reaches you! 📦 Ship to a drop address or email the code to your burner.", "bad"); return; }
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

/* the rows for the campaign on screen; random parts (minutes, ids) stay put until the orders change */
let rowCache = { key: null, rows: null };
function previewRows() {
  const key = JSON.stringify([S.round, S.inv.orders]);
  if (rowCache.key !== key) rowCache = { key, rows: O.toRows(campaignCtx()) };
  return rowCache.rows;
}

// MOCK verdict: the scripted Gus in orders.js
function mockJudge() {
  const rows = previewRows();
  const r = O.judgeOrders({ ...campaignCtx(), rows, memo: S.memo, version: S.version, heat: S.heat, persuasion: S.persuasion, learned: S.learned });
  const payout = Math.round(r.payout * SCHEMES[S.scheme].pay * (S.perks.includes("night") ? 2 : 1));
  return { ...r, rows, payout, line: null, newVersion: null, source: "mock" };
}

/* turn a POST /submit response into the shape the UI uses; tells are [name, weight, box] */
function adaptVerdict(r, mock) {
  const verdict = String(r.verdict ?? "").toUpperCase();
  const caught = verdict ? ["FLAGGED", "DECLINED"].includes(verdict) : !!r.caught;
  const raw = r.top_tells ?? r.tells ?? [];
  const tells = raw.map(t => {
    const name = typeof t === "string" ? t : t.tell_type ?? t.feature ?? t.name ?? t.tell;
    const weight = typeof t === "string" ? 1 : +(t.strength ?? t.weight ?? t.score ?? 1);
    const region = typeof t === "string" ? null : t.region;
    return [name, weight, region || TELL_REGION[name] || null];
  }).filter(t => t[0]);
  const v = +(r.new_version ?? r.version);
  return { caught, tells, payout: +(r.payout ?? (caught ? 0 : mock.payout)), results: r.results ?? mock.results, rows: mock.rows,
    line: r.inspector_line ?? r.line ?? null, newVersion: Number.isFinite(v) && v > 0 ? v : null, source: "api" };
}

async function judge() {
  const mock = mockJudge();
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
      // BLOCKED: never scored, the card was already declined or reported earlier in the campaign
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
  inspectorSay(`Reviewing your orders…`);
  const pending = judge(); // start the request now, the animation covers the wait

  await sleep(900);
  ob.classList.remove("scanning");
  const st = $(".inspect-stage");
  st.classList.remove("done");
  $("#big-stamp").className = "big-stamp"; $("#cash-pop").classList.remove("show");
  $("#inspect-line").textContent = `${L.inspector.name} v${S.version} is reviewing ${S.inv.orders.length > 1 ? S.inv.orders.length + " orders" : "your order"}…`;
  $("#inspect-line").classList.add("show", "reading");
  overlay("inspect"); sfx("scan");

  const [res] = await Promise.all([pending, sleep(1500)]);
  S.lastResult = res;
  S.rows = finishRows(res);
  const { caught, tells, payout } = res;
  const bs = $("#big-stamp");
  bs.textContent = caught ? "DECLINED" : "APPROVED";
  bs.classList.add("show", caught ? "flagged" : "paid");
  sfx("stamp");
  st.classList.add("done");
  const said = res.line || (res.reported && !tells.length ? "The cardholder called their bank. Card blocked!" : pick(L.lines[caught ? "catch" : "pass"]));
  $("#inspect-line").classList.remove("reading");
  $("#inspect-line").textContent = `${L.inspector.name} v${S.version}: "${said}"`;
  inspectorSay(said);
  const n = S.inv.orders.length;
  post("verdict", { caught, line: said, payout, scheme: SCHEMES[S.scheme].name,
    vendor: `${n} order${n > 1 ? "s" : ""} · ${O.SHOPS[S.level].domain}`, tells: tells.slice(0, 3).map(t => t[0]) });
  $("#inspect-line").classList.add("show");
  if (caught) {
    sfx("buzz"); stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake");
    S.streak = 0; S.caughtCount++;
    if (S.caughtCount === 1) showTip("first-caught", "🔍 Declined! The red boxes show what Gus spotted. Press D for the full row.", "tells-explained");
    addHeat(12);
  }
  if (payout > 0) { // orders that got through before a decline still pay
    S.money += payout;
    if (!caught) S.streak++;
    $("#cash-pop").textContent = "+" + money(payout); $("#cash-pop").classList.add("show");
    setTimeout(() => sfx("cash"), 250);
    $("#tb-money").classList.remove("bump"); void $("#tb-money").offsetWidth; $("#tb-money").classList.add("bump");
    if (!caught) S.cards.push({ scheme: S.scheme, payout, round: S.round, isNew: true });
  }
  S.history.push({ round: S.round, scheme: S.scheme, caught, payout, version: S.version, tells: tells.map(t => t[0]) });
  // forensic replay: open the first declined order on the ticket
  const firstBad = res.results ? res.results.findIndex(r => r.declined) : -1;
  if (firstBad >= 0) S.inv.cur = firstBad;
  renderTicket();
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
      <div class="cc-stamp ${r.caught ? "" : "paid"}">${r.caught ? "DECLINED" : "GOT AWAY"}</div>
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
    ? learned.map(l => `<li>Now catches: <b>${l}</b> — learned from ${n} orders.</li>`)
    : [`<li>No new tricks learned. <b>Clean job.</b></li>`];
  const st = stageFor(S.version);
  if (stageFor(S.version - 1) !== st) items.push(`<li>Promoted to <b>${st.title}</b></li>`);
  if (S.streak >= 2) { items.push(`<li>🔥 Streak ×${S.streak} — vary your schemes to keep it.</li>`); showTip("first-streak", "🔥 Streak! Different schemes in a row. Keep varying!", "streak-bonus"); }
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

const GUIDE_KEY = "forged-guided-done";
const GUIDE = { on: false, step: 0, waitingFor3D: null };

const GUIDE_STEPS = [
  { id: "sit",       world: true,  label: "Go to your desk",      instr: "Walk to your desk and press E to sit down." },
  { id: "scheme",    instr: "Read the memo and the card & shop file, then pick a scheme.",
    spotlight: ["#scheme-cards"] },
  { id: "edit-bank", instr: "Use 📦 Drop address so the goods reach you, not the cardholder.",
    spotlight: [".tool[data-tool=ship]"] },
  { id: "edit-tool", instr: "Make one more change: you need at least 2 to send.",
    spotlight: ["#tools"] },
  { id: "clerk",     instr: "Send a short note to customer support. Match their quirk!",
    spotlight: ["#win-clerk"], skippable: true },
  { id: "submit",    instr: EMBED ? "Drag the envelope onto PRINT to send your orders." : "Drag the envelope into the OUTBOX.",
    spotlight: ["#envelope"] },
  { id: "pickup",    world: true,  label: "Grab at printer",      instr: "Walk to the printer and press E to grab it." },
  { id: "deliver",   world: true,  label: "Drop in IN tray",      instr: "Carry it to Gus's IN tray and press E." },
  { id: "verdict",   instr: "Gus is reviewing your orders..." },
  { id: "done",      instr: "Tutorial complete! You're ready to forge on your own.", auto: true },
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
    if (r) {
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
    case "scheme": if (event === "scheme-picked") advanceGuide(); break;
    case "edit-bank": if (event === "goods-routed") advanceGuide(); break;
    case "edit-tool": if (event === "edit" && S.edits >= 2) advanceGuide(); break;
    case "clerk": if (event === "clerk-sent") advanceGuide(); break;
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

const TUT_KEY = "forged-tutorial-done";
const TUT_SCHEME = "account_takeover"; // the tutorial's steps are written for this scheme

// while the tutorial waits for a scheme, only the tutorial's scheme can be picked
function lockSchemes(on) {
  $$(".scheme-card").forEach(c => {
    const lock = on && c.dataset.scheme !== TUT_SCHEME;
    c.disabled = lock;
    c.classList.toggle("tut-locked", lock);
    c.title = lock ? "Available after the tutorial" : "";
  });
}
// Steps with `until` are hands-on: the player does the thing, the card turns green and
// moves on. `can` says whether the step is still possible (uses left); if not, "Skip step" shows.
const usesLeft = id => S.inv && S.uses[id] < TOOLS.find(t => t.id === id).cap && S.edits < S.maxEdits;
const TUTORIAL = [
  { at: [`.scheme-card[data-scheme=${TUT_SCHEME}]`], side: "top", wait: "scheme", title: "Pick your scheme",
    text: () => `Each card is a ready-made fraud campaign, with its <b>risk</b> and <b>payout</b>. <b>Hover a card</b> to see which tools help, which to avoid, and what gives it away.<br><br>For this tutorial, start with <b>Account takeover</b>: one order from the cardholder's own account. The others unlock as soon as the tutorial ends.` },
  { at: ["#win-memo"], side: "right", title: "The leaked memo",
    until: () => S.memo.some(m => m.mark),
    text: () => `The boss's orders to Gus, the shop's risk engine: what he's watching this round. <b>Two rules are real, one is fake.</b> You work out which from what gets caught.<br><br><b>Try it:</b> click any rule to mark it REAL. Click again for FAKE.` },
  { at: ["#win-case"], side: "right", title: "The card and the shop",
    text: () => `At the top, this round's stolen card: <b>whose it is, where they live, their real email and phone</b>. Below, what normal looks like at this shop. <b>The more your orders look like this cardholder's normal, the harder they are to catch.</b>` },
  { at: ["#scheme-banner", "#invoice"], side: "right", title: "Your order",
    text: () => `One checkout in 5 boxes. <b>You never type anything:</b> the buttons in each box swap what's in it. The line at the bottom says who gets the goods. Right now it's the cardholder, so you'd earn nothing.` },
  { at: ["#dock .dock-label", "#tools"], side: "top", title: "The toolkit",
    text: () => `Each tool swaps one box: ${kb("tool1")}–${kb("tool6")}, a click, the box's buttons, or the mouse wheel. Card, email, device and IP belong to your persona and apply to every order. Address and time apply to the order on screen. The 🔥 number is the heat a choice costs. <b>You need 2 changes to send</b>, ${S.maxEdits} at most.` },
  { at: [".tool[data-tool=ship]", "#invoice [data-region=ship]"], side: "right", title: "Get the goods: drop address",
    until: () => S.inv && S.inv.orders.some(o => factsOf(o).ship.toYou), can: () => usesLeft("ship"),
    text: () => `<b>Do it:</b> press ${kb("tool5")} (or 📦 Change address) and pick <b>Mule in the same city</b>.<br><br>Without it, the order ships to the victim's home and you get nothing.` },
  { at: [".tool[data-tool=device]", "#invoice [data-region=device]"], side: "right", title: "Blend in: device and IP",
    until: () => S.inv && (S.uses.device >= 1 || S.uses.proxy >= 1), can: () => usesLeft("device") || usesLeft("proxy"),
    text: () => `This is the cardholder's own account, and they always shop from their phone, near home. Your Windows laptop and home IP stand out.<br><br><b>Do it:</b> press ${kb("tool4")} for another device, or ${kb("tool3")} for a VPN near the cardholder. Cloning their phone unlocks in the shop.` },
  { at: ["#strip"], side: "top", title: "Campaigns",
    text: () => `The whole scheme, one panel per order. <b>+ Next order</b> copies the order on screen so you can add a step: a tiny test charge first, or a second buy a day later. Gus scores every order, and <b>one declined order blocks the card</b> for the rest.` },
  { at: ["#win-clerk"], side: "left", title: "Sweet-talk support",
    enter: () => { tut.base = S.clerkReplies || 0; }, until: () => (S.clerkReplies || 0) > tut.base,
    text: () => `<b>Do it:</b> press ${kb("chat")} (or click the box), type a short note to customer support and press Enter. ${LEVELS[S.level].clerk.name}'s quirk is in the window's corner: <i>${LEVELS[S.level].clerk.quirk}</i>. Notes that play to it fill the <b>Convinced</b> bar, which lowers Gus's suspicion.` },
  { at: [], noDim: true, drill: true, title: "Practice: the boss",
    enter: () => { tut.hid = false; tutBossDrill(); }, until: () => tut.hid,
    text: () => `The boss walks by while you work. When the red <b>FOOTSTEPS!</b> banner appears, press ${kb("hide")} fast to slide a newspaper over the screen. Miss it in a real round and you take +15 heat.<br><br><b>Practice now</b> (no heat): footsteps are coming…` },
  { at: ["#win-inspector"], side: "left", title: "Gus, the risk engine",
    text: () => `Who's judging your orders, and which version he is. Every round he's retrained on your tricks and gets smarter: <b>intern → magnifier → UV lamp → cyborg</b>. A tell that caught you once weighs more from then on.` },
  { at: ["#topbar .tb-heat", "#topbar .tb-money"], side: "bottom", title: "Heat and money",
    text: () => `<b>Heat</b> rose with each change you just made. It also climbs when you repeat a scheme, and high heat makes Gus suspicious. <b>Siphoned</b> is your money so far.` },
  { at: [], noDim: true, title: "What Gus sees", hold: 2600,
    until: () => $("#debug-panel").classList.contains("show"), leave: () => $("#debug-panel").classList.remove("show"),
    text: () => `<b>Do it:</b> press ${kb("detector")} to see exactly what Gus's model reads: <b>one row per order</b>, in the same format as the real card-fraud data the model trains on. Every choice you made is in there.` },
  { at: ["#envelope"], side: "left", title: EMBED ? "Print and deliver" : "Send it", last: true,
    until: () => S.printed || S.submitted, can: () => S.edits >= 2,
    text: () => EMBED
      ? `<b>Do it:</b> drag this envelope onto <b>PRINT</b> (the dark box at the top right). You'll stand up: grab the order slip at the printer (${kb("interact")}), drop it in Gus's IN tray (${kb("interact")}), then sit back down for the verdict and the shop.<br><br><kbd>Esc</kbd> opens the Game Menu any time.`
      : `<b>Do it:</b> drag this envelope into the <b>OUTBOX</b> (the dark box at the top right). Gus stamps each order APPROVED or DECLINED, then you spend your money in the shop.<br><br><kbd>Esc</kbd> opens the Game Menu any time.` },
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

/* ======================= What Gus sees (the IEEE-CIS rows) ======================= */

function record() {
  if (!S.inv) return { note: "pick a scheme first" };
  return {
    mode: "online", level: S.level, scheme: S.scheme, campaign_id: S.session + "-r" + S.round,
    orders: S.inv.orders.map(o => ({ ...o })),
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
  if (!S.inv) { $("#debug-title").textContent = "No order yet"; $("#debug-json").textContent = "Pick a scheme first."; return; }
  const rows = S.rows || previewRows(), i = S.inv.cur;
  $("#debug-title").textContent = `Order ${i + 1} of ${rows.length}, as an IEEE-CIS row`;
  $("#debug-json").textContent = JSON.stringify(compact(rows[i]), null, 2) +
    "\n\n// Blank columns (V1-V339 and the rest) are empty (NaN), as in most rows of the dataset.";
}
function toggleDebug() { $("#debug-panel").classList.toggle("show"); updateDebug(); }

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
  for (let i = 1; i <= 6; i++) if (K.is("tool" + i, code)) { e.preventDefault(); selectTool(TOOLS[i - 1].id); return; }
  if (K.is("drop", code)) { dropTool(); return; }
  if (K.is("chat", code) && S.inv && !S.submitted) { e.preventDefault(); $("#chat-text").focus(); }
});

// mouse buttons can be bound too ("Mouse3" = back button…); left click stays the pointer
document.addEventListener("mousedown", e => {
  if (e.button === 0 || S.paused) return;
  const code = "Mouse" + e.button, K = ForgedKeys;
  if (EMBED && K.is("standUp", code)) { e.preventDefault(); post("stand"); }
  else if (K.is("hide", code) && S.bossWindow) { e.preventDefault(); hideInvoice(); }
});

// mouse wheel cycles through the tools you can still use, like a hotbar
let wheelAt = 0;
$("#screen-desk").addEventListener("wheel", e => {
  if (S.paused || (tut.on && !TUTORIAL[tut.i].until) || $(".overlay.show") || !S.inv || S.submitted) return;
  if (e.target.closest(".win-body, #debug-panel, #popover")) return; // let windows scroll
  e.preventDefault();
  const now = performance.now(); if (now - wheelAt < 140) return; wheelAt = now; // trackpads send bursts
  if (S.edits >= S.maxEdits) return;
  const usable = TOOLS.filter(t => !t.instant && toolAvailable(t) && S.uses[t.id] < t.cap);
  if (!usable.length) return;
  const i = usable.findIndex(t => t.id === S.tool), dir = e.deltaY > 0 ? 1 : -1;
  const next = usable[i < 0 ? (dir > 0 ? 0 : usable.length - 1) : (i + dir + usable.length) % usable.length];
  if (next.id !== S.tool) selectTool(next.id);
}, { passive: false });

document.addEventListener("pointerdown", e => {
  if (!e.target.closest("#popover") && !e.target.closest(".tchip") && !e.target.closest(".tool")) { if (S.tool) dropTool(); else hidePopover(); }
});

})();
