"use strict";
const shared = require("../shared/errors");

const PERIOD_DAYS = 30;

const PLANS = {
  free: { name: "free", rank: 0, priceCents: 0, creditLimitCents: 5000, discountPct: 0 },
  basic: { name: "basic", rank: 1, priceCents: 1499, creditLimitCents: 20000, discountPct: 5 },
  pro: { name: "pro", rank: 2, priceCents: 4900, creditLimitCents: 100000, discountPct: 10 },
};

function get(name) {
  if (!Object.hasOwn(PLANS, name)) throw shared.validation(`unknown plan: ${name}`);
  return { ...PLANS[name] };
}

module.exports = { PERIOD_DAYS, PLANS, get };
