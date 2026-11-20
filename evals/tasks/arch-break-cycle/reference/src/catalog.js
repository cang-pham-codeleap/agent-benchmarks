const { priceFor } = require('./pricing');
const { PRODUCTS, getProduct } = require('./products');

// Sum of current prices of everything that is not sold out.
function catalogTotal() {
  return Object.keys(PRODUCTS)
    .map((sku) => priceFor(sku))
    .filter((p) => p !== null)
    .reduce((a, b) => a + b, 0);
}

module.exports = { PRODUCTS, getProduct, catalogTotal };
