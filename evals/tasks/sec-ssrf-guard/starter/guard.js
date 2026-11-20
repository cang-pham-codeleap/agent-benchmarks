"use strict";

// TODO: incomplete SSRF guard. See task.md for the full contract.
async function checkUrl(url, { resolve } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "scheme" };
  }
  if (u.hostname === "localhost") return { ok: false, reason: "blocked-host" };
  return { ok: true, reason: null };
}

async function checkRedirectChain(urls, opts) {
  return checkUrl(urls[0], opts);
}

module.exports = { checkUrl, checkRedirectChain };
