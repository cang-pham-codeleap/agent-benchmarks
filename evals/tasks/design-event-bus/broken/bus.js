"use strict";

function createBus({ onError } = {}) {
  const subs = new Map();

  function add(event, fn) {
    const sub = { fn, active: true };
    if (!subs.has(event)) subs.set(event, []);
    subs.get(event).push(sub);
    return function unsubscribe() {
      if (!sub.active) return;
      sub.active = false;
      const list = subs.get(event);
      list.splice(list.indexOf(sub), 1);
      if (!list.length) subs.delete(event);
    };
  }

  function once(event, fn) {
    const off = add(event, (...args) => {
      off();
      return fn(...args);
    });
    return off;
  }

  function emit(event, payload) {
    const run = (list, args, n = list.length) => {
      for (let i = 0; i < n; i++) {
        const sub = list[i];
        if (!sub || !sub.active) continue;
        try {
          sub.fn(...args);
        } catch (err) {
          if (onError) onError(err, event);
        }
      }
    };
    const w = event === "*" ? [] : subs.get("*") || [];
    const wn = w.length;
    run(subs.get(event) || [], [payload]);
    run(w, [event, payload], wn);
  }

  return {
    on: add,
    once,
    emit,
    listenerCount: (event) => (subs.get(event) || []).length,
  };
}

module.exports = { createBus };
