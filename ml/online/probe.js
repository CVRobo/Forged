/* Score hand-written checkouts: node ml/online/probe.js '<json list of inputs>' prints their rows as JSON lines */
globalThis.window = globalThis;
require("../../prototype/orders.js");
const O = window.ForgedOrders;
const inputs = JSON.parse(process.argv[2]);
inputs.forEach((input, i) => {
  const holder = { ...O.HOLDERS[i % O.HOLDERS.length], card: O.CARDS[0] };
  const full = { item: "", price: "", name: "", email: "", device: "", where: "", ship: "", when: "", repeat: "", gap: "", ...input };
  if (!full.email) full.email = holder.email.replace("@", "1@");
  const orders = O.buildFromInput(1, holder, full);
  const rows = O.toRows({ level: 1, holder, orders, hist: O.newHistory(), session: "probe-" + i, round: 1, scheme: "probe", campaign: "probe", perks: [] });
  rows.forEach(r => console.log(JSON.stringify({ ...r, probe: i })));
});
