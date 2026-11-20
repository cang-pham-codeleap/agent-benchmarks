"use strict";
const shared = require("../shared");

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw shared.validation("items must be a non-empty array");
  return items.map((item) => {
    const { sku, qty, priceCents } = item || {};
    if (!shared.isNonEmptyString(sku)) throw shared.validation("item sku is required");
    if (!shared.isPositiveInt(qty)) throw shared.validation(`invalid qty for ${sku}`);
    if (!shared.isNonNegativeInt(priceCents)) throw shared.validation(`invalid priceCents for ${sku}`);
    return { sku, qty, priceCents };
  });
}

const subtotalOf = (items) => shared.sumCents(items.map((i) => i.qty * i.priceCents));

module.exports = { validateItems, subtotalOf };
