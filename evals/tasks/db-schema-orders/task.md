# Orders schema

Write `schema.sql` (SQLite dialect) in the workspace root for a small shop.
It will be executed as a whole, on an empty in-memory database, by
`node:sqlite` `exec()` with `PRAGMA foreign_keys = ON` already set. It must
contain only `CREATE TABLE` / `CREATE INDEX` statements.

## Tables and columns

Use exactly these table and column names:

- `customers(id, email, name)`
  - `id` integer primary key; `email` and `name` required.
  - `email` is unique **case-insensitively** (`Ann@x.com` and `ann@X.com`
    are the same customer).
- `products(id, sku, name, price_cents, active)`
  - `id` integer primary key; `sku` required and unique; `name` required.
  - `price_cents` required, a whole number of cents, never negative.
    Non-integer values such as `1.5` or `'abc'` are rejected.
  - `active` is `0` or `1` only, default `1`.
- `orders(id, customer_id, status, created_at)`
  - `id` integer primary key; `customer_id` required, references a customer.
  - `status` is one of `pending`, `paid`, `shipped`, `cancelled`; default
    `pending`.
  - `created_at` required, defaults to the current time.
- `order_items(id, order_id, product_id, quantity, unit_price_cents)`
  - `id` integer primary key; `order_id` and `product_id` required and
    reference an order and a product.
  - `quantity` is a whole number greater than 0.
  - `unit_price_cents` is the price snapshot at purchase time: required, a
    whole number, never negative.
  - A product appears at most once per order.

## Referential behavior

- Deleting an order deletes its items.
- Deleting a customer that has orders is refused.
- Deleting a product referenced by any order item is refused.
- Rows referencing a missing customer, order or product are rejected.

## Indexes

These queries must be answered through an index, never a full table scan:

```sql
SELECT * FROM orders WHERE customer_id = ?;
SELECT * FROM order_items WHERE order_id = ?;
SELECT * FROM products WHERE sku = ?;
```
