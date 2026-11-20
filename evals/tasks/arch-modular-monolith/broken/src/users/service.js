"use strict";
const shared = require("../shared");
const { PLANS } = require("./plans");
const { createUserRepository } = require("./repository");

const copy = (v) => structuredClone(v);

function createUsersService({ clock, ids }) {
  const repo = createUserRepository();

  function planInfo(name) {
    if (!Object.hasOwn(PLANS, name)) throw shared.validation(`unknown plan: ${name}`);
    return { ...PLANS[name] };
  }

  function load(id) {
    const user = repo.get(id);
    if (!user) throw shared.notFound("user", id);
    return user;
  }

  return {
    signup({ email, name, plan = "free" } = {}) {
      if (!shared.isNonEmptyString(name)) throw shared.validation("name is required");
      const normalized = shared.normalizeEmail(email);
      planInfo(plan);
      if (repo.findByEmail(normalized)) throw shared.conflict(`email already registered: ${normalized}`);
      const user = {
        id: ids.next("usr"),
        email: normalized,
        name: name.trim(),
        plan,
        createdAt: shared.iso(clock.now()),
        planChangedAt: null,
      };
      repo.insert(user);
      return copy(user);
    },
    get: (id) => copy(load(id)),
    changePlan(id, plan) {
      const user = load(id);
      planInfo(plan);
      user.plan = plan;
      user.planChangedAt = shared.iso(clock.now());
      return copy(user);
    },
    planInfo,
  };
}

module.exports = { createUsersService };
