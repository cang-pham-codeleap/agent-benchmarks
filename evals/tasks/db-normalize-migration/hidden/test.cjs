const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ws = process.env.ACH_WORKSPACE || process.cwd();
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); }
};

const sql = fs.readFileSync(path.join(ws, 'migrate.sql'), 'utf8');
const data = [
  [1, 'Ann', 'ann@x.io', 'friend,work'],
  [2, 'Bob', null, ' a, A ,b,,'],
  [3, 'Cy', 'cy@x.io', ''],
  [4, 'Di', 'di@x.io', null],
  [5, 'Eve', 'eve@x.io', 'Work, FRIEND ,work'],
  [7, 'Fay', null, '  ,  , '],
  [9, 'Gus', 'gus@x.io', 'café, naïve,café'],
  [10, 'Hal', 'hal@x.io', 'Solo'],
];
const expected = {
  1: ['friend', 'work'], 2: ['a', 'b'], 3: [], 4: [], 5: ['friend', 'work'],
  7: [], 9: ['café', 'naïve'], 10: ['solo'],
};

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`CREATE TABLE contacts (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL, email TEXT, tags TEXT)`);
const ins = db.prepare('INSERT INTO contacts VALUES (?,?,?,?)');
for (const r of data) ins.run(...r);

let ran = true;
try { db.exec(sql); } catch (e) { ran = false; console.log(`FAIL migration-runs: ${e.message}`); failed++; }
if (!ran) process.exit(1);
console.log('ok migration-runs');

const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all();

check('transaction-closed', () => assert.strictEqual(db.isTransaction, false, 'transaction left open'));
check('uses-transaction', () => assert.match(sql, /\bBEGIN\b[\s\S]*\bCOMMIT\b/i));
check('contacts-columns', () => assert.deepStrictEqual(cols('contacts').map((c) => c.name), ['id', 'full_name', 'email']));
check('contacts-rows-kept', () => {
  const rows = db.prepare('SELECT id, full_name, email FROM contacts ORDER BY id').all();
  assert.deepStrictEqual(rows.map((r) => [r.id, r.full_name, r.email]), data.map((r) => r.slice(0, 3)));
});
check('tags-columns', () => assert.deepStrictEqual(cols('tags').map((c) => c.name).sort(), ['id', 'name']));
check('contact_tags-columns', () => {
  const c = cols('contact_tags');
  assert.deepStrictEqual(c.map((x) => x.name).sort(), ['contact_id', 'tag_id']);
  assert.deepStrictEqual(c.filter((x) => x.pk).map((x) => x.name).sort(), ['contact_id', 'tag_id'], 'composite primary key');
});
check('foreign-keys-declared', () => {
  const fk = db.prepare('PRAGMA foreign_key_list(contact_tags)').all().map((f) => `${f.from}->${f.table}.${f.to}`).sort();
  assert.deepStrictEqual(fk, ['contact_id->contacts.id', 'tag_id->tags.id']);
});
check('no-extra-tables', () => {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name).sort();
  assert.deepStrictEqual(names, ['contact_tags', 'contacts', 'tags']);
  assert.strictEqual(db.prepare("SELECT count(*) n FROM sqlite_temp_master WHERE type='table'").get().n, 0, 'temp table left');
});
check('tag-names-clean', () => {
  const names = db.prepare('SELECT name FROM tags').all().map((r) => r.name);
  for (const n of names) {
    assert.ok(n !== '', 'empty tag name');
    assert.strictEqual(n, n.trim(), `untrimmed ${JSON.stringify(n)}`);
    assert.strictEqual(n, n.toLowerCase(), `not lowercased ${JSON.stringify(n)}`);
  }
  assert.deepStrictEqual(names.sort(), ['a', 'b', 'café', 'friend', 'naïve', 'solo', 'work']);
});
check('tags-unique-enforced', () => {
  assert.throws(() => db.prepare('INSERT INTO tags(name) VALUES (?)').run('work'));
});
check('contact-tag-sets', () => {
  const q = db.prepare('SELECT t.name FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = ?');
  for (const id of Object.keys(expected)) {
    const got = q.all(Number(id)).map((r) => r.name).sort();
    assert.deepStrictEqual(got, expected[id], `contact ${id}`);
  }
});
check('no-duplicate-links', () => {
  const n = db.prepare('SELECT count(*) n FROM contact_tags').get().n;
  assert.strictEqual(n, Object.values(expected).reduce((s, a) => s + a.length, 0));
});
check('pk-enforced', () => {
  assert.throws(() => db.exec('INSERT INTO contact_tags SELECT contact_id, tag_id FROM contact_tags LIMIT 1'));
});
check('foreign-key-check', () => assert.deepStrictEqual(db.prepare('PRAGMA foreign_key_check').all(), []));
check('fk-enforced', () => {
  assert.throws(() => db.exec('INSERT INTO contact_tags VALUES (999, 1)'));
});

process.exit(failed ? 1 : 0);
