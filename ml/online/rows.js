/* Typed checkouts → IEEE-CIS rows, by the game's own code (prototype/orders.js), in one batch.
 *
 *   echo '[{"input": {...}, "holder": 0, "card": 1, "level": 1, "session": "s1"}]' | node ml/online/rows.js
 *
 * Each item is one round on a fresh history. Prints one JSON row per order with `attack` (the
 * item's index) and `value` (what the order pays the player: 0 when the loot doesn't reach them).
 * Unset answers default to the Rookie starter kit, like the game (the victim's login, phone, city).
 *
 * Used by robustness.py so the red-team search scores exactly the rows the game would produce.
 */
globalThis.window = globalThis;
require("../../prototype/orders.js");
const O = window.ForgedOrders;

let seed = 7;
Math.random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

const items = JSON.parse(require("fs").readFileSync(0, "utf8"));
const out = [];
items.forEach((it, i) => {
  const h = O.HOLDERS[(it.holder ?? i) % O.HOLDERS.length];
  const holder = { ...h, card: O.CARDS[(it.card ?? 0) % O.CARDS.length] };
  const level = it.level || 1;
  const input = { item: "", price: "", name: h.name, email: h.email, device: h.phone === "iphone" ? "iPhone" : "Samsung Galaxy",
    where: h.city.split(",")[0], ship: "", when: "", repeat: "", gap: "", ...it.input };
  const orders = O.buildFromInput(level, holder, input);
  const rows = O.toRows({ level, holder, orders, hist: O.newHistory(), session: it.session || `batch-${i}`, round: 1,
    scheme: "robustness", campaign: it.session || `batch-${i}`, perks: [] });
  rows.forEach((r, k) => {
    const f = O.facts(level, holder, orders[k]);
    out.push(JSON.stringify({ ...r, attack: i, value: f.ship.toYou ? f.amount : 0 }));
  });
});
process.stdout.write(out.join("\n") + "\n");
