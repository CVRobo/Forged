/* Forged — Game Menu (Esc), shared by the office (index.html) and the computer when it runs
 * on its own (os.html). Screens: Game Menu, Options, Controls (rebinding), How to Play,
 * Leaderboard / Hall of Shame, and the hold-Tab player list. Uses keys.js.
 *
 * The page that owns the screen calls ForgedMenu.init(host) once:
 *   host.office      true in the 3D office, false when os.html runs on its own
 *   host.onPause(on) freeze / unfreeze the game
 *   host.onResume()  after "Back to Game" (re-lock the mouse, refocus the computer…)
 *   host.onQuit()    "Quit to Title"
 *   host.canTour()   can the desk tutorial run right now?   host.onTour()  start it
 *   host.getStats()  { money, patches, shame: [{version, trick, learned}], round } or null
 * Inside the office the computer never shows this menu itself: it posts { type: "menu" }.
 */
(() => {
"use strict";
const K = window.ForgedKeys;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = t => String(t ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = n => "$" + Math.round(n).toLocaleString("en-US");
const kbd = action => `<kbd>${esc(K.label(action))}</kbd>`;

const PLAYER_KEY = "forged-player";
const TIP_KEYS = ["forged-tutorial-done", "forged-schemes-used"];
const API = (() => { try { return (new URLSearchParams(location.search).get("api") || window.FORGED_API || "").replace(/\/$/, ""); } catch (e) { return ""; } })();
function playerName() { try { return (localStorage.getItem(PLAYER_KEY) || "").trim() || "You"; } catch (e) { return "You"; } }

// offline only: sample rivals so the board is never empty (B pre-seeds the real one)
const SAMPLE_PLAYERS = [
  { name: "Shredder Sally", money: 18400, patches: 9 }, { name: "Two-Copy Tony", money: 11250, patches: 7 },
  { name: "Notary Nadia", money: 6900, patches: 4 }, { name: "Stamp Champ", money: 3150, patches: 2 },
];
const SAMPLE_SHAME = [
  { player: "Two-Copy Tony", version: 7, trick: "Duplicate with tweaks", learned: "copy-of-a-copy scan quality", n: 340 },
  { player: "Shredder Sally", version: 4, trick: "Phantom supplier", learned: "vendor isn't in the company's records", n: 212 },
  { player: "Notary Nadia", version: 3, trick: "Boss request", learned: "amount is way above this vendor's usual", n: 96 },
];

let host = null, root = null, stack = [], paused = false, capture = null, boardTab = "leaders";

/* ---------- screens ---------- */
const SCREENS = {
  pause: () => `
    <h2 class="fm-title">Game Menu</h2>
    <div class="fm-grid">
      <button class="fm-btn wide primary" data-fm-act="back">Back to Game</button>
      <button class="fm-btn" data-fm-go="howto">How to Play</button>
      <button class="fm-btn" data-fm-go="board">Leaderboard</button>
      <button class="fm-btn" data-fm-act="tour" ${host.canTour && host.canTour() ? "" : `disabled title="Start a round at your computer first"`}>Tutorial</button>
      <button class="fm-btn" data-fm-go="options">Options…</button>
      <button class="fm-btn wide danger" data-fm-act="quit">Quit to Title</button>
    </div>
    <p class="fm-foot">Paused · ${host.office ? "the office is frozen" : "the desk is frozen"}</p>`,
  options: () => `
    <h2 class="fm-title">Options</h2>
    <div class="fm-grid">
      <button class="fm-btn wide" data-fm-go="controls">Controls…</button>
      <button class="fm-btn wide" data-fm-act="reset-tips">Reset Tutorial &amp; Tips</button>
      <button class="fm-btn wide primary" data-fm-act="done">Done</button>
    </div>
    <p class="fm-foot">Reset shows the tour and the scheme tips again, as on your first game.</p>`,
  controls: () => {
    const groups = [["office", "In the office"], ["computer", "At the computer"]];
    const row = a => {
      const clash = K.clashes(a.id).length > 0;
      const cell = slot => {
        const code = K.get(a.id)[slot], waiting = capture && capture.id === a.id && capture.slot === slot;
        return `<button class="fm-key ${clash && code ? "clash" : ""} ${waiting ? "waiting" : ""}" data-fm-bind="${a.id}" data-fm-slot="${slot}">${waiting ? "&gt; press a key &lt;" : code ? esc(K.keyName(code)) : "<span class='fm-none'>—</span>"}</button>`;
      };
      return `<div class="fm-row"><span>${esc(a.name)}</span>${cell(0)}${cell(1)}</div>`;
    };
    const fixed = g => K.FIXED.filter(f => f.group === g || f.group === "both")
      .map(f => `<div class="fm-row fixed"><span>${esc(f.name)}</span><span class="fm-key locked">${esc(f.label)}</span><span></span></div>`).join("");
    return `
      <h2 class="fm-title">Controls</h2>
      <div class="fm-keys">
        ${groups.map(([g, title]) => `<div class="fm-group"><div class="fm-sub">${title}<span>Key</span><span>Alt</span></div>
          ${K.ACTIONS.filter(a => a.group === g).map(row).join("")}${fixed(g)}</div>`).join("")}
      </div>
      <p class="fm-foot">Click a key, then press the new one (or a mouse button). Backspace clears it, Esc cancels. Red means two actions share a key.${K.MAC ? " On a Mac, F-keys may need Fn." : ""}</p>
      <div class="fm-grid two">
        <button class="fm-btn" data-fm-act="reset-keys">Reset Keys</button>
        <button class="fm-btn primary" data-fm-act="done">Done</button>
      </div>`;
  },
  howto: () => {
    const office = host.office;
    const steps = office ? [
      `<b>Sit down.</b> Walk to your desk (${K.labels("forward")}/${K.label("left")}/${K.label("back")}/${K.label("right")}, ${kbd("sprint")} to sprint) and press ${kbd("interact")} at your computer.`,
      `<b>Pick a scheme.</b> Each card shows its risk and payout. Hover a new one for tips. Repeating a scheme raises heat.`,
      `<b>Read the memo and case file.</b> One memo rule is fake: click rules to mark them real or fake.`,
      `<b>Forge.</b> Pick a tool (${kbd("tool1")}–${kbd("tool6")} or the mouse wheel), click the invoice. 2 edits minimum, 4 max. Tape your own account into the bank box or you won't get paid. ${kbd("drop")} puts a tool down.`,
      `<b>Pitch.</b> ${kbd("chat")} to write to the clerk. Play to their quirk.`,
      `<b>Print.</b> Drag the envelope onto PRINT. You stand up automatically (or press ${kbd("standUp")}).`,
      `<b>Deliver.</b> Grab it at the printer and drop it in the inspector's IN tray (${kbd("interact")}). Keep it out of the boss's sight.`,
      `<b>Verdict.</b> PAID or FLAGGED, and the inspector learns either way. Sit back down for patch notes and the shop.`,
    ] : [
      `<b>Pick a scheme.</b> Each card shows its risk and payout. Hover a new one for tips. Repeating a scheme raises heat.`,
      `<b>Read the memo and case file.</b> One memo rule is fake: click rules to mark them real or fake.`,
      `<b>Forge.</b> Pick a tool (${kbd("tool1")}–${kbd("tool6")} or the mouse wheel), click the invoice. 2 edits minimum, 4 max. Tape your own account into the bank box or you won't get paid. ${kbd("drop")} puts a tool down.`,
      `<b>Pitch.</b> ${kbd("chat")} to write to the clerk. Play to their quirk.`,
      `<b>Submit.</b> Drag the envelope into the outbox.`,
      `<b>Verdict.</b> PAID or FLAGGED, and the inspector learns either way. Spend your money in the shop between rounds.`,
    ];
    return `
      <h2 class="fm-title">How to Play</h2>
      <ol class="fm-steps">${steps.map(s => `<li>${s}</li>`).join("")}</ol>
      <p class="fm-note"><b>The boss</b> walks by now and then. If he comes up behind you while you forge, press ${kbd("hide")} fast to hide the invoice. ${kbd("detector")} shows what the inspector's model reads. Esc opens this menu.</p>
      <div class="fm-grid two">
        <button class="fm-btn" data-fm-act="reset-tips">Reset Tutorial &amp; Tips</button>
        <button class="fm-btn primary" data-fm-act="done">Done</button>
      </div>`;
  },
  board: () => `
    <div class="fm-board-head">
      <div class="fm-tabs">
        <button class="fm-tab ${boardTab === "leaders" ? "on" : ""}" data-fm-tab="leaders">🏆 Leaderboard</button>
        <button class="fm-tab ${boardTab === "shame" ? "on" : ""}" data-fm-tab="shame">🧾 Hall of Shame</button>
      </div>
      <label class="fm-name">Your name <input id="fm-player" maxlength="16" spellcheck="false" autocomplete="off" placeholder="You"></label>
    </div>
    <div class="fm-source" id="fm-source"></div>
    <div class="fm-pane" id="fm-pane"></div>
    <div class="fm-grid one"><button class="fm-btn primary" data-fm-act="done">Done</button></div>`,
};

/* ---------- leaderboard data ---------- */
let boardData = null; // { players, shame, live }
function localBoard() {
  const s = host.getStats && host.getStats();
  const me = playerName();
  const players = s && s.round ? [...SAMPLE_PLAYERS, { name: me, money: s.money || 0, patches: s.patches || 0 }] : [...SAMPLE_PLAYERS];
  const mine = (s && s.shame || []).slice().reverse().map(x => ({ ...x, player: me, mine: true }));
  return { players, shame: [...mine, ...SAMPLE_SHAME], live: false };
}
async function loadBoard() {
  boardData = localBoard(); paintBoard(); paintPlayerList();
  if (!API) return;
  try {
    const r = await (await fetch(API + "/leaderboard")).json();
    const list = Array.isArray(r) ? r : r.players ?? r.leaderboard ?? [];
    const players = list.map(p => ({ name: p.player ?? p.name ?? "?", money: +(p.money ?? 0), patches: +(p.patches_caused ?? p.patches ?? 0) }));
    const shame = (r.hall_of_shame ?? []).map(x => ({ player: x.player ?? "?", version: x.version ?? "?", trick: x.trick ?? x.scheme ?? "a trick", learned: x.learned ?? "", n: x.n ?? x.invoices_trained_on ?? null }));
    boardData = { players, shame: shame.length ? shame : localBoard().shame.filter(x => x.mine), live: true };
    paintBoard(); paintPlayerList();
  } catch (e) { console.warn("[forged] leaderboard unavailable, showing offline data", e); }
}
function paintBoard() {
  const pane = $("#fm-pane", root); if (!pane || !boardData) return;
  const me = playerName();
  $("#fm-source", root).textContent = boardData.live ? "● Live from the server" : "Offline: sample players, plus your current run";
  if (boardTab === "leaders") {
    const rows = [...boardData.players].sort((a, b) => b.money - a.money);
    pane.innerHTML = rows.length ? `<table class="fm-table"><tr><th>#</th><th>Forger</th><th class="num">Siphoned</th><th class="num">Patches caused</th></tr>
      ${rows.map((p, i) => `<tr class="${p.name === me ? "me" : ""}"><td class="rank">${i + 1}</td><td>${esc(p.name)}</td><td class="num">${money(p.money)}</td><td class="num">${p.patches}</td></tr>`).join("")}</table>`
      : `<div class="fm-empty">No forgers yet. Be the first.</div>`;
  } else {
    pane.innerHTML = boardData.shame.length ? boardData.shame.map(x => `
      <div class="fm-shame ${x.mine ? "me" : ""}"><div class="ver">v${esc(x.version)}</div>
        <div><b>${esc(x.player)}</b>'s ${esc(x.trick)} taught the inspector to catch: ${esc(x.learned)}${x.round ? `<small>Your run, round ${x.round}</small>` : ""}</div>
        <div class="n">${x.n != null ? esc(x.n) + " invoices<br>retrained on" : x.amount != null ? money(x.amount) : ""}</div></div>`).join("")
      : `<div class="fm-empty">Nobody has forced a patch yet.</div>`;
  }
}

/* hold-Tab list, like Minecraft's player list */
function paintPlayerList() {
  const el = $("#fm-plist"); if (!el || !boardData) return;
  const me = playerName();
  const rows = [...boardData.players].sort((a, b) => b.money - a.money).slice(0, 8);
  el.innerHTML = `<div class="fm-plist-head">Forgers${boardData.live ? "" : " · offline"}</div>` +
    rows.map((p, i) => `<div class="fm-plist-row ${p.name === me ? "me" : ""}"><span>${i + 1}. ${esc(p.name)}</span><span>${money(p.money)} · ${p.patches} ⚙</span></div>`).join("");
}

/* ---------- rendering & navigation ---------- */
function render() {
  const id = stack[stack.length - 1];
  const card = $(".fm-card", root);
  card.className = "fm-card fm-card-" + id;
  card.innerHTML = SCREENS[id]();
  if (id === "board") {
    const input = $("#fm-player", root);
    input.value = playerName() === "You" ? "" : playerName();
    input.onchange = () => { try { localStorage.setItem(PLAYER_KEY, input.value.trim()); } catch (e) {} loadBoard(); };
    if (boardData) paintBoard(); loadBoard();
  }
  const first = $("button:not(:disabled)", card); first && first.focus({ preventScroll: true });
}
function go(id) { stack.push(id); render(); }
function back() {
  capture = null;
  stack.pop();
  if (!stack.length) return close();
  render();
}
function open(screen = "pause") {
  if (!host) return;
  if (!isOpen()) {
    stack = screen === "pause" ? ["pause"] : [screen];
    root.classList.add("show");
    // pause whenever the menu is up; How to Play / Leaderboard from the title screen pause nothing harmful
    if (!paused) { paused = true; host.onPause && host.onPause(true); }
    try { window.focus(); } catch (e) {}
    render();
  } else go(screen);
}
function close() {
  capture = null; stack = [];
  root.classList.remove("show");
  if (paused) { paused = false; host.onPause && host.onPause(false); }
  host.onResume && host.onResume();
}
function isOpen() { return !!root && root.classList.contains("show"); }

function toast(text) {
  const t = $(".fm-toast", root); t.textContent = text;
  t.classList.remove("show"); void t.offsetWidth; t.classList.add("show");
}

function act(name) {
  if (name === "back") return close();
  if (name === "done") return back();
  if (name === "quit") { stack = []; root.classList.remove("show"); paused = false; host.onPause && host.onPause(false); host.onQuit && host.onQuit(); return; }
  if (name === "tour") { if (!host.canTour || !host.canTour()) return; close(); host.onTour && host.onTour(); return; }
  if (name === "reset-tips") { TIP_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); toast("Tutorial and scheme tips will show again"); return; }
  if (name === "reset-keys") { K.reset(); render(); toast("Keys reset to defaults"); }
}

/* ---------- rebinding ---------- */
function finishCapture(code) {
  const { id, slot } = capture; capture = null;
  if (code !== undefined) K.set(id, slot, code);
  render();
  const btn = $(`[data-fm-bind="${id}"][data-fm-slot="${slot}"]`, root); btn && btn.focus({ preventScroll: true });
}

function build() {
  root = document.createElement("div");
  root.id = "fmenu";
  root.innerHTML = `<div class="fm-card"></div><div class="fm-toast"></div>`;
  document.body.appendChild(root);
  const pl = document.createElement("div"); pl.id = "fm-plist"; document.body.appendChild(pl);

  root.addEventListener("click", e => {
    if (capture) return;
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    if (b.dataset.fmGo) go(b.dataset.fmGo);
    else if (b.dataset.fmAct) act(b.dataset.fmAct);
    else if (b.dataset.fmTab) { boardTab = b.dataset.fmTab; $$(".fm-tab", root).forEach(t => t.classList.toggle("on", t === b)); paintBoard(); }
    else if (b.dataset.fmBind) { capture = { id: b.dataset.fmBind, slot: +b.dataset.fmSlot }; render(); }
  });
  // mouse buttons other than the left one can be bound (left click starts the rebinding)
  root.addEventListener("mousedown", e => { if (capture && e.button !== 0) { e.preventDefault(); finishCapture("Mouse" + e.button); } });
  root.addEventListener("contextmenu", e => e.preventDefault());

  // while open, the menu owns the keyboard
  addEventListener("keydown", e => {
    if (!isOpen()) return;
    const typing = document.activeElement && document.activeElement.tagName === "INPUT";
    if (capture) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.code === "Escape") finishCapture();
      else if (e.code === "Backspace" || e.code === "Delete") finishCapture(null);
      else finishCapture(e.code);
      return;
    }
    if (e.code === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (typing) document.activeElement.blur(); else back(); return; }
    if (typing) return;
    if (!["Tab", "Enter", "Space"].includes(e.code)) e.stopImmediatePropagation();
  }, true);
  addEventListener("keyup", e => { if (isOpen()) e.stopImmediatePropagation(); }, true);
}

window.ForgedMenu = {
  init(h) { host = h; if (!root) build(); },
  open, close, isOpen, toast,
  /** hold-Tab list in the office */
  showPlayerList(on) {
    const el = $("#fm-plist"); if (!el) return;
    if (on && !el.classList.contains("show")) { if (!boardData) boardData = localBoard(); paintPlayerList(); loadBoard(); }
    el.classList.toggle("show", on);
  },
};
K.onChange(() => { if (isOpen() && !capture) render(); });
})();
