"use strict";
const { PERIOD_DAYS } = require("./plans");

// Unused time on the old plan is credited rounded down; the new plan is charged rounded half up.
function prorate(fromPlan, toPlan, remainingDays) {
  const creditCents = Math.floor((fromPlan.priceCents * remainingDays) / PERIOD_DAYS);
  const chargeCents = Math.round((toPlan.priceCents * remainingDays) / PERIOD_DAYS);
  return { creditCents, chargeCents, netCents: chargeCents - creditCents };
}

module.exports = { prorate };
