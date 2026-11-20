"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ws = path.resolve(process.env.ACH_WORKSPACE || process.cwd());
const srcDir = path.join(ws, "src");

let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + ": " + (e && e.message ? e.message : String(e)));
  }
}
process.on("exit", () => {
  if (failed > 0) process.exitCode = 1;
});

// Helper clock
function createClock(initial = 1000000) {
  let cur = initial;
  return {
    now: () => cur,
    advance: (ms) => {
      cur += ms;
      return cur;
    },
    set: (t) => {
      cur = t;
    },
  };
}

(async function runAll() {
  // 1. Static import-graph rule
  await t("checkout.js does not import email, inventory, analytics or outbox", () => {
    const p = path.join(srcDir, "checkout.js");
    assert.ok(fs.existsSync(p), "checkout.js missing");
    const src = fs.readFileSync(p, "utf8");
    const badImports = ["email", "inventory", "analytics", "outbox"];
    for (const bad of badImports) {
      const re = new RegExp(`['"](\\./|\\.\\./)?${bad}(\\.js)?['"]`);
      assert.ok(!re.test(src), `checkout.js must not require ${bad}`);
    }
  });

  // Load modules
  const { createStore } = require(path.join(srcDir, "store.js"));
  const { createCheckout } = require(path.join(srcDir, "checkout.js"));
  const { createDispatcher } = require(path.join(srcDir, "outbox.js"));
  const { createEmailHandler } = require(path.join(srcDir, "email.js"));
  const { createInventoryHandler } = require(path.join(srcDir, "inventory.js"));
  const { createAnalyticsHandler } = require(path.join(srcDir, "analytics.js"));

  // 2. Checkout validation tests
  await t("checkout: invalid customer throws without saving order or event", () => {
    const store = createStore();
    const clock = createClock();
    const checkout = createCheckout({ store, now: clock.now });
    assert.throws(() => checkout.placeOrder({ customer: "", items: [{ sku: "A", qty: 1, price: 10 }] }));
    assert.throws(() => checkout.placeOrder({ customer: 123, items: [{ sku: "A", qty: 1, price: 10 }] }));
    assert.equal(store.countOrders(), 0);
    assert.equal(store.listEvents().length, 0);
  });

  await t("checkout: invalid items throws without saving", () => {
    const store = createStore();
    const clock = createClock();
    const checkout = createCheckout({ store, now: clock.now });
    assert.throws(() => checkout.placeOrder({ customer: "alice", items: [] }));
    assert.throws(() => checkout.placeOrder({ customer: "alice", items: [{ sku: "", qty: 1, price: 10 }] }));
    assert.throws(() => checkout.placeOrder({ customer: "alice", items: [{ sku: "A", qty: 0, price: 10 }] }));
    assert.throws(() => checkout.placeOrder({ customer: "alice", items: [{ sku: "A", qty: -1, price: 10 }] }));
    assert.throws(() => checkout.placeOrder({ customer: "alice", items: [{ sku: "A", qty: 1, price: -5 }] }));
    assert.throws(() => checkout.placeOrder({ customer: "alice", items: [{ sku: "A", qty: 1.5, price: 10 }] }));
    assert.equal(store.countOrders(), 0);
    assert.equal(store.listEvents().length, 0);
  });

  await t("checkout: valid order creates order and event atomically with correct fields", () => {
    const store = createStore();
    const clock = createClock(1700000000000);
    const checkout = createCheckout({ store, now: clock.now });
    const order = checkout.placeOrder({
      customer: "alice@example.com",
      items: [
        { sku: "item-1", qty: 2, price: 500 },
        { sku: "item-2", qty: 1, price: 1500 },
      ],
    });
    assert.equal(order.id, "ord-1");
    assert.equal(order.customer, "alice@example.com");
    assert.equal(order.total, 2500);
    assert.equal(order.createdAt, new Date(1700000000000).toISOString());

    const savedOrder = store.getOrder("ord-1");
    assert.deepEqual(savedOrder, order);

    const events = store.listEvents();
    assert.equal(events.length, 1);
    const ev = events[0];
    assert.equal(ev.id, "evt-ord-1");
    assert.equal(ev.type, "OrderPlaced");
    assert.equal(ev.createdAt, 1700000000000);
    assert.equal(ev.status, "pending");
    assert.deepEqual(ev.delivered, []);
    assert.deepEqual(ev.dead, []);
    assert.deepEqual(ev.attempts, {});
    assert.deepEqual(ev.nextAttemptAt, {});
    assert.deepEqual(ev.payload, { order });
  });

  await t("checkout: multiple orders increment IDs correctly", () => {
    const store = createStore();
    const clock = createClock(100);
    const checkout = createCheckout({ store, now: clock.now });
    const o1 = checkout.placeOrder({ customer: "c1", items: [{ sku: "A", qty: 1, price: 10 }] });
    const o2 = checkout.placeOrder({ customer: "c2", items: [{ sku: "B", qty: 1, price: 20 }] });
    assert.equal(o1.id, "ord-1");
    assert.equal(o2.id, "ord-2");
    assert.equal(store.countOrders(), 2);
    assert.equal(store.listEvents().length, 2);
  });

  // 3. Outbox dispatcher happy path
  await t("dispatcher: drains single event across all handlers and marks status done", async () => {
    const store = createStore();
    const clock = createClock(1000);
    const checkout = createCheckout({ store, now: clock.now });
    checkout.placeOrder({ customer: "c1", items: [{ sku: "A", qty: 1, price: 10 }] });

    const called = [];
    const handlers = {
      h1: (ev) => { called.push(["h1", ev.id]); },
      h2: async (ev) => { called.push(["h2", ev.id]); },
    };
    const dispatcher = createDispatcher({ store, handlers, now: clock.now });
    const res = await dispatcher.drain();
    assert.deepEqual(res, { delivered: 2, failed: 0 });
    assert.deepEqual(called, [
      ["h1", "evt-ord-1"],
      ["h2", "evt-ord-1"],
    ]);

    const ev = store.getEvent("evt-ord-1");
    assert.equal(ev.status, "done");
    assert.deepEqual(ev.delivered, ["h1", "h2"]);
    assert.deepEqual(ev.dead, []);
  });

  await t("dispatcher: event passed to handler does not leak mutable store state", async () => {
    const store = createStore();
    const clock = createClock(1000);
    const checkout = createCheckout({ store, now: clock.now });
    checkout.placeOrder({ customer: "c1", items: [{ sku: "A", qty: 1, price: 10 }] });

    let received;
    const dispatcher = createDispatcher({
      store,
      handlers: {
        inspect: (ev) => { received = ev; },
      },
      now: clock.now,
    });
    await dispatcher.drain();
    assert.ok(received);
    assert.equal(received.id, "evt-ord-1");
    assert.equal(received.type, "OrderPlaced");
    assert.ok(received.payload.order);
    assert.equal(received.delivered, undefined, "event passed to handler should only be id, type, payload, createdAt");
  });

  await t("dispatcher: already delivered handlers are not called on subsequent drains", async () => {
    const store = createStore();
    const clock = createClock(1000);
    const checkout = createCheckout({ store, now: clock.now });
    checkout.placeOrder({ customer: "c1", items: [{ sku: "A", qty: 1, price: 10 }] });

    let callCount = 0;
    const dispatcher = createDispatcher({
      store,
      handlers: { h1: () => { callCount++; } },
      now: clock.now,
    });
    const r1 = await dispatcher.drain();
    assert.deepEqual(r1, { delivered: 1, failed: 0 });
    assert.equal(callCount, 1);

    const r2 = await dispatcher.drain();
    assert.deepEqual(r2, { delivered: 0, failed: 0 });
    assert.equal(callCount, 1);
  });

  // 4. Failure, retry, and backoff
  await t("dispatcher: failing handler is retried on later drain without re-running succeeded handlers", async () => {
    const store = createStore();
    const clock = createClock(1000);
    const checkout = createCheckout({ store, now: clock.now });
    checkout.placeOrder({ customer: "c1", items: [{ sku: "A", qty: 1, price: 10 }] });

    let h1Runs = 0;
    let h2Runs = 0;
    let h2Fail = true;

    const handlers = {
      h1: () => { h1Runs++; },
      h2: () => {
        h2Runs++;
        if (h2Fail) throw new Error("h2 transient failure");
      },
    };

    const dispatcher = createDispatcher({
      store,
      handlers,
      now: clock.now,
      baseDelayMs: 1000,
    });

    // 1st drain at t = 1000: h1 succeeds, h2 fails.
    const res1 = await dispatcher.drain();
    assert.deepEqual(res1, { delivered: 1, failed: 1 });
    assert.equal(h1Runs, 1);
    assert.equal(h2Runs, 1);

    let ev = store.getEvent("evt-ord-1");
    assert.equal(ev.status, "pending", "event must remain pending when a handler fails");
    assert.deepEqual(ev.delivered, ["h1"]);
    assert.equal(ev.attempts["h2"], 1);
    // Exponential backoff: baseDelayMs * 2^(1-1) = 1000. nextAttemptAt = 1000 + 1000 = 2000
    assert.equal(ev.nextAttemptAt["h2"], 2000);

    // Drain before due time (t = 1500) -> h2 is skipped, h1 already delivered
    clock.set(1500);
    const resEarly = await dispatcher.drain();
    assert.deepEqual(resEarly, { delivered: 0, failed: 0 });
    assert.equal(h1Runs, 1);
    assert.equal(h2Runs, 1);

    // Drain at due time (t = 2000) with h2 healed -> h2 runs and succeeds, h1 NOT re-run
    clock.set(2000);
    h2Fail = false;
    const res2 = await dispatcher.drain();
    assert.deepEqual(res2, { delivered: 1, failed: 0 });
    assert.equal(h1Runs, 1, "h1 must not re-run");
    assert.equal(h2Runs, 2, "h2 should be retried");

    ev = store.getEvent("evt-ord-1");
    assert.equal(ev.status, "done");
    assert.deepEqual(ev.delivered, ["h1", "h2"]);
  });

  await t("dispatcher: backoff calculation doubles up to cap of 60000ms", async () => {
    const store = createStore();
    const clock = createClock(0);
    const checkout = createCheckout({ store, now: clock.now });
    checkout.placeOrder({ customer: "c1", items: [{ sku: "A", qty: 1, price: 10 }] });

    const dispatcher = createDispatcher({
      store,
      handlers: {
        failing: () => { throw new Error("boom"); },
      },
      now: clock.now,
      maxAttempts: 10,
      baseDelayMs: 1000,
    });

    // Attempt 1 at t = 0: delay = 1000 * 2^0 = 1000 -> next 1000
    await dispatcher.drain();
    assert.equal(store.getEvent("evt-ord-1").nextAttemptAt["failing"], 1000);

    // Attempt 2 at t = 1000: delay = 1000 * 2^1 = 2000 -> next 3000
    clock.set(1000);
    await dispatcher.drain();
    assert.equal(store.getEvent("evt-ord-1").nextAttemptAt["failing"], 3000);

    // Attempt 3 at t = 3000: delay = 1000 * 2^2 = 4000 -> next 7000
    clock.set(3000);
    await dispatcher.drain();
    assert.equal(store.getEvent("evt-ord-1").nextAttemptAt["failing"], 7000);

    // Fast-forward to attempt 7 (delay would be 1000 * 2^6 = 64000, capped at 60000)
    store.updateEvent("evt-ord-1", { attempts: { failing: 6 }, nextAttemptAt: { failing: 100000 } });
    clock.set(100000);
    await dispatcher.drain();
    // nextAttemptAt should be 100000 + 60000 = 160000
    assert.equal(store.getEvent("evt-ord-1").nextAttemptAt["failing"], 160000);
  });

  await t("dispatcher: dead letter when maxAttempts exceeded and status failed", async () => {
    const store = createStore();
    const clock = createClock(1000);
    const checkout = createCheckout({ store, now: clock.now });
    checkout.placeOrder({ customer: "c1", items: [{ sku: "A", qty: 1, price: 10 }] });

    const dispatcher = createDispatcher({
      store,
      handlers: {
        hGood: () => {},
        hBad: () => { throw new Error("bad"); },
      },
      now: clock.now,
      maxAttempts: 2,
      baseDelayMs: 500,
    });

    // 1st attempt at t=1000
    await dispatcher.drain();
    let ev = store.getEvent("evt-ord-1");
    assert.equal(ev.status, "pending");
    assert.deepEqual(ev.delivered, ["hGood"]);
    assert.deepEqual(ev.dead, []);
    assert.equal(ev.attempts["hBad"], 1);

    // 2nd attempt at t=1500 (reaches maxAttempts = 2)
    clock.set(1500);
    await dispatcher.drain();
    ev = store.getEvent("evt-ord-1");
    assert.equal(ev.status, "failed");
    assert.deepEqual(ev.delivered, ["hGood"]);
    assert.deepEqual(ev.dead, ["hBad"]);
    assert.equal(ev.attempts["hBad"], 2);
  });

  // 5. Concurrency lock
  await t("dispatcher: concurrent drain calls are locked", async () => {
    const store = createStore();
    const clock = createClock(1000);
    const checkout = createCheckout({ store, now: clock.now });
    checkout.placeOrder({ customer: "c1", items: [{ sku: "A", qty: 1, price: 10 }] });

    let resolveHandler;
    const slowHandlerPromise = new Promise((r) => { resolveHandler = r; });

    const dispatcher = createDispatcher({
      store,
      handlers: {
        slow: async () => { await slowHandlerPromise; },
      },
      now: clock.now,
    });

    const p1 = dispatcher.drain();
    // Call drain again while p1 is in flight
    const p2 = dispatcher.drain();
    const r2 = await p2;
    assert.deepEqual(r2, { delivered: 0, failed: 0 });

    resolveHandler();
    const r1 = await p1;
    assert.deepEqual(r1, { delivered: 1, failed: 0 });
  });

  // 6. Persistence across dispatcher instances
  await t("dispatcher: fresh dispatcher on same store picks up pending events", async () => {
    const store = createStore();
    const clock = createClock(1000);
    const checkout = createCheckout({ store, now: clock.now });
    checkout.placeOrder({ customer: "c1", items: [{ sku: "A", qty: 1, price: 10 }] });

    const d1 = createDispatcher({
      store,
      handlers: {
        h1: () => {},
        h2: () => { throw new Error("down"); },
      },
      now: clock.now,
      baseDelayMs: 1000,
    });
    await d1.drain();

    // Create a new dispatcher instance later
    clock.set(2000);
    let h2Called = false;
    const d2 = createDispatcher({
      store,
      handlers: {
        h1: () => { throw new Error("should not run"); },
        h2: () => { h2Called = true; },
      },
      now: clock.now,
    });
    const res = await d2.drain();
    assert.deepEqual(res, { delivered: 1, failed: 0 });
    assert.equal(h2Called, true);
    assert.equal(store.getEvent("evt-ord-1").status, "done");
  });

  // 7. Handlers: email, inventory, analytics idempotence & contracts
  await t("email handler: sends confirmation and is idempotent", () => {
    const sent = [];
    const handler = createEmailHandler({ send: (msg) => sent.push(msg) });
    const event = {
      id: "evt-1",
      type: "OrderPlaced",
      payload: {
        order: { id: "ord-1", customer: "bob@example.com", items: [], total: 100 },
      },
    };
    handler(event);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { to: "bob@example.com", subject: "Order ord-1 confirmed" });

    // Call again with same event id -> no-op
    handler(event);
    assert.equal(sent.length, 1);

    // Call with different event id -> runs
    handler({ ...event, id: "evt-2" });
    assert.equal(sent.length, 2);
  });

  await t("inventory handler: reserves stock and is idempotent", () => {
    const stock = { SKU1: 10, SKU2: 5 };
    const handler = createInventoryHandler({ stock });
    const event = {
      id: "evt-1",
      payload: {
        order: {
          id: "ord-1",
          items: [
            { sku: "SKU1", qty: 2, price: 10 },
            { sku: "SKU2", qty: 3, price: 20 },
          ],
        },
      },
    };
    handler(event);
    assert.deepEqual(stock, { SKU1: 8, SKU2: 2 });

    // Idempotent: re-running with same event id does not decrement stock again!
    handler(event);
    assert.deepEqual(stock, { SKU1: 8, SKU2: 2 });
  });

  await t("inventory handler: throws on insufficient stock without partial changes, and can be retried once stocked", () => {
    const stock = { SKU1: 1, SKU2: 5 };
    const handler = createInventoryHandler({ stock });
    const event = {
      id: "evt-1",
      payload: {
        order: {
          id: "ord-1",
          items: [
            { sku: "SKU1", qty: 2, price: 10 },
            { sku: "SKU2", qty: 3, price: 20 },
          ],
        },
      },
    };
    assert.throws(() => handler(event), /insufficient stock/);
    assert.deepEqual(stock, { SKU1: 1, SKU2: 5 }); // no mutation

    // Replenish stock and retry same event id: since it threw, it wasn't remembered as seen
    stock.SKU1 = 10;
    handler(event);
    assert.deepEqual(stock, { SKU1: 8, SKU2: 2 });
  });

  await t("analytics handler: tracks order and is idempotent", () => {
    const tracked = [];
    const handler = createAnalyticsHandler({ track: (evName, data) => tracked.push({ evName, data }) });
    const event = {
      id: "evt-1",
      payload: {
        order: { id: "ord-1", customer: "bob", total: 4200, items: [{ sku: "A", qty: 1, price: 4200 }] },
      },
    };
    handler(event);
    assert.equal(tracked.length, 1);
    assert.deepEqual(tracked[0], {
      evName: "order_placed",
      data: { orderId: "ord-1", total: 4200, items: 1 },
    });

    handler(event);
    assert.equal(tracked.length, 1);
  });

  // 8. End-to-end integration test
  await t("end-to-end: checkout + outbox + real handlers decouple order from side effects", async () => {
    const store = createStore();
    const clock = createClock(5000);
    const checkout = createCheckout({ store, now: clock.now });

    const sentEmails = [];
    const stock = { widget: 10 };
    const tracked = [];

    const emailHandler = createEmailHandler({ send: (m) => sentEmails.push(m) });
    const invHandler = createInventoryHandler({ stock });
    const analyticsHandler = createAnalyticsHandler({ track: (ev, d) => tracked.push({ ev, d }) });

    // Place an order: side effects have NOT run yet
    const order = checkout.placeOrder({
      customer: "dan@test.com",
      items: [{ sku: "widget", qty: 3, price: 100 }],
    });
    assert.equal(order.id, "ord-1");
    assert.equal(sentEmails.length, 0);
    assert.equal(stock.widget, 10);
    assert.equal(tracked.length, 0);

    const dispatcher = createDispatcher({
      store,
      handlers: {
        inventory: invHandler,
        email: emailHandler,
        analytics: analyticsHandler,
      },
      now: clock.now,
    });

    const drainRes = await dispatcher.drain();
    assert.deepEqual(drainRes, { delivered: 3, failed: 0 });
    assert.equal(sentEmails.length, 1);
    assert.equal(stock.widget, 7);
    assert.equal(tracked.length, 1);

    const ev = store.getEvent("evt-ord-1");
    assert.equal(ev.status, "done");
  });
})();
