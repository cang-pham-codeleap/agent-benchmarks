"use strict";

function createDispatcher({ store, handlers, now, maxAttempts = 3, baseDelayMs = 1000 }) {
  let inProgress = false;
  async function drain() {
    if (inProgress) return { delivered: 0, failed: 0 };
    inProgress = true;
    let deliveredCount = 0;
    let failedCount = 0;
    try {
      const time = now();
      const handlerKeys = Object.keys(handlers);
      for (const ev of store.listEvents()) {
        if (ev.status !== "pending") continue;
        let event = store.getEvent(ev.id);
        if (!event || event.status !== "pending") continue;
        for (const name of handlerKeys) {
          const fn = handlers[name];
          if (event.delivered.includes(name) || event.dead.includes(name)) continue;
          if (event.nextAttemptAt[name] !== undefined && event.nextAttemptAt[name] > time) continue;

          const stripped = {
            id: event.id,
            type: event.type,
            payload: event.payload,
            createdAt: event.createdAt,
          };
          try {
            await fn(stripped);
            const delivered = [...event.delivered, name];
            // Planted bug: marks the whole event "done" after the first handler succeeds!
            // Later failing handlers will never be retried on next drain because status is no longer pending.
            store.updateEvent(event.id, { delivered, status: "done" });
            event = store.getEvent(event.id);
            deliveredCount++;
          } catch {
            const attempts = { ...event.attempts };
            const curr = (attempts[name] || 0) + 1;
            attempts[name] = curr;
            const patch = { attempts };
            if (curr >= maxAttempts) {
              patch.dead = [...event.dead, name];
            } else {
              const delay = Math.min(baseDelayMs * Math.pow(2, curr - 1), 60000);
              patch.nextAttemptAt = { ...event.nextAttemptAt, [name]: time + delay };
            }
            store.updateEvent(event.id, patch);
            event = store.getEvent(event.id);
            failedCount++;
          }
        }
      }
      return { delivered: deliveredCount, failed: failedCount };
    } finally {
      inProgress = false;
    }
  }
  return { drain };
}

module.exports = { createDispatcher };
