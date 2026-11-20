"use strict";

const KINDS = ["info", "success", "warning", "error"];

function a11y(kind) {
  return kind === "error"
    ? { role: "alert", ariaLive: "assertive" }
    : { role: "status", ariaLive: "polite" };
}

function createToaster({ maxVisible = 3, now, setTimer, clearTimer, prefersReducedMotion = false } = {}) {
  if (!Number.isInteger(maxVisible) || maxVisible < 1) throw new RangeError("maxVisible");
  let seq = 0;
  const vis = [];
  const queue = [];
  const find = (id) => vis.find((t) => t.id === id);

  function start(t, ms) {
    t.deadline = now() + ms;
    t.timer = setTimer(() => {
      t.timer = null;
      dismiss(t.id);
    }, ms);
  }
  function stop(t) {
    if (t.timer != null) clearTimer(t.timer);
    t.timer = null;
  }
  function enqueue(t) {
    if (t.kind !== "error") return queue.push(t);
    let i = 0;
    while (i < queue.length && queue[i].kind === "error") i++;
    queue.splice(i, 0, t);
  }
  function promote() {
    while (vis.length < maxVisible && queue.length) {
      const t = queue.shift();
      vis.push(t);
      if (t.kind !== "error") start(t, t.durationMs);
    }
  }
  function snap(t, queued) {
    let remainingMs = null;
    if (t.kind !== "error") remainingMs = queued ? t.durationMs : t.paused ? t.remaining : t.deadline - now();
    return {
      id: t.id, message: t.message, kind: t.kind, count: t.count, durationMs: t.durationMs,
      paused: t.paused, remainingMs, ...a11y(t.kind), animate: !prefersReducedMotion,
    };
  }

  function show({ message, kind = "info", durationMs = 5000, id } = {}) {
    if (typeof message !== "string" || message === "") throw new TypeError("message");
    if (!KINDS.includes(kind)) throw new RangeError("kind");
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) throw new RangeError("durationMs");
    if (id === undefined) id = "toast-" + ++seq;
    const v = find(id);
    if (v) {
      Object.assign(v, { message, kind, durationMs, count: v.count + 1 });
      stop(v);
      if (kind === "error") {
        v.paused = false;
      } else if (v.paused) {
        v.remaining = durationMs;
      } else {
        start(v, durationMs);
      }
      return id;
    }
    const q = queue.findIndex((t) => t.id === id);
    if (q >= 0) {
      const t = queue[q];
      const wasError = t.kind === "error";
      Object.assign(t, { message, kind, durationMs, count: t.count + 1 });
      if (kind === "error" && !wasError) {
        queue.splice(q, 1);
        enqueue(t);
      }
      return id;
    }
    const t = { id, message, kind, durationMs, count: 1, paused: false, remaining: 0, deadline: 0, timer: null };
    enqueue(t);
    promote();
    return id;
  }

  function dismiss(id) {
    const i = vis.findIndex((t) => t.id === id);
    if (i >= 0) {
      stop(vis[i]);
      vis.splice(i, 1);
      promote();
      return true;
    }
    const q = queue.findIndex((t) => t.id === id);
    if (q < 0) return false;
    queue.splice(q, 1);
    return true;
  }

  function pause(id) {
    const t = find(id);
    if (!t || t.kind === "error" || t.paused) return false;
    t.remaining = Math.max(0, t.deadline - now());
    stop(t);
    t.paused = true;
    return true;
  }

  function resume(id) {
    const t = find(id);
    if (!t || !t.paused) return false;
    t.paused = false;
    start(t, t.durationMs);
    return true;
  }

  return {
    show, dismiss, pause, resume,
    visible: () => vis.map((t) => snap(t, false)),
    queued: () => queue.map((t) => snap(t, true)),
    liveRegionProps(toast) {
      if (!toast || !KINDS.includes(toast.kind)) throw new RangeError("kind");
      const { role, ariaLive } = a11y(toast.kind);
      return { role, "aria-live": ariaLive, "aria-atomic": "true" };
    },
  };
}

module.exports = { createToaster };
