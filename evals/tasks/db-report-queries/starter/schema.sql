CREATE TABLE customers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  signup_date TEXT NOT NULL            -- 'YYYY-MM-DD'
);
CREATE TABLE categories (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE products (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES categories(id)
);
CREATE TABLE orders (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  placed_at   TEXT NOT NULL,           -- 'YYYY-MM-DD HH:MM:SS'
  status      TEXT NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled'))
);
CREATE TABLE order_items (
  id               INTEGER PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES orders(id),
  product_id       INTEGER NOT NULL REFERENCES products(id),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0)
);
CREATE TABLE refunds (
  id            INTEGER PRIMARY KEY,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  refunded_at   TEXT NOT NULL          -- 'YYYY-MM-DD HH:MM:SS'
);
