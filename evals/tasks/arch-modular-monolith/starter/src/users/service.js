"use strict";
const db = require("../shared/db");
const shared = require("../shared/errors");
const validate = require("../shared/validate");
const { iso } = require("../shared/time");
const repo = require("./repository");
const billingPlans = require("../billing/plans");
const billingService = require("../billing/service");

function signup({ email, name, plan = "free" } = {}) {
  if (!validate.isNonEmptyString(name)) throw shared.validation("name is required");
  const normalized = validate.normalizeEmail(email);
  billingPlans.get(plan);
  validate.assertEmailFree(normalized);
  const user = repo.insert({
    id: db.ids.next("usr"),
    email: normalized,
    name: name.trim(),
    plan,
    createdAt: iso(db.clock.now()),
    planChangedAt: null,
  });
  // A paid signup immediately owes its first month.
  billingService.startSubscription(user.id);
  return user;
}

function get(id) {
  const user = repo.get(id);
  if (!user) throw shared.notFound("user", id);
  return user;
}

module.exports = { signup, get };
