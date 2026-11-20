"use strict";
const { validation } = require("./errors");

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const isNonNegativeInt = (v) => Number.isInteger(v) && v >= 0;
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

function normalizeEmail(email) {
  if (typeof email !== "string") throw validation("email must be a string");
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw validation(`invalid email: ${email}`);
  return e;
}

module.exports = { isNonEmptyString, isNonNegativeInt, isPositiveInt, normalizeEmail };
