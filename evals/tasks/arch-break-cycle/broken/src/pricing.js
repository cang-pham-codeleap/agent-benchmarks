const { stockOf } = require('./inventory');

// Current price in cents: -10% when well stocked (>= 50), +20% when scarce
// (1..4), null when sold out.
function priceFor(sku) {
  const { getProduct } = require('./catalog');
  const base = getProduct(sku).basePrice;
  const stock = stockOf(sku);
  if (stock === 0) return null;
  if (stock >= 50) return Math.round(base * 0.9);
  if (stock < 5) return Math.round(base * 1.2);
  return base;
}

module.exports = { priceFor };
