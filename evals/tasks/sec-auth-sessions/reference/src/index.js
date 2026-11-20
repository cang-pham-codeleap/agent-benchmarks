"use strict";
const { createStore } = require("./store");
const { createAuth } = require("./login");
const { createGuard } = require("./guard");
const cookies = require("./cookies");

/**
 * Wire the auth stack together for the HTTP layer.
 * `options` are passed straight to createAuth (now, csrfSecret, idleMs, absoluteMs, lockout, onEvent).
 * Returns { store, auth, guard, cookies }.
 */
function createApp(options = {}) {
  const store = options.store || createStore();
  const auth = createAuth({ ...options, store });
  const guard = createGuard(auth);
  return { store, auth, guard, cookies };
}

module.exports = { createApp };
