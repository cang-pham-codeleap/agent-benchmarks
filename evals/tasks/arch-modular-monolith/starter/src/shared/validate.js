"use strict";
const { validation, conflict } = require("./errors");
const userRepo = require("../users/repository");

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";
const isNonNegativeInt = (v) => Number.isInteger(v) && v >= 0;
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

function normalizeEmail(email) {
  if (typeof email !== "string") throw validation("email must be a string");
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw validation(`invalid email: ${email}`);
  return e;
}

// Uniqueness lives here because the validator was the first thing that needed it.
function assertEmailFree(email) {
  if (userRepo.findByEmail(email)) throw conflict(`email already registered: ${email}`);
}

module.exports = { isNonEmptyString, isNonNegativeInt, isPositiveInt, normalizeEmail, assertEmailFree };
