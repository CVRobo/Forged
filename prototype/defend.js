/* Forged — Defender mode (the role swap): you work Sunny Diner's AP desk.
 * A shift is 8 invoices built by ml/defender.py, from POST /defend/shift or, with no
 * server, the bundled defend-shifts.json. PAY or FLAG each one, with 2 callbacks per
 * shift; after each call the truth and the inspector's verdict are revealed.
 * Spec: docs/superpowers/specs/2026-10-24-defender-mode-design.md
 * Builds on window.ForgedOS (the helpers game.js exposes). */
(() => {
"use strict";

const OS = window.ForgedOS;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cents = n => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const acct = a => "••••" + esc(String(a).slice(-4));
const day = iso => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const when = iso => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const pct = x => Math.round(x * 100) + "%";
const qty = q => Number.isInteger(q) ? q : q.toLocaleString("en-US");
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

const VENDOR_ICONS = { petes: "🌾", bubbles: "🫧", dread: "🌀", lettuce: "🥬", sparky: "⚡", mop: "🧹" };
const AP_ADDR = "ap@sunnydiner.example";

const D = {
  n: 0, base: 1 + Math.floor(Math.random() * 1e6), // shift n plays seed base + n - 1 on the server
  shift: null, at: 0, calls: 0, decisions: {}, heard: {}, paidOrder: [],
  tab: "vendors", headers: false, bundle: null, busy: false, ringing: false,
};
const item = () => D.shift.items[D.at];

/* ---------- loading a shift ---------- */

async function loadShift(n) {
  if (OS.hasApi) {
    try { return await OS.api("POST", "/defend/shift", { seed: D.base + n - 1 }, 45000); } // v1 may train on first use
    catch (e) { OS.offline(e); }
  }
  if (!D.bundle) {
    const r = await fetch("defend-shifts.json", { cache: "no-store" });
    if (!r.ok) throw new Error("defend-shifts.json → HTTP " + r.status);
    D.bundle = await r.json();
  }
  return D.bundle.shifts[(n - 1) % D.bundle.shifts.length];
}

async function startShift(n) {
  if (D.busy) return;
  D.busy = true;
  let shift;
  try { shift = await loadShift(n); }
  catch (e) {
    console.warn("[forged] no shift to play:", e);
    OS.toast("Couldn't load the inbox: serve the prototype over http (python serve.py)", "bad");
    return;
  } finally { D.busy = false; }
  Object.assign(D, { n, shift, at: 0, calls: shift.callbacks ?? 2, decisions: {}, heard: {}, paidOrder: [],
    tab: "vendors", headers: false, ringing: false });
  $("#stage").dataset.level = "1";
  OS.show("defend");
  renderTop(); openItem(0);
  const v = shift.inspector.version;
  $("#df-brief-kicker").textContent = `SHIFT ${n} · AP DESK`;
  $("#df-brief-text").textContent = `${shift.items.length} invoices came in for Sunny Diner Supply, and some of them are fakes. ` +
    `Inspector v${v} is judging the same pile, so you'll see how you compare.`;
  $("#df-brief-insp").textContent = `Inspector v${v}`;
  OS.overlay("defend-brief");
}

/* ---------- rendering ---------- */

function renderTop() {
  const s = D.shift, v = s.inspector.version;
  $("#df-shift").textContent = D.n;
  $("#df-reviewed").textContent = `${Object.keys(D.decisions).length}/${s.items.length}`;
  $("#df-calls").innerHTML = Array.from({ length: s.callbacks ?? 2 },
    (_, i) => `<span class="df-phone ${i < D.calls ? "" : "used"}">☎</span>`).join("");
  $("#df-insp-face").innerHTML = OS.faceSVG(OS.LOOKS.inspector, OS.stageIndex(v));
  $("#df-insp-name").textContent = `Inspector v${v}`;
}

function openItem(i) {
  D.at = i;
  renderInbox(); renderMail(); renderPaper(); renderCase(); renderDesk(); highlight();
}

function renderInbox() {
  $("#df-inbox-list").innerHTML = D.shift.items.map((it, i) => {
    const m = it.email, inv = it.invoice, call = D.decisions[it.id];
    const right = call && (call === "flag") === it.truth.fraud;
    const status = call
      ? `<span class="df-chip ${call}">${call === "pay" ? "PAID" : "FLAGGED"}</span><span class="df-mark ${right ? "ok" : "bad"}">${right ? "✓" : "✗"}</span>`
      : D.heard[it.id] ? `<span class="df-chip call">☎ called</span>` : "";
    return `<button class="df-msg ${i === D.at ? "active" : ""} ${call ? "done" : ""}" data-i="${i}">
      <div class="df-msg-top"><b>${esc(m ? m.from_name : inv.vendor_name)}</b><span>${cents(inv.amount)}</span></div>
      <div class="df-msg-sub">${esc(m ? m.subject : `Invoice ${inv.invoice_id} (by post)`)}</div>
      <div class="df-msg-foot"><span>#${esc(inv.invoice_id)}</span>${status}</div>
    </button>`;
  }).join("");
}

function renderMail() {
  const m = item().email, body = $("#df-mail-body");
  $("#df-mail-hint").textContent = `${D.at + 1} of ${D.shift.items.length}`;
  if (!m) { body.innerHTML = `<div class="df-post">📮 This invoice came by post, with no email.</div>`; return; }
  const addr = esc(m.from_addr);
  body.innerHTML = `
    <div class="df-subject">${esc(m.subject)}</div>
    ${m.first_time_sender ? `<div class="df-warn">⚠ You don't often get email from ${addr}.</div>` : ""}
    <div class="df-hdr"><span>From</span><b>${esc(m.from_name)}</b>&nbsp;&lt;${addr}&gt;</div>
    ${m.reply_to ? `<div class="df-hdr"><span>Reply-To</span>${esc(m.reply_to)}</div>` : ""}
    ${m.cc.length ? `<div class="df-hdr"><span>CC</span>${m.cc.map(esc).join(", ")}</div>` : ""}
    <div class="df-hdr"><span>To</span>${AP_ADDR}</div>
    <div class="df-hdr"><span>Date</span>${when(m.sent_at)}<span class="df-thread">${m.in_thread ? "↩ reply in an existing thread" : "✉ new thread"}</span></div>
    <button class="df-link" id="df-headers">${D.headers ? "Hide" : "Show"} headers</button>
    ${D.headers ? `<pre class="df-raw">Authentication-Results: mx.sunnydiner.example;
    spf=${esc(m.spf)}; dkim=${esc(m.dkim)}; dmarc=${esc(m.dmarc)}
X-Sender-Domain-Age: ${m.domain_age_days == null ? "unknown" : m.domain_age_days + " days"}</pre>` : ""}
    <div class="df-text">${esc(m.body).replace(/\n/g, "<br>")}</div>`;
  $("#df-headers").onclick = () => { OS.sfx("click"); D.headers = !D.headers; renderMail(); };
}

function renderPaper() {
  const it = item(), inv = it.invoice, P = $("#df-paper"), paper = inv.paper || {};
  const white = new Set(paper.whiteout || []), taped = new Set(paper.taped || []);
  const f = (field, html) => white.has(field) ? `<span class="whited">${html}</span>` : html;
  const known = it.case.vendors.some(v => v.vendor_id === inv.vendor_id);
  const mismatch = inv.letterhead === "generic" || (known && inv.letterhead !== "vendor");
  const icon = inv.letterhead === "generic" ? "📄" : (VENDOR_ICONS[inv.vendor_id] || "🏷️");
  const lines = inv.line_items.map((li, i) => {
    const last = i === inv.line_items.length - 1; // a fee taped on, or a whited-out quantity, sits on the last line
    let desc = esc(li.description);
    if (last && taped.has("items")) desc = `<span class="taped">${desc}</span>`;
    const edited = html => last && white.has("items") ? `<span class="whited">${html}</span>` : html;
    return `<tr><td>${desc}</td><td class="num">${edited(qty(li.quantity))}</td><td class="num">${cents(li.unit_price)}</td>` +
      `<td class="num">${edited(cents(li.quantity * li.unit_price))}</td></tr>`;
  }).join("");
  const bank = `Acct ${acct(inv.bank_account)}`;
  P.innerHTML = `
    <div class="noise"></div>
    <div class="region inv-head" data-region="header">
      <div class="inv-logo ${mismatch ? "mismatch" : ""}">${icon}</div>
      <div style="flex:1;min-width:0"><div class="inv-vendor df-vendor">${esc(inv.vendor_name)}</div><span class="inv-domain">billing@${esc(inv.sender_domain)}</span></div>
      <div class="inv-title">INVOICE</div>
    </div>
    <div class="region inv-meta" data-region="meta">
      <div><span class="lbl">Invoice #</span>${f("invoice_id", esc(inv.invoice_id))}</div>
      <div><span class="lbl">Date</span>${f("issue_date", day(inv.issue_date))}</div>
      <div><span class="lbl">Bill to</span>Sunny Diner Supply</div>
      <div><span class="lbl">PO number</span>${inv.order_number ? esc(inv.order_number) : "—"}</div>
    </div>
    <div class="region" data-region="items">
      <table class="inv-items"><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line</th></tr>${lines}</table>
      <div class="inv-total">TOTAL DUE <span class="df-amount">${f("amount", cents(inv.amount))}</span></div>
    </div>
    <div class="region inv-bank" data-region="bank"><div class="lbl">REMIT PAYMENT TO</div>${taped.has("bank") ? `<span class="taped">${bank}</span>` : bank}</div>
    <div class="region inv-foot" data-region="footer">
      <div class="terms">Due ${day(inv.due_date)}. Thank you for your business! Questions: billing@${esc(inv.sender_domain)}</div>
    </div>`;
  P.classList.remove("gen-1", "gen-2", "gen-3");
  if (paper.copies) P.classList.add("gen-" + Math.min(3, paper.copies));
  Object.entries(paper.stains || {}).forEach(([region, strength]) => {
    const r = $(`[data-region="${region}"]`, P);
    if (!r) return;
    r.style.filter = `blur(${strength * 2.2}px) sepia(${strength * .8})`;
    const s = document.createElement("div");
    s.className = "stain" + (strength > .5 ? " big" : "");
    s.style.left = r.offsetLeft + r.offsetWidth * .72 + "px"; s.style.top = r.offsetTop + r.offsetHeight / 2 + "px";
    P.appendChild(s);
  });
  inv.stamps.forEach((kind, i) => {
    const s = document.createElement("div");
    s.className = "stamp-mark " + kind; s.textContent = kind;
    s.style.left = 390 - i * 40 + "px"; s.style.top = 500 + i * 46 + "px"; s.style.setProperty("--r", (i % 2 ? 9 : -12) + "deg");
    P.appendChild(s);
  });
}

function renderCase() {
  const it = item(), c = it.case, inv = it.invoice;
  $$("#df-tabs .df-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === D.tab));
  const name = id => (c.vendors.find(v => v.vendor_id === id) || {}).name || id || "—";
  const limit = OS.money(D.shift.approval_limit);
  const views = {
    vendors: () => `<table class="case-table"><tr><th>Approved vendor</th><th>Bank on file</th><th>Phone on file</th><th>Usually</th></tr>
      ${c.vendors.map(v => `<tr class="${v.vendor_id === inv.vendor_id ? "df-hit" : ""}">
        <td>${VENDOR_ICONS[v.vendor_id] || ""} ${esc(v.name)}<br><small>${esc(v.domain)}</small></td>
        <td class="mono">${acct(v.bank_on_file)}</td><td>${esc(v.phone)}</td>
        <td class="mono">${OS.money(v.usual_amount)}<br><small>every ${v.cadence_days} days${v.uses_po ? " · uses POs" : ""}</small></td></tr>`).join("")}
      </table>
      ${inv.vendor_id ? "" : `<p class="df-note">⚠ <b>${esc(inv.vendor_name)}</b> isn't on the approved list. Marge (manager) approves up to ${limit}, Big Lou (owner) everything else.</p>`}`,
    orders: () => c.open_orders.length ? `<table class="case-table"><tr><th>PO</th><th>Vendor</th><th>Amount</th></tr>
      ${c.open_orders.map(o => `<tr class="${o.order_number === inv.order_number && o.vendor_id === inv.vendor_id ? "df-hit" : ""}">
        <td class="mono">${esc(o.order_number)}</td><td>${esc(name(o.vendor_id))}</td><td class="mono">${cents(o.amount)}</td></tr>`).join("")}
      </table>` : `<p class="df-note">No open purchase orders.</p>`,
    changes: () => c.bank_changes.length ? `<table class="case-table"><tr><th>When</th><th>Vendor</th><th>Account</th><th>How</th></tr>
      ${c.bank_changes.map(b => `<tr class="${b.vendor_id === inv.vendor_id ? "df-hit" : ""}">
        <td>${day(b.changed_at)}</td><td>${esc(name(b.vendor_id))}</td>
        <td class="mono">${acct(b.old_account)} → ${acct(b.new_account)}</td>
        <td>by ${esc(b.channel)}<br><small>${b.verified ? "✓ confirmed on the number on file" : "✗ no callback"}${b.offered_phone ? " · gave its own number" : ""}</small></td></tr>`).join("")}
      </table>` : `<p class="df-note">No bank-detail changes on file.</p>`,
    paid: () => {
      const mine = D.paidOrder.slice().reverse().map(i => ({ ...D.shift.items[i].invoice, mine: true }));
      const rows = mine.concat(D.shift.paid_before);
      return `<table class="case-table"><tr><th>Invoice</th><th>Vendor</th><th>Amount</th><th>Dated</th></tr>
        ${rows.map(p => `<tr class="${p.vendor_id && p.vendor_id === inv.vendor_id ? "df-hit" : ""}">
          <td class="mono">${esc(p.invoice_id)}${p.mine ? ` <span class="tag">today</span>` : ""}</td><td>${esc(p.vendor_name)}</td>
          <td class="mono">${cents(p.amount)}</td><td>${day(p.issue_date)}</td></tr>`).join("")}
      </table>`;
    },
  };
  $("#df-case-body").innerHTML = views[D.tab]();
}

function renderDesk() {
  const it = item(), call = D.decisions[it.id], el = $("#df-desk-body");
  const phone = D.heard[it.id]
    ? `<div class="df-call"><div class="df-call-who">☎ ${esc(it.callback.who)}</div><div class="bubble">“${esc(it.callback.says)}”</div></div>` : "";
  if (!call) {
    const canCall = D.calls > 0 && !D.heard[it.id] && !D.ringing;
    el.innerHTML = `
      <div class="df-ask">Pay <b>${cents(it.invoice.amount)}</b> to <b>${esc(it.invoice.vendor_name)}</b>, account <b>${acct(it.invoice.bank_account)}</b>?</div>
      <div class="df-actions">
        <button class="btn btn-big df-pay" id="df-pay">✓ PAY</button>
        <button class="btn btn-big df-flag" id="df-flag">⚑ FLAG</button>
      </div>
      <button class="btn btn-ghost df-callbtn" id="df-call" ${canCall ? "" : "disabled"}>☎ Call ${it.invoice.vendor_id ? "the number on file" : "the owner"}
        <span class="tag">${D.calls} left</span></button>
      <div id="df-ring">${phone}</div>`;
    $("#df-pay").onclick = () => decide("pay");
    $("#df-flag").onclick = () => decide("flag");
    $("#df-call").onclick = callBack;
    return;
  }
  const t = it.truth, v = it.verdict, thr = D.shift.inspector.threshold;
  const right = (call === "flag") === t.fraud, inspRight = v.flagged === t.fraud;
  const miss = t.fraud ? "You paid a fake." : "You held up a real vendor.";
  el.innerHTML = `
    <div class="df-verdict ${right ? "ok" : "bad"}">
      <span class="df-stamp ${call === "pay" ? "paid" : "flagged"}">${call === "pay" ? "PAID" : "FLAGGED"}</span>
      <b>${right ? "Right call." : miss}</b>
      <button class="btn btn-small df-next" id="df-next">${nextIndex() < 0 ? "End shift →" : "Next invoice →"}</button>
    </div>
    <div class="df-truth ${t.fraud ? "fraud" : "real"}"><b>${t.fraud ? "FRAUD · " + esc(t.scheme_name) : "REAL INVOICE"}</b><div>${esc(t.why)}</div></div>
    <div class="df-insp-says">
      <div class="df-insp-head"><b>Inspector v${D.shift.inspector.version}: ${v.flagged ? "FLAGGED" : "PAID"}</b>
        <span class="df-mark ${inspRight ? "ok" : "bad"}">${inspRight ? "✓" : "✗"}</span>
        <span class="df-score">${pct(v.score)} sure it's fraud · flags at ${pct(thr)}</span></div>
      <div class="df-meter"><i style="width:${pct(v.score)}"></i><b style="left:${pct(thr)}"></b></div>
      ${v.reasons.length ? `<div class="df-why-head">${v.flagged ? "Why it flagged" : "What it weighed, not enough to flag"}</div>
        <ul class="df-why">${v.reasons.map(r => `<li>${esc(cap(r.text))}</li>`).join("")}</ul>` : `<div class="df-why-head">Nothing stood out to it.</div>`}
    </div>
    ${phone}`;
  $("#df-next").onclick = next;
}

// after a decision, outline what the inspector weighed: paper regions, or the whole email
function highlight() {
  const it = item(), P = $("#df-paper"), done = !!D.decisions[it.id];
  P.classList.toggle("forensic", done);
  $$("[data-tell]", P).forEach(e => e.removeAttribute("data-tell"));
  $("#df-mail").classList.remove("df-tell");
  if (!done) return;
  it.verdict.reasons.forEach(r => {
    if (r.region === "email") $("#df-mail").classList.add("df-tell");
    else if (r.region) $(`[data-region="${r.region}"]`, P)?.setAttribute("data-tell", "");
  });
}

/* ---------- actions ---------- */

function decide(choice) {
  const it = item();
  if (D.decisions[it.id] || D.ringing) return;
  D.decisions[it.id] = choice;
  if (choice === "pay") D.paidOrder.push(D.at);
  const right = (choice === "flag") === it.truth.fraud;
  OS.sfx("stamp"); setTimeout(() => OS.sfx(right ? "pick" : "bad"), 260);
  renderTop(); renderInbox(); renderCase(); renderDesk(); highlight();
}

function callBack() {
  const it = item();
  if (D.calls <= 0 || D.heard[it.id] || D.decisions[it.id] || D.ringing) return;
  D.calls--; D.ringing = true;
  renderTop(); renderDesk();
  $("#df-ring").innerHTML = `<div class="df-call ringing"><div class="df-call-who">☎ Calling ${esc(it.callback.who)}…</div></div>`;
  OS.sfx("msg"); setTimeout(() => OS.sfx("msg"), 450);
  setTimeout(() => {
    D.ringing = false; D.heard[it.id] = true;
    OS.sfx("pick");
    renderInbox();
    if (item() === it) renderDesk();
  }, 1300);
}

function nextIndex() {
  const items = D.shift.items;
  for (let k = 1; k <= items.length; k++) {
    const i = (D.at + k) % items.length;
    if (!D.decisions[items[i].id]) return i;
  }
  return -1;
}

function next() {
  const i = nextIndex();
  OS.sfx("click");
  if (i < 0) showEnd(); else openItem(i);
}

function step(dir) {
  const n = D.shift.items.length;
  openItem((D.at + dir + n) % n);
}

/* ---------- end of shift ---------- */

function showEnd() {
  const items = D.shift.items, frauds = items.filter(i => i.truth.fraud), v = D.shift.inspector.version;
  const tally = flags => ({
    right: items.filter(i => flags(i) === i.truth.fraud).length,
    caught: frauds.filter(flags).length,
    held: items.filter(i => !i.truth.fraud && flags(i)).length,
  });
  const you = tally(i => D.decisions[i.id] === "flag"), insp = tally(i => i.verdict.flagged);
  const used = (D.shift.callbacks ?? 2) - D.calls;
  $("#df-end-kicker").textContent = `SHIFT ${D.n} · REPORT`;
  $("#df-end-title").textContent = you.right > insp.right ? "You beat the inspector"
    : you.right < insp.right ? `Inspector v${v} wins this one` : "Dead heat";
  const row = (label, a, b, better) => `<tr><td>${label}</td><td class="${better(a, b) ? "df-better" : ""}">${a}</td><td class="${better(b, a) ? "df-better" : ""}">${b}</td></tr>`;
  $("#df-tally").innerHTML = `<table class="df-vs"><tr><th></th><th>You</th><th>Inspector v${v}</th></tr>
    ${row("Right calls", `${you.right} / ${items.length}`, `${insp.right} / ${items.length}`, (a, b) => parseInt(a) > parseInt(b))}
    ${row("Frauds caught", `${you.caught} of ${frauds.length}`, `${insp.caught} of ${frauds.length}`, (a, b) => parseInt(a) > parseInt(b))}
    ${row("Real vendors held up", you.held, insp.held, (a, b) => a < b)}
    ${row("Callbacks used", `${used} of ${D.shift.callbacks ?? 2}`, "—", () => false)}
  </table>`;
  const mark = (flagged, fraud) => `<span class="df-chip ${flagged ? "flag" : "pay"}">${flagged ? "FLAGGED" : "PAID"}</span><span class="df-mark ${flagged === fraud ? "ok" : "bad"}">${flagged === fraud ? "✓" : "✗"}</span>`;
  $("#df-recap").innerHTML = `<tr><th>Invoice</th><th>Vendor</th><th>Amount</th><th>Truth</th><th>You</th><th>Inspector</th></tr>` +
    items.map(i => `<tr><td class="mono">${esc(i.invoice.invoice_id)}</td><td>${esc(i.invoice.vendor_name)}</td><td class="mono">${cents(i.invoice.amount)}</td>
      <td>${i.truth.fraud ? `<b class="df-fraud">${esc(i.truth.scheme_name)}</b>` : "Real"}</td>
      <td>${mark(D.decisions[i.id] === "flag", i.truth.fraud)}</td><td>${mark(i.verdict.flagged, i.truth.fraud)}</td></tr>`).join("");
  OS.sfx(you.right >= insp.right ? "cash" : "buzz");
  OS.overlay("defend-end");
}

function toTitle() {
  OS.overlay("defend-brief", false); OS.overlay("defend-end", false);
  OS.show("title");
}

/* ---------- wiring ---------- */

$("#btn-defend").onclick = () => { OS.sfx("pick"); startShift(1); };
$("#df-quit").onclick = () => { OS.sfx("click"); toTitle(); };
$("#df-brief-go").onclick = () => { OS.sfx("pick"); OS.overlay("defend-brief", false); };
$("#df-brief-back").onclick = toTitle;
$("#df-end-quit").onclick = toTitle;
$("#df-end-next").onclick = () => { OS.overlay("defend-end", false); startShift(D.n + 1); };
$("#df-inbox-list").addEventListener("click", e => {
  const b = e.target.closest(".df-msg");
  if (b) { OS.sfx("click"); openItem(+b.dataset.i); }
});
$("#df-tabs").addEventListener("click", e => {
  const b = e.target.closest(".df-tab");
  if (b) { OS.sfx("click"); D.tab = b.dataset.tab; renderCase(); }
});

document.addEventListener("keydown", e => {
  if (!$("#screen-defend").classList.contains("active") || $(".overlay.show") || window.ForgedMenu?.isOpen?.()) return;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const el = document.activeElement;
  if (el && (["INPUT", "TEXTAREA"].includes(el.tagName) || el.isContentEditable)) return;
  const k = e.key.toLowerCase();
  if (k === "p") decide("pay");
  else if (k === "f") decide("flag");
  else if (k === "c") callBack();
  else if (k === "arrowdown" || k === "j") step(1);
  else if (k === "arrowup" || k === "k") step(-1);
  else if ((k === "enter" || k === "n") && D.decisions[item().id]) next();
  else return;
  e.preventDefault();
});

})();
