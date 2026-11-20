# Decouple checkout with domain events and a transactional outbox

`src/` is a small CommonJS app (plain Node, no dependencies). `placeOrder` in
`src/checkout.js` stores the order and then calls `src/inventory.js`,
`src/email.js` and `src/analytics.js` inline, so a failing analytics call (or
a stock shortage) fails the order. Restructure it around domain events and a
**transactional outbox**. `src/store.js` is a fixed stand-in for a database;
do not change it.

## Store contract (`src/store.js`, already exists)

`createStore()` returns `commit({ orders, events })` (atomic: throws and
applies nothing if any id already exists), `getOrder(id)`, `countOrders()`,
`getEvent(id)`, `listEvents()` (insertion order), `updateEvent(id, patch)`
(shallow merge). Everything it returns is a copy.

## `src/checkout.js`

`createCheckout({ store, now })` returns `{ placeOrder({ customer, items }) }`.

- Validation is unchanged: `customer` a non-empty string, `items` a non-empty
  array of `{ sku, qty, price }` with `sku` a non-empty string, `qty` a
  positive integer, `price` a non-negative integer (cents); otherwise throw an
  `Error` and write nothing.
- The order is `{ id, customer, items, total, createdAt }` with
  `id = "ord-" + (store.countOrders() + 1)`, `total` = sum of `qty * price`,
  `createdAt = new Date(now()).toISOString()`. `placeOrder` returns it.
- The order and an `OrderPlaced` event are written with **one** call to
  `store.commit({ orders: [order], events: [event] })`, so both exist or
  neither does. `placeOrder` does nothing else with side effects.
- The event is
  `{ id: "evt-" + order.id, type: "OrderPlaced", payload: { order }, createdAt: now(), status: "pending", delivered: [], dead: [], attempts: {}, nextAttemptAt: {} }`.
- `src/checkout.js` must not require `./email`, `./inventory`, `./analytics`
  (nor `./outbox`).

## `src/outbox.js`

`createDispatcher({ store, handlers, now, maxAttempts = 3, baseDelayMs = 1000 })`
returns `{ drain }`. `handlers` is an object mapping a handler name to
`handler(event)` (sync or async); `event` is `{ id, type, payload, createdAt }`.
`drain()` returns a promise of `{ delivered, failed }`: the number of handler
calls that succeeded / failed during that drain. Delivery is at-least-once and
tracked **per handler** in the stored event:

- `drain` reads `now()` exactly once, at its start, and uses that time for the
  whole drain. It walks events in insertion order, only those with
  `status: "pending"`, and for each event walks handlers in the key order of
  `handlers`. A handler is skipped if its name is in `event.delivered` or
  `event.dead`, or if `event.nextAttemptAt[name]` is later than the drain time
  (equal means due).
- A handler that returns/resolves successfully is added to `event.delivered`,
  persisted immediately (`store.updateEvent`), so it is never called again for
  that event. A handler that throws or rejects does not stop the other
  handlers or later events.
- On failure `event.attempts[name]` is incremented. If it reaches
  `maxAttempts` the handler name is added to `event.dead` and never retried.
  Otherwise `event.nextAttemptAt[name] = time + min(baseDelayMs * 2^(attempts-1), 60000)`.
- After handling an event, if every name in `handlers` is in `delivered` or
  `dead`, its status becomes `"failed"` if `dead` is non-empty, else `"done"`.
  Otherwise it stays `"pending"` (so failing handlers are retried by a later
  `drain`, while handlers that already succeeded are not run again).
- Only one drain runs at a time: calling `drain()` while another is in
  progress resolves immediately to `{ delivered: 0, failed: 0 }` without
  calling any handler.
- All state lives in the store, so a new dispatcher on the same store
  continues where the old one left off.

## Handlers

Replace the inline functions with handler factories. Each returned handler
must be **idempotent by `event.id`**: once it has completed successfully for an
event id (remembered in memory in the handler), another call with the same id
does nothing. A call that throws must not be remembered, so it can be retried.

- `src/email.js`: `createEmailHandler({ send })` calls
  `send({ to: order.customer, subject: "Order " + order.id + " confirmed" })`.
- `src/inventory.js`: `createInventoryHandler({ stock })` decrements
  `stock[sku]` by `qty` for every item of the order, or, if any item lacks
  enough stock (`stock[sku] || 0 < qty`), throws and changes nothing.
- `src/analytics.js`: `createAnalyticsHandler({ track })` calls
  `track("order_placed", { orderId, total, items: order.items.length })`.

Each reads the order from `event.payload.order`.
