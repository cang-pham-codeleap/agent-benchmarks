"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const ws = path.resolve(process.env.ACH_WORKSPACE || process.cwd());
const srcDir = path.join(ws, "src");
const MODULES = ["users", "billing", "orders", "shared"];
const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 1);
let failed = 0;
let count = 0;
function t(name, fn) {
  count++;
  try {
    fn();
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + ": " + String((e && e.message) || e).split("\n")[0]);
  }
}
process.on("exit", () => {
  if (failed > 0) process.exitCode = 1;
});

// ---------- static require graph, walked from src/app.js ----------
const builtins = new Set(Module.builtinModules.flatMap((m) => [m, "node:" + m]));
const modOf = (file) => {
  const rel = path.relative(srcDir, file).split(path.sep);
  return rel.length > 1 && MODULES.includes(rel[0]) ? rel[0] : null;
};
function resolveRel(spec, from) {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, base + ".js", base + ".cjs", path.join(base, "index.js")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}
const graph = new Map(); // file -> [{spec, target|null, kind}]
const staticErrors = [];
function crawl(file) {
  if (graph.has(file)) return;
  const text = fs.readFileSync(file, "utf8");
  const edges = [];
  graph.set(file, edges);
  const re = /require\(\s*(?:(['"`])([^'"`]+)\1|([^)]*))\)/g;
  let m;
  while ((m = re.exec(text))) {
    const rel = path.relative(ws, file);
    if (m[3] !== undefined) {
      staticErrors.push(`${rel}: non-literal require(${m[3].trim()})`);
      continue;
    }
    const spec = m[2];
    if (builtins.has(spec)) continue;
    if (!spec.startsWith(".")) {
      staticErrors.push(`${rel}: requires package "${spec}"`);
      continue;
    }
    const target = resolveRel(spec, file);
    if (!target) {
      staticErrors.push(`${rel}: cannot resolve "${spec}"`);
      continue;
    }
    edges.push({ spec, target });
    crawl(target);
  }
}
const entry = path.join(srcDir, "app.js");
if (fs.existsSync(entry)) crawl(entry);

t("static: src/app.js exists and every require resolves to a local file or built-in", () => {
  assert.ok(fs.existsSync(entry), "src/app.js missing");
  assert.deepEqual(staticErrors, []);
});
t("static: all four modules are reachable and each has an index.js", () => {
  for (const m of MODULES) {
    assert.ok(fs.existsSync(path.join(srcDir, m, "index.js")), `src/${m}/index.js missing`);
    assert.ok([...graph.keys()].some((f) => modOf(f) === m), `module ${m} not reachable from src/app.js`);
  }
});
t("static: cross-module requires target only another module's index.js", () => {
  const bad = [];
  for (const [file, edges] of graph) {
    const from = modOf(file);
    for (const { spec, target } of edges) {
      const to = modOf(target);
      if (to && to !== from && target !== path.join(srcDir, to, "index.js")) {
        bad.push(`${path.relative(ws, file)} -> ${spec}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
t("static: nothing outside src/<module>/ requires a module's internals", () => {
  const bad = [];
  for (const [file, edges] of graph) {
    if (modOf(file)) continue;
    for (const { spec, target } of edges) {
      const to = modOf(target);
      if (to && target !== path.join(srcDir, to, "index.js")) bad.push(`${path.relative(ws, file)} -> ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});
t("static: shared/ requires no other module", () => {
  const bad = [];
  for (const [file, edges] of graph) {
    if (modOf(file) !== "shared") continue;
    for (const { spec, target } of edges) {
      if (modOf(target) !== "shared") bad.push(`${path.relative(ws, file)} -> ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});
t("static: no dependency cycles between modules", () => {
  const deps = new Map(MODULES.map((m) => [m, new Set()]));
  for (const [file, edges] of graph) {
    const from = modOf(file);
    if (!from) continue;
    for (const { target } of edges) {
      const to = modOf(target);
      if (to && to !== from) deps.get(from).add(to);
    }
  }
  const state = new Map();
  const stack = [];
  const visit = (m) => {
    if (state.get(m) === 2) return;
    if (state.get(m) === 1) throw new Error("cycle: " + [...stack.slice(stack.indexOf(m)), m].join(" -> "));
    state.set(m, 1);
    stack.push(m);
    for (const d of deps.get(m)) visit(d);
    stack.pop();
    state.set(m, 2);
  };
  for (const m of MODULES) visit(m);
});
t("static: no global or globalThis state in reachable source", () => {
  const bad = [...graph.keys()].filter((f) => /\bglobalThis\b|\bglobal\s*[.[]/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(bad.map((f) => path.relative(ws, f)), []);
});

// ---------- behavior ----------
let createApp;
try {
  ({ createApp } = require(entry));
} catch (e) {
  console.log("FAIL load: " + e.message);
  process.exit(1);
}
function ctr(global) {
  const per = {};
  let n = 0;
  return { next: (p) => (global ? `${p}-${++n}` : `${p}-${(per[p] = (per[p] || 0) + 1)}`) };
}
function mk(opts = {}) {
  const clock = { t: T0, now() { return this.t; } };
  const app = createApp({ clock, ids: ctr(opts.global) });
  return { app, clock, day(n) { clock.t = T0 + n * DAY; } };
}
const iso = (ms) => new Date(ms).toISOString();
const code = (c) => (e) => e && e.code === c && e instanceof Error;
const item = (sku, qty, priceCents) => ({ sku, qty, priceCents });
const ann = (app, plan) => app.signup({ email: "ann@example.com", name: "Ann", plan });

t("signup: returns the exact user record with defaults", () => {
  const { app } = mk();
  assert.deepEqual(app.signup({ email: "ann@example.com", name: "Ann" }), {
    id: "usr-1", email: "ann@example.com", name: "Ann", plan: "free", createdAt: iso(T0), planChangedAt: null,
  });
});
t("signup: email trimmed+lowercased, name trimmed, createdAt from the clock at call time", () => {
  const { app, day } = mk();
  day(3);
  const u = app.signup({ email: "  Bob@Example.COM ", name: "  Bob  ", plan: "pro" });
  assert.equal(u.email, "bob@example.com");
  assert.equal(u.name, "Bob");
  assert.equal(u.createdAt, iso(T0 + 3 * DAY));
  assert.equal(u.plan, "pro");
});
t("signup: duplicate email (any case) is CONFLICT and wastes no id", () => {
  const { app } = mk({ global: true });
  assert.equal(ann(app).id, "usr-1");
  assert.throws(() => app.signup({ email: "ANN@example.com", name: "X" }), code("CONFLICT"));
  assert.equal(app.signup({ email: "b@example.com", name: "B" }).id, "usr-2");
});
t("signup: invalid email / blank name / unknown plan are VALIDATION", () => {
  const { app } = mk();
  for (const bad of [
    { email: "nope", name: "A" }, { email: "a@b", name: "A" }, { email: 5, name: "A" },
    { email: "a@b.co", name: "  " }, { email: "a@b.co" }, { email: "a@b.co", name: "A", plan: "gold" },
    { email: "a@b.co", name: "A", plan: "toString" },
  ]) assert.throws(() => app.signup(bad), code("VALIDATION"), JSON.stringify(bad));
  assert.equal(ann(app).id, "usr-1");
});
t("getUser: unknown id is NOT_FOUND; returned objects are copies", () => {
  const { app } = mk();
  assert.throws(() => app.getUser("usr-9"), code("NOT_FOUND"));
  const u = ann(app);
  u.plan = "pro";
  u.name = "Hacked";
  const g = app.getUser("usr-1");
  g.email = "x@y.zz";
  assert.deepEqual(app.getUser("usr-1"), { id: "usr-1", email: "ann@example.com", name: "Ann", plan: "free", createdAt: iso(T0), planChangedAt: null });
});

t("order: exact record for a free user (qty * price summed, no discount)", () => {
  const { app, day } = mk();
  ann(app);
  day(2);
  const o = app.placeOrder("usr-1", [item("a", 3, 250), item("b", 1, 99)]);
  assert.deepEqual(o, {
    id: "ord-1", userId: "usr-1", items: [item("a", 3, 250), item("b", 1, 99)], subtotalCents: 849,
    discountPct: 0, totalCents: 849, status: "placed", placedAt: iso(T0 + 2 * DAY), invoiceId: null,
  });
});
t("order: basic gets 5% off, rounded half up (1999 -> 1899)", () => {
  const { app } = mk();
  ann(app, "basic");
  const o = app.placeOrder("usr-1", [item("a", 1, 1999)]);
  assert.equal(o.discountPct, 5);
  assert.equal(o.subtotalCents, 1999);
  assert.equal(o.totalCents, 1899);
});
t("order: pro gets 10% off, exact .5 rounds up (1005 -> 905)", () => {
  const { app } = mk();
  ann(app, "pro");
  assert.equal(app.placeOrder("usr-1", [item("a", 1, 1005)]).totalCents, 905);
});
t("order: discount follows the plan at placement time, not later", () => {
  const { app } = mk();
  ann(app, "basic");
  const first = app.placeOrder("usr-1", [item("a", 1, 1000)]);
  app.upgradePlan("usr-1", "pro");
  const second = app.placeOrder("usr-1", [item("a", 1, 1000)]);
  assert.equal(app.getOrder(first.id).totalCents, 950);
  assert.equal(second.totalCents, 900);
});
t("order: invalid items are VALIDATION and consume no id", () => {
  const { app } = mk({ global: true });
  ann(app);
  for (const bad of [
    [], "x", null, [item("", 1, 1)], [item("a", 0, 1)], [item("a", 1.5, 1)], [item("a", "2", 1)],
    [item("a", 1, -1)], [item("a", 1, 1.5)], [null], [item("a", 1, 1), item("b", -2, 1)],
  ]) assert.throws(() => app.placeOrder("usr-1", bad), code("VALIDATION"), JSON.stringify(bad));
  assert.equal(app.placeOrder("usr-1", [item("a", 1, 1)]).id, "ord-2");
});
t("order: unknown user is NOT_FOUND", () => {
  const { app } = mk();
  assert.throws(() => app.placeOrder("usr-1", [item("a", 1, 1)]), code("NOT_FOUND"));
});
t("order: zero-priced items are allowed (total 0)", () => {
  const { app } = mk();
  ann(app);
  assert.equal(app.placeOrder("usr-1", [item("free", 2, 0)]).totalCents, 0);
});
t("order: extra item fields are dropped from the stored order", () => {
  const { app } = mk();
  ann(app);
  const o = app.placeOrder("usr-1", [{ sku: "a", qty: 1, priceCents: 10, secret: "x" }]);
  assert.deepEqual(o.items, [item("a", 1, 10)]);
});
t("order: the caller's items array is not retained by reference", () => {
  const { app } = mk();
  ann(app);
  const items = [item("a", 1, 100)];
  const o = app.placeOrder("usr-1", items);
  items[0].qty = 99;
  o.items[0].priceCents = 1;
  assert.deepEqual(app.getOrder(o.id).items, [item("a", 1, 100)]);
  assert.equal(app.getOrder(o.id).totalCents, 100);
});
t("credit: free limit 5000 is inclusive; one cent over is CREDIT_LIMIT and changes nothing", () => {
  const { app } = mk({ global: true });
  ann(app);
  app.placeOrder("usr-1", [item("a", 1, 3000)]);
  assert.throws(() => app.placeOrder("usr-1", [item("a", 1, 2001)]), code("CREDIT_LIMIT"));
  assert.equal(app.listOrders("usr-1").length, 1);
  const o = app.placeOrder("usr-1", [item("a", 1, 2000)]);
  assert.equal(o.id, "ord-3");
  assert.deepEqual(app.creditStatus("usr-1"), { limitCents: 5000, usedCents: 5000, availableCents: 0 });
  assert.throws(() => app.placeOrder("usr-1", [item("a", 1, 1)]), code("CREDIT_LIMIT"));
});
t("credit: the check uses the discounted total (basic, limit 20000)", () => {
  const { app } = mk();
  ann(app, "basic");
  assert.equal(app.placeOrder("usr-1", [item("a", 1, 21053)]).totalCents, 20000);
  assert.throws(() => app.placeOrder("usr-1", [item("a", 1, 1)]), code("CREDIT_LIMIT"));
});
t("credit: cancelling an order frees its credit", () => {
  const { app } = mk();
  ann(app);
  const o = app.placeOrder("usr-1", [item("a", 1, 5000)]);
  app.cancelOrder(o.id);
  assert.deepEqual(app.creditStatus("usr-1"), { limitCents: 5000, usedCents: 0, availableCents: 5000 });
  app.placeOrder("usr-1", [item("a", 1, 5000)]);
});
t("credit: invoiced-but-unpaid orders still count; paying releases them", () => {
  const { app } = mk();
  ann(app);
  app.placeOrder("usr-1", [item("a", 1, 4000)]);
  const inv = app.generateInvoice("usr-1");
  assert.equal(app.creditStatus("usr-1").usedCents, 4000);
  assert.throws(() => app.placeOrder("usr-1", [item("a", 1, 1001)]), code("CREDIT_LIMIT"));
  app.payInvoice(inv.id);
  assert.deepEqual(app.creditStatus("usr-1"), { limitCents: 5000, usedCents: 0, availableCents: 5000 });
});
t("credit: usage is per user and the limit grows with an upgrade", () => {
  const { app } = mk();
  ann(app);
  app.signup({ email: "bo@example.com", name: "Bo" });
  app.placeOrder("usr-1", [item("a", 1, 5000)]);
  app.placeOrder("usr-2", [item("a", 1, 5000)]);
  assert.throws(() => app.placeOrder("usr-1", [item("a", 1, 1)]), code("CREDIT_LIMIT"));
  app.upgradePlan("usr-1", "basic");
  assert.deepEqual(app.creditStatus("usr-1"), { limitCents: 20000, usedCents: 5000, availableCents: 15000 });
  assert.equal(app.placeOrder("usr-1", [item("a", 1, 10000)]).totalCents, 9500);
});
t("credit: creditStatus for an unknown user is NOT_FOUND", () => {
  const { app } = mk();
  assert.throws(() => app.creditStatus("usr-3"), code("NOT_FOUND"));
});
t("cancel: only placed orders; unknown id NOT_FOUND; double cancel and invoiced are CONFLICT", () => {
  const { app } = mk();
  ann(app);
  const a = app.placeOrder("usr-1", [item("a", 1, 100)]);
  const b = app.placeOrder("usr-1", [item("a", 1, 200)]);
  assert.equal(app.cancelOrder(a.id).status, "cancelled");
  assert.throws(() => app.cancelOrder(a.id), code("CONFLICT"));
  assert.throws(() => app.cancelOrder("ord-99"), code("NOT_FOUND"));
  app.generateInvoice("usr-1");
  assert.throws(() => app.cancelOrder(b.id), code("CONFLICT"));
  assert.equal(app.getOrder(b.id).status, "invoiced");
});
t("listOrders: creation order, per user, copies; unknown user NOT_FOUND", () => {
  const { app } = mk();
  ann(app);
  app.signup({ email: "bo@example.com", name: "Bo" });
  app.placeOrder("usr-1", [item("a", 1, 1)]);
  app.placeOrder("usr-2", [item("a", 1, 2)]);
  app.placeOrder("usr-1", [item("a", 1, 3)]);
  const l = app.listOrders("usr-1");
  assert.deepEqual(l.map((o) => o.id), ["ord-1", "ord-3"]);
  l[0].status = "paid";
  l.pop();
  assert.deepEqual(app.listOrders("usr-1").map((o) => o.status), ["placed", "placed"]);
  assert.throws(() => app.listOrders("usr-7"), code("NOT_FOUND"));
  assert.throws(() => app.getOrder("ord-77"), code("NOT_FOUND"));
});

t("upgrade: free -> basic on day 0 charges the full month (30/30 days)", () => {
  const { app, day } = mk();
  ann(app);
  day(0);
  const r = app.upgradePlan("usr-1", "basic");
  assert.deepEqual(r, {
    user: { id: "usr-1", email: "ann@example.com", name: "Ann", plan: "basic", createdAt: iso(T0), planChangedAt: iso(T0) },
    fromPlan: "free", toPlan: "basic", remainingDays: 30, creditCents: 0, chargeCents: 1499, netCents: 1499,
  });
});
t("upgrade: basic -> pro on day 10 (credit rounds down, charge rounds half up)", () => {
  const { app, day } = mk();
  ann(app, "basic");
  day(10);
  const r = app.upgradePlan("usr-1", "pro");
  assert.equal(r.remainingDays, 20);
  assert.equal(r.creditCents, 999);
  assert.equal(r.chargeCents, 3267);
  assert.equal(r.netCents, 2268);
  assert.equal(app.getUser("usr-1").plan, "pro");
  assert.equal(app.getUser("usr-1").planChangedAt, iso(T0 + 10 * DAY));
});
t("upgrade: proration uses the position inside the current 30-day period", () => {
  const cases = [
    [29, "free", "pro", 1, 0, 163], [30, "free", "basic", 30, 0, 1499], [35, "basic", "pro", 25, 1249, 4083],
    [59, "basic", "pro", 1, 49, 163], [60, "basic", "pro", 30, 1499, 4900], [10.9, "free", "basic", 20, 0, 999],
  ];
  for (const [d, from, to, rem, credit, charge] of cases) {
    const { app, day } = mk();
    ann(app, from);
    day(d);
    const r = app.upgradePlan("usr-1", to);
    assert.deepEqual([r.remainingDays, r.creditCents, r.chargeCents, r.netCents], [rem, credit, charge, charge - credit], `day ${d}`);
  }
});
t("upgrade: a clock earlier than signup is treated as day 0", () => {
  const { app, clock } = mk();
  ann(app);
  clock.t = T0 - 5 * DAY;
  const r = app.upgradePlan("usr-1", "basic");
  assert.equal(r.remainingDays, 30);
  assert.equal(r.netCents, 1499);
});
t("upgrade: downgrade, same plan, unknown plan are VALIDATION and leave the user untouched", () => {
  const { app } = mk();
  ann(app, "basic");
  for (const p of ["free", "basic", "gold", undefined]) assert.throws(() => app.upgradePlan("usr-1", p), code("VALIDATION"), String(p));
  assert.deepEqual(app.getUser("usr-1").plan, "basic");
  assert.equal(app.getUser("usr-1").planChangedAt, null);
  assert.throws(() => app.upgradePlan("usr-5", "pro"), code("NOT_FOUND"));
  assert.equal(app.generateInvoice("usr-1").lines.length, 1);
});
t("upgrade: the returned user is a copy", () => {
  const { app } = mk();
  ann(app);
  const r = app.upgradePlan("usr-1", "basic");
  r.user.plan = "pro";
  assert.equal(app.getUser("usr-1").plan, "basic");
});

t("invoice: subscription + orders, tax on orders only, summed once", () => {
  const { app, day } = mk({ global: true });
  ann(app, "basic");
  app.placeOrder("usr-1", [item("a", 2, 1000)]);
  app.placeOrder("usr-1", [item("b", 1, 333)]);
  day(4);
  const inv = app.generateInvoice("usr-1");
  assert.deepEqual(inv, {
    id: "inv-4", userId: "usr-1",
    lines: [
      { type: "subscription", ref: "basic", amountCents: 1499 },
      { type: "order", ref: "ord-2", amountCents: 1900 },
      { type: "order", ref: "ord-3", amountCents: 316 },
    ],
    subtotalCents: 3715, taxCents: 183, totalCents: 3898, status: "open", issuedAt: iso(T0 + 4 * DAY), paidAt: null,
  });
});
t("invoice: tax rounds once on the order sum (500+500 -> 83, not 82)", () => {
  const { app } = mk();
  ann(app);
  app.placeOrder("usr-1", [item("a", 1, 500)]);
  app.placeOrder("usr-1", [item("a", 1, 500)]);
  const inv = app.generateInvoice("usr-1");
  assert.deepEqual([inv.subtotalCents, inv.taxCents, inv.totalCents], [1000, 83, 1083]);
});
t("invoice: upgrade adjustment is untaxed and listed before orders", () => {
  const { app, day } = mk();
  ann(app);
  day(10);
  app.upgradePlan("usr-1", "pro");
  app.placeOrder("usr-1", [item("a", 1, 1000)]);
  const inv = app.generateInvoice("usr-1");
  assert.deepEqual(inv.lines, [
    { type: "adjustment", ref: "free->pro", amountCents: 3267 },
    { type: "order", ref: "ord-1", amountCents: 900 },
  ]);
  assert.deepEqual([inv.subtotalCents, inv.taxCents, inv.totalCents], [4167, 74, 4241]);
});
t("invoice: basic -> pro keeps the subscription line and adds one adjustment", () => {
  const { app, day } = mk();
  ann(app, "basic");
  day(10);
  app.upgradePlan("usr-1", "pro");
  const inv = app.generateInvoice("usr-1");
  assert.deepEqual(inv.lines, [
    { type: "subscription", ref: "basic", amountCents: 1499 },
    { type: "adjustment", ref: "basic->pro", amountCents: 2268 },
  ]);
  assert.deepEqual([inv.subtotalCents, inv.taxCents, inv.totalCents], [3767, 0, 3767]);
});
t("invoice: free signup + free plan + nothing ordered is CONFLICT; so is a repeat", () => {
  const { app } = mk({ global: true });
  ann(app);
  assert.throws(() => app.generateInvoice("usr-1"), code("CONFLICT"));
  app.placeOrder("usr-1", [item("a", 1, 100)]);
  const inv = app.generateInvoice("usr-1");
  assert.equal(inv.id, "inv-3");
  assert.throws(() => app.generateInvoice("usr-1"), code("CONFLICT"));
  assert.equal(app.placeOrder("usr-1", [item("a", 1, 100)]).id, "ord-4");
});
t("invoice: cancelled orders are not billed; a cancelled-only user has nothing to invoice", () => {
  const { app } = mk();
  ann(app);
  const a = app.placeOrder("usr-1", [item("a", 1, 100)]);
  app.placeOrder("usr-1", [item("a", 1, 200)]);
  app.cancelOrder(a.id);
  assert.deepEqual(app.generateInvoice("usr-1").lines.map((l) => l.ref), ["ord-2"]);
  const b = app.placeOrder("usr-1", [item("a", 1, 100)]);
  app.cancelOrder(b.id);
  assert.throws(() => app.generateInvoice("usr-1"), code("CONFLICT"));
});
t("invoice: orders become invoiced with the invoice id; later orders go on the next invoice", () => {
  const { app } = mk();
  ann(app);
  const o1 = app.placeOrder("usr-1", [item("a", 1, 100)]);
  const i1 = app.generateInvoice("usr-1");
  assert.deepEqual([app.getOrder(o1.id).status, app.getOrder(o1.id).invoiceId], ["invoiced", i1.id]);
  const o2 = app.placeOrder("usr-1", [item("a", 1, 100)]);
  const i2 = app.generateInvoice("usr-1");
  assert.deepEqual(i2.lines.map((l) => l.ref), [o2.id]);
  assert.equal(i2.id, "inv-2");
});
t("invoice: only that user's orders and pending lines are billed", () => {
  const { app } = mk();
  ann(app, "basic");
  app.signup({ email: "bo@example.com", name: "Bo", plan: "pro" });
  app.placeOrder("usr-1", [item("a", 1, 100)]);
  app.placeOrder("usr-2", [item("a", 1, 100)]);
  const i2 = app.generateInvoice("usr-2");
  assert.deepEqual(i2.lines.map((l) => l.ref), ["pro", "ord-2"]);
  assert.equal(app.generateInvoice("usr-1").lines.length, 2);
  assert.throws(() => app.generateInvoice("usr-9"), code("NOT_FOUND"));
});
t("invoice: pay -> paid with paidAt; orders become paid; double pay CONFLICT; unknown NOT_FOUND", () => {
  const { app, day } = mk();
  ann(app, "basic");
  const o = app.placeOrder("usr-1", [item("a", 1, 100)]);
  const inv = app.generateInvoice("usr-1");
  day(2);
  const paid = app.payInvoice(inv.id);
  assert.deepEqual([paid.status, paid.paidAt], ["paid", iso(T0 + 2 * DAY)]);
  assert.equal(app.getOrder(o.id).status, "paid");
  assert.throws(() => app.payInvoice(inv.id), code("CONFLICT"));
  assert.throws(() => app.payInvoice("inv-9"), code("NOT_FOUND"));
  assert.throws(() => app.getInvoice("inv-9"), code("NOT_FOUND"));
  assert.throws(() => app.cancelOrder(o.id), code("CONFLICT"));
});
t("invoice: getInvoice/listInvoices return copies in creation order, per user", () => {
  const { app } = mk();
  ann(app);
  app.signup({ email: "bo@example.com", name: "Bo" });
  app.placeOrder("usr-1", [item("a", 1, 100)]);
  const i1 = app.generateInvoice("usr-1");
  app.placeOrder("usr-2", [item("a", 1, 100)]);
  app.generateInvoice("usr-2");
  app.placeOrder("usr-1", [item("a", 1, 100)]);
  app.generateInvoice("usr-1");
  i1.status = "paid";
  i1.lines.length = 0;
  const list = app.listInvoices("usr-1");
  assert.deepEqual(list.map((i) => i.id), ["inv-1", "inv-3"]);
  assert.equal(list[0].status, "open");
  assert.equal(list[0].lines.length, 1);
  list[0].status = "paid";
  assert.equal(app.getInvoice("inv-1").status, "open");
  assert.throws(() => app.listInvoices("usr-9"), code("NOT_FOUND"));
});
t("ids: one shared generator is consumed in call order, never for failed operations", () => {
  const { app } = mk({ global: true });
  assert.equal(ann(app, "free").id, "usr-1");
  assert.equal(app.placeOrder("usr-1", [item("a", 1, 100)]).id, "ord-2");
  assert.throws(() => app.placeOrder("usr-1", [item("a", 1, 99999)]), code("CREDIT_LIMIT"));
  assert.equal(app.placeOrder("usr-1", [item("a", 1, 100)]).id, "ord-3");
  assert.equal(app.generateInvoice("usr-1").id, "inv-4");
  assert.throws(() => app.generateInvoice("usr-1"), code("CONFLICT"));
  assert.equal(app.signup({ email: "z@example.com", name: "Z" }).id, "usr-5");
});

// ---------- instance isolation ----------
t("isolation: two apps do not share users, orders, invoices or id sequences", () => {
  const A = mk();
  const B = mk();
  ann(A.app, "basic");
  assert.throws(() => B.app.getUser("usr-1"), code("NOT_FOUND"));
  assert.equal(ann(B.app).plan, "free"); // same email is fine in another app
  A.app.placeOrder("usr-1", [item("a", 1, 100)]);
  assert.deepEqual(B.app.listOrders("usr-1"), []);
  assert.throws(() => B.app.generateInvoice("usr-1"), code("CONFLICT"));
  assert.equal(A.app.generateInvoice("usr-1").id, "inv-1");
  assert.deepEqual(B.app.listInvoices("usr-1"), []);
  assert.deepEqual(B.app.creditStatus("usr-1"), { limitCents: 5000, usedCents: 0, availableCents: 5000 });
});
t("isolation: interleaved operations keep per-app clocks, plans and credit separate", () => {
  const A = mk();
  const B = mk();
  A.day(0);
  B.day(40);
  const ua = ann(A.app);
  const ub = ann(B.app);
  assert.equal(ua.createdAt, iso(T0));
  assert.equal(ub.createdAt, iso(T0 + 40 * DAY));
  A.app.upgradePlan("usr-1", "pro");
  assert.equal(B.app.getUser("usr-1").plan, "free");
  A.app.placeOrder("usr-1", [item("a", 1, 90000)]);
  assert.throws(() => B.app.placeOrder("usr-1", [item("a", 1, 6000)]), code("CREDIT_LIMIT"));
  B.day(55);
  assert.equal(B.app.upgradePlan("usr-1", "basic").remainingDays, 15);
});
t("isolation: a failed call in one app leaves the other unaffected", () => {
  const A = mk();
  const B = mk();
  ann(A.app);
  ann(B.app);
  assert.throws(() => A.app.signup({ email: "ann@example.com", name: "Dup" }), code("CONFLICT"));
  assert.equal(B.app.signup({ email: "c@example.com", name: "C" }).id, "usr-2");
  assert.equal(A.app.signup({ email: "c@example.com", name: "C" }).id, "usr-2");
});
t("default wiring: createApp() works with the system clock and per-app ids", () => {
  const a = createApp();
  const b = createApp();
  const before = Date.now();
  const u = a.signup({ email: "d@example.com", name: "D" });
  assert.equal(u.id, "usr-1");
  assert.ok(Date.parse(u.createdAt) >= before - 1 && Date.parse(u.createdAt) <= Date.now() + 1);
  assert.equal(b.signup({ email: "d@example.com", name: "D" }).id, "usr-1");
  assert.equal(a.placeOrder("usr-1", [item("a", 1, 10)]).id, "ord-1");
});

console.log(`\n${count - failed}/${count} passed`);
