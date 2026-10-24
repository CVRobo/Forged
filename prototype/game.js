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
  bad_po: "PO number doesn't follow the company format",
  dup_number: "invoice number already paid before",
  letterhead: "letterhead doesn't match the vendor",
  heat: "you've been getting sloppy (heat)",
  vendor_type: "vendor category",
};

/* ======================= State ======================= */

const S = {
  level: 1, round: 0, money: 0, heat: 0, version: 1,
  perks: [], unlocks: [], dossier: false, shredUsed: false,
  history: [], cards: [], caughtCount: 0, streak: 0,
  // per round
  scheme: null, vendorRef: null, inv: null, uses: {}, edits: 0, maxEdits: 4,
  stains: [], stamps: [], copyGen: 0, altered: new Set(), legibility: {}, persuasion: 0,
  memo: [], tool: null, pendingStamp: null, submitted: false, bossTimer: null, bossWindow: false,
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
  document.body.classList.add("embedded");
  $(".outbox-label").textContent = "PRINT — drop the envelope here, then deliver it";
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
  const op = e.target.closest("[data-open]");
  if (op) { sfx("click"); overlay(op.dataset.open); }
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
    shredUsed: false, history: [], cards: [], caughtCount: 0, streak: 0 });
  stage.dataset.level = level;
  $("#desk-mess").innerHTML = "";
  const L = LEVELS[level];
  $("#tb-level").textContent = L.name;
  $("#case-client").textContent = L.name;
  $("#memo-to").textContent = L.inspector.name;
  $("#clerk-avatar").textContent = L.clerk.avatar;
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
    printed: false, delivered: false });
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
    <li data-i="${i}" class="${m.mark || ""} ${reveal && !m.real ? "revealed-decoy" : ""}">${m.text}${m.mark ? `<span class="mark">${m.mark.toUpperCase()}</span>` : ""}</li>`).join("");
  $$("#memo-rules li").forEach(li => li.onclick = () => {
    const m = S.memo[li.dataset.i];
    m.mark = m.mark === null ? "real" : m.mark === "real" ? "fake" : null;
    sfx("pen"); renderMemo();
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
  $("#scheme-cards").innerHTML = Object.entries(SCHEMES).map(([id, sc]) => {
    const repeat = last.filter(s => s === id).length;
    return `<button class="scheme-card" data-scheme="${id}">
      ${repeat ? `<span class="sc-warn">USED ${repeat}× · +HEAT</span>` : ""}
      <div class="sc-ico">${sc.icon}</div>
      <div class="sc-name">${sc.name}</div>
      <div class="sc-desc">${sc.desc}</div>
      <div class="sc-weak"><b>Weak to:</b> ${sc.weak}<br><span class="sc-pay">Payout ×${sc.pay}</span></div>
    </button>`;
  }).join("");
  $$(".scheme-card").forEach(c => c.onclick = () => { sfx("pick"); overlay("briefing", false); beginForge(c.dataset.scheme); });
  overlay("briefing");
}

/* ======================= Invoice ======================= */

function beginForge(schemeId) {
  const L = LEVELS[S.level];
  S.scheme = schemeId;
  const v = pick(L.vendors);
  S.vendorRef = v;
  const prefix = S.level === 2 ? "SM-" : "PO-";
  const items = v.items.map(i => ({ desc: i[0], qty: i[1], price: i[2] }));
  const sum = items.reduce((a, i) => a + i.qty * i.price, 0);
  const inv = {
    vendor: v.name, domain: v.domain, letterhead: "match", icon: v.icon,
    invoiceNo: v.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() + "-0" + Math.floor(rand(200, 999)),
    date: "Fri, Oct " + Math.floor(rand(3, 28)), po: prefix + Math.floor(rand(1000, 9999)),
    items, amount: sum, bank: v.bank, approver: L.approvers[0][0].split(" ")[0],
  };
  if (schemeId === "duplicate") { inv.invoiceNo = L.notes[2].match(/#(\S+),/)?.[1] || inv.invoiceNo; inv.dupOf = inv.invoiceNo; }
  if (schemeId === "phantom") { inv.vendor = pick(PHANTOMS); inv.icon = "❓"; inv.domain = inv.vendor.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14) + ".biz"; inv.bank = pick(ATTACKER_ACCOUNTS).id; }
  if (schemeId === "boss_request") { inv.vendor = "Office of the Owner"; inv.icon = "👔"; inv.domain = "owner-office.net"; inv.bank = pick(ATTACKER_ACCOUNTS).id; inv.approver = L.approvers[1][0].split(" (")[0]; inv.items = [{ desc: "Urgent confidential payment", qty: 1, price: Math.round(v.usual * 1.8) }]; inv.amount = inv.items[0].price; }
  S.inv = inv;
  ["header", "meta", "items", "bank", "footer"].forEach(r => S.legibility[r] = 1);
  $("#scheme-banner").textContent = `${SCHEMES[schemeId].icon} ${SCHEMES[schemeId].name}`;
  renderInvoice();
  clerkSay(L.clerk.hello);
  inspectorSay(pick(L.lines.idle));
  scheduleBoss();
  updateHud();
  post("phase", { phase: "forging" });
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
  }, 450);
}
const scanQuality = () => S.perks.includes("copy") ? 1 : clamp(1 - .22 * S.copyGen, 0, 1);

/* ======================= Heat / HUD ======================= */

function addHeat(n) {
  if (S.perks.includes("night")) n *= 1.3;
  S.heat = clamp(S.heat + n, 0, 100);
  updateHud();
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
    inspector: LEVELS[S.level].inspector.name, emoji: st.emoji, clerk: LEVELS[S.level].clerk });
}

function stageFor(v) { return INSPECTOR_STAGES.find(s => v <= s.upTo); }
function renderInspector() {
  const L = LEVELS[S.level], st = stageFor(S.version);
  $("#insp-emoji").textContent = st.emoji; $("#insp-prop").textContent = st.prop;
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

$("#chat-form").addEventListener("submit", e => {
  e.preventDefault();
  const input = $("#chat-text"), text = input.value.trim();
  if (!text || !S.inv || S.submitted) return;
  input.value = ""; addMsg("me", text); sfx("click");
  S.inv.coverEmail = ((S.inv.coverEmail || "") + " " + text).trim();
  // MOCK: short + matches the clerk's quirk = convincing. The real game scores this with an LLM.
  const L = LEVELS[S.level];
  const hits = L.clerk.keywords.filter(k => text.toLowerCase().includes(k)).length;
  let score = 30 + hits * 25 - Math.max(0, text.length - 90) * .5 + (S.perks.includes("smooth") ? 20 : 0);
  score = clamp(score + rand(-10, 10), 0, 100);
  S.persuasion = clamp(Math.max(S.persuasion, score), 0, 100);
  $("#persuade-fill").style.width = S.persuasion + "%";
  const av = $("#clerk-avatar"); av.classList.add("typing");
  setTimeout(() => {
    av.classList.remove("typing");
    clerkSay(pick(L.clerk.replies[score > 60 ? "good" : score > 35 ? "meh" : "bad"]));
    updateDebug();
  }, 700 + rand(0, 600));
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
  if (m.type === "boss-near") bossWalk();
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
  if (inv.dupOf && inv.invoiceNo === inv.dupOf) t.push(["dup_number", 25, "meta"]);
  if (S.heat > 40) t.push(["heat", (S.heat - 40) * .5, null]);
  // the memo's real rules are what the inspector actually watches
  const watched = S.memo.filter(m => m.real).map(m => m.tell);
  t.forEach(x => { if (watched.includes(x[0])) x[1] *= 1.5; });
  return t.filter(x => x[1] > 0.5).sort((a, b) => b[1] - a[1]);
}

function submit() {
  S.submitted = true; clearTimeout(S.bossTimer);
  sfx("chunk");
  const ob = $("#outbox"); ob.classList.add("scanning");
  const tells = computeTells();
  const skill = .55 + .12 * (S.version - 1);
  let suspicion = tells.reduce((a, t) => a + t[1], 0) * skill;
  suspicion -= S.persuasion * .18;
  if (S.stamps.some(s => s.type === "APPROVED")) suspicion -= 6;
  suspicion += rand(-12, 12);
  const caught = suspicion > 38;
  const sc = SCHEMES[S.scheme];
  const payout = Math.round(S.inv.amount * sc.pay * (S.perks.includes("night") ? 2 : 1));
  S.lastResult = { caught, tells, payout, suspicion };
  updateDebug();

  setTimeout(() => {
    ob.classList.remove("scanning");
    const st = $(".inspect-stage");
    st.classList.remove("done");
    $("#big-stamp").className = "big-stamp"; $("#inspect-line").classList.remove("show"); $("#cash-pop").classList.remove("show");
    overlay("inspect"); sfx("scan");
    setTimeout(() => {
      const bs = $("#big-stamp");
      bs.textContent = caught ? "FLAGGED" : "PAID";
      bs.classList.add("show", caught ? "flagged" : "paid");
      sfx("stamp");
      st.classList.add("done");
      const L = LEVELS[S.level];
      const said = pick(L.lines[caught ? "catch" : "pass"]);
      $("#inspect-line").textContent = `${L.inspector.name} v${S.version}: "${said}"`;
      post("verdict", { caught, line: said, payout, scheme: SCHEMES[S.scheme].name, vendor: S.inv.vendor });
      $("#inspect-line").classList.add("show");
      if (caught) {
        sfx("buzz"); stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake");
        S.streak = 0; S.caughtCount++; addHeat(12);
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
    }, 1500);
  }, 900);
}

$("#btn-after-inspect").onclick = () => { sfx("click"); overlay("inspect", false); showCorkboard(); };

/* ======================= Corkboard (retrain as a scene) ======================= */

function showCorkboard() {
  const r = S.lastResult, L = LEVELS[S.level];
  const shredded = r.caught && S.perks.includes("shred") && !S.shredUsed;
  if (shredded) S.shredUsed = true;
  const oldV = S.version;
  if (!shredded) S.version++;
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
      <b>Clue #${i + 1}</b>${TELL_LABELS[t[0]] || t[0]}</div>`).join("");
  const cx = 510, cy = 130;
  $("#cork-string").innerHTML = (top.length ? top : [0]).map((_, i) =>
    `<path d="M${cx},${cy} Q${(cx + pos[i][0] + 100) / 2},${(cy + pos[i][1]) / 2 + 60} ${pos[i][0] + 105},${pos[i][1] + 10}"/>`).join("");
  $("#cork-emoji").textContent = stageFor(S.version).emoji;
  $("#cork-line").textContent = shredded ? "Wait… where did that file go?" : r.caught ? "Gotcha. Never again." : "You fooled me once. Never again.";
  $("#ver-old").textContent = "v" + oldV; $("#ver-new").textContent = "v" + S.version;
  overlay("cork");
  sfx("stamp");
}

$("#btn-after-cork").onclick = () => { sfx("click"); overlay("cork", false); showBetween(); };

/* ======================= Between rounds: patch notes + shop ======================= */

function showBetween() {
  const r = S.lastResult;
  const learned = r.tells.slice(0, 2).map(t => TELL_LABELS[t[0]]).filter(Boolean);
  const n = 40 + S.round * 17 + Math.floor(rand(0, 30));
  $("#patch-title").textContent = `Inspector v${S.version}`;
  const items = learned.length
    ? learned.map(l => `<li>Now catches: <b>${l}</b> — learned from ${n} invoices.</li>`)
    : [`<li>No new tricks learned. <b>Clean job.</b></li>`];
  const st = stageFor(S.version);
  if (stageFor(S.version - 1) !== st) items.push(`<li>Promoted to <b>${st.title}</b> ${st.emoji}</li>`);
  if (S.streak >= 2) items.push(`<li>🔥 Streak ×${S.streak} — vary your schemes to keep it.</li>`);
  $("#patch-list").innerHTML = items.join("");
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
$("#btn-quit").onclick = () => { sfx("click"); overlay("between", false); clearTimeout(S.bossTimer); show("title"); };

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
  if (Math.random() < .35 && S.round > 1 || S.round === 2) {
    S.bossTimer = setTimeout(bossWalk, rand(9000, 20000));
  }
}
function bossWalk() {
  if (S.submitted || !$("#screen-desk").classList.contains("active") || $(".overlay.show")) return;
  sfx("steps");
  const sh = $("#boss-shadow"); sh.classList.remove("walk"); void sh.offsetWidth; sh.classList.add("walk");
  $("#boss-prompt").classList.add("show");
  S.bossWindow = true;
  S.bossTimer = setTimeout(() => {
    if (!S.bossWindow) return;
    S.bossWindow = false; $("#boss-prompt").classList.remove("show");
    sfx("buzz"); addHeat(15); toast("The boss saw something… +15 heat", "bad");
    inspectorSay("Huh? What's the boss looking at?");
  }, 2000);
}
function hideInvoice() {
  if (!S.bossWindow) return;
  S.bossWindow = false; clearTimeout(S.bossTimer);
  $("#boss-prompt").classList.remove("show");
  const np = $("#newspaper"); np.classList.add("show"); sfx("whoosh");
  toast("Smooth. Just reading the paper.", "good");
  setTimeout(() => np.classList.remove("show"), 1700);
}

/* ======================= Detector debug view ======================= */

function record() {
  if (!S.inv) return { note: "pick a scheme first" };
  const inv = S.inv;
  return {
    level: S.level, scheme: S.scheme, vendor: inv.vendor, amount: inv.amount,
    bank_account: "••••" + inv.bank, sender_domain: inv.domain, invoice_no: inv.invoiceNo, po_number: inv.po, date: inv.date,
    line_items: inv.items.map(i => `${i.desc} ×${i.qty} @ ${i.price}`),
    field_altered: [...S.altered],
    legibility: Object.fromEntries(Object.entries(S.legibility).map(([k, v]) => [k, +v.toFixed(2)])),
    scan_quality: +scanQuality().toFixed(2), copy_generation: S.copyGen,
    stamp_type: S.stamps.map(s => s.type), stamp_position: S.stamps.map(s => [Math.round(s.x), Math.round(s.y)]),
    domain_mismatch: inv.domain !== S.vendorRef.domain, letterhead_match: inv.letterhead === "match",
    cover_email: inv.coverEmail || "", detector_version: S.version, heat: Math.round(S.heat),
    verdict: S.lastResult && S.submitted ? (S.lastResult.caught ? "FLAGGED" : "PAID") : null,
  };
}
function updateDebug() { if ($("#debug-panel").classList.contains("show")) $("#debug-json").textContent = JSON.stringify(record(), null, 2); }
function toggleDebug() { $("#debug-panel").classList.toggle("show"); updateDebug(); }
$("#btn-debug").onclick = () => { sfx("click"); toggleDebug(); };

/* ======================= Keyboard ======================= */

document.addEventListener("keydown", e => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if (e.code === "Space" && S.bossWindow) { e.preventDefault(); document.activeElement.blur?.(); hideInvoice(); return; }
  if (typing) { if (e.key === "Escape" || e.key === "Enter" && document.activeElement.isContentEditable) { e.preventDefault(); document.activeElement.blur(); } return; }
  if (e.key === "Escape" && EMBED && !S.tool && !$("#popover.show")) { post("stand"); return; }
  if (!$("#screen-desk").classList.contains("active") || $(".overlay.show")) return;
  if (e.key === "Escape") { dropTool(); hidePopover(); }
  if (e.key >= "1" && e.key <= "6") selectTool(TOOLS[+e.key - 1].id);
  if (e.key.toLowerCase() === "d") toggleDebug();
});
document.addEventListener("pointerdown", e => {
  if (!e.target.closest("#popover") && !e.target.closest("#invoice") && !e.target.closest(".tool")) hidePopover();
});

})();
