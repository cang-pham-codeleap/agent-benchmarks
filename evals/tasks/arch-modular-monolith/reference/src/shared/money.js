"use strict";

const sumCents = (list) => list.reduce((a, b) => a + b, 0);

// Percentage discount on integer cents, rounded half up.
const applyDiscount = (cents, pct) => Math.round((cents * (100 - pct)) / 100);

// Tax in basis points on integer cents, rounded half up.
const taxOf = (cents, bps) => Math.round((cents * bps) / 10000);

module.exports = { sumCents, applyDiscount, taxOf };
