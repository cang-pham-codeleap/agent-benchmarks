"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const ws = process.env.ACH_WORKSPACE || process.cwd();
let failed = 0;
function t(name, fn) {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failed++; console.log("FAIL " + name + ": " + (e && e.message ? e.message : e)); }
}
process.on("exit", () => { if (failed > 0) process.exitCode = 1; });

const sql = fs.readFileSync(path.join(ws, "schema.sql"), "utf8");
function fresh() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(sql);
  return db;
}
const rejects = (db, q, ...p) => {
  try { db.prepare(q).run(...p); } catch { return; }
  throw new Error("accepted but should be rejected: " + q + " " + JSON.stringify(p));
};
const ok = (db, q, ...p) => db.prepare(q).run(...p);

function seeded() {
  const db = fresh();
  ok(db, "INSERT INTO customers(id,email,name) VALUES (1,'Ann@x.com','Ann'),(2,'bob@x.com','Bob')");
  ok(db, "INSERT INTO products(id,sku,name,price_cents) VALUES (1,'A1','Apple',150),(2,'B2','Bean',0)");
  ok(db, "INSERT INTO orders(id,customer_id) VALUES (1,1)");
  ok(db, "INSERT INTO order_items(order_id,product_id,quantity,unit_price_cents) VALUES (1,1,2,150)");
  return db;
}

t("valid data and defaults", () => {
  const db = seeded();
  const o = db.prepare("SELECT status, created_at FROM orders WHERE id=1").get();
  if (o.status !== "pending") throw new Error("default status " + o.status);
  if (!o.created_at) throw new Error("created_at not defaulted");
  if (db.prepare("SELECT active FROM products WHERE id=1").get().active !== 1) throw new Error("active default");
  for (const s of ["paid", "shipped", "cancelled"]) ok(db, "INSERT INTO orders(customer_id,status) VALUES (2,?)", s);
});
t("email unique case-insensitively", () => {
  const db = seeded();
  rejects(db, "INSERT INTO customers(email,name) VALUES ('ann@X.COM','Dup')");
  rejects(db, "INSERT INTO customers(email,name) VALUES ('bob@x.com','Dup')");
  rejects(db, "INSERT INTO customers(email,name) VALUES (NULL,'N')");
});
t("customer name required", () => rejects(seeded(), "INSERT INTO customers(email,name) VALUES ('c@x.com',NULL)"));
t("sku unique and required", () => {
  const db = seeded();
  rejects(db, "INSERT INTO products(sku,name,price_cents) VALUES ('A1','Dup',1)");
  rejects(db, "INSERT INTO products(sku,name,price_cents) VALUES (NULL,'N',1)");
});
t("price non-negative integer", () => {
  const db = seeded();
  rejects(db, "INSERT INTO products(sku,name,price_cents) VALUES ('N1','n',-1)");
  rejects(db, "INSERT INTO products(sku,name,price_cents) VALUES ('N2','n',1.5)");
  rejects(db, "INSERT INTO products(sku,name,price_cents) VALUES ('N3','n','abc')");
  rejects(db, "INSERT INTO products(sku,name,price_cents) VALUES ('N4','n',NULL)");
  ok(db, "INSERT INTO products(sku,name,price_cents) VALUES ('N5','n',0)");
});
t("active is 0 or 1", () => {
  const db = seeded();
  rejects(db, "INSERT INTO products(sku,name,price_cents,active) VALUES ('N1','n',1,2)");
  rejects(db, "INSERT INTO products(sku,name,price_cents,active) VALUES ('N2','n',1,NULL)");
  ok(db, "INSERT INTO products(sku,name,price_cents,active) VALUES ('N3','n',1,0)");
});
t("order status restricted", () => {
  const db = seeded();
  rejects(db, "INSERT INTO orders(customer_id,status) VALUES (1,'refunded')");
  rejects(db, "INSERT INTO orders(customer_id,status) VALUES (1,'PAID')");
  rejects(db, "UPDATE orders SET status='lost' WHERE id=1");
  rejects(db, "INSERT INTO orders(customer_id,status) VALUES (1,NULL)");
});
t("order requires existing customer", () => {
  const db = seeded();
  rejects(db, "INSERT INTO orders(customer_id) VALUES (99)");
  rejects(db, "INSERT INTO orders(customer_id) VALUES (NULL)");
});
t("item quantity positive integer", () => {
  const db = seeded();
  for (const q of [0, -3, 1.5, "x", null])
    rejects(db, "INSERT INTO order_items(order_id,product_id,quantity,unit_price_cents) VALUES (1,2,?,5)", q);
});
t("item unit price non-negative integer", () => {
  const db = seeded();
  for (const p of [-1, 2.5, "x", null])
    rejects(db, "INSERT INTO order_items(order_id,product_id,quantity,unit_price_cents) VALUES (1,2,1,?)", p);
  ok(db, "INSERT INTO order_items(order_id,product_id,quantity,unit_price_cents) VALUES (1,2,1,0)");
});
t("one row per product per order", () => {
  const db = seeded();
  rejects(db, "INSERT INTO order_items(order_id,product_id,quantity,unit_price_cents) VALUES (1,1,1,150)");
  ok(db, "INSERT INTO orders(id,customer_id) VALUES (2,1)");
  ok(db, "INSERT INTO order_items(order_id,product_id,quantity,unit_price_cents) VALUES (2,1,1,150)");
});
t("items require existing order and product", () => {
  const db = seeded();
  rejects(db, "INSERT INTO order_items(order_id,product_id,quantity,unit_price_cents) VALUES (99,1,1,1)");
  rejects(db, "INSERT INTO order_items(order_id,product_id,quantity,unit_price_cents) VALUES (1,99,1,1)");
});
t("deleting an order cascades to items", () => {
  const db = seeded();
  ok(db, "DELETE FROM orders WHERE id=1");
  if (db.prepare("SELECT COUNT(*) n FROM order_items").get().n !== 0) throw new Error("items remain");
});
t("deleting a customer with orders is refused", () => {
  const db = seeded();
  rejects(db, "DELETE FROM customers WHERE id=1");
  ok(db, "DELETE FROM customers WHERE id=2");
  if (db.prepare("SELECT COUNT(*) n FROM orders").get().n !== 1) throw new Error("order lost");
});
t("deleting a referenced product is refused", () => {
  const db = seeded();
  rejects(db, "DELETE FROM products WHERE id=1");
  ok(db, "DELETE FROM products WHERE id=2");
});
t("customer deletable after its orders are gone", () => {
  const db = seeded();
  ok(db, "DELETE FROM orders WHERE id=1");
  ok(db, "DELETE FROM customers WHERE id=1");
  ok(db, "DELETE FROM products WHERE id=1");
});

function plan(db, q) {
  return db.prepare("EXPLAIN QUERY PLAN " + q).all().map((r) => r.detail).join(" | ");
}
for (const [name, q] of [
  ["orders by customer", "SELECT * FROM orders WHERE customer_id = 1"],
  ["items by order", "SELECT * FROM order_items WHERE order_id = 1"],
  ["products by sku", "SELECT * FROM products WHERE sku = 'A1'"],
]) {
  t("index used: " + name, () => {
    const p = plan(seeded(), q);
    if (!/SEARCH/.test(p) || /SCAN/.test(p)) throw new Error("full scan, plan: " + p);
  });
}
