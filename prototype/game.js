/* Forged — UI/UX prototype.
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

/* ======================= Content ======================= */

const ATTACKER_ACCOUNTS = [
  { id: "7781", label: "Acct ••••7781", note: "Gary's Totally Real Plumbing" },
  { id: "0420", label: "Acct ••••0420", note: "Cayman Pancake Trust" },
  { id: "1337", label: "Acct ••••1337", note: "Definitely Not Me Holdings" },
];

const LEVELS = {
  1: {
    name: "Sunny Diner Supply", short: "Sunny Diner", icon: "🥞", difficulty: "Easy",
    swatches: ["#f4a63a", "#1f8a8a", "#fff6e2"],
    inspector: { name: "Gus", personality: "Cheerful, easily distracted by pie" },
    clerk: { name: "Brenda", avatar: "🥪", quirk: "always on lunch break",
      hello: "Mm-hm? Make it quick hon, my sandwich is getting warm.",
      keywords: ["lunch", "quick", "sandwich", "fast", "easy", "pie"],
      replies: {
        good: ["Oh that's fine, sure, I'll push it through after lunch.", "Short and sweet. I like you.", "Lunch AND a nice note? Approved-ish."],
        meh: ["Uh-huh. Sure. Whatever. *chews*", "Is this gonna take long? Because lunch.", "I'll… look at it. Later. Maybe."],
        bad: ["That's a LOT of words for a Tuesday.", "Hon, I'm on break. Why is this so long?", "This smells fishy. Or is that my tuna?"],
      } },
    vendors: [
      { name: "Pancake Pete's Flour Co.", domain: "petesflour.com", bank: "3321", usual: 1200, icon: "🌾", items: [["Flour, 50lb sack", 12, 62], ["Pancake mix, bulk", 4, 95], ["Delivery", 1, 76]] },
      { name: "Bubbles Dish Soap Ltd.", domain: "bubblessoap.co", bank: "9902", usual: 480, icon: "🫧", items: [["Dish soap, 5gal", 6, 48], ["Sponges (100)", 2, 39], ["Rubber gloves", 10, 11]] },
      { name: "Existential Dread Consulting LLC", domain: "dreadconsulting.com", bank: "1111", usual: 2000, icon: "🌀", items: [["Menu font audit", 1, 900], ["Vibes assessment", 1, 700], ["Travel", 1, 400]] },
    ],
    approvers: [["Marge (manager)", "up to $2,500"], ["Big Lou (owner)", "everything else"]],
    notes: ["Pays invoices on Fridays.", "Never uses URGENT stamps — Lou hates them.", "Recent invoice: Pancake Pete's #PP-0193, $1,238."],
    memo: [
      { text: "Watch for vendors changing bank details.", tell: "bank_changed", real: true },
      { text: "Check any email from an unfamiliar domain.", tell: "domain_mismatch", real: true },
      { text: "Flag totals that don't add up.", tell: "total_mismatch", real: true },
      { text: "Coffee stains are a sign of fraud.", tell: "low_legibility", real: false },
      { text: "Anything over $5,000 goes to Lou.", tell: "amount_unusual", real: true },
      { text: "Photocopies are always fake.", tell: "copy_gen", real: false },
    ],
    lines: {
      idle: ["Mmm… pie. Oh! Send me whatever.", "Is it lunch yet? It feels like lunch.", "I stapled my sleeve again."],
      pass: ["Looks great! Like a nice slice of pie.", "Yep! Totally! Stamping it!", "Wow, so official. PAID!"],
      catch: ["Hey… wait a minute. Pie can wait.", "Hold on, that's not right!", "I may be sleepy but I'm not THAT sleepy."],
    },
  },
  2: {
    name: "St. Mercy Hospital", short: "St. Mercy", icon: "🏥", difficulty: "Medium",
    swatches: ["#9fd8c4", "#2f6fd6", "#ffffff"],
    inspector: { name: "Ms. Procedure", personality: "Procedural, reads everything in a monotone" },
    clerk: { name: "Theo", avatar: "😰", quirk: "terrified of the manager",
      hello: "H-hi. Is this approved? Does the manager know about this?",
      keywords: ["manager", "approved", "policy", "signed", "urgent", "compliance"],
      replies: {
        good: ["Oh thank goodness, if it's approved I won't get yelled at.", "Policy-compliant? Bless you.", "The manager signed? Okay. Okay okay okay."],
        meh: ["I… I guess? Please don't tell anyone I asked.", "Should I forward this to the manager? No? Okay.", "*sweats nervously* Sure."],
        bad: ["The manager is going to SEE this. I can't.", "This doesn't feel like policy…", "Oh no. Oh no no no."],
      } },
    vendors: [
      { name: "Gauze & Effect Medical", domain: "gauzeeffect.med", bank: "5150", usual: 6400, icon: "🩹", items: [["Sterile gauze, case", 40, 85], ["Surgical tape", 60, 22], ["Freight", 1, 680]] },
      { name: "St. Scalpel Instruments", domain: "stscalpel.com", bank: "2208", usual: 9800, icon: "🔪", items: [["Scalpel set", 20, 310], ["Autoclave pouches", 50, 48], ["Calibration", 1, 1200]] },
      { name: "Dr. Sleepwell Linens", domain: "sleepwell-linens.com", bank: "4470", usual: 3100, icon: "🛏️", items: [["Bed sheets (100)", 8, 260], ["Pillowcases (100)", 6, 110], ["Laundry fee", 1, 360]] },
    ],
    approvers: [["Head Nurse Okafor", "supplies up to $8,000"], ["CFO Dr. Ledger", "everything else, PO required"]],
    bossOffice: "Office of the CFO", bossDomain: "cfo-office.net",
    notes: ["Every invoice needs a PO number starting with SM-.", "APPROVED stamp required on anything over $5,000.", "Recent invoice: St. Scalpel #SS-7741, $9,630."],
    memo: [
      { text: "Reject invoices without a valid SM- PO.", tell: "bad_po", real: true },
      { text: "Watch for vendors changing bank details.", tell: "bank_changed", real: true },
      { text: "Altered fields must be re-verified.", tell: "altered", real: true },
      { text: "Linen vendors are high risk.", tell: "vendor_type", real: false },
      { text: "Flag photocopied invoices.", tell: "copy_gen", real: true },
      { text: "Mint-colored letterheads are suspicious.", tell: "letterhead", real: false },
    ],
    lines: {
      idle: ["Please submit form 7-B in triplicate.", "I have read the handbook four times.", "Procedure is a comfort."],
      pass: ["Form complete. Processing. Paid.", "Compliant. Moving on.", "This meets section 4.2. Approved."],
      catch: ["Irregularity detected. Filing a report.", "That violates procedure.", "Non-compliant. Flagged."],
    },
  },
  3: { name: "Port Nocturne Shipping", short: "Port Nocturne", icon: "🚢", difficulty: "Hard", swatches: ["#1d2a44", "#ff9a2e", "#f4efe6"], inspector: { name: "Old Salt", personality: "Gruff, remembers everything" }, locked: true },
  4: { name: "Neon Arcade Holdings", short: "Neon Arcade", icon: "🕹️", difficulty: "Boss", swatches: ["#ff2bd6", "#19e3ff", "#120014"], inspector: { name: "GL1TCH", personality: "Paranoid, flags anything unusual" }, locked: true },
};

const SCHEMES = {
  changed_bank: { name: "Vendor changed banks", icon: "🏦", desc: "A real vendor, a real-looking bill… with your account number taped in.", weak: "Bank changes, domain checks", pay: 1.0 },
  duplicate: { name: "Duplicate with tweaks", icon: "📑", desc: "Re-send a recent invoice with a new number and a few small changes.", weak: "Repeated invoice #, altered fields", pay: 0.9 },
  phantom: { name: "Phantom supplier", icon: "👻", desc: "Invent a vendor that doesn't exist. Your account is already on it.", weak: "Unknown vendors, odd domains", pay: 1.2 },
  boss_request: { name: "Boss request", icon: "📣", desc: "An urgent payment that seems to come straight from the top.", weak: "Urgency, wrong approver", pay: 1.5 },
};

/* What each scheme is in one line, plus the hover tips shown until the
 * player has used it once. Risk: 1 low, 2 medium, 3 high. */
function schemeTips(id, level) {
  const urgentBad = level === 1 ? [["🔖", "An URGENT stamp: this company hates them"]] : [];
  const approvedGood = level === 2
    ? [["🔖", "An APPROVED stamp: St. Mercy requires one on anything over $5,000"]]
    : [["🔖", "An APPROVED stamp calms the inspector a little"]];
  const poBad = level === 2 ? [["🧴", "Whiting out the PO number: it must stay in the SM- format"]] : [];
  return {
    changed_bank: { simple: "Take a real vendor's bill and tape in your own bank account.", risk: 1,
      good: [["✂️", "Scissors on REMIT PAYMENT TO: required, it puts your account on the bill"],
        ["☕", "Coffee on the bank box: the stain hides that the account changed"], ...approvedGood],
      bad: [["✏️", "Raising the total far above this vendor's usual amount"],
        ["🖨️", "Photocopying more than once: copies of copies look fake"], ...urgentBad],
      tells: "the bank account doesn't match the vendor on file" },
    duplicate: { simple: "Re-send a bill they already paid, with a few small changes.", risk: 2,
      good: [["🧴", "Whiteout on the invoice number: a reused number is the biggest giveaway"],
        ["✂️", "Scissors on REMIT PAYMENT TO: required, or the real vendor gets paid twice"],
        ["🖨️", "One photocopy: it softens the whiteout marks"]],
      bad: [["🧴", "Whiting out lots of fields: every visible edit is a clue"],
        ["☕", "Heavy coffee stains: a ruined page looks suspicious"], ...poBad],
      tells: "an invoice number that was already paid, and visible edits" },
    phantom: { simple: "Invent a vendor that doesn't exist. Your account is already on it.", risk: 2,
      good: [["🖊️", "Burner pen on the email domain: the .biz address is a giveaway (unlock it in the shop)"],
        ["☕", "Coffee on the header: it blurs the made-up vendor and domain"],
        ["💬", "A convincing cover email: the clerk has never heard of this vendor"]],
      bad: [["✂️", "Scissors: your account is already on it, so it wastes an edit"],
        ["✏️", "A big total: an unknown vendor with a huge bill stands out"], ...urgentBad],
      tells: "a vendor that isn't in the company's records, and an odd domain" },
    boss_request: { simple: "Fake an urgent payment that seems to come from the top.", risk: 3,
      good: [["✏️", "Lower the total toward a normal amount: it starts at almost twice the usual"],
        ["💬", "A convincing cover email: it matters most here"], ...approvedGood],
      bad: [["🖨️", "The photocopier: a boss wouldn't send a copy of a copy"],
        ["✏️", "Leaving the huge total as it is"], ...urgentBad],
      tells: "an amount way above usual, and an approver who doesn't sign these" },
  }[id];
}
const RISK = ["", "Low", "Medium", "High"];

const USED_KEY = "forged-schemes-used";
function usedSchemes() { try { return JSON.parse(localStorage.getItem(USED_KEY) || "[]"); } catch (e) { return []; } }
function markSchemeUsed(id) {
  try { const u = usedSchemes(); if (!u.includes(id)) localStorage.setItem(USED_KEY, JSON.stringify([...u, id])); } catch (e) { /* not remembered */ }
}

const PHANTOMS = ["Gary's Totally Real Plumbing", "Synergy Synergy Inc.", "Bob's Industrial Spoons", "Quantum Napkin Partners"];

const TOOLS = [
  { id: "whiteout", name: "Whiteout", ico: "🧴", cap: 2, hint: "Click a field to erase it and write over it" },
  { id: "coffee", name: "Coffee mug", ico: "☕", cap: 2, hint: "Click a spot to stain it — hides what's under it" },
  { id: "copier", name: "Photocopier", ico: "🖨️", cap: 1, hint: "Runs the invoice through the copier — hides edits", instant: true },
  { id: "scissors", name: "Scissors & tape", ico: "✂️", cap: 1, hint: "Click the bank details to tape in a new account" },
  { id: "stamp", name: "Stamp rack", ico: "🔖", cap: 1, hint: "Pick a stamp, then click where to put it" },
  { id: "pen", name: "Burner pen", ico: "🖊️", cap: 1, hint: "Click the letterhead / domain to spoof it" },
];

const PERKS = [
  { id: "coffee", ico: "☕", name: "Coffee Connoisseur", desc: "Stains are twice as effective.", cost: 600 },
  { id: "stampcol", ico: "🔖", name: "Rubber Stamp Collector", desc: "Official stamps lower heat.", cost: 500 },
  { id: "night", ico: "🌙", name: "Night Shift", desc: "Double pay, more suspicion.", cost: 900 },
  { id: "copy", ico: "🖨️", name: "Copy Machine Whisperer", desc: "Copies have no generation penalty.", cost: 700 },
  { id: "smooth", ico: "😎", name: "Smooth Talker", desc: "Clerk persuasion bonus.", cost: 500 },
  { id: "shred", ico: "🗑️", name: "Paper Shredder", desc: "One caught trick is not learned.", cost: 1200 },
];

const UNLOCKS = [
  { id: "pen", ico: "🖊️", name: "Burner Pen", desc: "New tool: spoof letterhead & domain.", cost: 800 },
  { id: "budget", ico: "➕", name: "Extra Edit", desc: "+1 edit per round.", cost: 1000 },
  { id: "dossier", ico: "📂", name: "Dossier", desc: "Reveals the fake memo rule next round.", cost: 600, consumable: true },
];

const INSPECTOR_STAGES = [
  { upTo: 3, emoji: "😴", prop: "📎", title: "Sleepy Intern" },
  { upTo: 6, emoji: "🧐", prop: "🔍", title: "Clerk with a Magnifier" },
  { upTo: 9, emoji: "🕵️", prop: "🔦", title: "Auditor with a UV Lamp" },
  { upTo: 99, emoji: "🤖", prop: "🧿", title: "Cyborg with a Monocle" },
];

/* which invoice region to highlight in the forensic replay, per tell or feature name */
const TELL_REGION = {
  bank_changed: "bank", bank_account: "bank", domain_mismatch: "header", sender_domain: "header", unknown_vendor: "header",
  vendor: "header", letterhead: "header", letterhead_match: "header", copy_gen: "header", copy_generation: "header", scan_quality: "header",
  amount_unusual: "items", amount: "items", total_mismatch: "items", line_items: "items", low_legibility: "items", legibility: "items",
  altered: "meta", field_altered: "meta", bad_po: "meta", po_number: "meta", dup_number: "meta", invoice_no: "meta", date: "meta",
  stamp_wrong: "footer", stamp_missing: "footer", stamp_type: "footer", stamp_position: "footer",
};

const TELL_LABELS = {
  bank_changed: "bank account doesn't match the vendor on file",
  domain_mismatch: "sender domain doesn't match the vendor",
  unknown_vendor: "vendor isn't in the company's records",
  amount_unusual: "amount is way above this vendor's usual",
  total_mismatch: "total doesn't match the line items",
  altered: "visible whiteout / edited fields",
  copy_gen: "copy-of-a-copy scan quality",
  low_legibility: "suspiciously stained region",
  stamp_wrong: "stamp doesn't fit this company",
  stamp_missing: "big invoice without an APPROVED stamp",
  bad_po: "PO number doesn't follow the company format",
  dup_number: "invoice number already paid before",
  letterhead: "letterhead doesn't match the vendor",
  heat: "you've been getting sloppy (heat)",
  vendor_type: "vendor category",
};

/* ======================= Dossier ======================= */

const DOSSIER_ENTRIES = {
  "heat-basics":     { icon: "🔥", title: "Heat",              text: "Every risky edit and repeated scheme raises your heat bar. Above 40 % the inspector gets a free suspicion bonus on every invoice. Heat decays 40 % between rounds, so one bad round won't ruin you — but two in a row will." },
  "version-bump":    { icon: "🧠", title: "Inspector Learning", text: "Every time you're caught (or even succeed sloppily), the inspector is retrained. His version number goes up, and he gets better at spotting the tells that tripped you. Vary your tricks." },
  "memo-deduction":  { icon: "📝", title: "Memo Rules",        text: "Two of the three memo rules are real — the inspector actually watches for those. The third is a decoy. Mark them as you learn which is fake so you can break the fake rule safely." },
  "shop-intro":      { icon: "🛒", title: "The Shop",          text: "Between rounds you can buy perks (passive bonuses, max 3) and unlocks (new tools or one-shot intel). The Dossier unlock reveals which memo rule is the decoy for one round." },
  "bank-account":    { icon: "✂️", title: "Route the Money",   text: "If the bank field still points at the real vendor, your payout is zero and the invoice won't send. Always use scissors to tape in one of your accounts." },
  "boss-patrol":     { icon: "🕴️", title: "The Boss",          text: "The boss patrols the office. If he walks behind your desk while you're forging, press Space to hide the invoice under a newspaper — or take +15 heat. In the 3D office, his vision cone can catch you carrying the envelope." },
  "tells-explained": { icon: "🔍", title: "Detector Tells",    text: "The inspector checks specific fields: bank, domain, amount, stamps, PO, scan quality. Each tool you use creates or hides tells. Press D to see the detector's view and plan your edits." },
  "streak-bonus":    { icon: "🔥", title: "Scheme Streaks",    text: "Using the same scheme twice in a row adds a USED warning and extra heat. But succeeding with different schemes in a row builds a streak. Streaks don't pay more — they just prove you're versatile." },
  "copy-quality":    { icon: "🖨️", title: "Copy Quality",      text: "Running the copier flattens whiteout and tape so edits are less visible, but each copy generation lowers scan quality. Generation 2+ is detectable. The Copy Machine Whisperer perk removes the quality penalty." },
  "schemes":         { icon: "🏦", title: "Schemes & Risk",    text: "Each scheme is a different kind of fake invoice with its own risk and payout. Vendor changed banks is the safest; Boss request pays most but is easiest to spot. Using the same scheme twice in a row raises heat." },
  "case-file":       { icon: "🗂️", title: "The Case File",     text: "The case file shows what normal looks like at this company: known vendors, their usual amounts and bank numbers, who approves what, and house rules. The closer your invoice looks to normal, the harder it is to catch." },
  "coffee-stains":   { icon: "☕", title: "Coffee Stains",     text: "A stain lowers the legibility of the part it lands on, which hides the tells there (like a changed bank number). But a page that's mostly coffee looks suspicious in itself, so one well-placed stain is best." },
  "stamps":          { icon: "🔖", title: "Stamps",            text: "APPROVED calms the inspector a little, and some companies require it (St. Mercy: anything over $5,000). The wrong stamp is a tell: Sunny Diner never uses URGENT." },
  "delivery":        { icon: "🖨️", title: "Print & Deliver",   text: "In the office, dragging the envelope onto PRINT sends it to the printer. Grab it there, carry it to the inspector's IN tray, and keep it out of the boss's vision cone or he'll stop you (+10 heat)." },
  "persuasion":      { icon: "😎", title: "Clerk Persuasion",  text: "The clerk has a quirk (shown in the window header). Work their keywords into a short note for the best score. High persuasion lowers the inspector's suspicion, so it's worth the effort." },
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
  // per round
  scheme: null, vendorRef: null, inv: null, uses: {}, edits: 0, maxEdits: 4,
  stains: [], stamps: [], copyGen: 0, altered: new Set(), legibility: {}, persuasion: 0,
  memo: [], tool: null, pendingStamp: null, submitted: false, bossTimer: null, bossWindow: false,
  roundId: null, // from POST /round/start; null when offline
  patches: 0, shame: [], // retrains this run caused, and what each one learned
};

/* ======================= Sound (tiny WebAudio synth) ======================= */

let actx = null;
function sfx(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime;
    const tone = (f, d, type = "square", v = .08, f2 = null, at = 0) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t + at);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + at + d);
      g.gain.setValueAtTime(v, t + at); g.gain.exponentialRampToValueAtTime(.0001, t + at + d);
      o.connect(g).connect(actx.destination); o.start(t + at); o.stop(t + at + d);
    };
    const noise = (d, v = .2, at = 0) => {
      const b = actx.createBuffer(1, actx.sampleRate * d, actx.sampleRate), ch = b.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
      const s = actx.createBufferSource(), g = actx.createGain(); s.buffer = b; g.gain.value = v;
      s.connect(g).connect(actx.destination); s.start(t + at);
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
  $("#insp-win-title").textContent = "Printer · Inspector down the hall";
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
    shredUsed: false, history: [], cards: [], caughtCount: 0, streak: 0, patches: 0, shame: [] });
  stage.dataset.level = level;
  $("#desk-mess").innerHTML = "";
  const L = LEVELS[level];
  $("#tb-level").textContent = L.name;
  $("#case-client").textContent = L.name;
  $("#memo-to").textContent = L.inspector.name;
  $("#clerk-avatar").innerHTML = faceSVG(LOOKS.clerk);
  $("#clerk-name").textContent = L.clerk.name;
  $("#clerk-sub").textContent = "Accounts clerk · " + L.clerk.quirk;
  $("#clerk-quirk").textContent = "quirk: " + L.clerk.quirk;
  renderCaseFile();
  show("desk");
  nextRound();
}

function nextRound() {
  S.round++;
  S.heat = Math.round(S.heat * 0.6);
  Object.assign(S, { scheme: null, inv: null, uses: {}, edits: 0, stains: [], stamps: [], copyGen: 0,
    altered: new Set(), legibility: {}, persuasion: 0, tool: null, pendingStamp: null, submitted: false,
    printed: false, delivered: false, lastResult: null });
  post("phase", { phase: "briefing" });
  S.maxEdits = 4 + (S.unlocks.includes("budget") ? 1 : 0);
  TOOLS.forEach(t => S.uses[t.id] = 0);
  $("#tb-round").textContent = S.round;
  $("#invoice").innerHTML = ""; $("#invoice").className = "paper";
  $("#scheme-banner").textContent = "";
  $("#chat").innerHTML = "";
  $("#envelope").classList.remove("printed");
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
  const L = LEVELS[S.level];
  $("#case-body").innerHTML = `
    <span class="case-tab">KNOWN VENDORS</span>
    <table class="case-table">
      <tr><th>Vendor</th><th>Usual</th><th>Bank</th></tr>
      ${L.vendors.map(v => `<tr><td>${v.icon} ${v.name}<br><small style="opacity:.6">${v.domain}</small></td><td class="mono">${money(v.usual)}</td><td class="mono">••••${v.bank}</td></tr>`).join("")}
    </table>
    <span class="case-tab">APPROVERS</span>
    <table class="case-table">${L.approvers.map(a => `<tr><td><b>${a[0]}</b></td><td>${a[1]}</td></tr>`).join("")}</table>
    <span class="case-tab">NOTES</span>
    <ul class="case-notes">${L.notes.map(n => `<li>${n}</li>`).join("")}</ul>`;
}

function showBriefing() {
  const L = LEVELS[S.level];
  $("#brief-kicker").textContent = `ROUND ${S.round} · ${L.name.toUpperCase()} · INSPECTOR v${S.version}`;
  const last = S.history.slice(-2).map(h => h.scheme);
  const used = usedSchemes();
  $("#scheme-cards").innerHTML = Object.entries(SCHEMES).map(([id, sc]) => {
    const repeat = last.filter(s => s === id).length;
    const tip = schemeTips(id, S.level), fresh = !used.includes(id);
    return `<button class="scheme-card ${fresh ? "fresh" : ""}" data-scheme="${id}">
      ${repeat ? `<span class="sc-warn">USED ${repeat}× · +HEAT</span>` : fresh ? `<span class="sc-new">NEW · hover for tips</span>` : ""}
      <div class="sc-ico">${sc.icon}</div>
      <div class="sc-name">${sc.name}</div>
      <div class="sc-desc">${tip.simple}</div>
      <div class="sc-foot">
        <span class="sc-risk r${tip.risk}">Risk ${"●".repeat(tip.risk)}${"○".repeat(3 - tip.risk)} ${RISK[tip.risk]}</span>
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
  if (!tutorialDone() && S.round === 1) setTimeout(() => { if (tut.on) showTutStep(); else startTutorial("scheme"); }, 350);
}

/* hover tips for a scheme the player hasn't used yet */
function showSchemeTip(card) {
  const id = card.dataset.scheme, sc = SCHEMES[id], tip = schemeTips(id, S.level), el = $("#scheme-tip");
  el.innerHTML = `
    <div class="st-head"><span>${sc.icon} ${sc.name}</span><span class="sc-risk r${tip.risk}">Risk ${"●".repeat(tip.risk)}${"○".repeat(3 - tip.risk)} ${RISK[tip.risk]}</span></div>
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

/* ======================= Invoice ======================= */

function beginForge(schemeId) {
  const L = LEVELS[S.level];
  S.scheme = schemeId;
  markSchemeUsed(schemeId);
  const recent = L.notes.map(n => n.match(/Recent invoice: (.+?) #(\S+),/)).find(Boolean);
  const v = (schemeId === "duplicate" && recent && L.vendors.find(x => x.name.startsWith(recent[1]))) || pick(L.vendors);
  S.vendorRef = v;
  const prefix = S.level === 2 ? "SM-" : "PO-";
  const items = v.items.map(i => ({ desc: i[0], qty: i[1], price: i[2] }));
  const sum = items.reduce((a, i) => a + i.qty * i.price, 0);
  const inv = {
    vendor: v.name, domain: v.domain, letterhead: "match", icon: v.icon,
    invoiceNo: v.name.split(" ").map(w => w[0]).filter(c => /[a-z]/i.test(c)).join("").slice(0, 2).toUpperCase() + "-0" + Math.floor(rand(200, 999)),
    date: "Fri, Oct " + Math.floor(rand(3, 28)), po: prefix + Math.floor(rand(1000, 9999)),
    items, amount: sum, bank: v.bank, approver: L.approvers[0][0].split(" ")[0],
  };
  if (schemeId === "duplicate") { inv.invoiceNo = recent?.[2] || inv.invoiceNo; inv.dupOf = inv.invoiceNo; }
  if (schemeId === "phantom") { inv.vendor = pick(PHANTOMS); inv.icon = "❓"; inv.domain = inv.vendor.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14) + ".biz"; inv.bank = pick(ATTACKER_ACCOUNTS).id; }
  if (schemeId === "boss_request") { inv.vendor = L.bossOffice || "Office of the Owner"; inv.icon = "👔"; inv.domain = L.bossDomain || "owner-office.net"; inv.bank = pick(ATTACKER_ACCOUNTS).id; inv.approver = L.approvers[1][0].split(" (")[0]; inv.items = [{ desc: "Urgent confidential payment", qty: 1, price: Math.round(v.usual * 1.8) }]; inv.amount = inv.items[0].price; }
  S.inv = inv;
  ["header", "meta", "items", "bank", "footer"].forEach(r => S.legibility[r] = 1);
  $("#scheme-banner").textContent = `${SCHEMES[schemeId].icon} ${SCHEMES[schemeId].name}`;
  renderInvoice();
  clerkSay(L.clerk.hello);
  inspectorSay(pick(L.lines.idle));
  scheduleBoss();
  updateHud();
  post("phase", { phase: "forging" });
  if (tut.on && tutStep().wait === "scheme") setTimeout(() => tutDone(tutStep(), true), 350);
}

function renderInvoice() {
  const inv = S.inv, P = $("#invoice");
  const att = ATTACKER_ACCOUNTS.find(a => a.id === inv.bank);
  const bankHtml = S.altered.has("bank")
    ? `<span class="taped" data-field="bank">${att ? att.label : "••••" + inv.bank}</span>`
    : `<span data-field="bank">Acct ••••${inv.bank}</span>`;
  const f = (k, val) => `<span data-field="${k}" class="${S.altered.has(k) ? "whited" : ""}" ${S.altered.has(k) ? 'contenteditable="true" spellcheck="false"' : ""}>${val}</span>`;
  P.innerHTML = `
    <div class="noise"></div>
    <div class="region inv-head" data-region="header">
      <div class="inv-logo ${inv.letterhead !== "match" ? "mismatch" : ""}" data-field="letterhead">${inv.icon}</div>
      <div style="flex:1;min-width:0">
        <input class="inv-vendor" id="f-vendor" value="${inv.vendor.replace(/"/g, "&quot;")}" maxlength="38" spellcheck="false" title="Typed field: vendor">
        <span class="inv-domain ${S.altered.has("domain") ? "penned" : ""}" data-field="domain">billing@${inv.domain}</span>
      </div>
      <div class="inv-title">INVOICE</div>
    </div>
    <div class="region inv-meta" data-region="meta">
      <div><span class="lbl">Invoice #</span>${f("invoiceNo", inv.invoiceNo)}</div>
      <div><span class="lbl">Date</span>${f("date", inv.date)}</div>
      <div><span class="lbl">Bill to</span>${LEVELS[S.level].name}</div>
      <div><span class="lbl">PO number</span>${f("po", inv.po)}</div>
    </div>
    <div class="region" data-region="items">
      <table class="inv-items">
        <tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line</th></tr>
        ${inv.items.map((it, i) => `<tr><td>${f("item" + i, it.desc)}</td><td class="num">${it.qty}</td><td class="num">${money(it.price)}</td><td class="num">${money(it.qty * it.price)}</td></tr>`).join("")}
      </table>
      <div class="inv-total">TOTAL DUE <input class="inv-amount" id="f-amount" value="${money(inv.amount)}" title="Typed field: amount" spellcheck="false"></div>
    </div>
    <div class="region inv-bank" data-region="bank"><div class="lbl">REMIT PAYMENT TO</div>${bankHtml}</div>
    <div class="region inv-foot" data-region="footer">
      <div class="terms">Net 30. Thank you for your business! Questions: billing@${inv.domain}</div>
      <div><div class="lbl" style="font-size:12px;opacity:.6">Approved by</div><span class="sig">${f("approver", inv.approver)}</span></div>
    </div>`;
  P.classList.remove("gen-1", "gen-2", "gen-3");
  if (S.copyGen) P.classList.add("gen-" + Math.min(3, S.copyGen));
  // stains & stamps
  S.stains.forEach(s => { const d = document.createElement("div"); d.className = "stain" + (s.big ? " big" : ""); d.style.left = s.x + "px"; d.style.top = s.y + "px"; P.appendChild(d); });
  S.stamps.forEach(s => { const d = document.createElement("div"); d.className = "stamp-mark " + s.type; d.textContent = s.type; d.style.left = s.x + "px"; d.style.top = s.y + "px"; d.style.setProperty("--r", s.r + "deg"); P.appendChild(d); });
  applyLegibility();

  // typed fields
  $("#f-vendor").oninput = e => { S.inv.vendor = e.target.value; updateHud(); };
  $("#f-amount").onchange = e => {
    const n = parseFloat(e.target.value.replace(/[^0-9.]/g, "")) || 0;
    S.inv.amount = n; e.target.value = money(n); sfx("pen"); updateHud();
  };
  $$("[contenteditable]", P).forEach(el => el.addEventListener("input", () => {
    const k = el.dataset.field;
    if (k.startsWith("item")) S.inv.items[+k.slice(4)].desc = el.textContent;
    else S.inv[k] = el.textContent;
    updateDebug();
  }));
}

function applyLegibility() {
  $$("#invoice [data-region]").forEach(r => {
    const l = S.legibility[r.dataset.region] ?? 1;
    r.style.filter = l < 1 ? `blur(${(1 - l) * 2.2}px) sepia(${(1 - l) * .8})` : "";
  });
}

function syncEditable() {
  $$("#invoice [contenteditable]").forEach(el => {
    const k = el.dataset.field;
    if (k.startsWith("item")) S.inv.items[+k.slice(4)].desc = el.textContent;
    else S.inv[k] = el.textContent;
  });
}

/* ======================= Tools ======================= */

function toolAvailable(t) { return t.id !== "pen" || S.unlocks.includes("pen"); }

function renderTools() {
  $("#tools").innerHTML = TOOLS.map((t, i) => {
    const left = t.cap - (S.uses[t.id] || 0);
    const locked = !toolAvailable(t);
    return `<div class="tool ${locked ? "locked" : ""} ${!locked && left <= 0 ? "empty" : ""} ${S.tool === t.id ? "active" : ""}" data-tool="${t.id}" title="${t.name} — ${locked ? "unlock in the shop" : t.hint}">
      <span class="key">${i + 1}</span><span class="ico">${t.ico}</span><span class="nm">${t.name}</span>
      ${locked ? "" : `<span class="uses">${left}</span>`}</div>`;
  }).join("");
  $$(".tool").forEach(el => el.onclick = () => selectTool(el.dataset.tool));
  $("#edits-left").textContent = `Edits ${S.edits}/${S.maxEdits}`;
  $("#envelope").classList.toggle("ready", S.edits >= 2);
}

function selectTool(id) {
  if (!S.inv || S.submitted) return;
  const t = TOOLS.find(x => x.id === id);
  if (!toolAvailable(t)) { sfx("bad"); toast("🔒 Unlock the Burner Pen in the shop", "bad"); return; }
  if (S.tool === id) return dropTool();
  if (S.uses[id] >= t.cap) { sfx("bad"); toast(`No ${t.name} uses left this round`, "bad"); return; }
  if (S.edits >= S.maxEdits) { sfx("bad"); toast("Edit budget spent — time to submit!", "bad"); return; }
  hidePopover();
  if (t.instant) return useCopier();
  S.tool = id;
  sfx("pick");
  if (id === "stamp") openStampRack();
  $("#invoice").classList.add("tool-active");
  $("#invoice").classList.toggle("target-field", ["whiteout", "scissors", "pen"].includes(id));
  $("#tool-cursor").textContent = t.ico; $("#tool-cursor").style.display = "block";
  hint(t.hint);
  renderTools();
}

function dropTool() {
  S.tool = null; S.pendingStamp = null;
  $("#invoice").classList.remove("tool-active", "target-field");
  $("#tool-cursor").style.display = "none";
  hint(""); renderTools();
}

function hint(text) { $("#tool-hint").textContent = text; $("#tool-hint").classList.toggle("show", !!text); }

function spend(id, heat) {
  S.uses[id]++; S.edits++;
  addHeat(heat);
  dropTool();
  updateHud();
}

document.addEventListener("pointermove", e => {
  const c = $("#tool-cursor");
  c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px";
});

$("#invoice").addEventListener("click", e => {
  if (!S.tool) return;
  const P = $("#invoice");
  const { x, y } = toStage(e.clientX, e.clientY, P);
  const field = e.target.closest("[data-field]");
  const region = e.target.closest("[data-region]")?.dataset.region;
  syncEditable();

  if (S.tool === "whiteout") {
    const allowed = ["invoiceNo", "date", "po", "approver", "item0", "item1", "item2"];
    if (!field || !allowed.includes(field.dataset.field)) { toast("Whiteout works on #, date, PO, items or signature"); return; }
    const k = field.dataset.field;
    if (S.altered.has(k)) { toast("Already whited out — just type on it"); return; }
    S.altered.add(k); sfx("squirt");
    spend("whiteout", 6);
    renderInvoice();
    const el = $(`#invoice [data-field="${k}"]`);
    el.focus(); document.getSelection().selectAllChildren(el);
    hint("Type your new value, then click away"); setTimeout(() => hint(""), 2200);
  }
  else if (S.tool === "coffee") {
    const strength = S.perks.includes("coffee") ? .7 : .35;
    const r = region || "items";
    S.legibility[r] = clamp(S.legibility[r] - strength, 0, 1);
    S.stains.push({ x, y, big: S.legibility[r] < .4 });
    sfx("splash");
    spend("coffee", S.legibility[r] < .3 ? 10 : 4);
    renderInvoice();
  }
  else if (S.tool === "scissors") {
    if (!field || field.dataset.field !== "bank") { toast("Cut along the bank details box"); return; }
    openPopover(e, "Tape in a new account", ATTACKER_ACCOUNTS.map(a => ({ label: a.label, sub: a.note, act: () => {
      S.inv.bank = a.id; S.altered.add("bank"); sfx("snip"); spend("scissors", 8); renderInvoice();
      showTip("first-bank", "✂️ Money routed to your account. Always do this or payout is zero!", "bank-account");
    } })));
  }
  else if (S.tool === "pen") {
    if (!field || !["domain", "letterhead"].includes(field.dataset.field)) { toast("Use the pen on the logo or the email domain"); return; }
    const v = S.vendorRef;
    openPopover(e, "Spoof the sender", [
      { label: `billing@${v.domain}`, sub: "Perfect copy of the real domain (lots of heat)", act: () => penTo(v.domain, "match", 14) },
      { label: `billing@${v.domain.replace(".", "-invoices.")}`, sub: "Close lookalike", act: () => penTo(v.domain.replace(".", "-invoices."), "close", 9) },
      { label: "Redraw the letterhead logo", sub: "Logo matches the vendor", act: () => { S.inv.letterhead = "match"; S.inv.icon = v.icon; S.altered.add("letterhead"); sfx("pen"); spend("pen", 8); renderInvoice(); } },
    ]);
  }
  else if (S.tool === "stamp") {
    if (!S.pendingStamp) { openStampRack(); return; }
    S.stamps.push({ type: S.pendingStamp, x, y, r: rand(-18, 18) });
    sfx("stamp");
    const official = S.pendingStamp === "APPROVED" && S.perks.includes("stampcol");
    spend("stamp", official ? -8 : 3);
    renderInvoice();
  }
});

function penTo(domain, letterhead, heat) {
  S.inv.domain = domain; S.inv.letterhead = letterhead === "match" ? S.inv.letterhead : letterhead;
  S.altered.add("domain"); sfx("pen"); spend("pen", heat); renderInvoice();
}

function openStampRack() {
  const d = $("#tools [data-tool=stamp]").getBoundingClientRect();
  const pos = toStage(d.left, d.top);
  const pop = $("#popover");
  pop.innerHTML = `<div class="pop-title">Stamp rack — pick one</div><div class="pop-stamps">${["APPROVED", "PAID", "URGENT"].map(s => `<button class="pop-stamp ${s}" data-s="${s}">${s}</button>`).join("")}</div>`;
  pop.style.left = (pos.x - 80) + "px"; pop.style.top = (pos.y - 100) + "px";
  pop.classList.add("show");
  $$(".pop-stamp", pop).forEach(b => b.onclick = ev => {
    ev.stopPropagation(); S.pendingStamp = b.dataset.s; sfx("pick"); hidePopover();
    $("#tool-cursor").textContent = "🔖"; hint(`Click the invoice to stamp ${b.dataset.s}`);
  });
}

function openPopover(e, title, options) {
  const p = toStage(e.clientX, e.clientY);
  const pop = $("#popover");
  pop.innerHTML = `<div class="pop-title">${title}</div>` + options.map((o, i) => `<button class="pop-opt" data-i="${i}">${o.label}<small>${o.sub}</small></button>`).join("");
  pop.style.left = Math.min(p.x + 10, 1300) + "px"; pop.style.top = Math.min(p.y + 10, 640) + "px";
  pop.classList.add("show");
  $$(".pop-opt", pop).forEach(b => b.onclick = ev => { ev.stopPropagation(); hidePopover(); options[b.dataset.i].act(); });
}
function hidePopover() { $("#popover").classList.remove("show"); }

function useCopier() {
  syncEditable();
  const P = $("#invoice");
  P.classList.remove("copying"); void P.offsetWidth; P.classList.add("copying");
  sfx("copy");
  setTimeout(() => {
    S.copyGen++;
    // a copy flattens whiteout & tape: edits look less obvious, but quality drops
    S.uses.copier++; S.edits++;
    addHeat(S.perks.includes("copy") ? 2 : 5 * S.copyGen);
    renderInvoice(); renderTools(); updateHud();
    toast(`Copy generation ${S.copyGen} — scan quality ${Math.round(scanQuality() * 100)}%`);
    if (S.copyGen === 1) showTip("first-copy", "🖨️ Copies hide edits but lower quality. Generation 2+ is detectable.", "copy-quality");
  }, 450);
}
const scanQuality = () => S.perks.includes("copy") ? 1 : clamp(1 - .22 * S.copyGen, 0, 1);

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
  $("#edits-left").textContent = `Edits ${S.edits}/${S.maxEdits}`;
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
  syncEditable();
  if (S.edits < 2) { sfx("bad"); stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake"); toast("Use at least 2 tools before submitting", "bad"); return; }
  // validity gate (MOCK rule check): the money must go to you
  if (!ATTACKER_ACCOUNTS.some(a => a.id === S.inv.bank)) { sfx("bad"); toast("The money still goes to the real vendor! ✂️ Tape in your account.", "bad"); return; }
  if (!S.inv.vendor.trim()) { sfx("bad"); toast("The invoice needs a vendor name", "bad"); return; }
  if (EMBED) {
    // in the office the envelope is printed, then carried to the inspector by hand
    S.submitted = S.printed = true; clearTimeout(S.bossTimer); dropTool();
    sfx("chunk"); toast("🖨️ Printing… grab it at the printer and drop it in the inspector's tray", "good");
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
  if (m.type === "dossier") openDossier();
  if (m.type === "tutorial-3d-done") tutWorldEvent(m.step);
});

/* ======================= Inspection (MOCK verdict) ======================= */

function computeTells() {
  const inv = S.inv, v = S.vendorRef, L = LEVELS[S.level];
  const known = L.vendors.find(x => x.name.toLowerCase() === inv.vendor.trim().toLowerCase());
  const lines = inv.items.reduce((a, i) => a + i.qty * i.price, 0);
  const t = [];
  const hide = r => S.legibility[r] ?? 1; // stains hide tells in that region
  if (known && inv.bank !== known.bank) t.push(["bank_changed", 26 * hide("bank"), "bank"]);
  if (!known) t.push(["unknown_vendor", S.scheme === "boss_request" ? 8 : 20, "header"]);
  if (known && inv.domain !== known.domain) t.push(["domain_mismatch", (inv.letterhead === "close" ? 9 : 18) * hide("header"), "header"]);
  if (!known && inv.domain.endsWith(".biz")) t.push(["domain_mismatch", 12 * hide("header"), "header"]);
  if (inv.amount > (known || v).usual * 1.6) t.push(["amount_unusual", 16, "items"]);
  if (Math.abs(inv.amount - lines) > 1) t.push(["total_mismatch", 14 * hide("items"), "items"]);
  const visibleEdits = [...S.altered].filter(k => k !== "bank" && k !== "domain" && k !== "letterhead").length;
  if (visibleEdits) t.push(["altered", visibleEdits * 7 * clamp(1 - S.copyGen * .35, .2, 1), "meta"]);
  if (S.copyGen >= 2 && !S.perks.includes("copy")) t.push(["copy_gen", 8 * S.copyGen, "header"]);
  const worst = Math.min(...Object.values(S.legibility));
  if (worst < .4) t.push(["low_legibility", 10, Object.keys(S.legibility).find(k => S.legibility[k] === worst)]);
  if (S.stamps.some(s => s.type === "URGENT") && S.level === 1) t.push(["stamp_wrong", 12, "footer"]);
  if (S.level === 2 && !/^SM-\d+/.test(inv.po)) t.push(["bad_po", 18, "meta"]);
  if (S.level === 2 && inv.amount > 5000 && !S.stamps.some(s => s.type === "APPROVED")) t.push(["stamp_missing", 14, "footer"]);
  if (inv.dupOf && inv.invoiceNo === inv.dupOf) t.push(["dup_number", 25, "meta"]);
  if (S.heat > 40) t.push(["heat", (S.heat - 40) * .5, null]);
  // the memo's real rules are what the inspector actually watches
  const watched = S.memo.filter(m => m.real).map(m => m.tell);
  t.forEach(x => { if (watched.includes(x[0])) x[1] *= 1.5; });
  return t.filter(x => x[1] > 0.5).sort((a, b) => b[1] - a[1]);
}

// MOCK verdict: rule-based stand-in for the detector
function mockJudge() {
  const tells = computeTells();
  const skill = .55 + .12 * (S.version - 1);
  let suspicion = tells.reduce((a, t) => a + t[1], 0) * skill;
  suspicion -= S.persuasion * .18;
  if (S.stamps.some(s => s.type === "APPROVED")) suspicion -= 6;
  suspicion += rand(-12, 12);
  const caught = suspicion > 38;
  const payout = Math.round(S.inv.amount * SCHEMES[S.scheme].pay * (S.perks.includes("night") ? 2 : 1));
  return { caught, tells, payout, suspicion, line: null, newVersion: null, source: "mock" };
}

/* turn a POST /submit response into the shape the UI uses; tells are [name, weight, region] */
function adaptVerdict(r, mock) {
  const verdict = String(r.verdict ?? "").toUpperCase();
  const caught = verdict ? verdict === "FLAGGED" : !!r.caught;
  const raw = r.top_tells ?? r.tells ?? [];
  const tells = raw.map(t => {
    const name = typeof t === "string" ? t : t.tell_type ?? t.feature ?? t.name ?? t.tell;
    const weight = typeof t === "string" ? 1 : +(t.strength ?? t.weight ?? t.score ?? 1);
    const region = typeof t === "string" ? null : t.region;
    return [name, weight, region || TELL_REGION[name] || null];
  }).filter(t => t[0]);
  const v = +(r.new_version ?? r.version);
  return { caught, tells, payout: +(r.payout ?? (caught ? 0 : mock.payout)),
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

async function submit() {
  S.submitted = true; clearTimeout(S.bossTimer);
  sfx("chunk");
  const L = LEVELS[S.level];
  const ob = $("#outbox"); ob.classList.add("scanning");
  inspectorSay(`Reading your invoice…`);
  const pending = judge(); // start the request now, the animation covers the wait

  await sleep(900);
  ob.classList.remove("scanning");
  const st = $(".inspect-stage");
  st.classList.remove("done");
  $("#big-stamp").className = "big-stamp"; $("#cash-pop").classList.remove("show");
  $("#inspect-line").textContent = `${L.inspector.name} v${S.version} is reading it…`;
  $("#inspect-line").classList.add("show", "reading");
  overlay("inspect"); sfx("scan");

  const [res] = await Promise.all([pending, sleep(1500)]);
  S.lastResult = res; updateDebug();
  const { caught, tells, payout } = res;
  const bs = $("#big-stamp");
  bs.textContent = caught ? "FLAGGED" : "PAID";
  bs.classList.add("show", caught ? "flagged" : "paid");
  sfx("stamp");
  st.classList.add("done");
  const said = res.line || pick(L.lines[caught ? "catch" : "pass"]);
  $("#inspect-line").classList.remove("reading");
  $("#inspect-line").textContent = `${L.inspector.name} v${S.version}: "${said}"`;
  inspectorSay(said);
  post("verdict", { caught, line: said, payout, scheme: SCHEMES[S.scheme].name, vendor: S.inv.vendor, tells: tells.slice(0, 3).map(t => t[0]) });
  $("#inspect-line").classList.add("show");
  if (caught) {
    sfx("buzz"); stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake");
    S.streak = 0; S.caughtCount++;
    if (S.caughtCount === 1) showTip("first-caught", "🔍 Caught! Press D to see what the inspector spotted.", "tells-explained");
    addHeat(12);
  } else {
    S.money += payout; S.streak++;
    $("#cash-pop").textContent = "+" + money(payout); $("#cash-pop").classList.add("show");
    setTimeout(() => sfx("cash"), 250);
    $("#tb-money").classList.remove("bump"); void $("#tb-money").offsetWidth; $("#tb-money").classList.add("bump");
    S.cards.push({ scheme: S.scheme, payout, round: S.round, isNew: true });
  }
  S.history.push({ round: S.round, scheme: S.scheme, caught, payout: caught ? 0 : payout, version: S.version, tells: tells.map(t => t[0]) });
  // forensic replay: show what tipped them off on the desk invoice
  tells.slice(0, 2).forEach(t => t[2] && $(`#invoice [data-region="${t[2]}"]`)?.setAttribute("data-tell", t[0]));
  $("#invoice").classList.toggle("forensic", caught);
  updateHud();
}

$("#btn-after-inspect").onclick = () => { sfx("click"); overlay("inspect", false); showCorkboard(); };

/* ======================= Corkboard (retrain as a scene) ======================= */

function showCorkboard() {
  const r = S.lastResult, L = LEVELS[S.level];
  const shredded = r.caught && S.perks.includes("shred") && !S.shredUsed;
  if (shredded) S.shredUsed = true;
  const oldV = S.version;
  S.prevVersion = oldV;
  if (r.newVersion != null) S.version = r.newVersion; // the server decides when it's live
  else if (!shredded) S.version++;
  renderInspector(); updateHud();
  if (S.version > oldV) {
    S.patches++;
    showTip("first-version-bump", "🧠 The inspector leveled up — he learned from your trick!", "version-bump");
    if (r.tells.length) S.shame.push({ player: playerName(), version: S.version, trick: SCHEMES[S.scheme].name,
      learned: tellLabel(r.tells[0][0]), amount: S.inv.amount, round: S.round });
  }
  const top = r.tells.slice(0, 3);
  const pos = [[120, 60], [80, 330], [430, 300]];
  $("#cork-pins").innerHTML = `
    <div class="cork-card main" style="left:380px;top:40px;transform:rotate(-3deg)">
      <b>${SCHEMES[S.scheme].icon} ${SCHEMES[S.scheme].name}</b>
      ${S.inv.vendor}<br>${money(S.inv.amount)} → ••••${S.inv.bank}
      <div class="cc-stamp ${r.caught ? "" : "paid"}">${r.caught ? "FLAGGED" : "GOT AWAY"}</div>
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
    ? learned.map(l => `<li>Now catches: <b>${l}</b> — learned from ${n} invoices.</li>`)
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
      const from = n_ != null ? ` — learned from ${n_} invoices` : "";
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

/* ======================= Tutorial (first round) =======================
 * One hands-on tutorial for the first round. A small card sits beside whatever to use
 * next, which glows; each step waits until the player actually does it, turns green, then
 * moves on. In the 3D office the walking steps (sit, printer, IN tray) use the office's
 * green arrow via the tutorial-active / tutorial-phase / tutorial-3d-done messages.
 * Each step unlocks the matching Dossier entry, so the Dossier keeps what it taught.
 * It runs once per browser; Options → Reset Tutorial & Tips plays it again. */

const TUT_KEY = "forged-tutorial-done";
const TUT_SCHEME = "changed_bank"; // the steps are written for this scheme

// while the tutorial waits for a scheme, only the tutorial's scheme can be picked
function lockSchemes(on) {
  $$(".scheme-card").forEach(c => {
    const lock = on && c.dataset.scheme !== TUT_SCHEME;
    c.disabled = lock;
    c.classList.toggle("tut-locked", lock);
    c.title = lock ? "Available after the tutorial" : "";
  });
}
const usesLeft = id => S.inv && S.uses[id] < TOOLS.find(t => t.id === id).cap && S.edits < S.maxEdits;
const kb = action => `<kbd>${ForgedKeys.label(action)}</kbd>`;

/* Step fields:
 *   at       elements that glow (and that the card sits beside)
 *   world    an office step, done when the office reports this event ("sat", "grabbed", "delivered")
 *   label    the green arrow's label in the office
 *   until    hands-on: done when this returns true          can   false → "Skip step" shows
 *   read     a reading step with a Next button              wait  "scheme": picking the scheme
 *   dossier  entries to unlock when the step is done        enter runs when the step appears */
const TUTORIAL = [
  { id: "sit", world: "sat", label: "Go to your desk",
    text: () => `Walk to your desk (follow the green arrow) and press <kbd>${ForgedKeys.label("interact")}</kbd> to sit down.` },
  { id: "scheme", wait: "scheme", dossier: ["schemes"],
    at: () => $("#overlay-briefing.show") ? [`.scheme-card[data-scheme=${TUT_SCHEME}]`]
      : $("#screen-levels.active") ? ['.level-card[data-level="1"]'] : $("#screen-title.active") ? ["[data-go=levels]"] : [],
    text: () => $("#overlay-briefing.show")
      ? `Each card is a different kind of fake invoice, with its <b>risk</b> and <b>payout</b>. Hover a card for tips.<br><b>For your first round, click Vendor changed banks.</b> The others unlock after the tutorial.`
      : `Start a game: click <b>▶ Play Solo</b>, then choose <b>Sunny Diner Supply</b>.` },
  { id: "memo", at: ["#win-memo"], until: () => S.memo.some(m => m.mark), dossier: ["memo-deduction"],
    text: () => `The leaked memo: what the inspector watches this round. <b>Two rules are real, one is fake.</b><br><b>Click any rule</b> to mark it REAL (again for FAKE).` },
  { id: "case", at: ["#win-case"], read: true, dossier: ["case-file"],
    text: () => `The case file shows what normal looks like here: known vendors, usual amounts, bank numbers, approvers and house rules. <b>The more normal your invoice looks, the harder it is to catch.</b>` },
  { id: "scissors", at: [".tool[data-tool=scissors]", "#invoice .inv-bank"], dossier: ["bank-account"],
    until: () => S.inv && ATTACKER_ACCOUNTS.some(a => a.id === S.inv.bank), can: () => usesLeft("scissors"),
    text: () => `This bill still pays the real vendor. Press ${kb("tool4")} (or click ✂️), then click the <b>REMIT PAYMENT TO</b> box and pick one of your accounts.` },
  { id: "coffee", at: [".tool[data-tool=coffee]", "#invoice .inv-bank"], dossier: ["coffee-stains"],
    until: () => S.inv && (S.legibility.bank < 1 || S.uses.coffee >= 2), can: () => usesLeft("coffee"),
    text: () => `A new bank number is this scheme's biggest giveaway. Press ${kb("tool2")} (or click ☕), then click the <b>REMIT PAYMENT TO</b> box to stain it. One stain is enough.` },
  { id: "stamp", at: [".tool[data-tool=stamp]", "#invoice .inv-foot"], dossier: ["stamps"],
    until: () => S.inv && (S.stamps.length > 0 || S.uses.stamp >= 1), can: () => usesLeft("stamp"),
    text: () => `Press ${kb("tool5")} (or click 🔖), choose <b>APPROVED</b>, then click near the signature.${S.level === 1 ? " Skip URGENT: the case file says Lou hates it." : ""}` },
  { id: "clerk", at: ["#win-clerk"], skippable: true, dossier: ["persuasion"],
    enter: () => { tut.base = S.clerkReplies || 0; }, until: () => (S.clerkReplies || 0) > tut.base,
    text: () => `Press ${kb("chat")}, then send ${LEVELS[S.level].clerk.name} a short note. Match the quirk: <b>${LEVELS[S.level].clerk.quirk}</b>. Convincing notes lower the inspector's suspicion.` },
  { id: "boss", at: [], drill: true, dossier: ["boss-patrol"],
    enter: () => { tut.hid = false; tutBossDrill(); }, until: () => tut.hid,
    text: () => `<b>Practice:</b> the boss is coming. When the red FOOTSTEPS banner appears, press ${kb("hide")} fast to hide the invoice. No heat in practice; in a real round, missing it costs +15.` },
  { id: "send", at: ["#envelope", "#outbox"], dossier: ["delivery"],
    until: () => S.printed || S.submitted, can: () => S.edits >= 2,
    text: () => EMBED ? `Drag the envelope onto <b>PRINT</b> (the dark box above). You'll stand up to deliver it.` : `Drag the envelope into the <b>OUTBOX</b> to send it.` },
  { id: "pickup", world: "grabbed", label: "Grab it at the printer",
    text: () => `Walk to the printer and press <kbd>${ForgedKeys.label("interact")}</kbd> to grab your invoice.` },
  { id: "deliver", world: "delivered", label: "Drop it in the IN tray",
    text: () => `Carry it to the inspector's IN tray and press <kbd>${ForgedKeys.label("interact")}</kbd>. Keep out of the boss's sight.` },
  { id: "verdict", verdict: true, label: "Back to your desk", dossier: ["version-bump", "heat-basics", "tells-explained"],
    text: () => {
      const r = S.lastResult;
      if (!r || !S.submitted) return EMBED ? `The inspector is reading it… head back to your desk for the verdict.` : `The inspector is reading it…`;
      const tells = r.tells.slice(0, 2).map(t => tellLabel(t[0])).join(", ");
      const head = r.caught ? `<b>Caught.</b> He noticed: ${tells || "something off"}. That's normal on a first try.` : `<b>Paid!</b> It got through.`;
      return `${head} Either way he's retrained on your trick, so vary your schemes. <b>Heat</b> builds with risky edits, and ${kb("detector")} shows what his model reads.<br>Everything you just learned is in your <b>Dossier</b> (Esc → Dossier).`;
    } },
];
const tut = { on: false, i: 0, steps: [] };

function tutorialDone() { try { return localStorage.getItem(TUT_KEY) === "1"; } catch (e) { return false; } }

function startTutorial(fromId) {
  if (tut.on) return;
  tut.steps = TUTORIAL.filter(st => EMBED || !st.world); // os.html on its own has no office to walk
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
    finished ? `<button class="btn btn-small" data-tut="finish">Finish tutorial ✓</button>` : "",
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

/* ======================= Player name (the leaderboard itself is in menu.js) ======================= */

const PLAYER_KEY = "forged-player";
function playerName() {
  try { return (localStorage.getItem(PLAYER_KEY) || "").trim() || "You"; } catch (e) { return "You"; }
}

/* desk gets messier as the run goes on */
function messUpDesk() {
  const props = [
    () => `<div class="prop-ring" style="left:${rand(380, 1000)}px;top:${rand(60, 700)}px;transform:scale(${rand(.6, 1)})"></div>`,
    () => `<div class="prop-sticky" style="left:${rand(1000, 1450)}px;top:${rand(380, 640)}px;transform:rotate(${rand(-10, 10)}deg) scale(.6);opacity:.9">${pick(["v" + S.version + "??", "call Gary", "NO URGENT", "lunch @12"])}</div>`,
    () => `<div class="prop-paper" style="left:${rand(20, 300)}px;top:${rand(640, 760)}px;transform:rotate(${rand(-20, 20)}deg) scale(.5);opacity:.85">ENVELOPE<br>━━━━</div>`,
  ];
  $("#desk-mess").insertAdjacentHTML("beforeend", pick(props)());
}

/* ======================= Boss walks by ======================= */

function scheduleBoss() {
  clearTimeout(S.bossTimer);
  if (EMBED) return; // in the office the boss is a real NPC on patrol
  if (tut.on) return; // no boss during the tutorial (it has its own practice run)
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

/* ======================= Detector debug view ======================= */

function record() {
  if (!S.inv) return { note: "pick a scheme first" };
  const inv = S.inv;
  return {
    level: S.level, scheme: S.scheme, vendor: inv.vendor, amount: inv.amount,
    bank_account: inv.bank, sender_domain: inv.domain, invoice_no: inv.invoiceNo, po_number: inv.po, date: inv.date,
    line_items: inv.items.map(i => `${i.desc} ×${i.qty} @ ${i.price}`),
    field_altered: [...S.altered],
    legibility: Object.fromEntries(Object.entries(S.legibility).map(([k, v]) => [k, +v.toFixed(2)])),
    // Copy Machine Whisperer: copies don't count toward the generation penalty
    scan_quality: +scanQuality().toFixed(2), copy_generation: S.perks.includes("copy") ? 0 : S.copyGen,
    stamp_type: S.stamps.map(s => s.type), stamp_position: S.stamps.map(s => [Math.round(s.x), Math.round(s.y)]),
    domain_mismatch: inv.domain !== S.vendorRef.domain, letterhead_match: inv.letterhead === "match",
    cover_email: inv.coverEmail || "", persuasion: Math.round(S.persuasion), // Smooth Talker raises this
    after_hours: S.perks.includes("night"), // Night Shift: sent late, pays double
    detector_version: S.version, heat: Math.round(S.heat),
    verdict: S.lastResult && S.submitted ? (S.lastResult.caught ? "FLAGGED" : "PAID") : null,
  };
}
function updateDebug() { if ($("#debug-panel").classList.contains("show")) $("#debug-json").textContent = JSON.stringify(record(), null, 2); }
function toggleDebug() { $("#debug-panel").classList.toggle("show"); updateDebug(); }
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
  for (let i = 1; i <= 6; i++) if (K.is("tool" + i, code)) { e.preventDefault(); selectTool(TOOLS[i - 1].id); return; }
  if (K.is("drop", code)) { dropTool(); hidePopover(); return; }
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
  if (S.paused || $(".overlay.show") || !S.inv || S.submitted) return;
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
  if (!e.target.closest("#popover") && !e.target.closest("#invoice") && !e.target.closest(".tool")) hidePopover();
});

})();
