"use strict";

class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

const validation = (message) => new AppError("VALIDATION", message);
const notFound = (what, id) => new AppError("NOT_FOUND", `${what} not found: ${id}`);
const conflict = (message) => new AppError("CONFLICT", message);
const creditLimit = (message) => new AppError("CREDIT_LIMIT", message);

module.exports = { AppError, validation, notFound, conflict, creditLimit };
