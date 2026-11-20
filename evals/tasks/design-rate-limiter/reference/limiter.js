"use strict";

function checkPos(v, name) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new RangeError(name + " must be a finite positive number");
}
function checkLimit(v) {
  if (!Number.isInteger(v) || v <= 0) throw new RangeError("limit must be a positive integer");
}
function clock(now) {
  if (now === undefined) return Date.now;
  if (typeof now !== "function") throw new RangeError("now must be a function");
  return now;
}
function checkCost(cost, integer) {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost <= 0 || (integer && !Number.isInteger(cost))) {
    throw new RangeError("invalid cost");
  }
}

// Builds a limiter from decide(state, cost, now) -> { result, commit }.
function build(makeState, decide, integerCost) {
  const states = new Map();
  function run(key, cost, commitIt) {
    if (cost === undefined) cost = 1;
    checkCost(cost, integerCost);
    let s = states.get(key);
    if (!s) states.set(key, (s = makeState()));
    const d = decide(s, cost);
    if (commitIt && d.result.allowed) d.commit();
    return d.result;
  }
  return {
    tryAcquire: (key, cost) => run(key, cost, true),
    peek: (key, cost) => run(key, cost, false),
  };
}

function tokenBucket({ capacity, refillPerSec, now } = {}) {
  checkPos(capacity, "capacity");
  checkPos(refillPerSec, "refillPerSec");
  const clk = clock(now);
  return build(
    () => ({ tokens: capacity, at: null }),
    (s, cost) => {
      const t = clk();
      if (s.at !== null) s.tokens = Math.min(capacity, s.tokens + ((t - s.at) * refillPerSec) / 1000);
      s.at = t;
      if (cost <= s.tokens) {
        return {
          result: { allowed: true, retryAfterMs: 0, remaining: Math.floor(s.tokens - cost) },
          commit: () => { s.tokens -= cost; },
        };
      }
      const retry = cost > capacity ? Infinity : Math.ceil(((cost - s.tokens) / refillPerSec) * 1000);
      return { result: { allowed: false, retryAfterMs: retry, remaining: Math.floor(s.tokens) } };
    },
    false,
  );
}

function slidingWindowLog({ limit, windowMs, now } = {}) {
  checkLimit(limit);
  checkPos(windowMs, "windowMs");
  const clk = clock(now);
  return build(
    () => ({ log: [] }),
    (s, cost) => {
      const t = clk();
      while (s.log.length && s.log[0].t + windowMs <= t) s.log.shift();
      let used = 0;
      for (const e of s.log) used += e.cost;
      if (used + cost <= limit) {
        return {
          result: { allowed: true, retryAfterMs: 0, remaining: limit - used - cost },
          commit: () => { s.log.push({ t, cost }); },
        };
      }
      let retry = Infinity;
      if (cost <= limit) {
        let need = used + cost - limit;
        for (const e of s.log) {
          need -= e.cost;
          if (need <= 0) { retry = e.t + windowMs - t; break; }
        }
      }
      return { result: { allowed: false, retryAfterMs: retry, remaining: limit - used } };
    },
    true,
  );
}

function fixedWindow({ limit, windowMs, now } = {}) {
  checkLimit(limit);
  checkPos(windowMs, "windowMs");
  const clk = clock(now);
  return build(
    () => ({ win: null, count: 0 }),
    (s, cost) => {
      const t = clk();
      const w = Math.floor(t / windowMs);
      if (s.win !== w) { s.win = w; s.count = 0; }
      if (s.count + cost <= limit) {
        return {
          result: { allowed: true, retryAfterMs: 0, remaining: limit - s.count - cost },
          commit: () => { s.count += cost; },
        };
      }
      const retry = cost > limit ? Infinity : (w + 1) * windowMs - t;
      return { result: { allowed: false, retryAfterMs: retry, remaining: limit - s.count } };
    },
    true,
  );
}

function all(limiters) {
  if (!Array.isArray(limiters) || limiters.length === 0) throw new RangeError("limiters must be a non-empty array");
  const list = limiters.slice();
  function combine(rs) {
    const denied = rs.filter((r) => !r.allowed);
    return {
      allowed: denied.length === 0,
      retryAfterMs: denied.length ? Math.max(...denied.map((r) => r.retryAfterMs)) : 0,
      remaining: Math.min(...rs.map((r) => r.remaining)),
    };
  }
  return {
    peek: (key, cost) => combine(list.map((l) => l.peek(key, cost))),
    tryAcquire(key, cost) {
      const peeked = combine(list.map((l) => l.peek(key, cost)));
      if (!peeked.allowed) return peeked;
      return combine(list.map((l) => l.tryAcquire(key, cost)));
    },
  };
}

module.exports = { tokenBucket, slidingWindowLog, fixedWindow, all };
