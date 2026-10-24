/* Simulated players: typed checkouts built by the game's own code (prototype/orders.js),
 * so the rows have exactly the shape real players send. Used to test the retrain loop
 * and the reports before real players arrive. Rows have origin "simulated".
 *
 * "honest" mode makes the cardholders' own orders in the same format (isFraud 0): their
 * email, their usual phone or a laptop, from their own city, shipped home. Without them, the
 * model would learn "looks like the game" instead of "looks like fraud". The base rates
 * (how often honest people use a VPN, ship elsewhere, shop at night) are guesses.
 *
 *   node ml/online/simulate.js [sessions=300] [seed=1] [players|honest] > rows.jsonl
 */
globalThis.window = globalThis;
require("../../prototype/orders.js");
const O = window.ForgedOrders;

const sessions = +(process.argv[2] || 300);
let seed = +(process.argv[3] || 1);
const honest = process.argv[4] === "honest";
const clever = process.argv[4] === "clever"; // players who found the quiet options: the victim's account, nearby drops
// a seeded Math.random, so a run is reproducible (orders.js uses Math.random too)
Math.random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = a => a[Math.floor(Math.random() * a.length)];

/* one round's typed answers. care (0-1): a careful player picks the quiet options */
function answers(level, h, care) {
  const city = h.city.split(",")[0], first = h.name.split(" ")[0].toLowerCase(), last = h.name.split(" ")[1].toLowerCase();
  const quiet = Math.random() < care;
  const shop = O.SHOPS[level];
  const item = pick(shop.catalog.filter(i => i.cd !== "S").map(i => i.name).concat(["PS5", "iPhone 15", "$200 Steam gift card", "AirPods", "Gaming laptop", "Rolex"]));
  const loud = {
    name: ["Alex Smith", "Jordan Lee", h.name],
    email: [`${first}${last[0]}@protonmail.com`, `deals4u_${h.addr1}@yahoo.com`, `x${h.addr1}@mail.ru`, `${first}.${last}${h.addr1 % 90}@gmail.com`],
    device: ["Android emulator", "Windows laptop", "Samsung Galaxy S9", "Linux PC"],
    where: ["Free VPN", "Tor", "London", "Lagos", "Moscow"],
    ship: ["Freight forwarder in Miami", "Warehouse in Rotterdam", "Hotel in Lagos", `PO box in ${city}`],
    when: ["3 AM", "Right now", "Friday night"],
    repeat: ["2", "3", "5"], gap: ["0", "1"],
  };
  const calm = {
    name: [h.name, `${h.name.split(" ")[0][0]}. ${h.name.split(" ")[1]}`],
    email: clever ? [h.email, h.email, `${first}.${last}${h.addr1 % 90}@gmail.com`] : [`${first}.${last}${h.addr1 % 90}@gmail.com`, `${last}.family@outlook.com`, h.email],
    device: clever ? [h.phone === "iphone" ? "iPhone 12" : "Samsung Galaxy S9", "MacBook Air"] : ["iPhone 12", "MacBook Air", "Windows laptop", "Samsung Galaxy S9"],
    where: ["Home", `VPN in ${city}`, city],
    ship: clever ? [`Cousin's garage in ${city}`, `PO box in ${city}`, `Locker in ${city}`] : [`Cousin's garage in ${city}`, `PO box in ${city}`, "Their home"],
    when: ["Tomorrow at lunch", "Next week", "Right now"],
    repeat: ["1", "1", "2"], gap: ["7", "3"],
  };
  // each answer is mostly from one pool, with some mixing, like a real player trying ideas
  const from = k => pick(Math.random() < (quiet ? 0.8 : 0.3) ? calm[k] : loud[k]);
  return { item, price: "", name: from("name"), email: from("email"), device: from("device"), where: from("where"),
    ship: from("ship"), when: from("when"), repeat: from("repeat"), gap: from("gap") };
}

/* the cardholder shopping for themself */
function honestAnswers(level, h) {
  const city = h.city.split(",")[0], first = h.name.split(" ")[0].toLowerCase(), last = h.name.split(" ")[1].toLowerCase();
  const near = O.CITIES.filter(c => !c.foreign && c.name !== city).map(c => c.name);
  const shop = O.SHOPS[level];
  const often = (p, a, b) => Math.random() < p ? a : b;
  const items = shop.catalog.filter(i => i.cd !== "S");
  const item = often(.9, pick(items).name, pick(["iPhone 15", "Gaming laptop", "AirPods", "$50 gift card"]));
  return {
    item, price: "", name: often(.9, h.name, `${h.name.split(" ")[0][0]}. ${h.name.split(" ")[1]}`),
    email: often(.7, h.email, pick([`${first}.${last}${h.addr1 % 90}@gmail.com`, `${last}.family@outlook.com`, `${first}${last}@icloud.com`])),
    device: often(.6, h.phone === "iphone" ? "iPhone 12" : "Samsung Galaxy S9", pick(["Windows laptop", "MacBook Air", "Windows laptop", "iPad tablet"])),
    where: often(.85, city, often(.3, `VPN in ${city}`, pick(near))),
    ship: often(.85, "Their home", pick([`Office in ${city}`, `PO box in ${city}`, `Mom's house in ${pick(near)}`])),
    when: often(.9, pick(["Right now", "Tomorrow at lunch", "7pm", "Next week", "10am"]), pick(["1am", "late night"])),
    repeat: often(.85, "1", "2"), gap: pick(["3", "7", "14"]),
  };
}

const out = [];
for (let s = 0; s < sessions; s++) {
  const level = pick([1, 2]), care = clever ? 0.95 : Math.random(), hist = O.newHistory();
  // an honest customer comes back with their own card; a ghost identity (deceased, synthetic, someone else's SSN) never shops
  const regular = { ...pick(O.HOLDERS.filter(h => !h.ghost)), card: pick(O.CARDS) };
  const rounds = 1 + Math.floor(Math.random() * 5);
  for (let round = 1; round <= rounds; round++) {
    const holder = honest ? regular : { ...pick(O.HOLDERS), card: pick(O.CARDS) };
    const input = honest ? honestAnswers(level, holder) : answers(level, holder, care);
    const orders = O.buildFromInput(level, holder, input);
    const ctx = { level, holder, orders, hist, session: `${honest ? "honest" : clever ? "clever" : "sim"}-${s}`, round, scheme: `typed-r${round}`, campaign: `sim-${s}-r${round}`, perks: [] };
    const rows = O.toRows(ctx);
    O.remember(hist, ctx, rows);
    rows.forEach(r => out.push(honest ? { ...r, isFraud: 0, origin: "simulated_honest", player: "", input }
      : { ...r, origin: "simulated", player: `${clever ? "clever" : "sim"}-${s % 60}`, verdict: null, input }));
  }
}
process.stdout.write(out.map(r => JSON.stringify(r)).join("\n") + "\n");
