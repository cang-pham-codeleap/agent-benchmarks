"use strict";

// Argument validation shared by the virtualizer modules. Every failure is a
// RangeError so callers can tell bad input from programming errors.

function isNonNegativeInt(n) {
  return Number.isInteger(n) && n >= 0;
}

function assertCount(n, name = "count") {
  if (!isNonNegativeInt(n)) {
    throw new RangeError(`${name} must be a non-negative integer, got ${String(n)}`);
  }
  return n;
}

function assertIndex(index, count, name = "index") {
  if (!isNonNegativeInt(index) || index >= count) {
    throw new RangeError(`${name} ${String(index)} out of range [0, ${count})`);
  }
  return index;
}

function assertPositiveSize(size, name = "size") {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    throw new RangeError(`${name} must be a finite number > 0, got ${String(size)}`);
  }
  return size;
}

function assertOverscan(n) {
  if (!isNonNegativeInt(n)) {
    throw new RangeError(`overscan must be a non-negative integer, got ${String(n)}`);
  }
  return n;
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

module.exports = {
  isNonNegativeInt,
  assertCount,
  assertIndex,
  assertPositiveSize,
  assertOverscan,
  clamp,
};
