# Untangle the billing/orders/users monolith

`src/` holds a small CommonJS app (plain Node, no dependencies) with four
folders: `src/users/`, `src/orders/`, `src/billing/` and `src/shared/`. They
reach into each other's internals, require each other in circles, and keep all
state in one process-wide mutable object, `src/shared/db.js`. Turn it into a
**modular monolith** with enforced boundaries, **without changing the
behavior of the public `createApp` API**.

## Required structure

Treat each of the four folders as a module.

1. **Public entry.** Every module (including `shared`) has a `src/<module>/index.js`.
   It is the only file of that module another module, or `src/app.js`, may `require`.
   Files inside a module may require each other freely.
2. **No back doors.** A file in one module must never require a non-index file of
   another module (`../orders/repository`, `../shared/money`, ...). Require
   `../shared`, `../users`, and so on, and nothing deeper.
3. **Acyclic.** The module dependency graph has no cycles. `shared` is the
   bottom layer: it requires nothing from `users`, `orders` or `billing`.
   (Hint: something in the starter lives in the wrong module.)
4. **No shared mutable singleton.** No module-level store, `db.js`-style object,
   `global` or `globalThis` state. Every mutable thing is created inside
   `createApp` and handed to modules through their factories. Two apps from two
   `createApp` calls must never see each other's users, orders, invoices, clock or ids.
5. **Single owner of data.** Only a module itself may change the records it owns
   (users: users, orders: orders, billing: invoices and pending billing lines).
   Other modules act on them through the owner's public API only. Consequently
   everything any module's public API returns is a snapshot (deep copy), and
   inputs such as the `items` array are not retained by reference. Mutating a
   returned value or a passed-in value never changes app state.
6. **Composition root.** `src/app.js` exports `createApp({ clock, ids } = {})` and
   is the only place that wires modules together. It may require only module
   `index.js` files. `clock` is `{ now() }` returning epoch milliseconds (default:
   `Date.now()`); `ids` is `{ next(prefix) }` returning a unique string such as
   `"usr-1"` (default: a fresh per-app counter per prefix, `"<prefix>-<n>"` from 1).
   Modules must use the injected clock and ids, never `Date.now()` or their own counters.

Only files reachable from `src/app.js` through `require` are checked, so leftover
unused files do not matter. Every `require` must be a string literal that is
either a Node built-in or a relative path (no packages).

## Public API (`createApp(...)` returns exactly these functions)

`signup`, `getUser`, `upgradePlan`, `placeOrder`, `getOrder`, `listOrders`,
`cancelOrder`, `creditStatus`, `generateInvoice`, `payInvoice`, `getInvoice`,
`listInvoices`. Their behavior is the one implemented by the starter and must
stay identical (read the code); the essentials:

- All money is integer cents. Errors are `Error`s with a `code`:
  `VALIDATION`, `NOT_FOUND`, `CONFLICT` or `CREDIT_LIMIT`. A failed call changes
  nothing and **does not consume an id**; ids are requested only once all checks have passed.
- Plans (`free`, `basic`, `pro`): monthly price 0 / 1499 / 4900, credit limit
  5000 / 20000 / 100000, order discount 0% / 5% / 10%, ranked in that order.
- `signup({ email, name, plan = "free" })` -> `{ id, email, name, plan, createdAt, planChangedAt: null }`;
  email is trimmed and lowercased and unique; a paid plan queues a `subscription` billing line for its price.
- `placeOrder(userId, items)`: items are `{ sku, qty, priceCents }`; total =
  `Math.round(subtotal * (100 - discountPct) / 100)` using the plan at that moment;
  rejected with `CREDIT_LIMIT` if (total of the user's `placed` and `invoiced`
  orders) + new total exceeds the plan's limit.
- `upgradePlan(userId, newPlan)` must move to a strictly higher-ranked plan.
  Proration uses the 30-day billing period anchored at the user's `createdAt`:
  `remainingDays = 30 - (daysSinceCreated % 30)` (days floored, never negative). The unused old
  plan is credited rounded **down**, the new plan is charged rounded **half up**; a positive net is queued
  as an untaxed `adjustment` billing line.
- `generateInvoice(userId)` bills queued lines first, then the user's `placed`
  orders; tax is 8.25% (`Math.round`) of the order lines' sum only, computed once.
  Billed orders become `invoiced`; `payInvoice` marks the invoice and its orders `paid`.
