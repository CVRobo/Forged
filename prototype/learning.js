/* Forged — "Gus is learning": the real fraud model (ml/online) getting better, version by version.
 * In the office, the DETECTOR LIVE TV opens it (E) over the 3D view and pauses the office the way the
 * Game Menu does. learning.html shows the same panel as a page of its own, to send people to.
 * The numbers are gus-versions.json, a copy of ml/online/models/versions.json, because serve.py only
 * serves this folder (README.md, "Gus is learning"). ml/online/README.md says what each one means.
 */
(() => {
"use strict";
const SRC = "gus-versions.json";
const BASE_RATE = 1 / 1000; // about 1 online order in 1,000 is fraud
// the promotion gate's limits (ml/online/retrain.py); versions.json records whether each check passed
const RECALL_FLOOR_DROP = 0.05, FPR_LIMIT = 0.04, GAME_FPR_LIMIT = 0.05;
// versions.json counts a retrain's attack orders as "player" orders. These came from elsewhere (their
// commits and notes): v2's from the red-team search (ml/online/robustness.py harden), which plays the
// game's own checkout hunting for orders Gus misses; v3's and v4's from simulated careful players
const ATTACKERS = { 2: "the red-team search", 3: "simulated careful players", 4: "simulated careful players" };
const source = r => ATTACKERS[r.version] || "players";
// Gus's words for the tells the model can learn (TELL_LABELS in orders.js)
const TELLS = {
  amount_unusual: "way more than people spend here", night: "who shops at 3 AM?", far_ship: "shipped across the ocean",
  ip_far: "shopping from 800 miles away", new_card: "a brand-new card buying big", velocity: "too many orders, too fast",
  new_address: "a new address on an old card", device_reuse: "the same computer with another card",
  new_account: "a brand-new account", new_device: "an old account on a strange device",
  gift_card: "a suspiciously big gift card", email_risky: "that email screams 'burner'",
  foreign_card: "a card from abroad, here?", proxy: "hiding behind a VPN",
};
// what the gate protects, per version: the same real transactions for every version
const GUARDS = [
  { name: "Real fraud caught", short: "real fraud caught", shape: "dot", of: r => r.test.recall },
  { name: "Honest customers blocked", short: "honest blocked", shape: "square", of: r => r.test.fpr },
];
const STATUS = { // [on cards and retrain rows, under the chart]
  first: ["first version", "first"],
  passed: ["✓ passed the gate", "promoted"],
  forced: ["⚠ pushed live by hand", "forced"],
  rejected: ["✗ rejected by the gate", "rejected"],
};

const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
const num = n => Math.round(n).toLocaleString("en-US");
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- the versions ---------------- */

// one row per version, oldest first
function rowsOf(list) {
  const vs = (Array.isArray(list) ? list : []).filter(v => v && v.test).sort((a, b) => a.version - b.version);
  const current = vs.filter(v => v.promoted).pop();
  return vs.map(v => ({
    ...v, current: v === current, attacks: (v.trained_on || {}).player || 0,
    status: v.parent == null ? "first" : !v.promoted ? "rejected" : v.forced ? "forced" : "passed",
  }));
}
// a retrain: the gate's before and after on attack orders held out from it
const isStep = r => r.parent != null && r.parent_test && r.test.player_catch != null && r.parent_test.player_catch != null;
// the gate's real-fraud floor: RECALL_FLOOR_DROP below v1's recall (retrain.py, _recall_floor)
function recallFloor(rows, r) {
  const v1 = rows.find(x => x.version === 1);
  return v1 ? v1.test.recall * (1 - RECALL_FLOOR_DROP) : (r.parent_test || r.test).recall - .02;
}

/* ---------------- the panel ---------------- */

function panel(rows, office) {
  const cur = rows.find(r => r.current);
  const close = office ? `<button class="gl-close" type="button" data-gl-close>✕ Back to the office</button>`
    : `<a class="gl-close" href="./">▶ Play Forged</a>`;
  return `
    <header class="gl-top">
      <div><h2 class="gl-title" id="gl-title">Gus is learning</h2>
        <p class="gl-sub">The real fraud model behind Forged, a LightGBM trained on real card transactions, version by version.</p></div>
      ${close}
    </header>
    ${headline(rows, cur)}
    ${retrains(rows)}
    <section class="gl-sec">
      <h3 class="gl-h">What the gate protects, version by version</h3>
      <p class="gl-note">Real card transactions no version trained on, the same test for every version.</p>
      <div class="gl-legend">
        ${GUARDS.map(g => `<span><i class="gl-key gl-key-${g.shape}"></i>${g.name}</span>`).join("")}
        ${rows.some(r => !r.promoted) ? `<span><i class="gl-key gl-key-cut"></i>Rejected by the gate</span>` : ""}
      </div>
      <div class="gl-plot"></div>
    </section>
    ${precision(cur)}
    <section class="gl-sec">
      <h3 class="gl-h">Every version</h3>
      <ol class="gl-versions">${rows.slice().reverse().map(r => card(rows, r)).join("")}</ol>
    </section>
    <footer class="gl-fine">
      <p><b>How it's measured.</b> Real fraud caught and honest customers blocked: real IEEE-CIS card transactions from the dataset's last days, at the real-shop threshold, which is set to block about 3% of honest customers. Attack orders caught: each retrain holds out some of its attack orders and tests the old and the new version on them (the gate's own before-and-after), so compare within a retrain, not across them.</p>
      <p><b>Where the attack orders came from.</b> v2's from a red-team search (<code>ml/online/robustness.py</code>) that plays the game's own checkout, hunting for orders Gus misses; v3's and v4's from simulated careful players (<code>ml/online/simulate.js</code>). Players' orders that get past Gus go through the same retrain and the same gate.</p>
      <p><b>What you play.</b> On the hosted link the game server runs the current version, and it judges every order. It doesn't retrain there: retraining needs the Kaggle training data. Without the game server (<code>serve.py</code> on its own), Gus is the game's scripted rules in your browser, and the Inspector version on your screen counts his patches. These are the versions shipped so far: <code>gus-versions.json</code>, a copy of <code>ml/online/models/versions.json</code>.</p>
    </footer>`;
}

// the current version: what it catches, and the two numbers the gate guards, against v1
function headline(rows, cur) {
  if (!cur) return "";
  const v1 = rows[0], ok = cur.checks || {}, first = cur === v1;
  const own = cur.test.player_catch, was = cur.parent_test && cur.parent_test.player_catch;
  const hero = own == null
    ? `<div class="gl-hero"><div class="gl-hero-k">v${cur.version}, the current version</div><div class="gl-hero-n">No retrain yet</div>
        <p>Gus hasn't learned from any attack orders so far.</p></div>`
    : `<div class="gl-hero"><div class="gl-hero-k">v${cur.version}, the current version</div><div class="gl-hero-n">${pct(own, 0)}</div>
        <p><b>of attack orders it never saw get caught.</b> They're held out from its retrain on ${num(cur.attacks)} attack orders from ${esc(source(cur))}.${was != null ? ` v${cur.parent} caught ${pct(was)} of the same orders.` : ""}</p></div>`;
  const tile = (label, now, base, pass, rule) => `<div class="gl-tile">
      <div class="gl-tile-l">${label}</div><div class="gl-tile-v">${pct(now)}</div>
      ${first ? "" : `<div class="gl-tile-d">v1: ${pct(base)}</div>
      <div class="gl-tile-g ${pass ? "ok" : "no"}">${pass ? "✓" : "✗"} gate: ${rule}</div>`}</div>`;
  return `<div class="gl-kpis">${hero}
      ${tile("Real fraud caught", cur.test.recall, v1.test.recall, ok.real_recall, `at least ${pct(recallFloor(rows, cur))}`)}
      ${tile("Honest customers blocked", cur.test.fpr, v1.test.fpr, ok.real_fpr, `at most ${pct(FPR_LIMIT, 0)}`)}
    </div>
    <p class="gl-gate">A new version only goes live if it catches more attack orders than the current one <i>and</i> stays as good for real customers. Otherwise the gate rejects it and Gus keeps his old brain.</p>`;
}

// the learning curve, honestly: one row per retrain, the version before and the retrained one on the same held-out orders
function retrains(rows) {
  const steps = rows.filter(isStep);
  if (!steps.length) return "";
  const row = r => {
    const a = r.parent_test.player_catch, b = r.test.player_catch, d = (b - a) * 100;
    return `<div class="gl-step${r.promoted ? "" : " is-cut"}">
      <div class="gl-step-k"><b>v${r.parent} → v${r.version}</b><span class="gl-pill gl-pill-${r.status}">${STATUS[r.status][0]}</span></div>
      <div class="gl-track" role="img" aria-label="v${r.parent} caught ${pct(a)} of these attack orders, v${r.version} ${pct(b)}">
        <i class="gl-bar${b >= a ? " up" : ""}" style="left:${Math.min(a, b) * 100}%;width:${Math.abs(b - a) * 100}%"></i>
        <i class="gl-dot was" style="left:${a * 100}%"></i><i class="gl-dot now" style="--from:${a * 100}%;left:${b * 100}%"></i>
      </div>
      <div class="gl-step-v">${pct(a)} → <b>${pct(b)}</b> <span class="${d >= 0 ? "ok" : "no"}">${d >= 0 ? "▲" : "▼"}${Math.abs(d).toFixed(1)} pts</span></div>
      <div class="gl-step-f">trained on ${num(r.attacks)} attack orders from ${esc(source(r))}</div>
    </div>`;
  };
  return `<section class="gl-sec">
    <h3 class="gl-h">What Gus learned, one retrain at a time</h3>
    <p class="gl-note">Attack orders caught by <i class="gl-dot was"></i> the version before and <i class="gl-dot now"></i> the retrained one, on attack orders held out from that retrain. Each retrain holds out its own, so compare within a row.</p>
    <div class="gl-steps">${steps.map(row).join("")}
      <div class="gl-step gl-axis" aria-hidden="true"><span></span><div>${[0, 25, 50, 75, 100].map(t => `<span style="left:${t}%">${t}%</span>`).join("")}</div><span></span></div>
    </div>
  </section>`;
}

// precision at a realistic base rate, in plain words
function precision(cur) {
  if (!cur) return "";
  const N = 100000, fraud = N * BASE_RATE, caught = fraud * cur.test.recall, blocked = (N - fraud) * cur.test.fpr;
  const p = caught / (caught + blocked), cells = Math.min(100, Math.max(1, Math.round(p * 100)));
  return `<aside class="gl-sec gl-honest">
    <h3 class="gl-h">Honest about precision</h3>
    <div class="gl-honest-body">
      <div>
        <p>Real shops see about <b>1 fraud in every 1,000 orders</b>. Out of 100,000 orders, that's ${num(fraud)} frauds: v${cur.version} stops ${num(caught)} of them, and also blocks about ${num(Math.round(blocked / 10) * 10)} honest customers.</p>
        <p class="gl-honest-big">Only ${pct(p)} of the orders Gus blocks are fraud: about 1 in ${num(1 / p)}.</p>
        <p>On his own he'd turn away far more honest customers than crooks. A real shop would use his score to pick orders for a person to review, not to decline them outright.</p>
      </div>
      <figure class="gl-waffle-fig">
        <div class="gl-waffle" role="img" aria-label="Of every 100 orders Gus blocks, about ${cells} are fraud and ${100 - cells} are honest customers">${"<i class='fraud'></i>".repeat(cells)}${"<i></i>".repeat(100 - cells)}</div>
        <figcaption><span><i class="gl-sq fraud"></i>${cells} fraud</span><span><i class="gl-sq"></i>${100 - cells} honest customers</span><span>in every 100 orders he blocks</span></figcaption>
      </figure>
    </div>
  </aside>`;
}

// a retrain's own note, when someone wrote one (retrain.py writes "retrained on N player orders (…)" by itself)
const noteOf = r => r.note && !/^retrained on \d+ player orders|^v1: /.test(r.note) ? r.note : "";

function card(rows, r) {
  const t = r.trained_on || {}, sims = (t.honest || 0) + (t.sim || 0);
  const trained = r.attacks
    ? `Trained on ${num(t.real || 0)} real card transactions, ${num(sims)} simulated shoppers (honest and crooked) and <b>${num(r.attacks)} attack orders</b> from ${esc(source(r))}${r.evasions ? ` (${num(r.evasions)} of them had got past v${r.parent})` : ""}.`
    : `Trained on ${num(t.real || 0)} real card transactions and ${num(sims)} simulated shoppers (honest and crooked), before any attack orders.`;
  // v1 has no attack orders of its own to be tested on: its number is from its first retrain's held-out orders
  const child = r.test.player_catch == null && rows.find(c => c.parent === r.version && isStep(c));
  const caught = r.test.player_catch ?? (child ? child.parent_test.player_catch : null);
  const n = (label, v, sub = "") => `<div><dt>${label}</dt><dd>${v == null ? "—" : pct(v)}</dd>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const learned = (r.learned || []).map(k => `<span class="gl-chip" title="${esc(k)}">${esc(TELLS[k] || k.replace(/_/g, " "))}</span>`).join("");
  const note = noteOf(r);
  return `<li class="gl-ver${r.current ? " is-current" : ""}${r.promoted ? "" : " is-cut"}">
    <div class="gl-ver-head"><b class="gl-vnum">v${r.version}</b>
      ${r.current ? `<span class="gl-pill gl-pill-current">current</span>` : ""}
      <span class="gl-pill gl-pill-${r.status}">${STATUS[r.status][0]}</span></div>
    <p class="gl-trained">${trained}</p>
    ${note ? `<p class="gl-said">${esc(note)}</p>` : ""}
    ${r.forced && r.forced_why ? `<p class="gl-said"><b>Why by hand:</b> ${esc(r.forced_why)}</p>` : ""}
    <dl class="gl-nums">
      ${n("Attack orders caught", caught, isStep(r) ? `v${r.parent}: ${pct(r.parent_test.player_catch)} on the same orders` : child ? `on v${child.version}'s held-out attack orders` : "")}
      ${n("Real fraud caught", r.test.recall)}${n("Honest customers blocked", r.test.fpr)}
    </dl>
    ${checks(rows, r)}
    ${learned ? `<p class="gl-learned">${r.promoted ? "Learned" : "Would have learned"} to watch for ${learned}</p>` : ""}
  </li>`;
}

function checks(rows, r) {
  if (!r.checks || !r.parent_test) return "";
  const was = r.parent_test, now = r.test, p = `v${r.parent}`;
  const said = {
    real_recall: `real fraud caught at least ${pct(recallFloor(rows, r))} (${pct(now.recall)})`,
    real_fpr: `honest customers blocked at most ${pct(FPR_LIMIT, 0)} (${pct(now.fpr)})`,
    game_fpr: `honest shoppers in the game blocked at most ${pct(GAME_FPR_LIMIT, 0)} (${pct(now.game_fpr)}, ${p}: ${pct(was.game_fpr)})`,
    player_catch: `more attack orders caught than ${p} (${now.player_catch == null ? "—" : pct(now.player_catch)} vs ${was.player_catch == null ? "—" : pct(was.player_catch)})`,
  };
  return `<ul class="gl-checks">${Object.entries(r.checks).map(([k, ok]) =>
    `<li class="${ok ? "ok" : "no"}">${ok ? "✓" : "✗"} ${esc(said[k] || k.replace(/_/g, " "))}</li>`).join("")}</ul>`;
}

/* ---------------- what the gate protects: a line per number, a column per version ---------------- */

// drawn at the plot's own width, so the text stays its real size; redrawn on resize
function drawChart(plot, rows, animate) {
  const W = Math.round(plot.clientWidth);
  if (!W || !rows.length) return;
  const H = 250, labels = W >= 560; // narrow screens drop the end labels: the legend and the cards carry them
  const P = { t: 14, r: labels ? 190 : 14, b: 66, l: 44 };
  const pw = W - P.l - P.r, ph = H - P.t - P.b, col = pw / rows.length;
  const X = i => P.l + col * (i + .5), Y = v => P.t + ph * (1 - v);
  const ci = Math.max(0, rows.findIndex(r => r.current)), cur = rows[ci];
  let s = `<svg class="gl-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="What the gate protects, one column per version"><g aria-hidden="true">`;
  for (const g of [0, .25, .5, .75, 1]) {
    s += `<line class="gl-grid" x1="${P.l}" x2="${P.l + pw}" y1="${Y(g)}" y2="${Y(g)}"/>`
      + `<text class="gl-tick" x="${P.l - 8}" y="${Y(g) + 4}" text-anchor="end">${g * 100}%</text>`;
  }
  rows.forEach((r, i) => {
    s += `<text class="gl-xv" x="${X(i)}" y="${H - P.b + 22}" text-anchor="middle">v${r.version}</text>`
      + `<text class="gl-xs" x="${X(i)}" y="${H - P.b + 38}" text-anchor="middle">${num(r.attacks)}${col >= 140 ? " attack orders" : col >= 72 ? " orders" : ""}</text>`
      + `<text class="gl-xs gl-xst" x="${X(i)}" y="${H - P.b + 54}" text-anchor="middle">${r.current ? "current" : STATUS[r.status][1]}</text>`;
  });
  s += `<line class="gl-cross" x1="0" x2="0" y1="${P.t}" y2="${P.t + ph}" visibility="hidden"/>`;
  const mark = (g, x, y, cut) => {
    const paint = cut ? `fill="#fff" stroke="var(--gl-guard)"` : `fill="var(--gl-guard)" stroke="#fff"`;
    return g.shape === "square" ? `<rect class="gl-mark" x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" rx="1.5" ${paint}/>`
      : `<circle class="gl-mark" cx="${x}" cy="${y}" r="5" ${paint}/>`;
  };
  GUARDS.forEach((g, k) => {
    const pts = rows.map((r, i) => ({ r, i, v: g.of(r) })).filter(p => p.v != null);
    const live = pts.filter(p => p.r.promoted);
    if (live.length > 1) {
      s += `<path class="gl-line${animate ? " gl-draw" : ""}" style="animation-delay:${k * 140}ms" pathLength="1" stroke="var(--gl-guard)" `
        + `d="${live.map((p, j) => `${j ? "L" : "M"}${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join("")}"/>`;
    }
    for (const p of pts.filter(p => !p.r.promoted)) { // a rejected version branches off its parent, dashed
      const from = pts.find(q => q.r.version === p.r.parent);
      if (from) s += `<line class="gl-cutline" x1="${X(from.i)}" y1="${Y(from.v)}" x2="${X(p.i)}" y2="${Y(p.v)}" stroke="var(--gl-guard)"/>`;
    }
    for (const p of pts) s += mark(g, X(p.i), Y(p.v), !p.r.promoted);
  });
  if (labels && cur) { // the current version's values, in a column on the right
    const ends = GUARDS.map(g => ({ g, v: g.of(cur) })).filter(e => e.v != null).map(e => ({ ...e, y: Y(e.v) })).sort((a, b) => a.y - b.y);
    ends.forEach((e, i) => { e.ly = i ? Math.max(e.y, ends[i - 1].ly + 18) : e.y; });
    const lx = P.l + pw + 14;
    for (const e of ends) {
      s += `<line class="gl-lead" x1="${X(ci) + 9}" y1="${e.y}" x2="${lx - 5}" y2="${e.ly}"/>`
        + `<text class="gl-end" x="${lx}" y="${e.ly + 4}"><tspan class="gl-end-v">${pct(e.v)}</tspan> ${e.g.short}</text>`;
    }
  }
  s += `</g>`;
  rows.forEach((r, i) => {
    s += `<rect class="gl-hit" x="${X(i) - col / 2}" y="${P.t}" width="${col}" height="${ph}" tabindex="0" role="img" data-i="${i}" aria-label="${esc(say(r))}"/>`;
  });
  plot.innerHTML = s + `</svg><div class="gl-tip" hidden></div>`;

  // hover or focus a version: a hairline on it and its numbers
  const tip = plot.querySelector(".gl-tip"), cross = plot.querySelector(".gl-cross");
  const show = i => {
    const r = rows[i];
    tip.innerHTML = `<div class="gl-tip-h"><b>v${r.version}</b> · ${r.current ? "current" : STATUS[r.status][1]}</div>`
      + GUARDS.map(g => `<div class="gl-tip-r"><i class="gl-key gl-key-${g.shape}"></i><b>${pct(g.of(r))}</b> ${g.name.toLowerCase()}</div>`).join("")
      + `<div class="gl-tip-f">trained on ${num(r.attacks)} attack orders</div>`;
    tip.hidden = false;
    const x = X(i), w = tip.offsetWidth;
    tip.style.left = (x + 14 + w <= W ? x + 14 : Math.max(0, x - 14 - w)) + "px";
    tip.style.top = P.t + "px";
    cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible");
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
  plot.querySelectorAll(".gl-hit").forEach(h => {
    const i = +h.dataset.i;
    h.addEventListener("pointerenter", () => show(i)); h.addEventListener("focus", () => show(i));
    h.addEventListener("pointerleave", hide); h.addEventListener("blur", hide);
  });
}
const say = r => `v${r.version}, ${r.current ? "current" : STATUS[r.status][1]}: `
  + GUARDS.map(g => `${g.name.toLowerCase()} ${pct(g.of(r))}`).join(", ") + `; trained on ${num(r.attacks)} attack orders`;

/* ---------------- loading and drawing ---------------- */

let pending = null;
function load() {
  if (!pending) {
    pending = fetch(SRC, { cache: "no-store" }).then(r => { if (!r.ok) throw new Error(`${SRC}: HTTP ${r.status}`); return r.json(); });
    pending.catch(() => { pending = null; }); // try again next time
  }
  return pending;
}

const drawn = new Map(); // element → its rows, for redrawing the chart at a new width
function render(el, list, office, animate = true) {
  const rows = rowsOf(list);
  el.innerHTML = panel(rows, office);
  el.classList.toggle("gl-still", !animate);
  drawn.set(el, rows);
  drawChart(el.querySelector(".gl-plot"), rows, animate && !still());
}
async function show(el, office) {
  if (!drawn.has(el)) el.innerHTML = `<p class="gl-wait">Loading Gus's versions…</p>`;
  try { render(el, await load(), office); }
  catch (e) {
    console.warn("[forged] couldn't load Gus's versions", e);
    el.innerHTML = `<header class="gl-top"><h2 class="gl-title" id="gl-title">Gus is learning</h2>${office ? `<button class="gl-close" type="button" data-gl-close>✕ Back to the office</button>` : ""}</header>
      <p class="gl-wait">Couldn't load <code>${SRC}</code>. Serve this folder with <code>python3 serve.py</code> and try again.</p>`;
  }
}
let resizing = 0;
addEventListener("resize", () => {
  clearTimeout(resizing);
  resizing = setTimeout(() => drawn.forEach((rows, el) => {
    const plot = el.isConnected && el.querySelector(".gl-plot");
    if (plot && plot.clientWidth) drawChart(plot, rows, false);
  }), 150);
});

window.ForgedLearning = { render, show };

/* ---------------- on its own page (learning.html) ---------------- */

const page = document.getElementById("gl-page");
if (page) { show(page, false); return; }

/* ---------------- in the office: over the 3D view ---------------- */

const FW = window.FW;
if (!FW) return;
const root = document.createElement("div");
root.id = "gl";
root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-labelledby", "gl-title");
root.innerHTML = `<div class="gl gl-card"></div>`;
document.body.appendChild(root);
const body = root.firstElementChild;

let froze = false; // did opening the panel pause the office?
const isOpen = () => root.classList.contains("show");
function open() {
  if (isOpen()) return;
  const P = FW.P;
  froze = P.started && !P.paused; // like the Game Menu: a solo office freezes, a LAN one keeps going
  if (froze) { P.paused = true; P.keys.clear(); FW.toOS("paused", { on: true }); }
  root.classList.add("show");
  if (document.pointerLockElement) document.exitPointerLock(); // paused, so world.js doesn't open the Game Menu
  show(body, true).then(() => { const b = body.querySelector("[data-gl-close]"); if (b && isOpen()) b.focus({ preventScroll: true }); });
}
function close() {
  if (!isOpen()) return;
  root.classList.remove("show");
  if (!froze) return;
  froze = false; FW.P.paused = false; FW.toOS("paused", { on: false });
  // after Esc the browser won't lock the mouse again: click the office to capture it
  try { const r = FW.renderer.domElement.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
}
root.addEventListener("click", e => { if (e.target === root || e.target.closest("[data-gl-close]")) close(); });
// while open, the panel owns the keyboard, the wheel and dragging (world.js would walk, zoom or turn)
addEventListener("keydown", e => {
  if (!isOpen()) return;
  e.stopImmediatePropagation();
  if (e.code === "Escape") { e.preventDefault(); close(); }
}, true);
addEventListener("keyup", e => { if (isOpen()) e.stopImmediatePropagation(); }, true);
for (const type of ["mousemove", "mousedown", "wheel"]) root.addEventListener(type, e => e.stopPropagation(), { passive: true });

// the DETECTOR LIVE TV on the east wall (world.js)
FW.addInteraction({ label: () => "See how the real Gus learns", can: () => FW.near({ x: FW.RW / 2 - 1.6, z: 0 }, 2), act: open });

// and from the Clock in card, before playing
const after = document.getElementById("btn-customize") || document.getElementById("btn-start");
if (after) {
  const b = document.createElement("button");
  b.id = "btn-learning"; b.type = "button"; b.textContent = "📈 How Gus learns";
  after.insertAdjacentElement("afterend", b);
  b.addEventListener("click", e => { e.stopPropagation(); open(); });
}

Object.assign(window.ForgedLearning, { open, close, isOpen });
})();
