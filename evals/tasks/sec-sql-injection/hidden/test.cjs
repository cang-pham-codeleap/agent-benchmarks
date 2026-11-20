"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
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

const { findUserByEmail, searchUsers, listUsers } = require(path.join(ws, "users.js"));

const SEED = [
  [1, "Alice Smith", "alice@example.com", "admin"],
  [2, "Bob O'Brien", "bob@example.com", "user"],
  [3, "Carol 100% Real", "carol@example.com", "user"],
  [4, "Dave_Jones", "dave@example.com", "guest"],
  [5, "Eve", "eve@evil.test", "user"],
  [6, "Back\\slash", "back@example.com", "guest"],
];
function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, email TEXT, role TEXT)");
  db.exec("CREATE TABLE secrets(id INTEGER PRIMARY KEY, v TEXT)");
  db.exec("INSERT INTO secrets VALUES (1, 'topsecret')");
  const ins = db.prepare("INSERT INTO users VALUES (?, ?, ?, ?)");
  for (const r of SEED) ins.run(...r);
  return db;
}
const ids = (rows) => rows.map((r) => r.id);
const count = (db) => db.prepare("SELECT COUNT(*) AS n FROM users").get().n;

const PAYLOADS = [
  "' OR '1'='1",
  "' OR 1=1 --",
  "x'; DROP TABLE users;--",
  "' UNION SELECT id, v, v, v FROM secrets --",
  "\" OR \"\"=\"",
  "%' OR '%'='",
];

t("findUserByEmail normal", () => {
  const db = fresh();
  assert.equal(findUserByEmail(db, "alice@example.com").name, "Alice Smith");
  assert.equal(findUserByEmail(db, "nobody@example.com"), undefined);
  assert.equal(findUserByEmail(db, "ALICE@example.com"), undefined);
});
t("findUserByEmail ignores injection payloads", () => {
  const db = fresh();
  for (const p of PAYLOADS) assert.equal(findUserByEmail(db, p), undefined, p);
  assert.equal(count(db), SEED.length);
});
t("findUserByEmail handles quotes in data", () => {
  const db = fresh();
  db.prepare("INSERT INTO users VALUES (7, 'Q', ?, 'user')").run("o'neil@example.com");
  assert.equal(findUserByEmail(db, "o'neil@example.com").id, 7);
});
t("searchUsers normal", () => {
  const db = fresh();
  assert.deepEqual(ids(searchUsers(db, "example.com")), [1, 2, 3, 4, 6]);
  assert.deepEqual(ids(searchUsers(db, "alice")), [1]);
  assert.deepEqual(ids(searchUsers(db, "O'Brien")), [2]);
  assert.deepEqual(ids(searchUsers(db, "EVE")), [5]);
  assert.deepEqual(ids(searchUsers(db, "zzz")), []);
  assert.deepEqual(ids(searchUsers(db, "")), [1, 2, 3, 4, 5, 6]);
});
t("searchUsers ignores injection payloads", () => {
  const db = fresh();
  for (const p of PAYLOADS) assert.deepEqual(searchUsers(db, p), [], p);
  assert.equal(count(db), SEED.length);
});
t("searchUsers matches % and _ literally", () => {
  const db = fresh();
  assert.deepEqual(ids(searchUsers(db, "%")), [3]);
  assert.deepEqual(ids(searchUsers(db, "100%")), [3]);
  assert.deepEqual(ids(searchUsers(db, "_")), [4]);
  assert.deepEqual(ids(searchUsers(db, "e_J")), [4]);
  assert.deepEqual(ids(searchUsers(db, "a_c")), []);
  assert.deepEqual(ids(searchUsers(db, "A%e")), []);
});
t("searchUsers matches backslash literally", () => {
  const db = fresh();
  assert.deepEqual(ids(searchUsers(db, "\\")), [6]);
  assert.deepEqual(ids(searchUsers(db, "k\\s")), [6]);
  assert.deepEqual(ids(searchUsers(db, "\\%")), []);
});
t("listUsers sorting", () => {
  const db = fresh();
  assert.deepEqual(ids(listUsers(db)), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ids(listUsers(db, {})), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ids(listUsers(db, { order: "desc" })), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(ids(listUsers(db, { sortBy: "name", order: "DESC" })), [6, 5, 4, 3, 2, 1].sort((a, b) => {
    const n = (i) => SEED[i - 1][1];
    return n(a) < n(b) ? 1 : n(a) > n(b) ? -1 : 0;
  }));
  assert.deepEqual(ids(listUsers(db, { sortBy: "role" })), [1, 4, 6, 2, 3, 5]);
  assert.deepEqual(ids(listUsers(db, { sortBy: "role", order: "Desc" })), [2, 3, 5, 4, 6, 1]);
  assert.deepEqual(ids(listUsers(db, { sortBy: "email" })), [1, 6, 2, 3, 4, 5]);
});
t("listUsers rejects bad sortBy/order with RangeError", () => {
  const db = fresh();
  const bad = [
    { sortBy: "id; DROP TABLE users" },
    { sortBy: "id, (SELECT v FROM secrets)" },
    { sortBy: "password" },
    { sortBy: "" },
    { sortBy: "ID" },
    { sortBy: 1 },
    { sortBy: null },
    { order: "asc; DROP TABLE users" },
    { order: "sideways" },
    { order: "" },
    { order: null },
    { order: 5 },
  ];
  for (const o of bad) assert.throws(() => listUsers(db, o), RangeError, JSON.stringify(o));
  assert.equal(count(db), SEED.length);
});
t("table survives everything", () => {
  const db = fresh();
  for (const p of PAYLOADS) {
    findUserByEmail(db, p);
    searchUsers(db, p);
  }
  assert.equal(count(db), SEED.length);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM secrets").get().n, 1);
});
