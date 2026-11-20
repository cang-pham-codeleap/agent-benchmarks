
const STOCK = { widget: 100, gadget: 3, gizmo: 0 };

function stockOf(sku) {
  if (!(sku in STOCK)) throw new Error(`unknown sku: ${sku}`);
  return STOCK[sku];
}

function reserve(sku, qty) {
  if (stockOf(sku) < qty) throw new Error(`insufficient stock for ${sku}`);
  STOCK[sku] -= qty;
  return STOCK[sku];
}

// Skus with fewer than 5 units left, alphabetical.
function restockList() {
  const { PRODUCTS } = require('./catalog');
  return Object.keys(PRODUCTS)
    .filter((sku) => STOCK[sku] < 5)
    .sort();
}

module.exports = { STOCK, stockOf, reserve, restockList };
