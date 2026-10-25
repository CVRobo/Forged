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
const brand = s => s.replace(/\b\w/g, c => c.toUpperCase()); // "american express" → "American Express"

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
      look: { skin: "#f1c27d", hair: "messy", hairColor: "#5a3a22", mouth: "o", brows: "raised" }, // matches Theo in the office
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
  3: {
    name: "Port Nocturne Shipping", short: "Port Nocturne", icon: "🚢", difficulty: "Hard",
    swatches: ["#1d2a44", "#ff9a2e", "#f4efe6"],
    inspector: { name: "Old Salt", personality: "Gruff fraud robot who remembers every trick he's ever seen" },
    memoryCap: 200, // "remembers everything": keeps far more of your past wins (levels 1–2 keep 40)
    clerk: { name: "Dez", avatar: "🥱", quirk: "half asleep on the night shift",
      look: { skin: "#8d5524", hair: "messy", hairColor: "#1a1210", lids: true, mouth: "flat", brows: "flat" }, // sleepy (half-closed lids)
      hello: "Port Nocturne night desk… *yawn*… Dez. If it's urgent, say urgent. Slowly.",
      keywords: ["urgent", "tracking", "coffee", "dock", "night", "container", "tonight"],
      replies: {
        good: ["Urgent freight? Fine. Stamped. Back to my nap.", "Coffee and a tracking number? You get me.", "Mm-hm. Ships tonight. Zzz."],
        meh: ["*yawns* …sorry, what port?", "It's 3am. Everything looks fine at 3am.", "I'll log it. Probably."],
        bad: ["Too many words. My eyes are closing.", "That doesn't sound like any dock I know.", "Old Salt's gonna want to see this one."],
      } },
    memo: O.MEMOS[3],
    lines: {
      idle: ["Forty years on these docks. Seen every trick twice.", "I never forget a face. Or a postcode.", "Fog's rolling in. So are the fakes."],
      pass: ["Hm. Clean manifest. Ship it.", "Aye. That one floats.", "Approved. Don't make me regret it."],
      catch: ["Seen this one before, sailor.", "That cargo's crooked.", "Nope. I wrote this trick down in '09."],
    },
  },
  4: {
    name: "Neon Arcade Holdings", short: "Neon Arcade", icon: "🕹️", difficulty: "Boss",
    swatches: ["#ff2bd6", "#19e3ff", "#120014"],
    inspector: { name: "GL1TCH", personality: "Paranoid fraud robot that flags anything unusual" },
    memoryCap: 200, // remembers like Old Salt
    clerk: { name: "Pixel", avatar: "🎮", quirk: "speedrunning every conversation",
      look: { skin: "#f1c27d", hair: "messy", hairColor: "#ff2bd6", mouth: "grin", brows: "raised", earrings: true },
      hello: "Neon Arcade support, Pixel here, current record 41 seconds per ticket. GO.",
      keywords: ["gg", "fast", "speedrun", "combo", "glitch", "respawn", "quick"],
      replies: {
        good: ["GG. Approved in record time.", "Short and sweet? New personal best!", "Combo! Pushed it through."],
        meh: ["Hmm. That cost me two seconds.", "Sure, sure. Skipping the cutscene.", "…loading… …okay."],
        bad: ["Way too long. Run's dead.", "That reads like a cheat code. Nope.", "GL1TCH is gonna flag that so hard."],
      } },
    memo: O.MEMOS[4],
    lines: {
      idle: ["SCANNING… SCANNING… *static*", "Everything is suspicious. Especially you.", "I once flagged my own reflection."],
      pass: ["…ANOMALY NOT FOUND. Approved. For now.", "Pattern acceptable. Barely.", "APPROVED. I'm still watching."],
      catch: ["ANOMALY DETECTED.", "That's not normal. NOTHING is normal.", "ERROR 404: TRUST NOT FOUND."],
    },
  },
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
  { id: "shred", ico: "🗑️", name: "Paper Shredder", desc: "Gus forgets one of your wins.", cost: 1200 },
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
  email_risky: "you", email_mismatch: "you", yahoo: "you", name_mismatch: "you", odd_domain: "you", new_account: "you", new_device: "device", device_reuse: "device",
  emulator: "device", device_mobile: "device", ip_far: "where", proxy: "where", far_ship: "ship", new_address: "ship",
  gift_card: "cart", amount_unusual: "cart", copycat: "cart", amount_jump: "when", velocity: "when", night: "when", friday: "when",
  new_card: "card", foreign_card: "card", identity: "card",
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
  "victim":          { icon: "💳", title: "Today's Victim",    text: "Each round a new stolen card lands on your desk. The victim panel shows whose it is and where they live; higher ranks show their email, their phone and what people usually spend. The more your order looks like them, the safer." },
  "checkout":        { icon: "🛒", title: "The Checkout",      text: "One question at a time: what you buy, who you pretend to be, what you shop on, where you shop from, where it goes, when and how many times. Type anything. New questions unlock as you rank up." },
  "route-goods":     { icon: "📦", title: "Get the Goods",     text: "Delivery decides who gets the loot. Their home means they get it (and you get nothing). A nearby address is quiet; a warehouse abroad is safe for you but loud. Gift card codes go to an email you control." },
  "gut":             { icon: "😊", title: "Gus's Gut Feeling", text: "The face in the checkout's address bar shows how worried Gus would be right now. It's the same rules as his verdict, minus a little luck. Keep changing your answers until he relaxes." },
  "delivery":        { icon: "🖨️", title: "Print & Deliver",   text: "In the office, dragging the envelope onto PRINT sends your order slip to the printer. Grab it there, carry it to Gus's IN tray, and keep it out of the boss's vision cone or he'll stop you (+10 heat)." },
  "heat-basics":     { icon: "🔥", title: "Heat",              text: "Risky choices and getting caught raise your heat. Above 40 % Gus gets suspicious of everything. Heat cools down between rounds." },
  "version-bump":    { icon: "🧠", title: "Gus Learns",        text: "Gus only learns when you beat him. Each win makes him a little sharper, he watches harder for the warning signs that were in your order, and he recognizes close copies of it. Getting caught teaches him nothing, so try again." },
  "memo-deduction":  { icon: "📝", title: "Memo Rules",        text: "Two of the three memo rules are real: Gus actually watches for those. The third is a decoy." },
  "shop-intro":      { icon: "🛒", title: "The Shop",          text: "Between rounds you can buy perks and new disguises. Perks last the whole run (3 max)." },
  "boss-patrol":     { icon: "🕴️", title: "The Boss",          text: "The boss patrols the office. The yellow cone on the floor is what he can see. If he walks behind your desk, press Space to hide the screen. In the office, keep the envelope out of his cone." },
  "hiding":          { icon: "🚪", title: "Hiding",            text: "Walls and closed doors block the boss's view. Doors open when you walk into them; press E by one to close it behind you. Duck into a side room with the slip and shut the door until he's passed." },
  "boss-planner":    { icon: "📒", title: "The Boss's Planner", text: "While the boss is out on patrol, sneak into his office and press E at the red planner on his desk: his next 20 s of route appears on the floor, with 5 s markers. On Port Nocturne he takes a different route every patrol (and sometimes doubles back), so check it before a run with the slip. If he walks in and catches you in there, +15 heat." },
  "break-perks":     { icon: "☕", title: "Break Room",        text: "Coffee makes you walk faster and the boss slower to notice you for 30 s. A donut can sweeten Brenda (she'll whisper a hint), Gus, or even the boss." },
  "tells-explained": { icon: "🔍", title: "What Gus Checks",   text: "Who's buying, from where, on what device, what, when, and how fast. After a catch, the review line that gave you away glows red." },
  "streak-bonus":    { icon: "🔥", title: "Streaks",           text: "Getting away with it several rounds in a row builds a streak. Changing your plan keeps it alive." },
  "campaigns":       { icon: "🔁", title: "Several Orders",    text: "Operators can repeat an order a few days apart. More loot, but several orders on one card is something Gus watches, and one catch blocks the card for the rest." },
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
  memory: [], // signatures of the tricks that fooled Gus (he only learns from your wins)
  scheme: null, holder: null, wallet: [], inv: null, input: null, step: null, sugg: {}, persuasion: 0,
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
  $("#btn-quit").textContent = "Clock out"; // back to the office's Clock in card to pick a level
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
  if (go && EMBED && go.dataset.go === "levels") { sfx("click"); startRun(S.chosenLevel || 1); return; } // in the office the level was picked before clocking in
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
    hist: O.newHistory(), learned: {}, session: "s" + Date.now().toString(36), holder: null, xp: loadXp(), rankUp: null, lanBrain: false });
  Object.assign(S, loadBrain(level)); // Gus keeps what he learned from your past wins
  stage.dataset.level = level;
  $("#desk-mess").innerHTML = "";
  const L = LEVELS[level];
  $("#tb-level").textContent = L.name;
  $("#case-client").textContent = O.SHOPS[level].domain;
  $("#memo-to").textContent = L.inspector.name;
  if (EMBED) $("#insp-win-title").textContent = `Printer · ${L.inspector.name} down the hall`;
  $("#clerk-avatar").innerHTML = faceSVG(L.clerk.look || LOOKS.clerk);
  $("#clerk-name").textContent = L.clerk.name;
  $("#clerk-sub").textContent = "Customer support · " + L.clerk.quirk;
  $("#clerk-quirk").textContent = "quirk: " + L.clerk.quirk;
  show("desk");
  nextRound();
}

/* retry: after a catch, the same victim and card come back with your answers filled in,
 * and the checkout opens where Gus caught you */
function nextRound(retry = false) {
  S.round++;
  S.heat = Math.round(S.heat * 0.6);
  const prev = S.holder; // a new stolen card every round
  const again = retry && S.lastResult && S.lastResult.caught ? { input: { ...S.input }, tells: S.lastResult.tells.slice(0, 2) } : null;
  // the stolen cards on your desk this round (a Mastermind picks one; everyone else gets the first)
  const wallet = again ? S.wallet : shuffle(O.HOLDERS.filter(h => !prev || h.name !== prev.name)).slice(0, 3).map(h => ({ ...h, card: pick(O.CARDS) }));
  Object.assign(S, { scheme: null, inv: null, input: null, step: null, sugg: {}, persuasion: 0, submitted: false,
    printed: false, delivered: false, lastResult: null, rows: null, holder: again ? prev : wallet[0], wallet, retryTells: again ? again.tells : null,
    gutApi: S.gutApi && S.gutApi.off ? S.gutApi : null });
  $("#tb-round").textContent = S.round;
  $("#invoice").innerHTML = ""; $("#invoice").className = "paper plan";
  $("#strip").innerHTML = "";
  $("#scheme-banner").textContent = "";
  $("#chat").innerHTML = ""; $("#persuade-fill").style.width = "0%";
  $("#envelope").classList.remove("printed");
  dealMemo();
  renderInspector();
  startPlanning();
  if (again) {
    S.input = again.input;
    S.touched = new Set(steps().map(s => s.id));
    const at = again.tells.map(t => t[2]).find(id => id && steps().some(s => s.id === id));
    S.step = at || "review";
    rebuild();
    if (again.tells.length) toast(`↺ Gus caught you on: ${tellLabel(again.tells[0][0])}. Change it and send again.`);
  }
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
      <li>💳 Their ${brand(h.card.brand)} ${h.card.type} ••••${h.card.last4} is on your desk.</li>
      ${r.n >= 2 ? `<li>📱 Always shops from ${phone}.</li><li>📧 ${h.email}</li>` : ""}
      ${r.n >= 3 ? `<li>🛒 People here spend about ${price(O.SHOPS[S.level].typical)}.</li>` : ""}
    </ul>`;
}
function hideSchemeTip() { $("#scheme-tip").classList.remove("show"); }

/* ======================= The checkout =======================
 * A fake web-shop checkout, one question per screen. The player types anything
 * (suggestions help when stuck); orders.js reads the text into the row's fields.
 * Ranks add questions. Gus's "gut feeling" face reacts as you type. */

const STEPS = [
  { id: "card", rank: 5, title: "Card", ask: "Which stolen card do you use?" },
  { id: "cart", rank: 1, title: "Cart", ask: "What are you buying?",
    fields: [{ k: "item", ph: "Anything: an espresso machine, a PS5, a $200 gift card…" }, { k: "price", ph: "$ price (optional)", small: true }] },
  { id: "you", rank: 2, title: "You", ask: "Who are you pretending to be?",
    fields: [{ k: "name", ph: "Name on the order" }, { k: "email", ph: "Email address" }] },
  { id: "device", rank: 3, title: "Device", ask: "What are you shopping on?", fields: [{ k: "device", ph: "e.g. iPhone, Samsung Galaxy, Windows laptop…" }] },
  { id: "where", rank: 3, title: "Location", ask: "Where are you shopping from?", fields: [{ k: "where", ph: "Home, a city, a VPN in a city, Tor…" }] },
  { id: "ship", rank: 1, title: "Delivery", ask: "Where does it go?", fields: [{ k: "ship", ph: "A city or an address" }] },
  { id: "when", rank: 4, title: "Timing", ask: "When do you order, and how many times?",
    fields: [{ k: "when", ph: "Now, 3 AM, tomorrow at lunch…" }, { k: "repeat", ph: "How many orders (1-5)", small: true }, { k: "gap", ph: "Days between them", small: true }] },
  { id: "review", rank: 1, title: "Review", ask: "Ready to place the order?" },
];
const steps = () => STEPS.filter(s => s.rank <= rank().n);
const stepIndex = () => Math.max(0, steps().findIndex(s => s.id === S.step));
const factsOf = o => O.facts(S.level, S.holder, o, { perks: S.perks });
const campaignTotal = () => S.inv ? S.inv.orders.reduce((a, o) => a + factsOf(o).amount, 0) : 0;
const planReady = () => !!(S.input && S.input.item && S.input.item.trim()) && (!S.inv || S.inv.orders.some(o => factsOf(o).ship.toYou));

function startPlanning() {
  const L = LEVELS[S.level], r = rank(), h = S.holder, first = h.name.split(" ")[0].toLowerCase(), last = h.name.split(" ")[1].toLowerCase();
  // answers to the questions a rank doesn't ask yet: a plain look-alike shopper at home
  S.input = { item: "", price: "", name: "", email: `${first}.${last}${10 + h.addr1 % 80}@gmail.com`, device: "", where: "", ship: "", when: "", repeat: "", gap: "" };
  // the questions a rank doesn't ask yet come as a quiet starter kit: their stolen login, on their kind of phone, from their city
  const asks = id => steps().some(s => s.id === id);
  if (!asks("you")) Object.assign(S.input, { name: h.name, email: h.email });
  if (!asks("device")) S.input.device = h.phone === "iphone" ? "iPhone" : "Samsung Galaxy";
  if (!asks("where")) S.input.where = h.city.split(",")[0];
  S.inv = { orders: [], cur: 0, coverEmail: "" };
  S.step = steps()[0].id;
  S.sugg = {}; S.touched = new Set();
  $("#win-clerk").classList.toggle("win-off", !r.windows.includes("clerk"));
  $("#win-memo").classList.toggle("win-off", !r.windows.includes("memo"));
  $("#win-case").style.top = r.windows.includes("memo") ? "352px" : "76px"; // the victim moves up while there's no memo
  renderCaseFile();
  rebuild();
  if (r.windows.includes("clerk")) clerkSay(L.clerk.hello);
  inspectorSay(pick(L.lines.idle));
  scheduleBoss();
  post("phase", { phase: "forging" });
  if (tut.on && tutStep().wait) setTimeout(() => tutDone(tutStep(), true), 350); // made it to the checkout
  else if (!tutorialDone() && S.round === 1) setTimeout(() => { if (tut.on) showTutStep(); else startTutorial("victim"); }, 350);
}

/* suggestions for when you're stuck: a few, reshuffled each round */
function suggestions(k) {
  if (S.sugg[k]) return S.sugg[k];
  const h = S.holder, shop = O.SHOPS[S.level], city = h.city.split(",")[0], first = h.name.split(" ")[0].toLowerCase(), last = h.name.split(" ")[1].toLowerCase();
  const near = O.CITIES.filter(c => !c.foreign && c.name !== city && O.findCity(h.city) && Math.abs(c.lat - O.findCity(h.city).lat) + Math.abs(c.lon - O.findCity(h.city).lon) < 2).map(c => c.name);
  const pool = {
    item: shop.catalog.filter(i => i.cd !== "S").map(i => i.name).concat(["PS5", "iPhone 15", "$200 Steam gift card", "AirPods", "Gaming laptop"]),
    name: [h.name, `${h.name.split(" ")[0][0]}. ${h.name.split(" ")[1]}`, "Alex Smith", "Jordan Lee"],
    email: [`${first}.${last}${h.addr1 % 90}@gmail.com`, h.email, `${first}${last[0]}@protonmail.com`, `deals4u_${h.addr1}@yahoo.com`, `${last}.family@outlook.com`],
    device: ["iPhone 12", "Samsung Galaxy S9", "Windows laptop", "MacBook Air", "Android emulator"],
    where: ["Home", `VPN in ${city}`, "Free VPN", "Tor", `${near[0] || city}`, "London"],
    ship: [`Cousin's garage in ${near[0] || city}`, `PO box in ${city}`, "Freight forwarder in Miami", "Warehouse in Rotterdam", "Their home"],
    when: ["Right now", "3 AM", "Tomorrow at lunch", "Next week"],
    repeat: ["1", "2", "3"], gap: ["0", "1", "7"],
  }[k] || [];
  if (k === "ship" && S.inv.orders.length && !factsOf(S.inv.orders[0]).ship.physical) {
    return [`${first}.${last}.gifts@gmail.com`, `cash4codes@protonmail.com`, h.email];
  }
  S.sugg[k] = shuffle(pool).slice(0, k === "repeat" || k === "gap" ? 3 : 3);
  return S.sugg[k];
}

/* the orders, Gus's gut feeling and the screen, after any change */
function rebuild(full = true) {
  S.inv.orders = S.input.item.trim() ? O.buildFromInput(S.level, S.holder, S.input) : [];
  S.inv.cur = 0;
  const f = S.inv.orders.length ? factsOf(S.inv.orders[0]) : null;
  S.scheme = "typed-r" + S.round; // the row's scheme_id; the name is for the corkboard and the collection
  SCHEMES[S.scheme] = { icon: f ? f.item.ico : "📦", name: f ? `${f.item.name} → ${f.ship.city || (f.ship.physical ? f.ship.label : "an inbox")}`.slice(0, 48) : "Your order", pay: 1 };
  if (full) renderPlan(); else renderMood();
  renderHand(); updateHud();
}

/* Gus's gut feeling: the same rules as the verdict, without the luck */
function gutFeeling() {
  if (!S.inv.orders.length) return null;
  // with a server, the fraud model's own score: worry 1 is exactly where the verdict says caught
  const g = S.gutApi;
  if (API && g && !g.off && g.worry != null) return g.worry < 1 ? 42 * g.worry : 42 + g.worry;
  const rows = previewRows();
  const r = O.judgeOrders({ ...campaignCtx(), rows, memo: S.memo, version: S.version, heat: S.heat, persuasion: S.persuasion,
    learned: S.learned, memory: S.memory, leniency: leniency(), preview: true });
  return Math.max(...r.results.map(x => x.suspicion ?? 0));
}
const MOODS = [[22, "😊", "Looks normal"], [32, "🙂", "Fine, I guess"], [42, "🤨", "Hmm…"], [1e9, "😠", "No way"]];
/* POST /preview: ask the fraud model about the checkout as it is now. The last answer stays on
 * screen until the new one arrives; without a model (503) the scripted gut feeling takes over */
function askGus() {
  if (!API || !S.inv || !S.inv.orders.length || (S.gutApi && S.gutApi.off)) return;
  const key = JSON.stringify([S.input, S.holder.name, rank().n, S.round]);
  if (S.gutApi && S.gutApi.key === key) return;
  S.gutApi = { ...(S.gutApi || {}), key };
  clearTimeout(S.gutT);
  S.gutT = setTimeout(async () => {
    const { verdict, ...rec } = record();
    try {
      const r = await api("POST", "/preview", { record: rec }, 4000);
      if (!S.gutApi || S.gutApi.key !== key) return; // the player kept typing
      S.gutApi.worry = +r.worry;
      renderMood();
    } catch (e) {
      if (/HTTP 503/.test(e && e.message)) S.gutApi = { off: true }; // no model on the server
    }
  }, 250);
}
function renderMood() {
  const el = $("#gut");
  if (!el) return;
  askGus();
  const s = gutFeeling(), m = s == null ? ["", "😶", "Waiting…"] : MOODS.find(x => s < x[0]);
  el.innerHTML = `<span class="gut-face">${m[1]}</span><span class="gut-txt"><small>Gus's gut feeling</small>${m[2]}</span>`;
}

function goStep(id) {
  if (S.submitted) return;
  S.step = id; sfx("click");
  renderPlan(); renderHand();
  setTimeout(() => $("#invoice .co-input")?.focus(), 30);
}
function nextStep(dir = 1) {
  const st = steps(), i = stepIndex();
  if (dir > 0 && S.step === "cart" && !S.input.item.trim()) { sfx("bad"); toast("Type what you're buying (or click a suggestion)"); return; }
  goStep(st[clamp(i + dir, 0, st.length - 1)].id);
}

// a step is done once you've typed (or picked) something in it
function stepDone(id) {
  const st = STEPS.find(s => s.id === id);
  return id === "card" ? true : !!(st && st.fields && st.fields.some(fd => S.touched.has(fd.k)));
}

function renderPlan() {
  const P = $("#invoice");
  if (!S.inv) { P.innerHTML = ""; return; }
  const st = steps().find(s => s.id === S.step) || steps()[0], i = stepIndex(), shop = O.SHOPS[S.level];
  const f = S.inv.orders.length ? factsOf(S.inv.orders[0]) : null;
  const dots = steps().map((s, k) => `<button class="co-dot ${s.id === S.step ? "cur" : ""} ${k < i || stepDone(s.id) ? "done" : ""}" data-step="${s.id}" ${S.submitted ? "disabled" : ""}>${k + 1}<small>${s.title}</small></button>`).join("");
  let body;
  if (st.id === "review") body = reviewHtml(f);
  else if (st.id === "card") body = `<div class="co-cards">${S.wallet.map((h, k) => `<button class="co-card ${h === S.holder ? "cur" : ""}" data-wallet="${k}">
      <b>💳 ${brand(h.card.brand)} ${h.card.type} ••••${h.card.last4}</b><span>${h.name} · ${h.city}</span><small>${h.card.sub}</small></button>`).join("")}</div>`;
  else body = st.fields.map(fd => {
    const ask = fd.k === "ship" && f && !f.item.kind.startsWith("phys") ? "Which email gets the code?" : null;
    return `<label class="co-field ${fd.small ? "small" : ""}">
      ${ask ? `<span class="co-sub">${ask}</span>` : ""}
      <input class="co-input" data-k="${fd.k}" value="${(S.input[fd.k] || "").replace(/"/g, "&quot;")}" placeholder="${fd.ph}" maxlength="60" spellcheck="false" autocomplete="off" ${S.submitted ? "disabled" : ""}>
      <span class="co-sugg">${suggestions(fd.k).map(x => `<button class="co-chip" data-k="${fd.k}" data-v="${x.replace(/"/g, "&quot;")}" tabindex="-1">${x}</button>`).join("")}</span>
    </label>`;
  }).join("");
  P.innerHTML = `
    <div class="co-bar"><span class="co-lock">🔒</span><span class="co-url">${shop.domain}/checkout</span><span id="gut" class="gut"></span></div>
    <div class="co-dots">${dots}</div>
    <div class="co-ask">${st.ask}</div>
    <div class="co-body">${body}</div>
    <div class="co-nav">
      ${i > 0 && !S.submitted ? `<button class="btn btn-ghost btn-small" id="co-back">← Back</button>` : "<span></span>"}
      ${f ? `<span class="co-total">${f.item.ico} ${price(campaignTotal())}${S.inv.orders.length > 1 ? ` · ${S.inv.orders.length} orders` : ""}</span>` : ""}
      ${st.id !== "review" ? `<button class="btn btn-small" id="co-next">Next →</button>` : `<span class="co-hint">${S.submitted ? "" : planReady() ? "✉️ Drag the envelope to send it" : "Nothing reaches you yet: change the delivery"}</span>`}
    </div>
    ${S.lastResult ? `<div class="t-verdict ${S.lastResult.caught ? "bad" : "ok"}">${S.lastResult.caught ? "CAUGHT" : "GOT AWAY"}</div>` : ""}`;
  renderMood();
  // forensic replay: the review lines that gave you away
  const red = S.lastResult ? (S.lastResult.caught ? S.lastResult.tells.slice(0, 2) : []) : S.retryTells || [];
  red.forEach(t => t[2] && P.querySelector(`[data-region="${t[2]}"]`)?.setAttribute("data-tell", t[0]));
  P.classList.toggle("forensic", red.length > 0);
  $$(".co-dot", P).forEach(b => b.onclick = () => goStep(b.dataset.step));
  $$(".co-input", P).forEach(inp => {
    inp.oninput = () => { S.input[inp.dataset.k] = inp.value; S.touched.add(inp.dataset.k); fixedTell(); clearTimeout(S.typeT); S.typeT = setTimeout(() => rebuild(false), 160); };
    inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); rebuild(false); nextStep(1); } };
  });
  $$(".co-chip", P).forEach(b => b.onclick = () => { S.input[b.dataset.k] = b.dataset.v; S.touched.add(b.dataset.k); fixedTell(); sfx("pen"); rebuild(); });
  $$(".co-card", P).forEach(b => b.onclick = () => { S.holder = S.wallet[+b.dataset.wallet]; S.sugg = {}; sfx("snip"); renderCaseFile(); rebuild(); });
  $$(".co-line", P).forEach(b => b.onclick = () => !S.submitted && goStep(b.dataset.region));
  const back = $("#co-back"), next = $("#co-next");
  if (back) back.onclick = () => nextStep(-1);
  if (next) next.onclick = () => nextStep(1);
}

/* on a retry, a red line stops blinking once you change that step */
function fixedTell() { if (S.retryTells) S.retryTells = S.retryTells.filter(t => t[2] !== S.step); }

/* the order summary, like a real checkout's last page */
function reviewHtml(f) {
  if (!f) return `<p class="co-empty">Nothing in the cart yet.</p>`;
  const I = S.input, n = S.inv.orders.length;
  const line = (id, ico, label, val) => steps().some(s => s.id === id) || id === "card"
    ? `<button class="co-line region" data-region="${id}" ${S.submitted ? "disabled" : ""}><span>${ico} ${label}</span><b>${val}</b></button>` : "";
  return `<div class="co-review">
    ${line("cart", f.item.ico, "Item", `${f.item.name} · ${price(f.amount)}`)}
    ${line("card", "💳", "Paid with", `${brand(f.card.brand)} ••••${f.card.last4} (${S.holder.name})`)}
    ${line("you", "👤", "Buyer", `${I.name || S.holder.name} · ${f.emailAddr}`)}
    ${line("device", "📱", "Device", f.dev.label)}
    ${line("where", "🌐", "Shopping from", f.proxy.label)}
    ${line("ship", "📦", f.ship.physical ? "Ship to" : "Code sent to", f.ship.id === "billing" ? "Their home (they get it!)" : f.ship.label)}
    ${line("when", "⏰", "When", `${f.clock.label}${n > 1 ? ` · ${n} orders, ${I.gap || 0} day(s) apart` : ""}`)}
  </div>`;
}

/* the dock: where you are in the checkout */
function renderHand() {
  const st = steps(), i = stepIndex();
  $("#hand-ask").textContent = S.submitted ? "SENT" : `STEP ${i + 1} OF ${st.length}`;
  $("#tools").innerHTML = S.submitted ? `<div class="hand-done">Sent! Fingers crossed.</div>`
    : st.map((s, k) => `<button class="co-step ${s.id === S.step ? "cur" : ""} ${stepDone(s.id) ? "done" : ""}" data-step="${s.id}"><span class="key">${k + 1}</span>${s.title}</button>`).join("");
  $$(".co-step").forEach(b => b.onclick = () => goStep(b.dataset.step));
  $("#envelope").classList.toggle("ready", planReady());
}
const renderTools = renderHand;
function playCard(i) { const s = steps()[i]; if (s) goStep(s.id); }
function selectSlot(id) { goStep(id); }

/* heat when you send: risky choices are noticed around the office too */
function planHeat() {
  const f = S.inv.orders.length ? factsOf(S.inv.orders[0]) : null;
  if (!f) return 0;
  return 2 + (f.proxy.id23 ? 3 : 0) + (f.ship.abroad ? 4 : 0) + (f.dev.emulator ? 3 : 0) + (S.inv.orders.length - 1) * 2;
}

function dropTool() { hidePopover(); }
function hint(text) { $("#tool-hint").textContent = text; $("#tool-hint").classList.toggle("show", !!text); }
function hidePopover() { $("#popover").classList.remove("show"); }

/* ======================= Gus's brain (saved) =======================
 * He only learns from your wins: each trick that fooled him raises his version,
 * weighs its warning signs more, and is remembered so close copies get caught.
 * Saved per shop, so his difficulty follows how good the player has become. */
const BRAIN_KEY = lvl => "forged.gus." + lvl;
function loadBrain(level) {
  try { const b = JSON.parse(localStorage.getItem(BRAIN_KEY(level)) || "null"); if (b) return b; } catch (e) {}
  return { version: 1, learned: {}, memory: [] };
}
const memoryCap = (level = S.level) => (LEVELS[level] && LEVELS[level].memoryCap) || 40; // how many past tricks Gus remembers
function saveBrain() {
  if (S.lanBrain) return; // a LAN room's shared Gus never overwrites your own
  try { localStorage.setItem(BRAIN_KEY(S.level), JSON.stringify({ version: S.version, learned: S.learned, memory: S.memory.slice(-memoryCap()) })); } catch (e) {}
}
/* LAN game (lan.js): everyone at the same shop plays one Gus. The room's brain replaces yours while
 * you're in the room, your wins teach it (gus-learned, posted from showCorkboard), and leaving brings yours back. */
function applyRoomBrain(b) {
  if (API || +b.level !== S.level) return; // with a server, the server already shares Gus
  Object.assign(S, { version: Math.max(1, +b.version || 1), learned: { ...(b.learned || {}) }, memory: (b.memory || []).slice(-memoryCap(+b.level)), lanBrain: true });
  renderInspector(); updateHud();
}
function soloBrain() {
  if (!S.lanBrain) return;
  Object.assign(S, loadBrain(S.level), { lanBrain: false });
  renderInspector(); updateHud();
}
const leniency = () => [0, 18, 10, 4, 0, 0][rank().n]; // a Rookie's first plans should mostly work

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
    patches: S.patches, shame: S.shame, lanBrain: !!S.lanBrain,
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
    return;
  }
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
  // the level is picked on the office's Clock in card: start that run (unless one is already going)
  if (m.type === "level" && LEVELS[m.level] && !LEVELS[m.level].locked) {
    S.chosenLevel = +m.level;
    if (!$("#screen-desk.active")) startRun(S.chosenLevel);
  }
  if (m.type === "dossier") openDossier();
  if (m.type === "tutorial-3d-done") tutWorldEvent(m.step);
  if (m.type === "gus-brain") applyRoomBrain(m); // LAN game: the room's Gus for your shop
  if (m.type === "gus-solo") soloBrain();       // left the LAN room: your own Gus again
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
  const r = O.judgeOrders({ ...campaignCtx(), rows, memo: S.memo, version: S.version, heat: S.heat, persuasion: S.persuasion,
    learned: S.learned, memory: S.memory, leniency: leniency() });
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
    line: r.inspector_line || r.line || null, newVersion: Number.isFinite(v) && v > 0 ? v : null, source: "api" };
}

async function judge() {
  const mock = mockJudge();
  mock.tells.forEach(t => t[2] = TELL_REGION[t[0]] || null); // orders.js names ticket boxes; the plan has blanks
  if (!API || !S.roundId) return mock;
  try {
    const { verdict, ...rec } = record(); // the verdict is what we're asking for
    // the server's fraud model judges the rows (it falls back to the browser's Gus without one)
    const mult = S.perks.includes("night") ? 2 : 1; // what each order pays you if it gets through
    const values = S.inv.orders.map(o => { const f = factsOf(o); return f.ship.toYou ? +(f.amount * mult).toFixed(2) : 0; });
    const gus = { caught: mock.caught, tells: mock.tells.map(t => [t[0], +(+t[1]).toFixed(2)]), payout: mock.payout, values };
    const r = await api("POST", "/submit", { round_id: S.roundId, player: playerName(), record: rec, perks: S.perks, gus }, 10000);
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
}

$("#btn-after-inspect").onclick = () => { sfx("click"); overlay("inspect", false); showCorkboard(); };

/* ======================= Corkboard (retrain as a scene) ======================= */

function showCorkboard() {
  const r = S.lastResult, L = LEVELS[S.level];
  const oldV = S.version;
  S.prevVersion = oldV;
  // Gus only learns when you beat him (Paper Shredder: he forgets one win)
  const forgotten = !r.caught && S.perks.includes("shred") && !S.shredUsed;
  if (forgotten) S.shredUsed = true;
  S.studied = [];
  if (!r.caught && !forgotten) {
    if (r.newVersion != null) S.version = r.newVersion; // the server decides when it's live
    else S.version++;
    const taught = { tells: {}, memory: [] }; // what this win taught him, for a LAN room's shared Gus
    (r.results || []).forEach((x, i) => {
      if (x.declined || !S.rows[i]) return;
      const sig = O.signature(S.rows[i]);
      S.memory.push(sig); taught.memory.push(sig); // he'll recognize this trick
      x.tells.slice(0, 2).forEach(t => {
        S.learned[t[0]] = (S.learned[t[0]] || 0) + 1; taught.tells[t[0]] = (taught.tells[t[0]] || 0) + 1;
        if (!S.studied.includes(t[0])) S.studied.push(t[0]);
      });
    });
    saveBrain();
    if (r.newVersion == null) post("gus-learned", { level: S.level, version: S.version, ...taught });
  }
  renderInspector(); updateHud();
  if (S.version > oldV) {
    S.patches++;
    showTip("first-version-bump", "🧠 You fooled Gus, so he studied your trick. Next time, try something new!", "version-bump");
    S.shame.push({ player: playerName(), version: S.version, trick: (SCHEMES[S.scheme] || {}).name || "a trick",
      learned: S.studied.length ? tellLabel(S.studied[0]) : "your style", amount: campaignTotal(), round: S.round });
  }
  const sc = SCHEMES[S.scheme] || { icon: "📦", name: "Your order" };
  const top = (r.caught ? r.tells : S.studied.map(t => [t])).slice(0, 3);
  const pos = [[120, 60], [80, 330], [430, 300]];
  $("#cork-pins").innerHTML = `
    <div class="cork-card main" style="left:380px;top:40px;transform:rotate(-3deg)">
      <b>${sc.icon} ${sc.name}</b>
      ${S.inv.orders.length} order${S.inv.orders.length > 1 ? "s" : ""} on ${S.holder.name}'s card<br>${money(r.payout)} to you
      <div class="cc-stamp ${r.caught ? "" : "paid"}">${r.caught ? "CAUGHT" : "GOT AWAY"}</div>
    </div>` +
    (top.length ? top : [["heat"]]).map((t, i) => `
    <div class="cork-card" style="left:${pos[i][0]}px;top:${pos[i][1]}px;transform:rotate(${rand(-5, 5)}deg)">
      <b>${r.caught ? "Clue" : "Studying"} #${i + 1}</b>${tellLabel(t[0])}</div>`).join("");
  const cx = 510, cy = 130;
  $("#cork-string").innerHTML = (top.length ? top : [0]).map((_, i) =>
    `<path d="M${cx},${cy} Q${(cx + pos[i][0] + 100) / 2},${(cy + pos[i][1]) / 2 + 60} ${pos[i][0] + 105},${pos[i][1] + 10}"/>`).join("");
  $("#cork-portrait").innerHTML = faceSVG(LOOKS.inspector, stageIndex(S.version));
  $("#cork-line").textContent = forgotten ? "Wait… where did that file go?" : r.caught ? "Gotcha. I already knew that one." : "You fooled me. I'm studying this.";
  $("#ver-old").textContent = "v" + oldV; $("#ver-new").textContent = "v" + S.version;
  overlay("cork");
  sfx("stamp");
}

$("#btn-after-cork").onclick = () => { sfx("click"); overlay("cork", false); showBetween(); };

/* ======================= Between rounds: patch notes + shop ======================= */

function showBetween() {
  const r = S.lastResult;
  $("#patch-title").textContent = `Gus v${S.version}`;
  const items = r.caught
    ? [`<li>Gus caught you, so <b>he didn't learn anything new</b>. Change something and try again.</li>`]
    : (S.studied || []).length
      ? [...S.studied.slice(0, 2).map(t => `<li>Gus studied your win. He now watches for: <b>${tellLabel(t)}</b></li>`), `<li>He'll recognize <b>this exact trick</b> next time.</li>`]
      : [`<li>Gus studied your win. He'll recognize <b>this exact trick</b> next time.</li>`];
  const st = stageFor(S.version);
  if (stageFor(S.version - 1) !== st) items.push(`<li>Promoted to <b>${st.title}</b></li>`);
  if (S.streak >= 2) { items.push(`<li>🔥 Streak ×${S.streak}: keep changing your plan.</li>`); showTip("first-streak", "🔥 Streak! Keep changing your plan to keep it.", "streak-bonus"); }
  if (S.rankUp) {
    items.unshift(`<li class="rank-up">⭐ <b>Rank up: ${S.rankUp.title}!</b> New: ${S.rankUp.unlocks}.</li>`);
    toast(`⭐ Rank up: ${S.rankUp.title}!`, "good"); setTimeout(() => sfx("cash"), 300);
    S.rankUp = null;
  }
  $("#patch-list").innerHTML = items.join("");
  loadPatchNotes(S.prevVersion, items.filter(li => /rank-up|Promoted|Streak/.test(li))); // server notes replace Gus's lines, these stay
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
  $("#btn-retry").hidden = !r.caught;
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

function startNext(retry) {
  sfx("pick"); overlay("between", false);
  const hadDossier = S.dossier;
  nextRound(retry);
  // dossier reveals the decoy for exactly one round
  if (hadDossier) { renderMemo(); S.dossier = false; }
}
$("#btn-next-round").onclick = () => startNext(false);
$("#btn-retry").onclick = () => startNext(true);
function quitToTitle() {
  $$(".overlay").forEach(o => o.classList.remove("show"));
  clearTimeout(S.bossTimer); S.bossWindow = false; $("#boss-prompt").classList.remove("show");
  if (tut.on) endTutorial(true);
  dropTool(); hidePopover(); hideSchemeTip(); $("#debug-panel").classList.remove("show");
  Object.assign(S, { inv: null, submitted: false });
  show("title");
}
$("#btn-quit").onclick = () => { sfx("click"); if (EMBED) post("quit-office"); else quitToTitle(); }; // in the office: back to the Clock in card

/* ======================= Tutorial (first round) =======================
 * One hands-on tutorial for the first round. A small card sits beside whatever to use
 * next, which glows; each step waits until the player actually does it, turns green, then
 * moves on. In the 3D office the walking steps (sit, printer, IN tray) use the office's
 * green arrow via the tutorial-active / tutorial-phase / tutorial-3d-done messages.
 * Each step unlocks the matching Dossier entry, so the Dossier keeps what it taught.
 * It runs once per browser; Options → Reset Tutorial & Tips plays it again. */

const TUT_KEY = "forged-tutorial-done-v2"; // v2: the checkout replaced the invoice

// the tutorial doesn't lock anything on the checkout (C's engine calls this for the old scheme picker)
function lockSchemes() {}
const kb = action => `<kbd>${ForgedKeys.label(action)}</kbd>`;

/* Step fields:
 *   at       elements that glow (and that the card sits beside)
 *   world    an office step, done when the office reports this event ("sat", "grabbed", "delivered")
 *   label    the green arrow's label in the office
 *   until    hands-on: done when this returns true          can   false → "Skip step" shows
 *   read     a reading step with a Next button              wait  "start": getting to the checkout
 *   dossier  entries to unlock when the step is done        enter runs when the step appears */
const TUTORIAL = [
  { id: "sit", world: "sat", label: "Go to your desk", dossier: ["boss-patrol"],
    text: () => `Walk to your desk (follow the green arrow) and press <kbd>${ForgedKeys.label("interact")}</kbd> to sit down.` },
  { id: "start", wait: "start",
    at: () => $("#screen-levels.active") ? ['.level-card[data-level="1"]'] : $("#screen-title.active") ? ["[data-go=levels]"] : [],
    text: () => `Start a game: click <b>▶ Play Solo</b>, then choose <b>Sunny Diner Supply</b>.` },
  { id: "victim", at: ["#win-case"], read: true, dossier: ["victim"],
    text: () => `Today's victim. <b>Their stolen card is on your desk</b>: you'll shop with it. You learn more about them as you rank up.` },
  { id: "checkout", at: ["#invoice"], until: () => S.step === "review", dossier: ["checkout", "route-goods"],
    text: () => `A fake checkout, one question at a time. <b>Type anything</b> (or click a suggestion), then press <b>Enter</b>. Make sure the loot is delivered <b>to you</b>, not to their home.` },
  { id: "gut", at: ["#gut"], read: true, dossier: ["gut"],
    text: () => `<b>Gus's gut feeling.</b> Gus is the shop's fraud robot. This face shows how worried he'd be right now: 😊 relaxed … 😠 no way. Change your answers to calm him down.` },
  { id: "send", at: ["#envelope", "#outbox"], dossier: ["delivery"],
    until: () => S.printed || S.submitted, can: () => planReady(),
    text: () => EMBED ? `Drag the envelope onto <b>PRINT</b> (the dark box above). You'll stand up to deliver it.` : `Drag the envelope into the <b>OUTBOX</b> to send it.` },
  { id: "pickup", world: "grabbed", label: "Grab it at the printer", dossier: ["hiding"],
    text: () => `Walk to the printer and press <kbd>${ForgedKeys.label("interact")}</kbd> to grab your order slip.` },
  { id: "deliver", world: "delivered", label: "Drop it in the IN tray", dossier: ["break-perks"],
    text: () => `Carry it to Gus's IN tray and press <kbd>${ForgedKeys.label("interact")}</kbd>. Keep out of the boss's sight.` },
  { id: "verdict", verdict: true, label: "Back to your desk", dossier: ["version-bump", "heat-basics", "tells-explained"],
    text: () => {
      const r = S.lastResult;
      if (!r || !S.submitted) return EMBED ? `Gus is checking it… head back to your desk for the verdict.` : `Gus is checking it…`;
      const tells = r.tells.slice(0, 2).map(t => tellLabel(t[0])).join(", ");
      const head = r.caught ? `<b>Caught.</b> He noticed: ${tells || "something off"}. He learns nothing from a catch, so tweak it and try again.`
        : `<b>You got away with it!</b> Gus studies every win, so next time try something new.`;
      return `${head}<br>Everything you just learned is in your <b>Dossier</b> (Esc → Dossier).${EMBED ? "<br>One last trick before you go: the boss's planner." : ""}`;
    } },
  // office only (filtered out on the plain computer): the boss heads out and you peek at his planner
  { id: "planner", world: "planner-read", label: "Read the boss's planner", dossier: ["boss-planner"], hold: 2600,
    text: () => `The boss just left on patrol. Stand up, sneak into <b>his office</b> and press <kbd>${ForgedKeys.label("interact")}</kbd> at the red planner on his desk to see his route.` },
];
const tut = { on: false, i: 0, steps: [] };

function tutorialDone() { try { return localStorage.getItem(TUT_KEY) === "1"; } catch (e) { return false; } }

function startTutorial(fromId) {
  if (tut.on) return;
  tut.steps = TUTORIAL.filter(st => EMBED ? st.id !== "start" : !st.world); // os.html alone has no office to walk; in the office the level is picked before clocking in
  Object.assign(tut, { on: true, i: Math.max(0, tut.steps.findIndex(st => st.id === fromId)), entered: -1, done: false, verdictShown: false });
  post("tutorial-active", { on: true });
  clearInterval(tut.poll); tut.poll = setInterval(tutPoll, 200);
  showTutStep();
}
function endTutorial(unfinished = false) {
  if (!tut.on) return;
  tut.on = false;
  clearInterval(tut.poll); clearTimeout(tut.adv);
  if (S.bossPractice) { S.bossPractice = false; S.bossWindow = false; clearTimeout(S.bossTimer); $("#boss-prompt").classList.remove("show"); }
  lockSchemes(false); setGlow([]);
  const card = $(".guide-card"); if (card) card.remove();
  post("tutorial-active", { on: false });
  if (!unfinished) { try { localStorage.setItem(TUT_KEY, "1"); } catch (e) { /* shows again next time */ } }
}
const tutStep = () => tut.steps[tut.i];
const atOf = st => (typeof st.at === "function" ? st.at() : st.at) || [];

// a soft green glow on the parts to use (no dimming)
function setGlow(sels) {
  $$(".tut-glow").forEach(el => el.classList.remove("tut-glow"));
  sels.forEach(q => $$(q).forEach(el => el.classList.add("tut-glow")));
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
  const st = tutStep(); if (!st) return endTutorial();
  if (tut.entered !== tut.i) { // first time showing this step
    tut.entered = tut.i; tut.done = false; clearTimeout(tut.adv);
    st.enter && st.enter();
    if (st.world || st.verdict) post("tutorial-phase", { phase: st.id, label: st.label || "" });
  }
  lockSchemes(st.wait === "scheme");
  const at = atOf(st); tut.atKey = at.join("|");
  setGlow(at);
  let card = $(".guide-card");
  if (!card) { card = document.createElement("div"); card.className = "guide-card"; stage.appendChild(card); }
  card.classList.toggle("done", tut.done);
  const finished = st.verdict && S.submitted && S.lastResult;
  const buttons = [
    st.read ? `<button class="btn btn-small" data-tut="next">Next →</button>` : "",
    finished ? `<button class="btn btn-small" data-tut="finish">${tut.i >= tut.steps.length - 1 ? "Finish tutorial ✓" : "One more thing →"}</button>` : "",
    st.skippable && !tut.done ? `<button class="btn btn-ghost btn-small" data-tut="next">Skip →</button>` : "",
    st.can && !tut.done && !st.can() ? `<button class="btn btn-ghost btn-small" data-tut="next">Skip step →</button>` : "",
  ].join("");
  card.innerHTML = `<div class="guide-step">${tut.done ? "✓ Done!" : `Tutorial · step ${tut.i + 1} of ${tut.steps.length}`}</div>
    <p class="guide-instr">${st.text()}</p>
    <div class="guide-btns">${buttons}<button class="guide-quit" data-tut="quit">Skip tutorial</button></div>`;
  // office steps happen away from the computer; the green arrow shows the way there
  card.style.display = st.world && EMBED ? "none" : "";
  placeTutCard(card, st);
}
function placeTutCard(card, st) {
  const at = atOf(st), r = at.length ? tutRect(at) : null;
  const cw = card.offsetWidth || 420, ch = card.offsetHeight || 140, g = 20, m = 16, top = 70;
  if (st.verdict) { card.style.left = (1600 - cw - 40) + "px"; card.style.top = "250px"; return; } // clear of the stamp
  if (!r) { card.style.left = (800 - cw / 2) + "px"; card.style.top = (st.drill ? 560 : 300) + "px"; return; }
  // beside the glowing part, never on top of it (it has to stay clickable), and on screen
  const spots = [[r.x + r.w + g, r.y], [r.x - g - cw, r.y + r.h - ch], [r.x + r.w - cw, r.y - g - ch], [r.x, r.y + r.h + g]];
  const fits = ([x, y]) => x >= m && y >= top && x + cw <= 1600 - m && y + ch <= 900 - m;
  const [x, y] = spots.find(fits) || spots[1];
  card.style.left = clamp(x, m, 1600 - cw - m) + "px";
  card.style.top = clamp(y, top, 900 - ch - m) + "px";
}
stage.addEventListener("click", e => {
  const b = e.target.closest(".guide-card [data-tut]"); if (!b || !tut.on) return;
  sfx("click");
  if (b.dataset.tut === "quit") endTutorial();
  else if (b.dataset.tut === "finish") tutNext(true);
  else tutNext();
});

// hands-on steps: watch for the player doing the thing
function tutPoll() {
  if (!tut.on || S.paused) return;
  const st = tutStep(); if (!st) return;
  if (st.verdict) { if (S.submitted && S.lastResult && !tut.verdictShown) { tut.verdictShown = true; tutDone(st, false); } return; }
  if (st.wait) { if (atOf(st).join("|") !== tut.atKey) showTutStep(); return; } // follow the player to the scheme picker
  if (!st.until || tut.done) { if (st.can) showTutStep(); return; }
  let ok = false; try { ok = st.until(); } catch (e) { ok = false; }
  if (ok) tutDone(st, true);
  else if (st.can) showTutStep(); // refresh "Skip step" when the player runs out of uses
}
function tutDone(st, advance) {
  tut.done = true; sfx("cash");
  (st.dossier || []).forEach(unlockDossierEntry);
  showTutStep();
  if (advance) { clearTimeout(tut.adv); tut.adv = setTimeout(() => { if (tut.on && tutStep() === st) tutNext(true); }, st.hold || 1000); }
}
function tutNext(auto = false) {
  const st = tutStep(); if (!st) return;
  if (!tut.done) (st.dossier || []).forEach(unlockDossierEntry); // read / skipped steps still unlock their entry
  if (st.drill && S.bossPractice) { S.bossPractice = false; S.bossWindow = false; clearTimeout(S.bossTimer); $("#boss-prompt").classList.remove("show"); }
  if (tut.i >= tut.steps.length - 1) { endTutorial(); toast("Tutorial complete. Good luck out there!", "good"); return; }
  tut.i++; showTutStep();
}
// the office reports walking steps
function tutWorldEvent(ev) { const st = tut.on && tutStep(); if (st && st.world === ev) tutDone(st, true); }
addEventListener("resize", () => tut.on && showTutStep());
// first launch in the office: start at "Go to your desk" so the green arrow points there
if (EMBED && !tutorialDone()) setTimeout(() => startTutorial("sit"), 600);
if (EMBED) post("os-ready"); // the office replies with the level if you've already clocked in

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
  if (tut.on) return; // no boss during the tutorial
  if (Math.random() < .35 && S.round > 1 || S.round === 2) {
    S.bossTimer = setTimeout(bossWalk, rand(9000, 20000));
  }
}
// tutorial practice: footsteps after a moment, no heat, repeats until the player hides in time
function tutBossDrill(delay = 1800) {
  clearTimeout(S.bossTimer);
  S.bossTimer = setTimeout(() => { if (tut.on && tutStep().drill && !S.paused) bossWalk(true); }, delay);
}
function bossWalk(practice = false) {
  if (S.paused && !practice) { S.bossTimer = setTimeout(bossWalk, 4000); return; }
  if (!practice && (S.submitted || tut.on || !$("#screen-desk").classList.contains("active") || $(".overlay.show"))) {
    if (tut.on && !S.submitted) S.bossTimer = setTimeout(bossWalk, 8000); // try again after the tutorial
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
    input: { ...S.input }, rank: rank().n, orders: S.inv.orders.map(o => ({ ...o })),
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
// the fraud-model report page, served by the API (so it works however the game is served)
if ($("#btn-report") && API) { $("#btn-report").hidden = false; $("#btn-report").onclick = () => { sfx("click"); window.open(API + "/report", "_blank"); }; }
window.forgedRows = { all: storedRows, csv: downloadCsv, clear: () => { try { localStorage.removeItem(ROWS_KEY); } catch (e) {} } };

const paintDebugKey = () => { $("#debug-key").textContent = ForgedKeys.label("detector"); };
paintDebugKey(); ForgedKeys.onChange(paintDebugKey);
if ($("#btn-debug")) $("#btn-debug").onclick = () => { sfx("click"); toggleDebug(); };
function openDossier() { renderDossier(); overlay("dossier"); }
if ($("#btn-dossier")) $("#btn-dossier").onclick = () => { sfx("click"); openDossier(); };

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
  } else if (tut.on && tutStep().drill && !tut.hid) {
    S.bossWindow = false; $("#boss-prompt").classList.remove("show"); tutBossDrill();
  } else if (S.pausedWindow) {
    S.bossTimer = setTimeout(bossSaw, 2000); // a fresh 2 seconds to hide the invoice
  } else if (!EMBED && S.inv && !S.submitted) scheduleBoss();
}
if (!EMBED) ForgedMenu.init({
  office: false,
  onPause: setPaused,
  onQuit: quitToTitle,
  canDossier: () => true, onDossier: openDossier,
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
  // reading steps of the tutorial: Enter or → for Next (every other key plays as normal)
  if (tut.on && !typing && tutStep().read && (code === "Enter" || code === "ArrowRight")) { e.preventDefault(); tutNext(); return; }
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

// mouse wheel moves between the checkout steps
let wheelAt = 0;
$("#screen-desk").addEventListener("wheel", e => {
  if (S.paused || $(".overlay.show") || !S.inv || S.submitted) return;
  if (e.target.closest(".win-body, #debug-panel, #popover")) return; // let windows scroll
  e.preventDefault();
  const now = performance.now(); if (now - wheelAt < 180) return; wheelAt = now; // trackpads send bursts
  nextStep(e.deltaY > 0 ? 1 : -1);
}, { passive: false });

document.addEventListener("pointerdown", e => {
  if (!e.target.closest("#popover") && !e.target.closest(".tchip") && !e.target.closest(".tool")) { if (S.tool) dropTool(); else hidePopover(); }
});

})();
