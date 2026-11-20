"use strict";

const PORTS = new Set([80, 443, 8080]);

function parseV4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

function v4Blocked([a, b]) {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function parseV6(str) {
  let s = str.split("%")[0];
  if (s.includes(".")) {
    const i = s.lastIndexOf(":");
    const v = parseV4(s.slice(i + 1));
    if (!v) return null;
    s = s.slice(0, i + 1) + ((v[0] << 8) | v[1]).toString(16) + ":" + ((v[2] << 8) | v[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const grp = (h) => (h === "" ? [] : h.split(":"));
  const head = grp(halves[0]);
  const rest = halves.length === 2 ? grp(halves[1]) : [];
  const all = [...head, ...rest];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  let groups;
  if (halves.length === 2) {
    if (all.length > 7) return null;
    groups = [...head, ...Array(8 - all.length).fill("0"), ...rest];
  } else {
    if (all.length !== 8) return null;
    groups = all;
  }
  return groups.map((g) => parseInt(g, 16));
}

function v6Blocked(w) {
  const embedded = [w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255];
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return v4Blocked(embedded);
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return v4Blocked(embedded);
  if (w.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1, IPv4-compatible
  return (w[0] & 0xfe00) === 0xfc00 || (w[0] & 0xffc0) === 0xfe80 || (w[0] >> 8) === 0xff;
}

// Unparseable addresses fail closed.
function addressBlocked(addr) {
  if (typeof addr !== "string") return true;
  if (addr.includes(":")) {
    const w = parseV6(addr);
    return !w || v6Blocked(w);
  }
  const o = parseV4(addr);
  return !o || v4Blocked(o);
}

async function checkUrl(url, { resolve } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "scheme" };
  if (u.username || u.password) return { ok: false, reason: "userinfo" };
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (!PORTS.has(port)) return { ok: false, reason: "port" };

  let host = u.hostname;
  if (host.startsWith("[")) {
    return addressBlocked(host.slice(1, -1)) ? { ok: false, reason: "blocked-address" } : { ok: true, reason: null };
  }
  if (parseV4(host)) {
    return addressBlocked(host) ? { ok: false, reason: "blocked-address" } : { ok: true, reason: null };
  }
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: "blocked-host" };

  let addrs;
  try {
    addrs = await resolve(u.hostname);
  } catch {
    return { ok: false, reason: "resolve-failed" };
  }
  if (!Array.isArray(addrs) || addrs.length === 0) return { ok: false, reason: "resolve-failed" };
  if (addressBlocked(addrs[0])) return { ok: false, reason: "blocked-address" };
  return { ok: true, reason: null };
}

async function checkRedirectChain(urls, opts) {
  if (!Array.isArray(urls) || urls.length === 0) return { ok: false, reason: "empty-chain" };
  if (urls.length > 6) return { ok: false, reason: "too-many-redirects" };
  for (let i = 0; i < urls.length; i++) {
    const r = await checkUrl(urls[i], opts);
    if (!r.ok) return { ok: false, reason: r.reason, index: i };
    if (i > 0 && new URL(urls[i - 1]).protocol === "https:" && new URL(urls[i]).protocol === "http:") {
      return { ok: false, reason: "downgrade", index: i };
    }
  }
  return { ok: true, reason: null };
}

module.exports = { checkUrl, checkRedirectChain };
