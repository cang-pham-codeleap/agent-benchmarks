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

module.exports = { PRODUCTS, getProduct };
