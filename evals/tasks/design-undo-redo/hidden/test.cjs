"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const ws = process.env.ACH_WORKSPACE || process.cwd();
let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log("ok   " + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name + ": " + (e && e.message ? e.message : String(e)));
  }
}
process.on("exit", () => {
  if (failed > 0) process.exitCode = 1;
});

let createHistory;
try {
  ({ createHistory } = require(path.join(ws, "history.js")));
} catch (e) {
  console.log("FAIL load: " + e.message);
  process.exit(1);
}
if (typeof createHistory !== "function") {
  console.log("FAIL load: createHistory is not exported");
  process.exit(1);
}

// --- document model + commands (shipped with the test) ---
function makeDoc(text = "") {
  return {
    text,
    log: [],
    insert(pos, s) {
      if (pos < 0 || pos > this.text.length) throw new RangeError("bad pos");
      this.text = this.text.slice(0, pos) + s + this.text.slice(pos);
      this.log.push("i" + pos + s);
    },
    remove(pos, len) {
      const gone = this.text.slice(pos, pos + len);
      this.text = this.text.slice(0, pos) + this.text.slice(pos + len);
      this.log.push("r" + pos + gone);
      return gone;
    },
  };
}
function ins(pos, s) {
  return {
    kind: "ins", pos, s,
    apply(d) { d.insert(pos, s); },
    revert(d) { d.remove(pos, s.length); },
    mergeWith(next) {
      if (next.kind === "ins" && next.pos === pos + s.length) return ins(pos, s + next.s);
      return null;
    },
  };
}
function del(pos, len) {
  let gone = "";
  return {
    apply(d) { gone = d.remove(pos, len); },
    revert(d) { d.insert(pos, gone); },
  };
}
const boom = (msg = "boom") => ({
  apply() { throw new Error(msg); },
  revert() { throw new Error("revert of failed command"); },
});
function clock(start = 1000) {
  const c = { t: start, now: () => c.t, tick(ms) { c.t += ms; } };
  return c;
}
function setup(opts = {}) {
  const doc = makeDoc(opts.text || "");
  const c = clock();
  const h = createHistory({ doc, now: c.now, ...opts.h });
  return { doc, c, h };
}
const throwsMsg = (fn, msg) => assert.throws(fn, (e) => e.message === msg);

t("basic execute/undo/redo", () => {
  const { doc, h } = setup();
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  h.execute(ins(0, "ab"));
  assert.equal(doc.text, "ab");
  assert.equal(h.canUndo, true);
  assert.equal(h.undo(), true);
  assert.equal(doc.text, "");
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, true);
  assert.equal(h.redo(), true);
  assert.equal(doc.text, "ab");
  assert.equal(h.canRedo, false);
});

t("undo/redo on empty stacks return false", () => {
  const { doc, h } = setup({ text: "x" });
  assert.equal(h.undo(), false);
  assert.equal(h.redo(), false);
  assert.equal(doc.text, "x");
});

t("separate steps without mergeWith undo one at a time in order", () => {
  const { doc, c, h } = setup({ text: "hello" });
  h.execute(del(0, 1));
  c.tick(10);
  h.execute(del(0, 1));
  assert.equal(doc.text, "llo");
  h.undo();
  assert.equal(doc.text, "ello");
  h.undo();
  assert.equal(doc.text, "hello");
  h.redo();
  h.redo();
  assert.equal(doc.text, "llo");
});

t("new execute clears redo", () => {
  const { h } = setup();
  h.execute(del0());
  h.undo();
  assert.equal(h.canRedo, true);
  h.execute(ins(0, "z"));
  assert.equal(h.canRedo, false);
  assert.equal(h.redo(), false);
  function del0() { return ins(0, "a"); }
});

t("failing apply records nothing and keeps redo", () => {
  const { doc, h } = setup();
  h.execute(ins(0, "a"));
  h.undo();
  throwsMsg(() => h.execute(boom("nope")), "nope");
  assert.equal(h.canRedo, true);
  assert.equal(h.canUndo, false);
  assert.equal(doc.text, "");
});

t("fast consecutive mergeable commands merge into one step", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "a"));
  c.tick(100);
  h.execute(ins(1, "b"));
  c.tick(100);
  h.execute(ins(2, "c"));
  assert.equal(doc.text, "abc");
  doc.log.length = 0;
  h.undo();
  assert.equal(doc.text, "");
  assert.deepEqual(doc.log, ["r0abc"], "merged step reverts once");
  assert.equal(h.canUndo, false);
  doc.log.length = 0;
  h.redo();
  assert.deepEqual(doc.log, ["i0abc"], "merged step re-applies once");
});

t("merge window is 1000 ms inclusive", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "a"));
  c.tick(1000);
  h.execute(ins(1, "b"));
  h.undo();
  assert.equal(doc.text, "", "exactly 1000 ms merges");
  h.redo();
  c.tick(1001);
  h.execute(ins(2, "c"));
  h.undo();
  assert.equal(doc.text, "ab", "1001 ms does not merge");
});

t("merge window slides from the last merged command", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "a"));
  for (let i = 1; i < 6; i++) {
    c.tick(800);
    h.execute(ins(i, "x"));
  }
  assert.equal(doc.text, "axxxxx");
  h.undo();
  assert.equal(doc.text, "");
});

t("window is measured from the newest step after a failed merge", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "a"));
  c.tick(900);
  h.execute(ins(0, "X")); // not adjacent: new step
  c.tick(900);
  h.execute(ins(1, "Y")); // 900 after X, 1800 after a: merges into X
  assert.equal(doc.text, "XYa");
  h.undo();
  assert.equal(doc.text, "a");
});

t("mergeWith returning falsy starts a new step", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "ab"));
  c.tick(5);
  h.execute(ins(0, "X")); // not adjacent -> no merge
  assert.equal(doc.text, "Xab");
  h.undo();
  assert.equal(doc.text, "ab");
  h.undo();
  assert.equal(doc.text, "");
});

t("a non-merging command still becomes the merge base for the next", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "ab"));
  c.tick(5);
  h.execute(ins(0, "X")); // new step, base is now ins(0,"X")
  c.tick(5);
  h.execute(ins(1, "Y")); // adjacent to X -> merges into X's step
  assert.equal(doc.text, "XYab");
  h.undo();
  assert.equal(doc.text, "ab");
  h.undo();
  assert.equal(doc.text, "");
});

t("command without mergeWith never absorbs the next one", () => {
  const { doc, c, h } = setup({ text: "abc" });
  h.execute(del(0, 1));
  c.tick(1);
  h.execute(ins(2, "z"));
  h.undo();
  assert.equal(doc.text, "bc");
});

t("undo breaks the merge chain", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "a"));
  c.tick(10);
  h.execute(ins(1, "b"));
  c.tick(10);
  h.undo();
  h.execute(ins(0, "c"));
  c.tick(10);
  h.execute(ins(1, "d"));
  h.undo();
  assert.equal(doc.text, "", "c+d merged; nothing older remains");
  assert.equal(h.canUndo, false);
});

t("redo breaks the merge chain", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "a"));
  h.undo();
  h.redo();
  c.tick(10);
  h.execute(ins(1, "b"));
  assert.equal(doc.text, "ab");
  h.undo();
  assert.equal(doc.text, "a", "b is its own step after a redo");
});

t("merging into an older step after undo is not allowed", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "a"));
  c.tick(2000);
  h.execute(ins(1, "b"));
  h.execute(ins(2, "c")); // merges into b
  h.undo(); // removes bc
  c.tick(10);
  h.execute(ins(1, "d")); // adjacent to 'a' step but must not merge
  h.undo();
  assert.equal(doc.text, "a");
});

t("merge does not count against limit", () => {
  const { doc, c, h } = setup({ h: { limit: 3 } });
  h.execute(ins(0, "a"));
  c.tick(10);
  h.execute(ins(1, "b"));
  c.tick(10);
  h.execute(ins(2, "c"));
  c.tick(5000);
  h.execute(ins(3, "d"));
  c.tick(5000);
  h.execute(ins(4, "e"));
  assert.equal(doc.text, "abcde");
  h.undo();
  h.undo();
  assert.equal(doc.text, "abc");
  assert.equal(h.canUndo, true, "merged abc step survived limit 3");
  h.undo();
  assert.equal(doc.text, "");
});

t("transaction groups commands into one step", () => {
  const { doc, h } = setup({ text: "abc" });
  const r = h.transaction(() => {
    h.execute(del(0, 1));
    h.execute(ins(0, "XY"));
    h.execute(del(1, 1));
    return 42;
  });
  assert.equal(r, 42);
  assert.equal(doc.text, "Xbc");
  h.undo();
  assert.equal(doc.text, "abc");
  assert.equal(h.canUndo, false);
  h.redo();
  assert.equal(doc.text, "Xbc");
});

t("undo reverts a transaction in reverse order, redo applies in order", () => {
  const { doc, h } = setup();
  h.transaction(() => {
    h.execute(ins(0, "a"));
    h.execute(ins(1, "b"));
  });
  doc.log.length = 0;
  h.undo();
  assert.deepEqual(doc.log, ["r1b", "r0a"]);
  doc.log.length = 0;
  h.redo();
  assert.deepEqual(doc.log, ["i0a", "i1b"]);
});

t("commands inside a transaction never merge with each other", () => {
  const { doc, h } = setup();
  doc.log.length = 0;
  h.transaction(() => {
    h.execute(ins(0, "a"));
    h.execute(ins(1, "b"));
  });
  h.undo();
  assert.deepEqual(doc.log.slice(2), ["r1b", "r0a"]);
});

t("transaction steps neither merge into nor absorb plain steps", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "a"));
  c.tick(5);
  h.transaction(() => h.execute(ins(1, "b")));
  c.tick(5);
  h.execute(ins(2, "c"));
  assert.equal(doc.text, "abc");
  h.undo();
  assert.equal(doc.text, "ab", "c separate from tx step");
  h.undo();
  assert.equal(doc.text, "a", "tx step separate from a");
  h.undo();
  assert.equal(doc.text, "");
});

t("transaction commit ends the merge chain even for a later execute", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "a"));
  c.tick(5);
  h.transaction(() => h.execute(ins(1, "b")));
  c.tick(5);
  h.execute(ins(2, "c"));
  c.tick(5);
  h.execute(ins(3, "d")); // merges with c
  h.undo();
  assert.equal(doc.text, "ab");
});

t("nested transactions flatten into one step", () => {
  const { doc, h } = setup();
  h.transaction(() => {
    h.execute(ins(0, "a"));
    h.transaction(() => {
      h.execute(ins(1, "b"));
      h.transaction(() => h.execute(ins(2, "c")));
    });
    h.execute(ins(3, "d"));
  });
  assert.equal(doc.text, "abcd");
  h.undo();
  assert.equal(doc.text, "");
  assert.equal(h.canUndo, false);
  h.redo();
  assert.equal(doc.text, "abcd");
});

t("throwing transaction reverts everything and rethrows the same error", () => {
  const { doc, h } = setup({ text: "x" });
  const err = new Error("kaboom");
  assert.throws(
    () =>
      h.transaction(() => {
        h.execute(ins(1, "a"));
        h.execute(ins(2, "b"));
        throw err;
      }),
    (e) => e === err,
  );
  assert.equal(doc.text, "x");
  assert.equal(h.canUndo, false);
});

t("rollback reverts in reverse order", () => {
  const { doc, h } = setup();
  h.execute(ins(0, "-"));
  doc.log.length = 0;
  assert.throws(() =>
    h.transaction(() => {
      h.execute(ins(1, "a"));
      h.execute(ins(2, "b"));
      throw new Error("x");
    }),
  );
  assert.deepEqual(doc.log, ["i1a", "i2b", "r2b", "r1a"]);
});

t("failing apply inside a transaction rolls back earlier commands", () => {
  const { doc, h } = setup({ text: "x" });
  throwsMsg(
    () =>
      h.transaction(() => {
        h.execute(ins(1, "a"));
        h.execute(boom("inner-fail"));
        h.execute(ins(2, "never"));
      }),
    "inner-fail",
  );
  assert.equal(doc.text, "x");
  assert.equal(h.canUndo, false);
});

t("rolled-back transaction keeps redo stack and history intact", () => {
  const { doc, h } = setup();
  h.execute(ins(0, "a"));
  h.execute(ins(1, "b")); // merged
  h.undo();
  assert.equal(h.canRedo, true);
  assert.throws(() =>
    h.transaction(() => {
      h.execute(ins(0, "q"));
      throw new Error("x");
    }),
  );
  assert.equal(h.canRedo, true);
  h.redo();
  assert.equal(doc.text, "ab");
});

t("rolled-back transaction does not break merge eligibility", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "a"));
  c.tick(5);
  assert.throws(() =>
    h.transaction(() => {
      h.execute(ins(1, "zz"));
      throw new Error("x");
    }),
  );
  c.tick(5);
  h.execute(ins(1, "b"));
  h.undo();
  assert.equal(doc.text, "", "b merged with a");
});

t("empty transaction creates no step and keeps redo", () => {
  const { doc, h } = setup();
  h.execute(ins(0, "a"));
  h.undo();
  h.transaction(() => {});
  h.transaction(() => h.transaction(() => {}));
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, true);
  h.redo();
  assert.equal(doc.text, "a");
});

t("empty transaction does not break the merge chain", () => {
  const { doc, c, h } = setup();
  h.execute(ins(0, "a"));
  c.tick(5);
  h.transaction(() => {});
  c.tick(5);
  h.execute(ins(1, "b"));
  h.undo();
  assert.equal(doc.text, "");
});

t("committing a non-empty transaction clears redo", () => {
  const { h } = setup();
  h.execute(ins(0, "a"));
  h.undo();
  h.transaction(() => h.execute(ins(0, "b")));
  assert.equal(h.canRedo, false);
});

t("failed inner transaction reverts only its own commands", () => {
  const { doc, h } = setup();
  h.transaction(() => {
    h.execute(ins(0, "a"));
    try {
      h.transaction(() => {
        h.execute(ins(1, "b"));
        h.execute(ins(2, "c"));
        throw new Error("inner");
      });
    } catch (e) {
      assert.equal(e.message, "inner");
    }
    assert.equal(doc.text, "a");
    h.execute(ins(1, "d"));
  });
  assert.equal(doc.text, "ad");
  h.undo();
  assert.equal(doc.text, "");
  assert.equal(h.canUndo, false);
  h.redo();
  assert.equal(doc.text, "ad");
});

t("failed inner transaction propagating out rolls back the whole outer", () => {
  const { doc, h } = setup();
  assert.throws(
    () =>
      h.transaction(() => {
        h.execute(ins(0, "a"));
        h.transaction(() => {
          h.execute(ins(1, "b"));
          throw new Error("deep");
        });
      }),
    /deep/,
  );
  assert.equal(doc.text, "");
  assert.equal(h.canUndo, false);
});

t("undo/redo inside a transaction throw and change nothing", () => {
  const { doc, h } = setup();
  h.execute(ins(0, "a"));
  assert.throws(() =>
    h.transaction(() => {
      h.execute(ins(1, "b"));
      h.undo();
    }),
  );
  assert.equal(doc.text, "a", "tx rolled back, committed step untouched");
  assert.equal(h.canUndo, true);
  h.undo();
  h.redo();
  assert.throws(() => h.transaction(() => h.redo()));
  assert.equal(doc.text, "a");
});

t("canUndo/canRedo reflect committed stacks during a transaction", () => {
  const { h } = setup();
  h.transaction(() => {
    h.execute(ins(0, "a"));
    assert.equal(h.canUndo, false);
  });
  assert.equal(h.canUndo, true);
});

t("transaction is usable again after a rollback", () => {
  const { doc, h } = setup();
  assert.throws(() => h.transaction(() => { h.execute(ins(0, "a")); throw new Error("x"); }));
  h.transaction(() => h.execute(ins(0, "b")));
  assert.equal(doc.text, "b");
  h.undo();
  assert.equal(doc.text, "");
});

t("limit drops oldest steps", () => {
  const { doc, c, h } = setup({ text: "abcde", h: { limit: 3 } });
  for (let i = 0; i < 5; i++) {
    h.execute(del(0, 1));
    c.tick(5000);
  }
  assert.equal(doc.text, "");
  assert.equal(h.undo(), true);
  assert.equal(h.undo(), true);
  assert.equal(h.undo(), true);
  assert.equal(h.undo(), false);
  assert.equal(doc.text, "cde");
});

t("limit counts a transaction as one step", () => {
  const { doc, c, h } = setup({ text: "abcdef", h: { limit: 2 } });
  h.execute(del(0, 1));
  c.tick(5000);
  h.transaction(() => {
    h.execute(del(0, 1));
    h.execute(del(0, 1));
    h.execute(del(0, 1));
  });
  c.tick(5000);
  h.execute(del(0, 1));
  assert.equal(doc.text, "f");
  h.undo();
  h.undo();
  assert.equal(h.canUndo, false);
  assert.equal(doc.text, "bcdef");
});

t("redo survives limit trimming of the undo stack", () => {
  const { doc, c, h } = setup({ text: "abc", h: { limit: 1 } });
  h.execute(del(0, 1));
  c.tick(5000);
  h.execute(del(0, 1));
  h.undo();
  assert.equal(h.canRedo, true);
  h.redo();
  assert.equal(doc.text, "c");
  assert.equal(h.canUndo, true);
});

t("limit validation", () => {
  const doc = makeDoc();
  for (const bad of [0, -1, 1.5, NaN, "3"]) {
    assert.throws(() => createHistory({ doc, limit: bad }), RangeError, "limit " + String(bad));
  }
  createHistory({ doc, limit: 1 });
  createHistory({ doc, limit: Infinity });
});

t("independent histories do not share state", () => {
  const a = setup();
  const b = setup();
  a.h.execute(ins(0, "a"));
  assert.equal(b.h.canUndo, false);
  assert.equal(b.h.undo(), false);
});
