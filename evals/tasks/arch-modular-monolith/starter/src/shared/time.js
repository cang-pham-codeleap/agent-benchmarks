"use strict";
const { PERIOD_DAYS } = require("../billing/plans");

const DAY_MS = 86400000;

// Where `nowMs` falls in the 30-day billing periods that start at `anchorMs`.
function periodPosition(anchorMs, nowMs) {
  const day = Math.floor(Math.max(0, nowMs - anchorMs) / DAY_MS);
  return { dayInPeriod: day % PERIOD_DAYS, remainingDays: PERIOD_DAYS - (day % PERIOD_DAYS) };
}

const iso = (ms) => new Date(ms).toISOString();

module.exports = { DAY_MS, periodPosition, iso };
