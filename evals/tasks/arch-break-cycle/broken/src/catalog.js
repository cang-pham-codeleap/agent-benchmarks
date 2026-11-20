const pricing = require('./pricing');

const PRODUCTS = {
  widget: { sku: 'widget', name: 'Widget', basePrice: 1000 },
  gadget: { sku: 'gadget', name: 'Gadget', basePrice: 2500 },
  gizmo: { sku: 'gizmo', name: 'Gizmo', basePrice: 750 },
};

function getProduct(sku) {
  const p = PRODUCTS[sku];
  if (!p) throw new Error(`unknown sku: ${sku}`);
  return p;
}

// Sum of current prices of everything that is not sold out.
function catalogTotal() {
  return Object.keys(PRODUCTS)
    .map((sku) => pricing.priceFor(sku))
    .filter((p) => p !== null)
    .reduce((a, b) => a + b, 0);
}

module.exports = { PRODUCTS, getProduct, catalogTotal };
