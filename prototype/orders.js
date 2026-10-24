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
  if (o.in) return factsFromInput(level, holder, o.in, o.k, opts); // typed checkout
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
    const cardKey = holder.name + "|" + f.card.id, emailKey = f.email.hijacked ? holder.email : f.emailAddr;
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
      P_emaildomain: f.emailDomain, R_emaildomain: f.ship.rDomain || (f.ship.id === "burner_email" ? (f.email.hijacked ? "protonmail.com" : f.emailDomain) : f.ship.id === "holder_email" ? holder.email.split("@")[1] : null),
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
      M1: f.nameMatches === false ? "F" : "T", M2: f.email.matchesHolder ? "T" : "F", M3: hijacked ? "T" : "F",
      M4: f.card.foreign ? "M2" : f.proxy.foreign || f.proxy.dist2 > 500 ? "M1" : "M0",
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
    hist.orders.push({ t, cardKey: ctx.holder.name + "|" + f.card.id, emailKey: f.email.hijacked ? ctx.holder.email : f.emailAddr,
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
  email_risky: "that email screams 'burner'",
  email_mismatch: "the email's name isn't the card's name",
  new_card: "a brand-new card buying big",
  foreign_card: "a card from abroad, here?",
  ip_far: "shopping from 800 miles away",
  proxy: "hiding behind a VPN",
  emulator: "a phone that isn't a real phone",
  new_device: "an old account on a strange device",
  device_reuse: "the same computer with another card",
  far_ship: "shipped across the ocean",
  new_address: "a new address on an old card",
  gift_card: "a suspiciously big gift card",
  amount_unusual: "way more than people spend here",
  amount_jump: "$1 tests, then a big buy",
  name_mismatch: "the name isn't the one on the card",
  new_account: "a brand-new account",
  odd_domain: "an email from a weird website",
  copycat: "the same trick that fooled me before",
  velocity: "too many orders, too fast",
  night: "who shops at 3 AM?",
  heat: "you've been getting sloppy",
  device_mobile: "ordered from a phone",
  friday: "it's Friday",
  yahoo: "a Yahoo email",
};
const TELL_BOX = {
  email_risky: "buyer", email_mismatch: "buyer", yahoo: "buyer", new_account: "buyer", new_card: "card", foreign_card: "card", velocity: "card",
  ip_far: "device", proxy: "device", emulator: "device", new_device: "device", device_reuse: "device", device_mobile: "device",
  far_ship: "ship", new_address: "ship", name_mismatch: "buyer", odd_domain: "buyer", gift_card: "cart", amount_unusual: "cart", amount_jump: "cart", night: "cart", friday: "cart",
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
  const memory = ctx.memory || [], jitter = ctx.preview ? () => 0 : rand;
  const shop = SHOPS[level];
  const watched = memo.filter(m => m.real).map(m => m.tell);
  const skill = Math.min(1.05, .55 + .06 * (version - 1)); // capped: a new idea can always win
  let reported = false, stopped = false;
  const results = orders.map((o, i) => {
    const f = facts(level, holder, o, { perks }), row = rows[i], prev = rows[i - 1];
    const t = [];
    const add = (name, w) => { if (w > .5) t.push([name, w, TELL_BOX[name] || null]); };
    if (stopped) return { declined: true, reason: "card_blocked", tells: [], score: 1 };
    // the card can get reported while you wait (Patience perk: never)
    if (!ctx.preview && i > 0 && f.clock.waitDays && !perks.includes("patience") && Math.random() < .04 * f.clock.waitDays) {
      reported = stopped = true;
      return { declined: true, reason: "card_reported", tells: [], score: 1 }; // bad luck, not Gus
    }
    if (f.email.risky) add("email_risky", 18);
    if (!f.email.matchesHolder) add("email_mismatch", 8);
    if (f.nameMatches === false) add("name_mismatch", 12);
    if (f.oddDomain) add("odd_domain", 9);
    if (f.card.ageDays === 0 && row.C1 <= 3) add("new_card", clamp(4 + f.amount / 60, 4, 18));
    if (f.card.foreign) add("foreign_card", 10 + (f.item.cd === "C" ? 8 : 0));
    if (row.dist2 > 300) add("ip_far", row.id_23 ? 8 : 16);
    if (row.id_23) add("proxy", row.id_23 === "IP_PROXY:ANONYMOUS" ? 14 : 8);
    if (f.dev.emulator) add("emulator", 16);
    if (f.email.hijacked && row.id_16 === "NotFound") add("new_device", perks.includes("cookies") ? 7 : 14);
    if (row.C11 > 1) add("device_reuse", Math.min(22, 9 * (row.C11 - 1)));
    if (f.ship.abroad) add("far_ship", 18); else if (row.dist1 > 5) add("far_ship", 5);
    if (f.ship.id === "mule" && f.card.pastOrders) add("new_address", 9);
    if (f.item.cd === "C" && f.amount >= 100) add("gift_card", 5 + f.amount / 50);
    if (f.amount > shop.typical + 3 * shop.spread) add("amount_unusual", 12);
    if (prev && prev.TransactionAmt < 10 && f.amount > 150) add("amount_jump", 22);
    if (row.C6 >= 3) add("velocity", 7 * (row.C6 - 2));
    const hour = Math.floor((row.TransactionDT % 86400) / 3600);
    if (hour < 6) add("night", 6);
    if (heat > 40) add("heat", (heat - 40) * .5);
    // Gus remembers the tricks that fooled him: a close copy of one is a red flag
    const sig = signature(row), seen = memory.reduce((m, x) => Math.max(m, similarity(sig, x)), 0);
    if (seen >= .78) add("copycat", 80 * (seen - .72) + (seen === 1 ? 10 : 0)); // only real copies: most fields the same
    t.forEach(x => {
      if (watched.includes(x[0])) x[1] *= 1.5;
      if (learned[x[0]]) x[1] *= Math.min(1.8, 1 + .15 * learned[x[0]]); // Gus studied this from one of your wins
    });
    const tells = t.sort((a, b) => b[1] - a[1]);
    // leniency: Gus goes easy on new players (game.js passes more at low ranks)
    let suspicion = tells.reduce((a, x) => a + x[1], 0) * skill - persuasion * .18 + jitter(-10, 10) - (ctx.leniency || 0);
    if (f.amount < 5) suspicion -= 12; // nobody reviews a $1 charge
    const caught = suspicion > 38;
    if (caught) stopped = true; // a flagged order blocks the card for the rest of the campaign
    return { declined: caught, reason: caught ? "flagged" : null, tells, suspicion, score: clamp(.5 + (suspicion - 38) / 60, .01, .99) };
  });
  const caught = results.some(r => r.declined);
  const payout = orders.reduce((a, o, i) => {
    const f = facts(level, holder, o, { perks });
    return results[i].declined || !f.ship.toYou ? a : a + f.amount;
  }, 0);
  const tells = results.flatMap(r => r.tells).sort((a, b) => b[1] - a[1]);
  return { caught, results, tells, payout, reported };
}

/* ======================= Plan cards (what the player sees) =======================
 * The player never sees the boxes above. They fill in a one-line plan with
 * picture cards dealt into their hand, and buildCampaign() turns the plan into
 * orders. Ranks unlock one more blank at a time; Mastermind can tweak the
 * disguise piece by piece, which is where the most creative data comes from. */

const RANKS = [
  { n: 1, title: "Rookie", xp: 0, slots: ["what", "where"], windows: [], unlocks: "Choose what to buy and where it goes" },
  { n: 2, title: "Hustler", xp: 2, slots: ["who", "what", "where"], windows: ["clerk"], unlocks: "Choose the name and email you shop under, and the support chat" },
  { n: 3, title: "Schemer", xp: 4, slots: ["who", "what", "when", "where"], windows: ["clerk", "memo"], unlocks: "Choose your device and where you shop from, and the leaked memo" },
  { n: 4, title: "Operator", xp: 7, slots: ["who", "what", "when", "where", "trick"], windows: ["clerk", "memo"], unlocks: "Choose when, and repeat the order" },
  { n: 5, title: "Mastermind", xp: 11, slots: ["who", "what", "when", "where", "trick"], windows: ["clerk", "memo"], custom: true, unlocks: "Choose which stolen card to use" },
];
const rankFor = xp => [...RANKS].reverse().find(r => xp >= r.xp);

const PERSONAS = [
  { id: "me", ico: "🧑", name: "Just me", line: "My laptop, my Wi-Fi", heat: 0,
    kit: { card: "fresh_visa", email: "lookalike", proxy: "none", device: "laptop" } },
  { id: "grandma", ico: "👵", name: "Grandma's account", line: "Her login, my laptop", heat: 5,
    kit: { card: "aged_mc", email: "hijacked", proxy: "none", device: "laptop" } },
  { id: "ghost", ico: "🕶️", name: "The Ghost", line: "Untraceable. Very shady.", heat: 2,
    kit: { card: "fresh_visa", email: "proton", proxy: "free_vpn", device: "emulator" } },
  { id: "lookalike", ico: "🪞", name: "The Look-alike", line: "Same name, new phone", heat: 3,
    kit: { card: "fresh_visa", email: "lookalike", proxy: "paid_vpn", device: "burner_android" } },
  { id: "tourist", ico: "🧳", name: "The Tourist", line: "A card from far away", heat: 1,
    kit: { card: "foreign_visa", email: "yahoo", proxy: "free_vpn", device: "laptop" } },
  { id: "bigshot", ico: "💼", name: "The Big Shot", line: "Platinum card, no history", heat: 3,
    kit: { card: "amex", email: "lookalike", proxy: "none", device: "laptop" } },
  { id: "neighbor", ico: "🏡", name: "The Neighbor", line: "Shops from next door", heat: 4, unlock: "neighbor",
    kit: { card: "aged_mc", email: "lookalike", proxy: "residential", device: "burner_android" } },
  { id: "clone", ico: "📱", name: "The Phone Clone", line: "Their account, their phone", heat: 6, unlock: "clone",
    kit: { card: "aged_mc", email: "hijacked", proxy: "paid_vpn", device: "clone" } },
];
const WHENS = [
  { id: "now", ico: "⚡", name: "Right now", line: "No time to lose", heat: 0 },
  { id: "afternoon", ico: "🥪", name: "Lunch break", line: "When everyone shops", heat: 0 },
  { id: "night", ico: "🌙", name: "3 AM", line: "Nobody's watching. Right?", heat: 1 },
  { id: "day", ico: "📅", name: "Tomorrow", line: "Patience pays… maybe", heat: 0 },
  { id: "week", ico: "🗓️", name: "Next week", line: "The card might die", heat: 0 },
];
const WHERES = [
  { id: "mule", ico: "🏚️", name: "Cousin's garage", line: "A few miles from them", physical: true, heat: 3 },
  { id: "reshipper", ico: "🚢", name: "Warehouse overseas", line: "Far away. Safe for me.", physical: true, heat: 5 },
  { id: "burner_email", ico: "📧", name: "My secret inbox", line: "The code comes to me", physical: false, heat: 2 },
];
const TRICKS = [
  { id: "none", ico: "✋", name: "No trick", line: "Keep it simple", heat: 0 },
  { id: "test_first", ico: "🧪", name: "Test the card", line: "A $1 charge first", heat: 1 },
  { id: "three_times", ico: "🔁", name: "Do it 3 times", line: "Triple loot, triple risk", heat: 6 },
  { id: "warm_up", ico: "🐢", name: "Warm it up", line: "A normal buy the day before", heat: 2 },
  { id: "come_back", ico: "↩️", name: "Come back later", line: "Again next week", heat: 3 },
  { id: "small_bites", ico: "🍰", name: "Small bites", line: "Three cheap orders instead", heat: 3 },
];
// the parts a Mastermind can swap on their disguise
const TWEAKS = [
  { id: "card", ico: "💳", name: "Card", options: CARDS },
  { id: "email", ico: "📧", name: "Email", options: EMAILS },
  { id: "device", ico: "📱", name: "Device", options: DEVICES },
  { id: "proxy", ico: "🌐", name: "Hide", options: PROXIES },
];

/* deal `n` cards for one blank of the plan. `plan.what` decides which WHERE cards fit */
function dealHand(slot, ctx) {
  const { level, plan, unlocks = [], n = 3 } = ctx;
  const shop = SHOPS[level];
  const shuffle = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(v => v[1]);
  if (slot === "what") {
    const loot = shop.catalog.filter(i => i.cd !== "S").map(i => ({ id: i.sku, ico: i.ico, name: i.name,
      line: i.name.includes("$") ? "Code sent by email" : price(i.price), item: i }));
    const phys = shuffle(loot.filter(c => c.item.kind === "physical")), dig = shuffle(loot.filter(c => c.item.kind === "digital"));
    return shuffle([phys[0], dig[0], ...shuffle([...phys.slice(1), ...dig.slice(1)]).slice(0, n - 2)]);
  }
  if (slot === "where") {
    const item = itemOf(shop, { sku: plan.what });
    return WHERES.filter(w => w.physical === (item.kind === "physical"));
  }
  if (slot === "who") return shuffle(PERSONAS.filter(p => !p.unlock || unlocks.includes(p.unlock))).slice(0, n);
  if (slot === "when") return shuffle(WHENS).slice(0, n);
  if (slot === "trick") return [TRICKS[0], ...shuffle(TRICKS.slice(1)).slice(0, n - 1)];
  return [];
}
const price = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/* the plan → the orders Gus scores. Blanks the player's rank doesn't have yet use safe defaults */
function buildCampaign(level, plan) {
  const shop = SHOPS[level];
  const kit = { ...(find(PERSONAS, plan.who) || PERSONAS[0]).kit, ...(plan.custom || {}) };
  const item = itemOf(shop, { sku: plan.what });
  const base = { ...kit, sku: item.sku, ship: plan.where || (item.kind === "digital" ? "burner_email" : "mule"), clock: plan.when || "afternoon" };
  fixShip(shop, base);
  const byPrice = [...shop.catalog].sort((a, b) => a.price - b.price);
  // `ship` for the extra orders: test charges and warm-ups go to the cardholder, like a real customer's would
  const extra = (it, clock, ship = base.ship) => { const o = { ...base, sku: it.sku, clock, ship }; fixShip(shop, o); return o; };
  const smallPhysical = byPrice.find(i => i.kind === "physical");
  switch (plan.trick) {
    case "test_first": return [extra(byPrice[0], base.clock, "holder_email"), { ...base, clock: "now" }];
    case "three_times": return [base, { ...base, clock: "now" }, { ...base, clock: "now" }];
    case "warm_up": return [extra(smallPhysical, base.clock, "billing"), { ...base, clock: "day" }];
    case "come_back": return [base, { ...base, clock: "week" }];
    case "small_bites": { // three of a cheaper item of the same kind
      const same = byPrice.filter(i => i.kind === item.kind && i.cd !== "S" && i.sku !== item.sku);
      const cheap = same.filter(i => i.price <= item.price / 2).pop() || same[0] || item;
      return [extra(cheap, base.clock), extra(cheap, "afternoon"), extra(cheap, "day")];
    }
    default: return [base];
  }
}

/* ======================= Typed checkout =======================
 * The player types what they want, like on a real checkout page. These parsers
 * turn the text into the facts a row needs, using the dataset's vocabulary
 * (email domains, device strings, product codes, distances). No AI: keywords. */

const norm = s => String(s || "").toLowerCase().trim();
const num = s => { const m = String(s || "").replace(/,/g, "").match(/\d+(\.\d+)?/); return m ? +m[0] : null; };

// cities players are likely to type, with coordinates for dist1 / dist2 (miles)
const CITIES = [
  ["Columbus", 39.96, -83.0], ["Phoenix", 33.45, -112.07], ["Atlanta", 33.75, -84.39], ["Tampa", 27.95, -82.46], ["Dallas", 32.78, -96.8],
  ["Chicago", 41.88, -87.63], ["New York", 40.71, -74.0, ["nyc", "brooklyn", "manhattan"]], ["Los Angeles", 34.05, -118.24, ["la", "hollywood"]],
  ["Miami", 25.76, -80.19], ["Seattle", 47.61, -122.33], ["Denver", 39.74, -104.99], ["Boston", 42.36, -71.06], ["Houston", 29.76, -95.37],
  ["San Francisco", 37.77, -122.42, ["sf", "bay area", "oakland"]], ["Las Vegas", 36.17, -115.14, ["vegas"]], ["Detroit", 42.33, -83.05],
  ["Orlando", 28.54, -81.38], ["Austin", 30.27, -97.74], ["Cleveland", 41.5, -81.69], ["Cincinnati", 39.1, -84.51], ["Mesa", 33.42, -111.83],
  ["Scottsdale", 33.49, -111.93], ["Tempe", 33.43, -111.94], ["Fort Worth", 32.76, -97.33], ["St. Petersburg", 27.77, -82.64, ["st petersburg", "st pete"]],
  ["Clearwater", 27.97, -82.8], ["Marietta", 33.95, -84.55], ["Dublin", 40.1, -83.11], ["Plano", 33.02, -96.7], ["Berkeley", 37.87, -122.27],
  ["Philadelphia", 39.95, -75.17, ["philly"]], ["Portland", 45.52, -122.68], ["Nashville", 36.16, -86.78], ["New Orleans", 29.95, -90.07],
  ["Toronto", 43.65, -79.38, [], true], ["Mexico City", 19.43, -99.13, [], true], ["London", 51.5, -0.13, [], true], ["Paris", 48.86, 2.35, [], true],
  ["Rotterdam", 51.92, 4.48, [], true], ["Lagos", 6.52, 3.38, [], true], ["Moscow", 55.76, 37.62, [], true], ["Bucharest", 44.43, 26.1, [], true],
  ["Manila", 14.6, 120.98, [], true], ["Dubai", 25.2, 55.27, [], true], ["Hong Kong", 22.32, 114.17, [], true], ["Berlin", 52.52, 13.4, [], true],
].map(([name, lat, lon, alias = [], foreign = false]) => ({ name, lat, lon, foreign, keys: [name.toLowerCase(), ...alias] }));
const PLAYER_HOME = "Chicago"; // where you really are, if you don't hide it

function findCity(text) {
  const t = " " + norm(text).replace(/[^a-z. ]/g, " ") + " ";
  return CITIES.find(c => c.keys.some(k => t.includes(" " + k + " ") || (k.length > 4 && t.includes(k))));
}
function miles(a, b) {
  if (!a || !b) return null;
  const R = 3959, rad = d => d * Math.PI / 180, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const holderCity = holder => findCity(holder.city);

/* what you're buying: a catalog item, or anything you type with a price */
const ITEM_ICONS = [[/gift|voucher|code|credit|steam|itunes|robux|card/, "🎁"], [/phone|iphone|galaxy|pixel/, "📱"], [/laptop|macbook|computer|pc\b/, "💻"],
  [/tv|television|monitor/, "📺"], [/console|ps5|playstation|xbox|switch/, "🎮"], [/watch|rolex|jewel|ring|necklace/, "💍"], [/shoe|sneaker|jordan/, "👟"],
  [/espresso|coffee/, "☕"], [/mixer|blender|kitchen/, "🥣"], [/ticket|flight|hotel/, "🎫"], [/subscription|membership|plan|monthly/, "🔁"],
  [/visit|service|repair|lesson|consult/, "🩺"], [/donat/, "💝"], [/headphone|airpod|speaker/, "🎧"], [/bike|scooter/, "🛵"], [/camera/, "📷"]];
// rough street prices for things players type, when they don't give a price
const PRICE_GUESS = [[/ps5|playstation|xbox/, 499], [/switch/, 299], [/iphone|galaxy s|pixel/, 899], [/macbook|gaming laptop/, 1299], [/laptop|computer|pc\b/, 799],
  [/airpod|headphone|earbud/, 179], [/tv|television/, 649], [/rolex/, 8500], [/watch/, 349], [/sneaker|jordan|shoe/, 189], [/camera/, 749],
  [/ipad|tablet/, 449], [/bike|scooter/, 599], [/chair/, 249], [/blender/, 89], [/speaker/, 129], [/ring|necklace|jewel/, 1200]];
function parseItem(shop, text, priceText) {
  const t = norm(text);
  const hit = t && shop.catalog.find(i => norm(i.name) === t || norm(i.name).split(/[ ,]+/).filter(w => w.length > 3 && !/card|gift/.test(w)).some(w => t.includes(w))
    || (/gift/.test(t) && /gift/.test(norm(i.name)) && num(t) === i.price));
  const typedPrice = num(priceText) ?? (/gift|voucher|credit/.test(t) ? num(t) : null);
  const cd = hit ? hit.cd
    : /gift|voucher|code|credit|steam|itunes|robux|e-?card/.test(t) ? "C"
    : /subscription|membership|monthly|plan\b/.test(t) ? "R"
    : /visit|service|repair|lesson|consult|booking|ticket|flight|hotel/.test(t) ? "H"
    : /donat/.test(t) ? "S" : "W";
  const guess = (PRICE_GUESS.find(([re]) => re.test(t)) || [, 120])[1];
  const price = Math.max(.5, Math.min(25000, typedPrice ?? (hit ? hit.price : guess)));
  return { name: hit && typedPrice == null ? hit.name : (text || "").trim().slice(0, 40) || "Mystery box", price, cd,
    kind: cd === "W" ? "physical" : "digital", ico: hit ? hit.ico : (ITEM_ICONS.find(([re]) => re.test(t)) || [, "📦"])[1], sku: hit ? hit.sku : null };
}

/* who you pretend to be: the name on the order and the email */
const ANON_DOMAINS = ["protonmail.com", "proton.me", "anonymous.com", "mail.com", "guerrillamail.com", "tempmail.com", "yopmail.com", "tutanota.com", "10minutemail.com"];
const COMMON_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "aol.com", "anonymous.com", "comcast.net", "icloud.com", "outlook.com", "msn.com",
  "att.net", "live.com", "sbcglobal.net", "verizon.net", "ymail.com", "bellsouth.net", "me.com", "cox.net", "optonline.net", "charter.net", "protonmail.com", "mail.com"];
function parseEmail(nameText, emailText, holder) {
  const e = norm(emailText).replace(/\s+/g, "");
  const domain = (e.includes("@") ? e.split("@").pop() : "") || "gmail.com";
  const local = e.split("@")[0] || "";
  const hName = norm(holder.name).split(" ");
  const typedName = norm(nameText);
  const hijacked = e === norm(holder.email);
  return {
    domain, address: e.includes("@") ? e : (local || "shopper") + "@" + domain,
    hijacked, risky: ANON_DOMAINS.includes(domain), odd: !COMMON_DOMAINS.includes(domain),
    matchesHolder: hijacked || hName.some(p => p.length > 2 && local.includes(p)),
    nameMatches: !typedName || hName.every(p => typedName.includes(p)) || (typedName.includes(hName[1]) && typedName[0] === hName[0][0]),
    accountDays: hijacked ? 730 : 0, pastOrders: hijacked ? 23 : 0,
  };
}

/* what you shop on: free text to the dataset's DeviceInfo / id_30 / id_31 / id_33 strings */
const DEVICE_RULES = [
  [/emulat|bot|script|headless|virtual|vm\b|bluestacks/, { type: "mobile", info: "rv:57.0", os: "Linux", browser: "chrome generic", screen: "800x600", depth: 24, emulator: true, label: "Phone emulator" }],
  [/iphone|ipad|ios|apple phone/, { type: "mobile", info: "iOS Device", os: "iOS 11.2.1", browser: "mobile safari 11.0", screen: "2436x1125", depth: 32, label: "iPhone" }],
  [/samsung|galaxy/, { type: "mobile", info: "SAMSUNG SM-G930V Build/NRD90M", os: "Android 7.0", browser: "samsung browser 6.2", screen: "1440x2560", depth: 32, label: "Samsung Galaxy" }],
  [/pixel|android|motorola|moto|lg\b|huawei|xiaomi|oneplus|phone/, { type: "mobile", info: "Moto G (4) Build/NPJ25.93-14.7", os: "Android 7.0", browser: "chrome 63.0 for android", screen: "1080x1920", depth: 32, label: "Android phone" }],
  [/mac|apple|imac/, { type: "desktop", info: "MacOS", os: "Mac OS X 10_12_6", browser: "safari 11.0", screen: "2560x1600", depth: 24, label: "Mac" }],
  [/linux|ubuntu/, { type: "desktop", info: "Linux", os: "Linux", browser: "firefox 57.0", screen: "1920x1080", depth: 24, label: "Linux PC" }],
  [/tablet|kindle|fire/, { type: "mobile", info: "KFFOWI Build/LVY48F", os: "Android 5.1.1", browser: "chrome 63.0 for android", screen: "1024x600", depth: 32, label: "Tablet" }],
];
const DEFAULT_DEVICE = { type: "desktop", info: "Windows", os: "Windows 10", browser: "chrome 63.0", screen: "1920x1080", depth: 24, label: "Windows laptop" };
function parseDevice(text) {
  const t = norm(text);
  const d = (DEVICE_RULES.find(([re]) => re.test(t)) || [, DEFAULT_DEVICE])[1];
  return { ...d, key: d.label + "|" + t.replace(/[^a-z0-9]/g, "").slice(0, 24) };
}

/* where you shop from: your home, a city (pretend to be there), or a VPN / Tor */
function parseWhere(text, holder) {
  const t = norm(text), hc = holderCity(holder);
  const city = findCity(t) || (/near|next door|neighbo|same (city|town)|their (city|town)|residential/.test(t) ? hc : null);
  const at = city || findCity(PLAYER_HOME);
  const d = miles(at, hc) ?? 812;
  const near = /next door|neighbo|residential/.test(t);
  if (/\btor\b|onion/.test(t)) return { id23: "IP_PROXY:ANONYMOUS", dist2: 4120, foreign: true, label: "Tor" };
  if (/vpn|proxy/.test(t)) return { id23: city ? "IP_PROXY:HIDDEN" : "IP_PROXY:ANONYMOUS", dist2: city ? Math.max(2, d) : 1460, foreign: !!(city && city.foreign), label: city ? "VPN in " + city.name : "VPN" };
  return { id23: null, dist2: near ? 3 : Math.max(1, d), foreign: at.foreign, label: city ? city.name : PLAYER_HOME + " (your home)" };
}

/* where the loot goes. Physical: an address (their home, a city, abroad). Digital: an email */
function parseShip(text, item, holder, email) {
  const t = norm(text), hc = holderCity(holder);
  if (item.kind === "digital") {
    const to = t.includes("@") ? t.replace(/\s+/g, "") : (/their|victim|holder/.test(t) ? norm(holder.email) : email.address);
    const theirs = to === norm(holder.email);
    return { id: theirs ? "holder_email" : "burner_email", dist1: null, toYou: !theirs || email.hijacked, physical: false, rDomain: to.split("@").pop(), label: to };
  }
  if (!t || /their (home|house|address)|billing|victim|same address/.test(t) || (holder.street && t.includes(norm(holder.street)))) {
    return { id: "billing", dist1: 0, toYou: false, physical: true, label: "Their home, " + holder.city };
  }
  const city = findCity(t) || (/garage|cousin|friend|mule|locker|po box|next door|neighbo/.test(t) ? hc : null);
  // abroad keeps its real distance: a blank dist1 is what most of the dataset's online orders have
  if ((city && city.foreign) || (!city && /abroad|overseas|international/.test(t)))
    return { id: "reshipper", dist1: (city && miles(city, hc)) || 4000, toYou: true, physical: true, abroad: true, label: String(text).trim() };
  const d = city ? miles(city, hc) : 25;
  return { id: "mule", dist1: Math.max(2, city === hc ? 4 + (t.length % 9) : d), toYou: true, physical: true, label: String(text).trim(), city: city ? city.name : null };
}

/* when: "3am", "15:00", "lunch", "tomorrow", "next week"; repeats a few days apart */
function parseWhen(text) {
  const t = norm(text);
  let waitDays = /next week|in a week/.test(t) ? 7 : /tomorrow/.test(t) ? 1 : (num(t.match(/(\d+)\s*days?/)?.[0]) || 0);
  let hour = null;
  const m = t.match(/(\d{1,2})(?::(\d\d))?\s*(am|pm)?/);
  if (m && !/days?/.test(t.slice(m.index, m.index + m[0].length + 5))) { hour = +m[1] % 24; if (m[3] === "pm" && hour < 12) hour += 12; if (m[3] === "am" && hour === 12) hour = 0; }
  else if (/midnight/.test(t)) hour = 0; else if (/night|late/.test(t)) hour = 3; else if (/morning|breakfast/.test(t)) hour = 8;
  else if (/lunch|noon/.test(t)) hour = 12; else if (/afternoon/.test(t)) hour = 15; else if (/evening|dinner/.test(t)) hour = 19;
  return { waitDays, hour, label: String(text || "").trim() || "right now" };
}

/* the checkout answers → the orders Gus scores. `repeat` orders, `gap` days apart */
function buildFromInput(level, holder, input) {
  const n = Math.max(1, Math.min(5, Math.round(num(input.repeat) || 1)));
  return Array.from({ length: n }, (_, k) => ({ in: input, k }));
}
function factsFromInput(level, holder, input, k, opts = {}) {
  const shop = SHOPS[level];
  const item = parseItem(shop, input.item, input.price);
  const em = parseEmail(input.name, input.email, holder);
  const card = holder.card;
  const where = parseWhere(input.where, holder);
  const ship = parseShip(input.ship, item, holder, em);
  const when = parseWhen(input.when);
  const gap = Math.max(0, Math.min(30, num(input.gap) ?? 0));
  const dev = parseDevice(input.device);
  const usual = HOLDER_DEVICES[holder.phone];
  return {
    shop, card, item, dev, usual, amount: item.price, perks: opts.perks || [],
    email: { ...em, sub: "" }, emailDomain: em.domain, emailAddr: em.address,
    proxy: { id23: where.id23, dist2: where.dist2, label: where.label, foreign: where.foreign },
    ship, clock: { waitDays: k === 0 ? when.waitDays : gap, hour: k === 0 ? when.hour : (gap ? when.hour : null), label: k === 0 ? when.label : gap ? `${gap} day${gap > 1 ? "s" : ""} later` : "right after" },
    deviceKey: dev.key, addressKey: ship.id === "billing" ? "billing-" + holder.addr1 : ship.physical ? "addr-" + norm(ship.label).replace(/[^a-z0-9]/g, "").slice(0, 30) : null,
    nameMatches: em.nameMatches, oddDomain: em.odd && !em.risky,
  };
}

/* what Gus remembers about a trick that fooled him: a few coarse fields of its row */
function signature(row) {
  const b = (v, steps) => v == null ? "na" : steps.findIndex(s => v <= s);
  return [row.P_emaildomain, row.DeviceInfo, row.ProductCD, b(row.TransactionAmt, [5, 20, 50, 100, 200, 400, 700, 1000, 1e9]), b(row.dist1, [0, 5, 15, 40, 100, 500, 1e9]),
    b(row.dist2, [5, 20, 100, 500, 1500, 1e9]), row.id_23 || "none", Math.floor(((row.TransactionDT % 86400) / 3600) / 4), row.M2, row.R_emaildomain || "none", row.card4];
}
const similarity = (a, b) => a.reduce((n, v, i) => n + (v === b[i] ? 1 : 0), 0) / a.length;

window.ForgedOrders = {
  SHOPS, HOLDERS, TOOLS, SCHEMES, CARDS, EMAILS, PROXIES, DEVICES, SHIPS, CLOCKS, HOLDER_DEVICES,
  TELL_LABELS, TELL_BOX, MEMOS, COLUMNS,
  find, optionFor, itemOf, shipOptions, fixShip, facts, newHistory, toRows, remember, judgeOrders,
  RANKS, rankFor, PERSONAS, WHENS, WHERES, TRICKS, TWEAKS, dealHand, buildCampaign,
  CITIES, PLAYER_HOME, findCity, parseItem, parseEmail, parseDevice, parseWhere, parseShip, parseWhen, buildFromInput, signature, similarity,
};
})();
