const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ws = process.env.ACH_WORKSPACE || process.cwd();
const taskDir = process.env.ACH_TASK_DIR || path.resolve(__dirname, '..');
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`ok ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`); }
};
const read = (f) => fs.readFileSync(path.join(ws, f), 'utf8');

const V1 = `
CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT);
CREATE TABLE folders (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES folders(id), name TEXT NOT NULL);
CREATE TABLE documents (id INTEGER PRIMARY KEY, folder_id INTEGER NOT NULL REFERENCES folders(id),
  owner_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT);
CREATE TABLE shares (folder_id INTEGER NOT NULL REFERENCES folders(id), user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('read','write')), PRIMARY KEY (folder_id, user_id));
PRAGMA user_version = 1;
`;
const V1_DATA = `
INSERT INTO users VALUES (1,'Ann@Example.com','Ann'),(2,'bob@example.com',NULL),(3,'Cy@x.io','Cy'),(7,'dee@x.io','Dee');
INSERT INTO folders VALUES (1,NULL,'root'),(2,1,'a'),(3,2,'b'),(4,NULL,'x'),(10,12,'early'),(11,10,'deep'),(12,1,'late');
INSERT INTO documents VALUES (1,3,1,'Spec','text'),(2,11,2,'Notes',NULL),(5,1,1,'T',''),(8,4,3,'Z','zz');
INSERT INTO shares VALUES (2,3,'read'),(12,2,'write'),(4,1,'write');
`;

const fresh = () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
};
const dbFromSchema = () => { const db = fresh(); db.exec(read('schema.sql')); return db; };

let seq = 0;
function suite(label, db) {
  const c = (name, fn) => check(`${label}:${name}`, fn);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const tenant = () => Number(run('INSERT INTO tenants(name) VALUES (?)', `t${++seq}`).lastInsertRowid);
  const user = (t, email = `u${++seq}@x.io`) => Number(run('INSERT INTO users(tenant_id,email,name) VALUES (?,?,?)', t, email, 'n').lastInsertRowid);
  const folder = (t, p, name = `f${++seq}`) => Number(run('INSERT INTO folders(tenant_id,parent_id,name) VALUES (?,?,?)', t, p, name).lastInsertRowid);
  const doc = (t, f, o, title = 'd') => Number(run('INSERT INTO documents(tenant_id,folder_id,owner_id,title) VALUES (?,?,?,?)', t, f, o, title).lastInsertRowid);
  const share = (t, f, u, role = 'viewer') => run('INSERT INTO shares(tenant_id,folder_id,user_id,role) VALUES (?,?,?,?)', t, f, u, role);
  const move = (f, p) => run('UPDATE folders SET parent_id = ? WHERE id = ?', p, f);
  const count = (tbl, w = '1', ...a) => db.prepare(`SELECT count(*) n FROM ${tbl} WHERE ${w}`).get(...a).n;
  const rejects = (fn, msg) => assert.throws(fn, undefined, msg);

  c('basic-crud', () => {
    const t = tenant(); const u = user(t); const r = folder(t, null); const k = folder(t, r);
    doc(t, k, u); share(t, k, u, 'editor');
    assert.strictEqual(all('SELECT body FROM documents WHERE tenant_id = ?', t)[0].body, '');
  });
  c('email-case-insensitive-unique', () => {
    const t = tenant(); user(t, 'Alice@X.io');
    rejects(() => user(t, 'alice@x.IO'), 'case-variant duplicate accepted');
  });
  c('email-case-preserved-and-lookup', () => {
    const t = tenant(); const id = user(t, 'Mixed@Case.io');
    assert.strictEqual(all('SELECT email FROM users WHERE id = ?', id)[0].email, 'Mixed@Case.io');
    assert.strictEqual(all('SELECT id FROM users WHERE tenant_id = ? AND email = ?', t, 'mixed@case.IO').length, 1);
  });
  c('same-email-other-tenant-ok', () => { const a = tenant(); const b = tenant(); user(a, 'same@x.io'); user(b, 'SAME@x.io'); });
  c('email-needs-at', () => {
    const t = tenant();
    rejects(() => user(t, 'noat.example'));
    rejects(() => user(t, '@x.io'));
  });
  c('required-values', () => {
    const t = tenant();
    rejects(() => run('INSERT INTO tenants(name) VALUES (?)', ''));
    rejects(() => folder(t, null, ''));
    rejects(() => run('INSERT INTO users(tenant_id,email,name) VALUES (?,?,NULL)', t, 'n@x.io'));
    rejects(() => run('INSERT INTO documents(tenant_id,folder_id,owner_id,title) VALUES (?,NULL,NULL,?)', t, 'x'));
    const f = folder(t, null); const u = user(t);
    rejects(() => share(t, f, u, 'admin'));
  });
  c('tenant-name-unique', () => { const n = `dup${++seq}`; run('INSERT INTO tenants(name) VALUES (?)', n); rejects(() => run('INSERT INTO tenants(name) VALUES (?)', n)); });
  c('share-unique-per-folder-user', () => {
    const t = tenant(); const f = folder(t, null); const u = user(t);
    share(t, f, u); rejects(() => share(t, f, u, 'editor'));
  });
  c('xtenant-folder-parent', () => {
    const a = tenant(); const b = tenant(); const fa = folder(a, null);
    rejects(() => folder(b, fa));
  });
  c('xtenant-document-folder', () => {
    const a = tenant(); const b = tenant(); const fa = folder(a, null); const ub = user(b);
    rejects(() => doc(b, fa, ub));
  });
  c('xtenant-document-owner', () => {
    const a = tenant(); const b = tenant(); const fa = folder(a, null); const ub = user(b);
    rejects(() => doc(a, fa, ub));
  });
  c('xtenant-share', () => {
    const a = tenant(); const b = tenant(); const fa = folder(a, null); const ua = user(a); const ub = user(b);
    rejects(() => share(a, fa, ub), 'share to foreign user');
    rejects(() => share(b, fa, ub), 'share of foreign folder');
    rejects(() => share(b, fa, ua), 'fully foreign share');
  });
  c('unknown-tenant', () => { rejects(() => run('INSERT INTO users(tenant_id,email,name) VALUES (999999,?,?)', 'q@x.io', 'n')); });
  c('xtenant-move-rejected', () => {
    const a = tenant(); const b = tenant(); const fa = folder(a, null); const fb = folder(b, null);
    rejects(() => move(fb, fa));
    assert.strictEqual(all('SELECT parent_id p FROM folders WHERE id = ?', fb)[0].p, null);
  });
  c('tenant-id-immutable', () => {
    const a = tenant(); const b = tenant(); const f = folder(a, null); const u = user(a);
    rejects(() => run('UPDATE folders SET tenant_id = ? WHERE id = ?', b, f), 'folder');
    rejects(() => run('UPDATE users SET tenant_id = ? WHERE id = ?', b, u), 'user');
    const bf = folder(b, null); const bu = user(b); const d = doc(a, f, u);
    rejects(() => run('UPDATE documents SET tenant_id = ?, folder_id = ?, owner_id = ? WHERE id = ?', b, bf, bu, d), 'document');
    assert.strictEqual(count('documents', 'id = ? AND tenant_id = ?', d, a), 1);
  });
  c('tenant-delete-refused-with-rows', () => {
    const t = tenant(); user(t);
    rejects(() => run('DELETE FROM tenants WHERE id = ?', t));
    const e = tenant(); run('DELETE FROM tenants WHERE id = ?', e);
  });
  c('cycle-self-insert', () => {
    const t = tenant(); const next = Number(all('SELECT coalesce(max(id),0)+1 n FROM folders')[0].n);
    rejects(() => run('INSERT INTO folders(id,tenant_id,parent_id,name) VALUES (?,?,?,?)', next, t, next, 'self'));
    assert.strictEqual(count('folders', 'id = ?', next), 0);
  });
  c('cycle-self-move', () => {
    const t = tenant(); const f = folder(t, null);
    rejects(() => move(f, f));
  });
  c('cycle-two-node', () => {
    const t = tenant(); const a = folder(t, null); const b = folder(t, a);
    rejects(() => move(a, b));
  });
  c('cycle-grandchild', () => {
    const t = tenant(); const a = folder(t, null); const b = folder(t, a); const cc = folder(t, b);
    rejects(() => move(a, cc), 'move under grandchild');
    assert.strictEqual(all('SELECT parent_id p FROM folders WHERE id = ?', a)[0].p, null);
  });
  c('cycle-deep-chain', () => {
    const t = tenant(); const ids = [folder(t, null)];
    for (let i = 0; i < 6; i++) ids.push(folder(t, ids[i]));
    rejects(() => move(ids[0], ids[6]), 'depth 6');
    rejects(() => move(ids[2], ids[5]), 'mid-chain');
    rejects(() => move(ids[3], ids[4]), 'child');
  });
  c('cycle-sibling-branches-ok', () => {
    const t = tenant(); const r = folder(t, null); const a = folder(t, r); const b = folder(t, r);
    const a1 = folder(t, a); const b1 = folder(t, b);
    move(a, b1); move(b, null); move(a1, a);
    assert.strictEqual(all('SELECT parent_id p FROM folders WHERE id = ?', a)[0].p, b1);
  });
  c('move-after-move-then-cycle', () => {
    const t = tenant(); const a = folder(t, null); const b = folder(t, null); const x = folder(t, b);
    move(b, a);
    rejects(() => move(a, x), 'a is now an ancestor of x');
    move(x, null); move(a, x);
  });
  c('move-to-root-and-same-parent', () => {
    const t = tenant(); const a = folder(t, null); const b = folder(t, a);
    move(b, a); move(b, null); move(b, null);
    assert.strictEqual(count('folders', 'tenant_id = ? AND parent_id IS NULL', t), 2);
  });
  c('cascade-folder-subtree', () => {
    const t = tenant(); const u = user(t); const r = folder(t, null); const a = folder(t, r); const a1 = folder(t, a);
    const a2 = folder(t, a1); const keep = folder(t, r);
    doc(t, a, u); doc(t, a2, u); doc(t, keep, u, 'keep'); share(t, a1, u); share(t, keep, u);
    run('DELETE FROM folders WHERE id = ?', a);
    assert.deepStrictEqual(all('SELECT id FROM folders WHERE tenant_id = ? ORDER BY id', t).map((x) => x.id), [r, keep]);
    assert.deepStrictEqual(all('SELECT title FROM documents WHERE tenant_id = ?', t).map((x) => x.title), ['keep']);
    assert.deepStrictEqual(all('SELECT folder_id FROM shares WHERE tenant_id = ?', t).map((x) => x.folder_id), [keep]);
    assert.strictEqual(count('users', 'id = ?', u), 1);
  });
  c('cascade-isolated-between-tenants', () => {
    const a = tenant(); const b = tenant(); const fa = folder(a, null); const fb = folder(b, null);
    folder(a, fa); folder(b, fb);
    run('DELETE FROM folders WHERE tenant_id = ? AND parent_id IS NULL', a);
    assert.strictEqual(count('folders', 'tenant_id = ?', a), 0);
    assert.strictEqual(count('folders', 'tenant_id = ?', b), 2);
  });
  c('user-delete-refused-with-docs', () => {
    const t = tenant(); const u = user(t); const f = folder(t, null); share(t, f, u); doc(t, f, u);
    rejects(() => run('DELETE FROM users WHERE id = ?', u));
    assert.strictEqual(count('users', 'id = ?', u), 1);
    assert.strictEqual(count('shares', 'user_id = ?', u), 1, 'share must survive refused delete');
  });
  c('user-delete-ok-cascades-shares', () => {
    const t = tenant(); const u = user(t); const o = user(t); const f = folder(t, null); share(t, f, u); doc(t, f, o);
    run('DELETE FROM users WHERE id = ?', u);
    assert.strictEqual(count('shares', 'user_id = ?', u), 0);
    assert.strictEqual(count('documents', 'tenant_id = ?', t), 1);
  });
  c('user-delete-after-doc-gone', () => {
    const t = tenant(); const u = user(t); const f = folder(t, null); const d = doc(t, f, u);
    run('DELETE FROM documents WHERE id = ?', d); run('DELETE FROM users WHERE id = ?', u);
  });
  c('user-delete-blocked-even-when-folder-cascade-would-remove-doc-later', () => {
    const t = tenant(); const u = user(t); const f = folder(t, null); doc(t, f, u);
    rejects(() => run('DELETE FROM users WHERE id = ?', u));
    run('DELETE FROM folders WHERE id = ?', f); run('DELETE FROM users WHERE id = ?', u);
  });

  const plan = (sql, ...a) => all(`EXPLAIN QUERY PLAN ${sql}`, ...a).map((r) => r.detail);
  const usesIndex = (name, sql, table, cols, params) => c(`index-${name}`, () => {
    const d = plan(sql, ...params);
    assert.ok(!d.some((x) => /^SCAN/.test(x)), `table scan: ${d.join(' | ')}`);
    const re = new RegExp(`SEARCH ${table} USING (COVERING )?INDEX \\S+ \\(${cols.map((x) => `${x}=\\?`).join(' AND ')}`);
    assert.ok(d.some((x) => re.test(x)), `want ${cols.join('+')} lookup: ${d.join(' | ')}`);
    return d;
  });
  usesIndex('folders-children', 'SELECT * FROM folders WHERE tenant_id = ? AND parent_id = ? ORDER BY name', 'folders', ['tenant_id', 'parent_id'], [1, 1]);
  c('index-folders-children-sorted', () => {
    const d = plan('SELECT * FROM folders WHERE tenant_id = ? AND parent_id = ? ORDER BY name', 1, 1);
    assert.ok(!d.some((x) => /TEMP B-TREE/.test(x)), `sort step: ${d.join(' | ')}`);
  });
  usesIndex('folders-roots', 'SELECT * FROM folders WHERE tenant_id = ? AND parent_id IS NULL ORDER BY name', 'folders', ['tenant_id', 'parent_id'], [1]);
  usesIndex('documents-folder', 'SELECT * FROM documents WHERE tenant_id = ? AND folder_id = ?', 'documents', ['tenant_id', 'folder_id'], [1, 1]);
  usesIndex('documents-owner', 'SELECT * FROM documents WHERE tenant_id = ? AND owner_id = ?', 'documents', ['tenant_id', 'owner_id'], [1, 1]);
  usesIndex('shares-user', 'SELECT * FROM shares WHERE tenant_id = ? AND user_id = ?', 'shares', ['tenant_id', 'user_id'], [1, 1]);
  usesIndex('users-email', 'SELECT * FROM users WHERE tenant_id = ? AND email = ?', 'users', ['tenant_id', 'email'], [1, 'a@x.io']);
  c('user-version-2', () => assert.strictEqual(all('PRAGMA user_version')[0].user_version, 2));
  c('integrity', () => {
    assert.deepStrictEqual(all('PRAGMA foreign_key_check'), []);
    assert.deepStrictEqual(all('PRAGMA integrity_check').map((r) => r.integrity_check), ['ok']);
  });
  c('only-five-tables', () => {
    const n = all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name).sort();
    assert.deepStrictEqual(n, ['documents', 'folders', 'shares', 'tenants', 'users']);
    assert.strictEqual(all("SELECT count(*) n FROM sqlite_temp_master WHERE type='table'")[0].n, 0, 'temp table left');
  });
}

// ---- fresh schema ----
let schemaDb = null;
try { schemaDb = dbFromSchema(); console.log('ok schema-runs'); }
catch (e) { failed++; console.log(`FAIL schema-runs: ${e.message}`); }
if (schemaDb) suite('schema', schemaDb);

// ---- migration ----
let mdb = null;
try {
  mdb = fresh(); mdb.exec(V1); mdb.exec(V1_DATA);
  mdb.exec(read('migrate_v1.sql'));
  console.log('ok migration-runs');
} catch (e) { failed++; mdb = null; console.log(`FAIL migration-runs: ${e.message}`); }

if (mdb) {
  const all = (sql, ...a) => mdb.prepare(sql).all(...a);
  check('migration:transaction-closed', () => assert.strictEqual(mdb.isTransaction, false));
  check('migration:uses-transaction', () => assert.match(read('migrate_v1.sql'), /\bBEGIN\b[\s\S]*\bCOMMIT\b/i));
  check('migration:default-tenant', () => assert.deepStrictEqual(all('SELECT id, name FROM tenants').map((r) => [r.id, r.name]), [[1, 'default']]));
  check('migration:users', () => assert.deepStrictEqual(
    all('SELECT id, tenant_id, email, name FROM users ORDER BY id').map((r) => [r.id, r.tenant_id, r.email, r.name]),
    [[1, 1, 'Ann@Example.com', 'Ann'], [2, 1, 'bob@example.com', 'bob@example.com'], [3, 1, 'Cy@x.io', 'Cy'], [7, 1, 'dee@x.io', 'Dee']]));
  check('migration:folders-tree', () => assert.deepStrictEqual(
    all('SELECT id, tenant_id, parent_id, name FROM folders ORDER BY id').map((r) => [r.id, r.tenant_id, r.parent_id, r.name]),
    [[1, 1, null, 'root'], [2, 1, 1, 'a'], [3, 1, 2, 'b'], [4, 1, null, 'x'], [10, 1, 12, 'early'], [11, 1, 10, 'deep'], [12, 1, 1, 'late']]));
  check('migration:documents', () => assert.deepStrictEqual(
    all('SELECT id, tenant_id, folder_id, owner_id, title, body FROM documents ORDER BY id').map((r) => [r.id, r.tenant_id, r.folder_id, r.owner_id, r.title, r.body]),
    [[1, 1, 3, 1, 'Spec', 'text'], [2, 1, 11, 2, 'Notes', ''], [5, 1, 1, 1, 'T', ''], [8, 1, 4, 3, 'Z', 'zz']]));
  check('migration:shares-roles', () => assert.deepStrictEqual(
    all('SELECT tenant_id, folder_id, user_id, role FROM shares ORDER BY folder_id').map((r) => [r.tenant_id, r.folder_id, r.user_id, r.role]),
    [[1, 2, 3, 'viewer'], [1, 4, 1, 'editor'], [1, 12, 2, 'editor']]));
  check('migration:ids-continue', () => {
    const id = Number(mdb.prepare('INSERT INTO folders(tenant_id,parent_id,name) VALUES (1,NULL,?)').run('new').lastInsertRowid);
    assert.ok(id > 12, `new id ${id} collides or reuses`);
  });
  check('migration:cycle-in-migrated-tree', () => {
    assert.throws(() => mdb.exec('UPDATE folders SET parent_id = 11 WHERE id = 12'), undefined, 'late under its own grandchild');
    assert.throws(() => mdb.exec('UPDATE folders SET parent_id = 3 WHERE id = 1'), undefined, 'root under deep leaf');
    mdb.exec('UPDATE folders SET parent_id = 3 WHERE id = 4');
  });
  suite('migrated', mdb);
}

process.exit(failed ? 1 : 0);
