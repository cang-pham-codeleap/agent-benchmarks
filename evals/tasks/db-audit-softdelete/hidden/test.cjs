"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const ws = process.env.ACH_WORKSPACE || process.cwd();
let failed = 0;
let name$ = "";
function t(name, fn) {
  try {
    fn();
    console.log("ok   " + name$ + name);
  } catch (e) {
    failed++;
    console.log("FAIL " + name$ + name + ": " + (e && e.message ? e.message.split("\n")[0] : String(e)));
  }
}
process.on("exit", () => { if (failed > 0) process.exitCode = 1; });

let base, audit;
try {
  base = fs.readFileSync(path.join(ws, "base.sql"), "utf8");
  audit = fs.readFileSync(path.join(ws, "audit.sql"), "utf8");
} catch (e) {
  console.log("FAIL load: " + e.message);
  process.exit(1);
}

const TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const OLD = "2000-01-01T00:00:00.000Z";
const J = (s) => (s === null ? null : JSON.parse(s));

function run(recursive) {
  name$ = "[recursive=" + recursive + "] ";
  const fresh = () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA recursive_triggers = " + recursive);
    db.exec(base);
    db.exec(audit);
    return db;
  };
  const ins = (db, id, email, nm = null) =>
    db.prepare("INSERT INTO accounts(id,email,name) VALUES (?,?,?)").run(id, email, nm);
  const log = (db) => db.prepare("SELECT * FROM audit_log ORDER BY id").all();
  const row = (db, id) => db.prepare("SELECT * FROM accounts WHERE id=?").get(id);
  const stamp = (db, id) => db.prepare("UPDATE accounts SET updated_at=? WHERE id=?").run(OLD, id);
  const snap = (r) => ({ id: r.id, email: r.email, name: r.name, deleted_at: r.deleted_at, updated_at: r.updated_at });

  t("insert logs one row with final snapshot", () => {
    const db = fresh();
    ins(db, 1, "A@x.com", "Ann");
    const l = log(db);
    assert.equal(l.length, 1);
    assert.equal(l[0].op, "INSERT");
    assert.equal(l[0].row_id, 1);
    assert.equal(l[0].old_values, null);
    assert.equal(l[0].changed, null);
    assert.deepEqual(J(l[0].new_values), snap(row(db, 1)));
    assert.match(row(db, 1).updated_at, TS);
    assert.equal(row(db, 1).deleted_at, null);
  });
  t("insert overrides supplied updated_at", () => {
    const db = fresh();
    db.prepare("INSERT INTO accounts(id,email,updated_at) VALUES (1,'a@x.com',?)").run(OLD);
    assert.match(row(db, 1).updated_at, TS);
    assert.notEqual(row(db, 1).updated_at, OLD);
    assert.equal(J(log(db)[0].new_values).updated_at, row(db, 1).updated_at);
  });
  t("insert with NULL name keeps JSON null", () => {
    const db = fresh();
    ins(db, 1, "a@x.com");
    const n = J(log(db)[0].new_values);
    assert.ok("name" in n && n.name === null);
    assert.deepEqual(Object.keys(n).sort(), ["deleted_at", "email", "id", "name", "updated_at"]);
  });
  t("update logs old/new, changed list, touches updated_at", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "Ann");
    stamp(db, 1);
    const before = snap(row(db, 1));
    db.exec("UPDATE accounts SET name='Anna' WHERE id=1");
    const l = log(db);
    assert.equal(l.length, 2);
    assert.equal(l[1].op, "UPDATE");
    assert.equal(l[1].row_id, 1);
    assert.deepEqual(J(l[1].changed), ["name"]);
    assert.deepEqual(J(l[1].old_values), before);
    assert.deepEqual(J(l[1].new_values), snap(row(db, 1)));
    assert.notEqual(row(db, 1).updated_at, OLD);
    assert.match(row(db, 1).updated_at, TS);
  });
  t("changed lists several columns in table order", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "Ann");
    db.exec("UPDATE accounts SET deleted_at='x', name='B', email='b@x.com' WHERE id=1");
    assert.deepEqual(J(log(db)[1].changed), ["email", "name", "deleted_at"]);
  });
  t("no-op update (same values) logs nothing and keeps updated_at", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "Ann");
    stamp(db, 1);
    db.exec("UPDATE accounts SET name='Ann', email='a@x.com' WHERE id=1");
    db.exec("UPDATE accounts SET name=name WHERE id=1");
    assert.equal(log(db).length, 1);
    assert.equal(row(db, 1).updated_at, OLD);
  });
  t("NULL to NULL is no change, NULL to value is", () => {
    const db = fresh();
    ins(db, 1, "a@x.com");
    stamp(db, 1);
    db.exec("UPDATE accounts SET name=NULL, deleted_at=NULL WHERE id=1");
    assert.equal(log(db).length, 1);
    db.exec("UPDATE accounts SET name='N' WHERE id=1");
    assert.deepEqual(J(log(db)[1].changed), ["name"]);
    db.exec("UPDATE accounts SET name=NULL WHERE id=1");
    assert.deepEqual(J(log(db)[2].changed), ["name"]);
    assert.equal(J(log(db)[2].new_values).name, null);
  });
  t("case-only email change counts as a change", () => {
    const db = fresh();
    ins(db, 1, "a@x.com");
    db.exec("UPDATE accounts SET email='A@X.com' WHERE id=1");
    const l = log(db);
    assert.equal(l.length, 2);
    assert.deepEqual(J(l[1].changed), ["email"]);
    assert.equal(row(db, 1).email, "A@X.com");
  });
  t("multi-row update logs only rows that changed", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "same");
    ins(db, 2, "b@x.com", "other");
    ins(db, 3, "c@x.com", "other");
    db.exec("UPDATE accounts SET name='same'");
    const l = log(db).slice(3);
    assert.deepEqual(l.map((r) => r.row_id), [2, 3]);
    assert.ok(l.every((r) => r.op === "UPDATE" && JSON.stringify(J(r.changed)) === '["name"]'));
  });
  t("exactly one audit row per update (no recursion duplicates)", () => {
    const db = fresh();
    ins(db, 1, "a@x.com");
    db.exec("UPDATE accounts SET name='n1' WHERE id=1");
    db.exec("UPDATE accounts SET name='n2' WHERE id=1");
    assert.equal(log(db).filter((r) => r.op === "UPDATE").length, 2);
  });
  t("updated_at-only write is plain: stored as given, not audited", () => {
    const db = fresh();
    ins(db, 1, "a@x.com");
    db.prepare("UPDATE accounts SET updated_at=? WHERE id=1").run(OLD);
    assert.equal(row(db, 1).updated_at, OLD);
    assert.equal(log(db).length, 1);
  });
  t("caller-supplied updated_at is overridden when a real change happens", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "Ann");
    db.prepare("UPDATE accounts SET name='Z', updated_at=? WHERE id=1").run(OLD);
    assert.match(row(db, 1).updated_at, TS);
    assert.notEqual(row(db, 1).updated_at, OLD);
    assert.equal(J(log(db)[1].new_values).updated_at, row(db, 1).updated_at);
  });
  t("hard delete logs DELETE with old snapshot", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "Ann");
    const before = snap(row(db, 1));
    db.exec("DELETE FROM accounts WHERE id=1");
    const l = log(db);
    assert.equal(l.length, 2);
    assert.equal(l[1].op, "DELETE");
    assert.equal(l[1].row_id, 1);
    assert.deepEqual(J(l[1].old_values), before);
    assert.equal(l[1].new_values, null);
    assert.equal(l[1].changed, null);
    assert.equal(row(db, 1), undefined);
  });
  t("active_accounts view shape and filtering", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "Ann");
    ins(db, 2, "b@x.com", "Bob");
    db.exec("UPDATE accounts SET deleted_at='2020-01-01T00:00:00.000Z' WHERE id=2");
    const rows = db.prepare("SELECT * FROM active_accounts").all();
    assert.equal(rows.length, 1);
    assert.deepEqual(Object.keys(rows[0]), ["id", "email", "name", "updated_at"]);
    assert.equal(rows[0].id, 1);
  });
  t("delete via view soft-deletes (row stays, logged as UPDATE)", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "Ann");
    stamp(db, 1);
    db.exec("DELETE FROM active_accounts WHERE id=1");
    const r = row(db, 1);
    assert.ok(r, "row must still exist");
    assert.match(r.deleted_at, TS);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM active_accounts").get().n, 0);
    const l = log(db);
    assert.equal(l.length, 2);
    assert.equal(l[1].op, "UPDATE");
    assert.deepEqual(J(l[1].changed), ["deleted_at"]);
    assert.equal(J(l[1].old_values).deleted_at, null);
    assert.equal(J(l[1].new_values).deleted_at, r.deleted_at);
    assert.notEqual(r.updated_at, OLD);
  });
  t("view delete honours WHERE and handles many rows", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "Ann");
    ins(db, 2, "b@x.com", "Bob");
    ins(db, 3, "c@x.com", "Cy");
    db.exec("DELETE FROM active_accounts WHERE name <> 'Ann'");
    assert.deepEqual(db.prepare("SELECT id FROM active_accounts").all().map((r) => r.id), [1]);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounts").get().n, 3);
    assert.equal(log(db).filter((r) => r.op === "UPDATE").length, 2);
    db.exec("DELETE FROM active_accounts");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM active_accounts").get().n, 0);
    assert.equal(log(db).filter((r) => r.op === "UPDATE").length, 3);
  });
  t("view delete does not re-stamp already deleted rows", () => {
    const db = fresh();
    ins(db, 1, "a@x.com");
    ins(db, 2, "b@x.com");
    db.exec("DELETE FROM active_accounts WHERE id=1");
    db.prepare("UPDATE accounts SET deleted_at=? WHERE id=1").run(OLD);
    db.prepare("DELETE FROM active_accounts").run();
    assert.equal(row(db, 1).deleted_at, OLD);
    assert.match(row(db, 2).deleted_at, TS);
  });
  t("no hard DELETE audit rows from soft delete", () => {
    const db = fresh();
    ins(db, 1, "a@x.com");
    db.exec("DELETE FROM active_accounts");
    assert.equal(log(db).filter((r) => r.op === "DELETE").length, 0);
  });
  t("email unique ignoring ASCII case among active rows", () => {
    const db = fresh();
    ins(db, 1, "Ann@X.com");
    assert.throws(() => ins(db, 2, "ann@x.COM"), /UNIQUE|constraint/i);
    assert.throws(() => ins(db, 3, "Ann@X.com"), /UNIQUE|constraint/i);
    assert.equal(row(db, 1).email, "Ann@X.com");
  });
  t("failed insert leaves no audit row", () => {
    const db = fresh();
    ins(db, 1, "a@x.com");
    assert.throws(() => ins(db, 2, "A@x.com"));
    assert.equal(log(db).length, 1);
    assert.equal(row(db, 2), undefined);
  });
  t("update to a conflicting email fails atomically", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "A");
    ins(db, 2, "b@x.com", "B");
    stamp(db, 2);
    assert.throws(() => db.exec("UPDATE accounts SET email='A@X.COM' WHERE id=2"));
    assert.equal(row(db, 2).email, "b@x.com");
    assert.equal(row(db, 2).updated_at, OLD);
    assert.equal(log(db).length, 2);
  });
  t("multi-row update failing midway rolls back all rows and logs", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "A");
    ins(db, 2, "b@x.com", "B");
    assert.throws(() => db.exec("UPDATE accounts SET email='z@x.com'"));
    assert.equal(row(db, 1).email, "a@x.com");
    assert.equal(log(db).length, 2);
  });
  t("deleted email can be reused by a new account", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "old");
    db.exec("DELETE FROM active_accounts WHERE id=1");
    ins(db, 2, "A@X.com", "new");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM active_accounts").get().n, 1);
    assert.equal(row(db, 2).name, "new");
  });
  t("several deleted rows may share an email", () => {
    const db = fresh();
    for (let i = 1; i <= 3; i++) {
      ins(db, i, "a@x.com");
      db.exec("DELETE FROM active_accounts WHERE id=" + i);
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounts WHERE deleted_at IS NOT NULL").get().n, 3);
  });
  t("restore works when address is free, logged as UPDATE", () => {
    const db = fresh();
    ins(db, 1, "a@x.com");
    db.exec("DELETE FROM active_accounts WHERE id=1");
    db.exec("UPDATE accounts SET deleted_at=NULL WHERE id=1");
    assert.equal(row(db, 1).deleted_at, null);
    const l = log(db);
    assert.deepEqual(J(l[2].changed), ["deleted_at"]);
    assert.equal(J(l[2].new_values).deleted_at, null);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM active_accounts").get().n, 1);
  });
  t("restore fails when address is taken by an active row", () => {
    const db = fresh();
    ins(db, 1, "a@x.com");
    db.exec("DELETE FROM active_accounts WHERE id=1");
    ins(db, 2, "A@x.com");
    const n = log(db).length;
    assert.throws(() => db.exec("UPDATE accounts SET deleted_at=NULL WHERE id=1"));
    assert.match(row(db, 1).deleted_at, TS);
    assert.equal(log(db).length, n);
  });
  t("email of a deleted row may be edited to a taken address", () => {
    const db = fresh();
    ins(db, 1, "a@x.com");
    ins(db, 2, "b@x.com");
    db.exec("DELETE FROM active_accounts WHERE id=2");
    db.exec("UPDATE accounts SET email='A@x.com' WHERE id=2");
    assert.equal(row(db, 2).email, "A@x.com");
  });
  t("unique rule is an index, not trigger-only", () => {
    const db = fresh();
    const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='accounts' AND sql IS NOT NULL").all();
    assert.ok(idx.some((r) => /UNIQUE/i.test(r.sql) && /WHERE/i.test(r.sql)), "partial unique index expected");
  });
  t("non-ASCII emails are compared bytewise-case-sensitively like NOCASE", () => {
    const db = fresh();
    ins(db, 1, "é@x.com");
    ins(db, 2, "É@x.com");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM active_accounts").get().n, 2);
  });
  t("audit ids increase and ops sequence is right across a lifecycle", () => {
    const db = fresh();
    ins(db, 1, "a@x.com", "A");
    db.exec("UPDATE accounts SET name='B' WHERE id=1");
    db.exec("DELETE FROM active_accounts WHERE id=1");
    db.exec("DELETE FROM accounts WHERE id=1");
    const l = log(db);
    assert.deepEqual(l.map((r) => r.op), ["INSERT", "UPDATE", "UPDATE", "DELETE"]);
    assert.deepEqual(l.map((r) => r.row_id), [1, 1, 1, 1]);
    assert.ok(l.every((r, i) => i === 0 || r.id > l[i - 1].id));
  });
}

run("OFF");
run("ON");
