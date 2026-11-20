# Ports and adapters for the order module

`src/` holds a small CommonJS app (plain Node, no dependencies) that places
orders, applies discounts and computes totals. The domain logic in
`src/domain/orders.js` currently reaches straight into `node:fs` and
`src/infra/file-store.js`. Restructure it into ports and adapters
(hexagonal architecture) **without changing observable behavior**.

## Required structure

- `src/domain/**` is pure: no file under `src/domain/` may `require` anything
  under `src/infra/`, any Node built-in module (`fs`, `node:path`, ...) or any
  package. Requiring other files inside `src/domain/` is fine. It must not
  read the system clock itself either.
- `src/domain/orders.js` exports `createOrderService({ repository, clock })`
  returning an object with:
  - `placeOrder({ customer, items })` -> the saved order
  - `applyDiscount(id, percent)` -> the updated order
  - `total(id)` -> integer cents
  - `get(id)` -> the order, or `null` if unknown
- The injected **repository** (the port) is synchronous and has:
  `save(order)`, `get(id)` (order or `null`) and `list()` (array of all
  orders, in creation order).
- The injected **clock** has `now()` returning epoch milliseconds.
- `src/infra/file-store.js` exports `createFileRepository(dir)`: a repository
  implementing the port, storing one `<id>.json` file per order in `dir`
  (created if missing). `list()` returns orders in creation order.
- `src/app.js` is the composition root: it exports `createApp(dir)` which
  wires the service to a file repository in `dir` and the system clock
  (`{ now: () => Date.now() }`), and returns the service.

## Behavior to preserve

- `placeOrder`: `customer` must be a non-empty string; `items` a non-empty
  array of `{ sku, qty, price }` with `sku` a non-empty string, `qty` a
  positive integer and `price` a non-negative integer (cents). Otherwise
  throw an `Error`, and save nothing.
- The new order is `{ id, customer, items, discount: 0, createdAt }` where
  `id` is `"ord-" + (number of orders already in the repository + 1)` and
  `createdAt` is `new Date(clock.now()).toISOString()`.
- `applyDiscount(id, percent)`: `percent` is a number from 0 to 100
  inclusive; it **replaces** any earlier discount (no stacking). Unknown id
  or an invalid percent throws an `Error` and changes nothing.
- `total(id)`: sum of `qty * price` over the items, reduced by the discount
  percent and rounded with `Math.round`:
  `Math.round(subtotal * (100 - discount) / 100)`. Unknown id throws.
