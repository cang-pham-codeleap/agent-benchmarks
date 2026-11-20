"use strict";
const shared = require("../shared/errors");
const validate = require("../shared/validate");
const money = require("../shared/money");
const plans = require("../billing/plans");
const usersRepo = require("../users/repository");

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw shared.validation("items must be a non-empty array");
  return items.map((item) => {
    const { sku, qty, priceCents } = item || {};
    if (!validate.isNonEmptyString(sku)) throw shared.validation("item sku is required");
    if (!validate.isPositiveInt(qty)) throw shared.validation(`invalid qty for ${sku}`);
    if (!validate.isNonNegativeInt(priceCents)) throw shared.validation(`invalid priceCents for ${sku}`);
    return { sku, qty, priceCents };
  });
}

const subtotalOf = (items) => money.sumCents(items.map((i) => i.qty * i.priceCents));

// The user's plan decides both the discount and the credit limit.
function planOf(userId) {
  const user = usersRepo.get(userId);
  return plans.get(user.plan);
}

module.exports = { validateItems, subtotalOf, planOf };
