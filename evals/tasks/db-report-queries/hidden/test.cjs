"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const ws = process.env.ACH_WORKSPACE || process.cwd();
const here = __dirname;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.message ? e.message.split("\n")[0] : e)); }
}
process.on("exit", () => { if (failed > 0) process.exitCode = 1; });

const rd = (p) => fs.readFileSync(p, "utf8");
const schema = rd(path.join(ws, "schema.sql"));
const seed = rd(path.join(ws, "seed.sql"));
const extra = rd(path.join(here, "extra.sql"));

const blocks = {};
{
  let cur = null;
  for (const line of rd(path.join(ws, "queries.sql")).split("\n")) {
    const m = /^--\s*name:\s*(\S+)\s*$/.exec(line);
    if (m) { cur = m[1]; blocks[cur] = []; } else if (cur) blocks[cur].push(line);
  }
  for (const k of Object.keys(blocks)) blocks[k] = blocks[k].join("\n").trim();
}

function mk(withExtra) {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  db.exec(seed);
  if (withExtra) db.exec(extra);
  return db;
}
function run(db, name, params = {}) {
  assert.ok(blocks[name], "missing block " + name);
  return db.prepare(blocks[name]).all(params).map((r) => ({ ...r }));
}

// ---- independent oracle in JS, computed from the rows ----
function model(db) {
  const all = (q) => db.prepare(q).all().map((r) => ({ ...r }));
  const orders = all("SELECT * FROM orders");
  const items = all("SELECT * FROM order_items");
  const refunds = all("SELECT * FROM refunds");
  const cust = all("SELECT * FROM customers");
  const prods = all("SELECT * FROM products");
  const cats = all("SELECT * FROM categories");
  const counted = new Map(orders.filter((o) => o.status === "paid" || o.status === "shipped").map((o) => [o.id, o]));
  const itemNet = (i) => i.quantity * i.unit_price_cents - refunds.filter((r) => r.order_item_id === i.id).reduce((s, r) => s + r.amount_cents, 0);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    monthly(year) {
      const out = [];
      for (let m = 1; m <= 12; m++) {
        const key = `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
        let s = 0;
        for (const i of items) { const o = counted.get(i.order_id); if (o && o.placed_at.slice(0, 7) === key) s += itemNet(i); }
        out.push({ month: key, net_cents: s });
      }
      return out;
    },
    top() {
      const net = new Map();
      for (const i of items) if (counted.has(i.order_id)) net.set(i.product_id, (net.get(i.product_id) ?? 0) + itemNet(i));
      const out = [];
      for (const c of cats) {
        const ps = prods.filter((p) => p.category_id === c.id && net.has(p.id)).map((p) => ({ product: p.name, net_cents: net.get(p.id) }));
        ps.sort((a, b) => b.net_cents - a.net_cents);
        for (const p of ps) {
          const rank = 1 + ps.filter((q) => q.net_cents > p.net_cents).length;
          if (rank <= 3) out.push({ category: c.name, product: p.product, net_cents: p.net_cents, rank });
        }
      }
      return out.sort((a, b) => cmp(a.category, b.category) || a.rank - b.rank || cmp(a.product, b.product));
    },
    repeat() {
      const day = (s) => Date.parse(s.slice(0, 10) + "T00:00:00Z") / 86400000;
      const co = new Map();
      for (const c of cust) {
        const k = c.signup_date.slice(0, 7);
        const row = co.get(k) ?? { cohort: k, customers: 0, buyers: 0, repeaters: 0, rate: null };
        row.customers++;
        const os = [...counted.values()].filter((o) => o.customer_id === c.id).sort((a, b) => cmp(a.placed_at, b.placed_at) || a.id - b.id);
        if (os.length) {
          row.buyers++;
          if (os.slice(1).some((o) => day(o.placed_at) - day(os[0].placed_at) <= 30)) row.repeaters++;
        }
        co.set(k, row);
      }
      return [...co.values()].map((r) => ({ ...r, rate: r.buyers ? Math.round((r.repeaters / r.buyers) * 1e4) / 1e4 : null })).sort((a, b) => cmp(a.cohort, b.cohort));
    },
    cross(th) {
      const out = [];
      for (const c of cust) {
        const os = [...counted.values()].filter((o) => o.customer_id === c.id).sort((a, b) => cmp(a.placed_at, b.placed_at) || a.id - b.id);
        let run = 0, at = null;
        for (const o of os) {
          run += items.filter((i) => i.order_id === o.id).reduce((s, i) => s + itemNet(i), 0);
          if (at === null && run >= th) at = o.placed_at.slice(0, 10);
        }
        if (os.length && run >= th) out.push({ customer_id: c.id, name: c.name, crossed_on: at, lifetime_net_cents: run });
      }
      return out.sort((a, b) => cmp(a.crossed_on, b.crossed_on) || a.customer_id - b.customer_id);
    },
  };
}

// ---- spot checks with hand-computed values on the shipped seed ----
t("block names present", () => {
  for (const n of ["monthly_net_revenue", "top_products_per_category", "repeat_purchase_rate", "threshold_crossings"]) assert.ok(blocks[n] && blocks[n].length > 0, n);
});
t("seed: monthly 2024 hand values", () => {
  const rows = run(mk(false), "monthly_net_revenue", { year: 2024 });
  const want = [8700, 4700, 6300, 1200, 6000, 0, 0, 0, 0, 0, 0, 0];
  assert.deepEqual(rows, want.map((n, i) => ({ month: "2024-" + String(i + 1).padStart(2, "0"), net_cents: n })));
});
t("seed: monthly other years (prior year, empty year)", () => {
  const db = mk(false);
  assert.deepEqual(run(db, "monthly_net_revenue", { year: 2023 }).map((r) => r.net_cents), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5000]);
  const empty = run(db, "monthly_net_revenue", { year: 2030 });
  assert.equal(empty.length, 12);
  assert.ok(empty.every((r) => r.net_cents === 0 && /^2030-\d\d$/.test(r.month)));
});
t("seed: top products hand values", () => {
  assert.deepEqual(run(mk(false), "top_products_per_category"), [
    { category: "Books", product: "Atlas", net_cents: 7500, rank: 1 },
    { category: "Books", product: "Novel", net_cents: 4000, rank: 2 },
    { category: "Books", product: "Primer", net_cents: 4000, rank: 2 },
    { category: "Games", product: "Chess", net_cents: 9000, rank: 1 },
    { category: "Games", product: "Cards", net_cents: 1600, rank: 2 },
    { category: "Toys", product: "Puzzle", net_cents: 2400, rank: 1 },
    { category: "Toys", product: "Robot", net_cents: 2000, rank: 2 },
  ]);
});
t("seed: repeat purchase hand values", () => {
  assert.deepEqual(run(mk(false), "repeat_purchase_rate"), [
    { cohort: "2023-12", customers: 2, buyers: 2, repeaters: 1, rate: 0.5 },
    { cohort: "2024-01", customers: 3, buyers: 2, repeaters: 1, rate: 0.5 },
    { cohort: "2024-02", customers: 2, buyers: 2, repeaters: 1, rate: 0.5 },
    { cohort: "2024-03", customers: 2, buyers: 2, repeaters: 1, rate: 0.5 },
    { cohort: "2024-04", customers: 1, buyers: 0, repeaters: 0, rate: null },
  ]);
});
t("seed: threshold crossings hand values", () => {
  assert.deepEqual(run(mk(false), "threshold_crossings", { threshold_cents: 5000 }), [
    { customer_id: 9, name: "Ivy", crossed_on: "2023-12-31", lifetime_net_cents: 5700 },
    { customer_id: 1, name: "Ann", crossed_on: "2024-01-10", lifetime_net_cents: 8000 },
    { customer_id: 10, name: "Jo", crossed_on: "2024-05-01", lifetime_net_cents: 6000 },
  ]);
});
t("seed: crossing date is the first order reaching the threshold", () => {
  const rows = run(mk(false), "threshold_crossings", { threshold_cents: 7000 });
  assert.deepEqual(rows.map((r) => [r.customer_id, r.crossed_on]), [[1, "2024-01-25"]]);
});

for (const withExtra of [false, true]) {
  const tag = withExtra ? "extra" : "seed";
  const db = mk(withExtra);
  const m = model(db);
  for (const y of [2023, 2024, 2025]) t(tag + ": monthly_net_revenue " + y, () => assert.deepEqual(run(db, "monthly_net_revenue", { year: y }), m.monthly(y)));
  t(tag + ": top_products_per_category", () => assert.deepEqual(run(db, "top_products_per_category"), m.top()));
  t(tag + ": repeat_purchase_rate", () => assert.deepEqual(run(db, "repeat_purchase_rate"), m.repeat()));
  for (const th of [1, 3000, 5000, 6000, 9000, 20000, 10000000]) t(tag + ": threshold_crossings " + th, () => assert.deepEqual(run(db, "threshold_crossings", { threshold_cents: th }), m.cross(th)));
}

t("extra: tied products share a rank and the next rank is skipped", () => {
  const rows = run(mk(true), "top_products_per_category").filter((r) => r.category === "Toys");
  assert.deepEqual(rows.map((r) => [r.product, r.rank]), [["Kite", 1], ["Ball", 2], ["Kazoo", 2]]);
});
t("extra: unsold product and empty category absent", () => {
  const rows = run(mk(true), "top_products_per_category");
  assert.ok(!rows.some((r) => r.product === "Zine" || r.category === "Empty"));
});
t("extra: year edges and refund attributed to order month", () => {
  const db = mk(true);
  assert.equal(run(db, "monthly_net_revenue", { year: 2024 })[11].net_cents, 1000);
  assert.equal(run(db, "monthly_net_revenue", { year: 2025 })[0].net_cents, 1500);
});
t("extra: equal timestamps count as a repeat purchase", () => {
  const r = run(mk(true), "repeat_purchase_rate").find((x) => x.cohort === "2024-05");
  assert.deepEqual(r, { cohort: "2024-05", customers: 2, buyers: 1, repeaters: 1, rate: 1 });
});
t("extra: fully refunded first order still counts, crossing on later order", () => {
  const rows = run(mk(true), "threshold_crossings", { threshold_cents: 1 });
  assert.deepEqual(rows.find((r) => r.customer_id === 16), { customer_id: 16, name: "Pia", crossed_on: "2024-08-20", lifetime_net_cents: 100 });
});
