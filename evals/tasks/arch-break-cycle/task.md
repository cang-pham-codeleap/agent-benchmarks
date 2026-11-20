# Break the require cycle

The project in `src/` is three CommonJS modules, `catalog.js`, `pricing.js`
and `inventory.js`, that require each other in a cycle
(catalog -> pricing -> inventory -> catalog).

Symptom: `require('./src/catalog')` works, but if any other module is the
first one loaded (for example `require('./src/pricing')` in a fresh
process), an imported function ends up `undefined` and calls throw
`TypeError: ... is not a function`.

Fix the design so that the modules work no matter which one is loaded first.

Requirements:

- The static `require` graph of the files under `src/` must be acyclic.
  Moving the `require` call inside a function (a lazy require), or any other
  trick that only hides the cycle at load time, does not count. You may add
  new files under `src/`.
- Keep every module's public exports and their behavior unchanged:
  - `catalog.js`: `PRODUCTS`, `getProduct(sku)`, `catalogTotal()`
  - `pricing.js`: `priceFor(sku)`
  - `inventory.js`: `STOCK`, `stockOf(sku)`, `reserve(sku, qty)`, `restockList()`
- Plain Node, no dependencies, CommonJS only.
