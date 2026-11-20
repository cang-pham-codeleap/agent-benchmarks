"use strict";

function createBus({ onError } = {}) {
  const subs = new Map(); // event -> array of { fn, active }

  function add(event, fn, once) {
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

  function on(event, fn) {
    return add(event, fn);
  }

  function once(event, fn) {
    let off;
    off = add(event, (...args) => {
      off();
      return fn(...args);
    });
    return off;
  }

  function emit(event, payload) {
    const run = (list, args) => {
      for (const sub of list) {
        if (!sub.active) continue;
        try {
          sub.fn(...args);
        } catch (err) {
          if (onError) onError(err, event);
        }
      }
    };
    const specific = (subs.get(event) || []).slice();
    const wild = event === "*" ? [] : (subs.get("*") || []).slice();
    run(specific, [payload]);
    run(wild, [event, payload]);
  }

  function listenerCount(event) {
    return (subs.get(event) || []).length;
  }

  return { on, once, emit, listenerCount };
}

module.exports = { createBus };
