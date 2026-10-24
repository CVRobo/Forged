/* orders.js: the online-order content for the computer (game.js).
 * See docs/online-fraud-redesign.md.
 *
 * The player works in the back office of a web shop and pushes fraudulent
 * orders past Gus, the shop's risk engine. Each order is 5 boxes (card, buyer,
 * ship to, device, cart & time). The toolkit swaps what's in a box, and a
 * campaign is 1 to 5 orders in a row.
 *
 * Everything that ends up in a training row lives here:
 *   - the value lists (card codes, email domains, devices…) the toolkit draws from,
 *   - toRows(): one IEEE-CIS row (transaction + identity columns) per order,
 *   - judgeOrders(): the scripted stand-in for Gus (MOCK) until B's model serves.
 *
 * The value lists are common values from the IEEE-CIS train set, typed in by hand.
 * B: replace them with lists read from the CSV so game rows match the real
 * distribution. The meanings of card1-6, C, D, M and most id_ columns are
 * anonymized by Vesta; how we fill them is a documented best guess (see toRows). */
(() => {
"use strict";

const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = n => Math.round(n * 10) / 10;

/* ======================= Shops (one per level) ======================= */

const SHOPS = {
  1: {
    domain: "sunnydiner.shop", prefix: "SD", typical: 74, spread: 60, country: "US",
    catalog: [
      { sku: "donate1", name: "Donate $1 to the Pie Fund", price: 1, kind: "digital", cd: "S", ico: "🥧" },
      { sku: "apron", name: "Diner apron", price: 19.99, kind: "physical", cd: "W", ico: "🧑‍🍳" },
      { sku: "flour", name: "Flour, 50 lb sack", price: 62, kind: "physical", cd: "W", ico: "🌾" },
      { sku: "gift25", name: "Gift card $25", price: 25, kind: "digital", cd: "C", ico: "🎁" },
      { sku: "gift100", name: "Gift card $100", price: 100, kind: "digital", cd: "C", ico: "🎁" },
      { sku: "gift500", name: "Gift card $500", price: 500, kind: "digital", cd: "C", ico: "🎁" },
      { sku: "mixer", name: "Stand mixer", price: 349, kind: "physical", cd: "W", ico: "🥣" },
      { sku: "espresso", name: "Espresso machine", price: 899.99, kind: "physical", cd: "W", ico: "☕" },
    ],
    notes: ["Most orders are under $150, shipped to the billing address.", "Gift cards are emailed, never shipped.", "Regulars buy from the same phone every time."],
  },
  2: {
    domain: "stmercy-pharmacy.com", prefix: "SM", typical: 96, spread: 80, country: "US",
    catalog: [
      { sku: "donate2", name: "Donate $2 to the children's ward", price: 2, kind: "digital", cd: "S", ico: "💝" },
      { sku: "vitamins", name: "Vitamins, 90 days", price: 24.5, kind: "physical", cd: "W", ico: "💊" },
      { sku: "telehealth", name: "Telehealth visit", price: 39, kind: "digital", cd: "H", ico: "🩺" },
      { sku: "subscription", name: "Refill delivery plan (monthly)", price: 12.99, kind: "digital", cd: "R", ico: "🔁" },
      { sku: "bp", name: "Blood pressure monitor", price: 79.99, kind: "physical", cd: "W", ico: "🫀" },
      { sku: "gift50", name: "Gift card $50", price: 50, kind: "digital", cd: "C", ico: "🎁" },
      { sku: "gift200", name: "Gift card $200", price: 200, kind: "digital", cd: "C", ico: "🎁" },
      { sku: "scooter", name: "Mobility scooter", price: 1499, kind: "physical", cd: "W", ico: "🛵" },
    ],
    notes: ["Every order over $500 is checked by a pharmacist.", "Patients reorder from the same device and address.", "Anonymous email providers are blocked at signup."],
  },
};

/* ======================= Cardholders (the victims) ======================= */

// addr1 is the IEEE-CIS billing region code, addr2 the country code (87 = US)
const HOLDERS = [
  { name: "Pat Miller", city: "Columbus, OH", addr1: 299, email: "pat.miller@yahoo.com", phone: "iphone" },
  { name: "Dee Alvarez", city: "Phoenix, AZ", addr1: 325, email: "dee.alvarez@gmail.com", phone: "iphone" },
  { name: "Sam Okoro", city: "Atlanta, GA", addr1: 204, email: "samokoro@hotmail.com", phone: "android" },
  { name: "Lou Bennett", city: "Tampa, FL", addr1: 264, email: "lbennett@aol.com", phone: "iphone" },
  { name: "Kim Tran", city: "Dallas, TX", addr1: 330, email: "kim.tran@comcast.net", phone: "android" },
];

/* ======================= Toolkit options =======================
 * Every option is { id, label, sub, heat, …values }. `sub` is the one-line
 * "what Gus sees" hint. `unlock` options need a shop unlock first. */

const CARDS = [
  { id: "fresh_visa", label: "Fresh Visa debit", sub: "Never used at this shop: no history at all", heat: 2,
    brand: "visa", type: "debit", card1: 9500, card2: 111, card3: 150, card5: 226, last4: "4417", ageDays: 0, pastOrders: 0, foreign: false },
  { id: "aged_mc", label: "Aged Mastercard credit", sub: "The cardholder shops here: 2 years of normal orders", heat: 6,
    brand: "mastercard", type: "credit", card1: 15885, card2: 545, card3: 150, card5: 224, last4: "8802", ageDays: 640, pastOrders: 9, foreign: false },
  { id: "amex", label: "Amex platinum credit", sub: "Big limit, but Amex is rare here", heat: 5,
    brand: "american express", type: "credit", card1: 16136, card2: 204, card3: 150, card5: 117, last4: "1005", ageDays: 210, pastOrders: 2, foreign: false },
  { id: "foreign_visa", label: "Foreign Visa credit", sub: "Cheap dump from abroad: card country isn't the shop's", heat: 1,
    brand: "visa", type: "credit", card1: 7919, card2: 194, card3: 185, card5: 138, last4: "3390", ageDays: 0, pastOrders: 0, foreign: true },
];

const EMAILS = [
  { id: "lookalike", label: "Look-alike Gmail", sub: "Same name as the cardholder, brand-new account", heat: 3,
    domain: "gmail.com", matchesHolder: true, accountDays: 0, pastOrders: 0, risky: false },
  { id: "proton", label: "ProtonMail burner", sub: "Anonymous provider: easy to make, easy to spot", heat: 1,
    domain: "protonmail.com", matchesHolder: false, accountDays: 0, pastOrders: 0, risky: true },
  { id: "yahoo", label: "Random Yahoo account", sub: "Common provider, but the name doesn't match the card", heat: 2,
    domain: "yahoo.com", matchesHolder: false, accountDays: 0, pastOrders: 0, risky: false },
  { id: "hijacked", label: "Hijack the cardholder's account", sub: "Their real login: years of history, but they always shop from their phone", heat: 8,
    domain: null, matchesHolder: true, accountDays: 730, pastOrders: 23, risky: false, hijacked: true },
];

const PROXIES = [
  { id: "none", label: "No VPN (your home IP)", sub: "Your IP is 800 miles from the billing address", heat: 0, id23: null, dist2: 812 },
  { id: "free_vpn", label: "Free VPN", sub: "Hides you, but flagged as an anonymous proxy", heat: 2, id23: "IP_PROXY:ANONYMOUS", dist2: 1460 },
  { id: "paid_vpn", label: "Paid VPN, cardholder's state", sub: "Close to the billing address, still a known VPN range", heat: 4, id23: "IP_PROXY:HIDDEN", dist2: 58 },
  { id: "residential", label: "Residential proxy next door", sub: "Looks like a neighbor's home internet", heat: 6, id23: null, dist2: 3, unlock: "residential" },
];

const DEVICES = [
  { id: "laptop", label: "Your laptop", sub: "Windows desktop. Gus has seen it before if you reuse it", heat: 0,
    type: "desktop", info: "Windows", os: "Windows 10", browser: "chrome 63.0", screen: "1920x1080", depth: 24 },
  { id: "burner_android", label: "Burner Android phone", sub: "A cheap phone, new to the shop", heat: 3,
    type: "mobile", info: "SM-G892A Build/NRD90M", os: "Android 7.0", browser: "chrome 63.0 for android", screen: "1440x2960", depth: 32 },
  { id: "emulator", label: "Phone emulator", sub: "Free and endless, but its browser and screen look odd", heat: 1,
    type: "mobile", info: "rv:57.0", os: "Linux", browser: "chrome generic", screen: "800x600", depth: 24, emulator: true },
  { id: "clone", label: "Clone the cardholder's phone", sub: "Same model, OS and browser as the cardholder", heat: 7, unlock: "cloner",
    type: "mobile", info: "iOS Device", os: "iOS 11.2.1", browser: "mobile safari 11.0", screen: "2436x1125", depth: 32, clone: true },
];
// what the cardholder normally uses (for the clone and the hijacked account)
const HOLDER_DEVICES = {
  iphone: { type: "mobile", info: "iOS Device", os: "iOS 11.2.1", browser: "mobile safari 11.0", screen: "2436x1125", depth: 32 },
  android: { type: "mobile", info: "SAMSUNG SM-G930V Build/NRD90M", os: "Android 7.0", browser: "samsung browser 6.2", screen: "1440x2560", depth: 32 },
};

const SHIPS = [
  { id: "billing", label: "Cardholder's home (billing)", sub: "Looks normal, but the goods go to the victim", heat: 0, dist1: 0, toYou: false, physical: true },
  { id: "mule", label: "Mule in the same city", sub: "A different address a few miles away", heat: 4, dist1: 8, toYou: true, physical: true },
  { id: "reshipper", label: "Reshipper overseas", sub: "A forwarding warehouse abroad: far, but safe for you", heat: 6, dist1: null, toYou: true, physical: true, abroad: true },
  { id: "holder_email", label: "Email it to the cardholder", sub: "Looks normal, but the code goes to the victim", heat: 0, dist1: null, toYou: false, physical: false },
  { id: "burner_email", label: "Email it to your burner", sub: "The code comes straight to you", heat: 3, dist1: null, toYou: true, physical: false },
];

const CLOCKS = [
  { id: "now", label: "Right away", sub: "Seconds after the last order", heat: 0, waitDays: 0, hour: null },
  { id: "afternoon", label: "Same day, 2 PM", sub: "Business hours, a few hours later", heat: 0, waitDays: 0, hour: 14 },
  { id: "night", label: "3 AM tonight", sub: "Fewer staff awake, but odd hours", heat: 1, waitDays: 0, hour: 3 },
  { id: "day", label: "Wait a day", sub: "Looks less rushed. The cardholder might notice", heat: 0, waitDays: 1, hour: 11 },
  { id: "week", label: "Wait a week", sub: "Very patient. Real risk the card gets reported", heat: 0, waitDays: 7, hour: 16 },
];

/* the toolkit: 6 tools, hotkeys 1-6, each swaps one box of the ticket */
const TOOLS = [
  { id: "card", box: "card", name: "Card market", ico: "💳", cap: 3, options: CARDS, hint: "Swap the stolen card" },
  { id: "email", box: "buyer", name: "Burner email", ico: "📧", cap: 3, options: EMAILS, hint: "Change who's buying" },
  { id: "proxy", box: "device", name: "VPN / proxy", ico: "🌐", cap: 3, options: PROXIES, hint: "Change where you seem to be" },
  { id: "device", box: "device", name: "Device spoofer", ico: "📱", cap: 3, options: DEVICES, hint: "Change the phone or computer" },
  { id: "ship", box: "ship", name: "Drop address", ico: "📦", cap: 3, options: SHIPS, hint: "Change where the goods go" },
  { id: "clock", box: "cart", name: "Clock", ico: "⏰", cap: 3, options: CLOCKS, hint: "Change when the order is placed" },
];

/* ======================= Starter campaigns (the schemes) ======================= */

const SCHEMES = {
  card_testing: { name: "Card testing", icon: "🧪", pay: 1.0, risk: 2,
    simple: "Two tiny charges to check the card works, then one big buy.",
    good: [["📦", "Drop address on the big order: required, or the victim gets the espresso machine"],
      ["🌐", "A VPN: your home IP is far from the billing address"],
      ["⏰", "Space the orders out: three charges in a minute is the classic tell"]],
    bad: [["💳", "A fresh card on a big order: no history at all"], ["📧", "ProtonMail: anonymous providers are watched"]],
    tells: "small charges followed by a big one, on a card with no history",
    build: shop => [order(shop, "donate"), order(shop, "donate"), order(shop, "big")] },
  account_takeover: { name: "Account takeover", icon: "🔑", pay: 1.1, risk: 2,
    simple: "Log into the cardholder's own account and order to a new address.",
    good: [["📦", "Drop address: required, the account ships to the victim's home"],
      ["📱", "Clone their phone: the account always shops from it (unlock in the shop)"],
      ["🌐", "A VPN near the cardholder"]],
    bad: [["📧", "Swapping the email: you lose the account's history"], ["⏰", "3 AM: this cardholder never shops at night"]],
    tells: "a new device and a new address on an old, quiet account",
    build: shop => [order(shop, "mid", { card: "aged_mc", email: "hijacked" })] },
  gift_card_flip: { name: "Gift card flip", icon: "🎁", pay: 1.3, risk: 3,
    simple: "Buy a big gift card with a cheap foreign card and send the code to yourself.",
    good: [["📦", "Email it to your burner: required, or the code goes to the victim"],
      ["💳", "A domestic card: a foreign card on a gift card is a red flag"],
      ["📧", "A look-alike email: ProtonMail plus gift cards is a classic"]],
    bad: [["⏰", "Buying several in a row: velocity on gift cards is watched closely"]],
    tells: "a large gift card on a fresh foreign card from an anonymous email",
    build: shop => [order(shop, "gift", { card: "foreign_visa", email: "proton", ship: "holder_email" })] },
  slow_burn: { name: "Slow burn", icon: "🐢", pay: 0.9, risk: 1,
    simple: "Several normal-looking orders, days apart, on an aged card.",
    good: [["📦", "Drop address: required on at least one order"],
      ["📱", "Keep the same device: a regular uses one phone"]],
    bad: [["⏰", "Waiting too long: every day is a chance the cardholder notices"]],
    tells: "almost nothing, if the amounts and timing stay normal",
    build: shop => [order(shop, "small", { card: "aged_mc" }), order(shop, "small", { card: "aged_mc", clock: "day" }), order(shop, "mid", { card: "aged_mc", clock: "day" })] },
  blank: { name: "Blank kit", icon: "✏️", pay: 1.0, risk: 0,
    simple: "One empty order. Build your own scheme from scratch.",
    good: [["💡", "Anything goes: mix cards, devices, addresses and timing"], ["➕", "+ Next order adds steps to the campaign"]],
    bad: [["📦", "Forgetting the drop address: the goods have to reach you"]],
    tells: "depends on what you build",
    build: shop => [order(shop, "mid")] },
};

// a starting order; `kind` picks the cart, `opts` overrides the default kit
function order(shop, kind, opts = {}) {
  const C = shop.catalog;
  const byPrice = [...C].sort((a, b) => a.price - b.price);
  const physical = byPrice.filter(i => i.kind === "physical");
  const item = {
    donate: byPrice[0],
    small: physical[0],
    mid: physical[Math.floor(physical.length / 2)],
    big: physical[physical.length - 1],
    gift: [...C].filter(i => i.cd === "C").pop(),
  }[kind] || byPrice[0];
  return {
    card: opts.card || "fresh_visa", email: opts.email || "lookalike", proxy: opts.proxy || "none",
    device: opts.device || "laptop", ship: opts.ship || (item.kind === "digital" ? "holder_email" : "billing"),
    clock: opts.clock || "now", sku: item.sku,
  };
}

const find = (list, id) => list.find(o => o.id === id);
const optionFor = (tool, o) => find(TOOLS.find(t => t.id === tool).options, o[tool]);
const itemOf = (shop, o) => shop.catalog.find(i => i.sku === o.sku) || shop.catalog[0];

/* the ship options that fit the cart: physical goods need an address, digital ones an email */
function shipOptions(shop, o) { const it = itemOf(shop, o); return SHIPS.filter(s => s.physical === (it.kind === "physical")); }

/* after a cart change, keep the ship option valid (and keep "goes to you" if it was) */
function fixShip(shop, o) {
  const opts = shipOptions(shop, o);
  if (opts.some(s => s.id === o.ship)) return;
  const wasYou = find(SHIPS, o.ship)?.toYou;
  o.ship = (opts.find(s => s.toYou === !!wasYou) || opts[0]).id;
}

/* ======================= Run history =======================
 * Gus remembers every card, email, device and address across the whole run,
 * so reusing a device on a new card shows up in the counts next round. */

function newHistory() { return { orders: [], day: 0, txn: 0 }; }

/* resolve an order into plain facts: what each box really is */
function facts(level, holder, o, opts = {}) {
  const shop = SHOPS[level], card = find(CARDS, o.card), email = find(EMAILS, o.email);
  const proxy = find(PROXIES, o.proxy), ship = find(SHIPS, o.ship), clock = find(CLOCKS, o.clock), item = itemOf(shop, o);
  let dev = { ...find(DEVICES, o.device) };
  if (dev.clone) dev = { ...dev, ...HOLDER_DEVICES[holder.phone] };
  const emailDomain = email.hijacked ? holder.email.split("@")[1] : email.domain;
  const emailAddr = email.hijacked ? holder.email
    : email.matchesHolder ? holder.name.toLowerCase().replace(" ", ".") + "1@" + emailDomain
    : { proton: "quickdeals", yahoo: "shopper" }[o.email] + (holder.addr1 * 7 % 900 + 100) + "@" + emailDomain;
  // the cardholder's usual device: a hijacked account knows it
  const usual = HOLDER_DEVICES[holder.phone];
  return { shop, card, email, emailDomain, emailAddr, proxy, ship, clock, item, dev, usual,
    deviceKey: dev.clone ? "holder-" + holder.phone : o.device,
    addressKey: ship.id === "billing" ? "billing-" + holder.addr1 : ship.id === "mule" ? "mule" : ship.id === "reshipper" ? "reshipper" : null,
    amount: item.price, perks: opts.perks || [] };
}

/* ======================= IEEE-CIS rows ======================= */

const T_COLS = ["TransactionID", "isFraud", "TransactionDT", "TransactionAmt", "ProductCD",
  "card1", "card2", "card3", "card4", "card5", "card6", "addr1", "addr2", "dist1", "dist2", "P_emaildomain", "R_emaildomain",
  ...Array.from({ length: 14 }, (_, i) => "C" + (i + 1)), ...Array.from({ length: 15 }, (_, i) => "D" + (i + 1)),
  ...Array.from({ length: 9 }, (_, i) => "M" + (i + 1)), ...Array.from({ length: 339 }, (_, i) => "V" + (i + 1))];
const ID_COLS = [...Array.from({ length: 38 }, (_, i) => "id_" + String(i + 1).padStart(2, "0")), "DeviceType", "DeviceInfo"];
const GAME_COLS = ["session_id", "origin", "level_id", "round_no", "scheme_id", "campaign_id", "step", "verdict", "score", "top_reasons", "detector_version", "cover_note"];
const COLUMNS = [...T_COLS, ...ID_COLS, ...GAME_COLS];

/* Turn the campaign into rows, one per order, in the IEEE-CIS column format.
 * `hist` is the run so far (not changed here). Our reading of the anonymized columns:
 *   C1 orders on this card, C2 shipping addresses on this card, C4 devices on this card,
 *   C6 orders on this card in the last 24 h, C8 devices on this email, C9 card orders shipped to an address,
 *   C11 cards on this device, C12 cards on this email, C13 orders from this email, C14 orders to this address
 *   (C3, C5, C7, C10 stay 0, as they mostly are in the data);
 *   D1 card age in days, D2 = D1 unless 0, D3 days since this card's last order, D4 account age,
 *   D10 days since this device was first seen, D11 days since the billing address was first seen,
 *   D15 days since the shipping address was first seen;
 *   M1 name on card, M2 email looks like the cardholder, M3 account belongs to the cardholder,
 *   M4 M0 domestic / M2 foreign card, M5 ships somewhere else, M6 ships to billing. */
function toRows(ctx) {
  const { level, holder, orders, hist, session, round, scheme, campaign, perks } = ctx;
  const shop = SHOPS[level];
  const past = [...hist.orders];
  let day = hist.day, minute = 9 * 60 + Math.floor(rand(0, 60)), txn = hist.txn;
  return orders.map((o, step) => {
    const f = facts(level, holder, o, { perks });
    day += f.clock.waitDays;
    minute = f.clock.hour != null ? f.clock.hour * 60 + Math.floor(rand(0, 50)) : minute + (step ? Math.floor(rand(1, 4)) : 0);
    const t = day * 1440 + minute; // minutes since the run started
    const cardKey = holder.name + "|" + o.card, emailKey = f.email.hijacked ? holder.email : f.emailAddr;
    const onCard = past.filter(p => p.cardKey === cardKey), onEmail = past.filter(p => p.emailKey === emailKey);
    const onDevice = past.filter(p => p.deviceKey === f.deviceKey), onAddr = f.addressKey ? past.filter(p => p.addressKey === f.addressKey) : [];
    const uniq = (rows, k, extra) => new Set([...rows.map(r => r[k]), extra].filter(v => v != null)).size;
    const lastCard = onCard.length ? onCard[onCard.length - 1].t : null;
    const daysSince = first => first == null ? null : r1((t - first) / 1440);
    const cardFirst = onCard.length ? onCard[0].t : null, devFirst = onDevice.length ? onDevice[0].t : null;
    const addrFirst = onAddr.length ? onAddr[0].t : null;
    const holderAddr = f.ship.id === "billing";
    const d1 = f.card.ageDays + (cardFirst != null ? Math.floor((t - cardFirst) / 1440) : 0);
    const hijacked = !!f.email.hijacked;
    const deviceIsUsual = hijacked && f.dev.info === f.usual.info && f.dev.os === f.usual.os;
    const row = {
      TransactionID: 9000000 + (++txn), isFraud: 1,
      TransactionDT: 86400 * 200 + t * 60, // seconds; day 200 sits inside the dataset's DT range
      TransactionAmt: +f.amount.toFixed(3), ProductCD: f.item.cd,
      card1: f.card.card1, card2: f.card.card2, card3: f.card.card3, card4: f.card.brand, card5: f.card.card5, card6: f.card.type,
      addr1: f.card.foreign ? null : holder.addr1, addr2: f.card.foreign ? 60 : 87,
      dist1: f.ship.dist1 == null ? null : f.ship.dist1, dist2: f.proxy.dist2,
      // R_emaildomain: who receives a digital item. Your burner is the buyer email you control (a hijacked inbox would alert the victim)
      P_emaildomain: f.emailDomain, R_emaildomain: f.ship.id === "burner_email" ? (f.email.hijacked ? "protonmail.com" : f.emailDomain) : f.ship.id === "holder_email" ? holder.email.split("@")[1] : null,
      C1: f.card.pastOrders + onCard.length + 1,
      C2: uniq(onCard, "addressKey", f.addressKey) || 1, C3: 0,
      C4: uniq(onCard, "deviceKey", f.deviceKey) + (f.card.pastOrders ? 1 : 0), C5: 0,
      C6: onCard.filter(p => t - p.t < 1440).length + 1, C7: 0,
      C8: uniq(onEmail, "deviceKey", f.deviceKey) + (hijacked && !deviceIsUsual ? 1 : 0),
      C9: onCard.filter(p => p.addressKey).length + (f.addressKey ? 1 : 0), C10: 0,
      C11: uniq(onDevice, "cardKey", cardKey), C12: uniq(onEmail, "cardKey", cardKey),
      C13: f.email.pastOrders + onEmail.length + 1, C14: onAddr.length + (f.addressKey ? 1 : 0) + (holderAddr ? f.card.pastOrders : 0),
      D1: d1, D2: d1 > 0 ? d1 : null, D3: lastCard != null ? r1((t - lastCard) / 1440) : f.card.pastOrders ? Math.floor(rand(8, 30)) : null,
      D4: f.email.accountDays + (onEmail.length ? Math.floor((t - onEmail[0].t) / 1440) : 0),
      D5: null, D6: null, D7: null, D8: null, D9: null,
      D10: devFirst != null ? daysSince(devFirst) : deviceIsUsual ? f.email.accountDays : 0,
      D11: holderAddr || !f.card.foreign ? d1 : null, D12: null, D13: null, D14: null,
      D15: holderAddr ? d1 : addrFirst != null ? daysSince(addrFirst) : 0,
      M1: "T", M2: f.email.matchesHolder ? "T" : "F", M3: hijacked ? "T" : "F",
      M4: f.card.foreign ? "M2" : f.proxy.dist2 > 500 ? "M1" : "M0",
      M5: holderAddr || !f.ship.physical ? "F" : "T", M6: holderAddr ? "T" : "F", M7: null, M8: null, M9: null,
      id_01: hijacked ? -5 : 0, id_02: Math.floor(rand(1000, 600000)), id_05: 0, id_06: 0, id_11: 100,
      id_12: onDevice.length || deviceIsUsual || f.perks.includes("cookies") ? "Found" : "NotFound",
      id_13: 49, id_15: hijacked ? "Found" : "New", id_16: onDevice.length || deviceIsUsual ? "Found" : "NotFound",
      id_17: 166, id_19: Math.floor(rand(100, 600)), id_20: Math.floor(rand(100, 600)),
      id_23: f.proxy.id23, id_28: hijacked ? "Found" : "New", id_29: hijacked ? "Found" : "NotFound",
      id_30: f.dev.os, id_31: f.dev.browser, id_32: f.dev.depth, id_33: f.dev.screen, id_34: "match_status:2",
      id_35: "T", id_36: "F", id_37: "T", id_38: f.dev.type === "mobile" ? "F" : "T",
      DeviceType: f.dev.type, DeviceInfo: f.dev.info,
      session_id: session, origin: "player", level_id: level, round_no: round, scheme_id: scheme,
      campaign_id: campaign, step: step + 1, verdict: null, score: null, top_reasons: null, detector_version: null, cover_note: "",
    };
    past.push({ t, cardKey, emailKey, deviceKey: f.deviceKey, addressKey: f.addressKey, amount: f.amount });
    return row;
  });
}

/* commit a submitted campaign to the run history (the rows were built by toRows) */
function remember(hist, ctx, rows) {
  rows.forEach((row, i) => {
    const o = ctx.orders[i], f = facts(ctx.level, ctx.holder, o);
    const t = (row.TransactionDT - 86400 * 200) / 60;
    hist.orders.push({ t, cardKey: ctx.holder.name + "|" + o.card, emailKey: f.email.hijacked ? ctx.holder.email : f.emailAddr,
      deviceKey: f.deviceKey, addressKey: f.addressKey, amount: f.amount });
  });
  const last = rows[rows.length - 1];
  hist.day = Math.floor((last.TransactionDT - 86400 * 200) / 86400) + 1; // next round is the next day
  hist.txn = last.TransactionID - 9000000;
}

/* ======================= Scripted Gus (MOCK) =======================
 * Scores each order from its row and facts. Tells are [name, weight, box].
 * The real detector (B) replaces this and returns the same shape. */

const TELL_LABELS = {
  email_risky: "anonymous email provider",
  email_mismatch: "email doesn't match the cardholder",
  new_card: "brand-new card on a big order",
  foreign_card: "foreign card at a local shop",
  ip_far: "IP far from the billing address",
  proxy: "order placed through a VPN",
  emulator: "emulator: browser and screen don't fit",
  new_device: "new device on an old account",
  device_reuse: "one device used with several cards",
  far_ship: "goods shipped far from the cardholder",
  new_address: "new shipping address on an old card",
  gift_card: "large gift card",
  amount_unusual: "amount way above this shop's usual",
  amount_jump: "tiny test charges, then a big one",
  velocity: "several orders on one card, fast",
  night: "order at an odd hour",
  heat: "you've been getting sloppy (heat)",
  device_mobile: "ordered from a phone",
  friday: "Friday order",
  yahoo: "Yahoo email",
};
const TELL_BOX = {
  email_risky: "buyer", email_mismatch: "buyer", yahoo: "buyer", new_card: "card", foreign_card: "card", velocity: "card",
  ip_far: "device", proxy: "device", emulator: "device", new_device: "device", device_reuse: "device", device_mobile: "device",
  far_ship: "ship", new_address: "ship", gift_card: "cart", amount_unusual: "cart", amount_jump: "cart", night: "cart", friday: "cart",
};

const MEMOS = {
  1: [
    { text: "Watch anonymous email providers.", tell: "email_risky", real: true },
    { text: "Flag orders placed far from the billing address.", tell: "ip_far", real: true },
    { text: "Several orders on one card in a day is a red flag.", tell: "velocity", real: true },
    { text: "Brand-new cards on big orders need a second look.", tell: "new_card", real: true },
    { text: "Orders from phones are always fraud.", tell: "device_mobile", real: false },
    { text: "Friday orders are suspicious.", tell: "friday", real: false },
  ],
  2: [
    { text: "Old accounts on brand-new devices: check them.", tell: "new_device", real: true },
    { text: "Large gift cards go to review.", tell: "gift_card", real: true },
    { text: "Block orders through VPNs.", tell: "proxy", real: true },
    { text: "Watch for one device paying with many cards.", tell: "device_reuse", real: true },
    { text: "Yahoo addresses are high risk.", tell: "yahoo", real: false },
    { text: "Night orders are always fraud.", tell: "night", real: false },
  ],
};

/* score one campaign. Returns per-order results and the campaign verdict.
 * ctx: { level, holder, orders, rows, memo, version, heat, persuasion, perks, learned, waitRisk } */
function judgeOrders(ctx) {
  const { level, holder, orders, rows, memo, version, heat, persuasion, perks, learned } = ctx;
  const shop = SHOPS[level];
  const watched = memo.filter(m => m.real).map(m => m.tell);
  const skill = .55 + .12 * (version - 1);
  let reported = false, stopped = false;
  const results = orders.map((o, i) => {
    const f = facts(level, holder, o, { perks }), row = rows[i], prev = rows[i - 1];
    const t = [];
    const add = (name, w) => { if (w > .5) t.push([name, w, TELL_BOX[name] || null]); };
    if (stopped) return { declined: true, reason: "card_blocked", tells: [], score: 1 };
    // the card can get reported while you wait (Patience perk: never)
    if (i > 0 && f.clock.waitDays && !perks.includes("patience") && Math.random() < .04 * f.clock.waitDays) {
      reported = stopped = true;
      return { declined: true, reason: "card_reported", tells: [], score: 1 }; // bad luck, not Gus: nothing to learn
    }
    if (f.email.risky) add("email_risky", 18);
    if (!f.email.matchesHolder) add("email_mismatch", 8);
    if (f.card.ageDays === 0 && row.C1 <= 3) add("new_card", clamp(4 + f.amount / 60, 4, 18));
    if (f.card.foreign) add("foreign_card", 10 + (f.item.cd === "C" ? 8 : 0));
    if (row.dist2 > 300) add("ip_far", row.id_23 ? 8 : 16);
    if (row.id_23) add("proxy", row.id_23 === "IP_PROXY:ANONYMOUS" ? 14 : 8);
    if (f.dev.emulator) add("emulator", 16);
    if (f.email.hijacked && row.id_16 === "NotFound") add("new_device", perks.includes("cookies") ? 7 : 14);
    if (row.C11 > 1) add("device_reuse", 9 * (row.C11 - 1));
    if (f.ship.abroad) add("far_ship", 18); else if (row.dist1 > 5) add("far_ship", 5);
    if (f.ship.id === "mule" && f.card.pastOrders) add("new_address", 9);
    if (f.item.cd === "C" && f.amount >= 100) add("gift_card", 5 + f.amount / 50);
    if (f.amount > shop.typical + 3 * shop.spread) add("amount_unusual", 12);
    if (prev && prev.TransactionAmt < 10 && f.amount > 150) add("amount_jump", 22);
    if (row.C6 >= 3) add("velocity", 7 * (row.C6 - 2));
    const hour = Math.floor((row.TransactionDT % 86400) / 3600);
    if (hour < 6) add("night", 6);
    if (heat > 40) add("heat", (heat - 40) * .5);
    t.forEach(x => {
      if (watched.includes(x[0])) x[1] *= 1.5;
      if (learned[x[0]]) x[1] *= 1 + .3 * learned[x[0]]; // Gus learned this trick from you before
    });
    const tells = t.sort((a, b) => b[1] - a[1]);
    let suspicion = tells.reduce((a, x) => a + x[1], 0) * skill - persuasion * .18 + rand(-10, 10);
    if (f.amount < 5) suspicion -= 12; // nobody reviews a $1 charge
    const caught = suspicion > 38;
    if (caught) stopped = true; // a flagged order blocks the card for the rest of the campaign
    return { declined: caught, reason: caught ? "flagged" : null, tells, score: clamp(.5 + (suspicion - 38) / 60, .01, .99) };
  });
  const caught = results.some(r => r.declined);
  const payout = orders.reduce((a, o, i) => {
    const f = facts(level, holder, o, { perks });
    return results[i].declined || !f.ship.toYou ? a : a + f.amount;
  }, 0);
  const tells = results.flatMap(r => r.tells).sort((a, b) => b[1] - a[1]);
  return { caught, results, tells, payout, reported };
}

window.ForgedOrders = {
  SHOPS, HOLDERS, TOOLS, SCHEMES, CARDS, EMAILS, PROXIES, DEVICES, SHIPS, CLOCKS, HOLDER_DEVICES,
  TELL_LABELS, TELL_BOX, MEMOS, COLUMNS,
  find, optionFor, itemOf, shipOptions, fixShip, facts, newHistory, toRows, remember, judgeOrders,
};
})();
