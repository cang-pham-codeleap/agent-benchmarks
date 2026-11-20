"use strict";

const MERGE_WINDOW_MS = 1000;

function createHistory({ doc, limit = Infinity, now = Date.now } = {}) {
  if (limit !== Infinity && !(Number.isInteger(limit) && limit > 0)) {
    throw new RangeError("limit must be Infinity or a positive integer");
  }
  let undoStack = [];
  let redoStack = [];
  let pending = null; // commands of the outermost running transaction
  let canMerge = false; // newest undo step may absorb the next execute
  let lastTime = 0;

  function push(step) {
    undoStack.push(step);
    redoStack = [];
    if (undoStack.length > limit) undoStack.splice(0, undoStack.length - limit);
  }

  function rollback(mark) {
    while (pending.length > mark) pending.pop().revert(doc);
  }

  function execute(cmd) {
    if (pending) {
      cmd.apply(doc);
      pending.push(cmd);
      return;
    }
    const t = now();
    cmd.apply(doc);
    const top = undoStack[undoStack.length - 1];
    if (canMerge && top && top.mergeable && t - lastTime <= MERGE_WINDOW_MS) {
      const cur = top.cmds[0];
      const merged = typeof cur.mergeWith === "function" ? cur.mergeWith(cmd) : null;
      if (merged) {
        top.cmds[0] = merged;
        lastTime = t;
        return;
      }
    }
    push({ cmds: [cmd], mergeable: true });
    canMerge = true;
    lastTime = t;
  }

  function transaction(fn) {
    if (pending) {
      const mark = pending.length;
      try {
        return fn();
      } catch (e) {
        rollback(mark);
        throw e;
      }
    }
    pending = [];
    let result;
    try {
      result = fn();
    } catch (e) {
      try {
        // (no rollback)
      } finally {
        pending = null;
      }
      throw e;
    }
    const cmds = pending;
    pending = null;
    if (cmds.length) {
      push({ cmds, mergeable: false });
      canMerge = false;
    }
    return result;
  }

  function undo() {
    if (pending) throw new Error("cannot undo inside a transaction");
    const step = undoStack.pop();
    if (!step) return false;
    for (let i = step.cmds.length - 1; i >= 0; i--) step.cmds[i].revert(doc);
    redoStack.push(step);
    canMerge = false;
    return true;
  }

  function redo() {
    if (pending) throw new Error("cannot redo inside a transaction");
    const step = redoStack.pop();
    if (!step) return false;
    for (const c of step.cmds) c.apply(doc);
    undoStack.push(step);
    canMerge = false;
    return true;
  }

  return {
    execute,
    undo,
    redo,
    transaction,
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
  };
}

module.exports = { createHistory };
