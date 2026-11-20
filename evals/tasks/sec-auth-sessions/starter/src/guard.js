"use strict";

/**
 * Request guard used by the HTTP layer. `req` is
 * { method, cookies: { sid, csrf }, headers: { "x-csrf-token" } }.
 * Returns { status: 401 } without a live session, { status: 403 } when the
 * CSRF check fails, otherwise { status: 200, user }.
 */
function createGuard(auth) {
  return function guard(req) {
    const cookies = req.cookies || {};
    const headers = req.headers || {};
    const user = auth.authenticate(cookies.sid);
    if (!user) return { status: 401 };
    const ok = auth.csrf.validate({
      method: req.method,
      sessionToken: cookies.sid,
      cookie: cookies.csrf,
      header: headers["x-csrf-token"],
    });
    if (!ok) return { status: 403 };
    return { status: 200, user };
  };
}

module.exports = { createGuard };
