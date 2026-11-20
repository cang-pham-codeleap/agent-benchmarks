# Shop report queries

The workspace holds `schema.sql` and `seed.sql` (SQLite) for a small shop:
`customers`, `categories`, `products`, `orders`, `order_items`, `refunds`.
Do not edit them. Fill in the four named blocks of `queries.sql`.

## File convention

`queries.sql` is split into blocks. A block starts at a line
`-- name: <query_name>` and runs to the next such line or the end of the file.
Each block must be **one** SQL statement (a leading `WITH` is fine, a trailing
`;` is fine) that works on SQLite via `node:sqlite`. Keep the four names and the
output column names and order given below. Parameters are SQLite named
parameters (`:year`, `:threshold_cents`) and are bound by the caller; use them
exactly as spelled.

The queries are run against `seed.sql` and against other data with the same
schema, so don't hard-code anything from the seed.

## Shared definitions

- A **counted order** has status `paid` or `shipped`. `pending` and `cancelled`
  orders are ignored everywhere, including their refunds.
- An item's **gross** is `quantity * unit_price_cents`. Its **net** is gross
  minus the sum of all `refunds.amount_cents` that reference that item (an item
  may have several refunds, and a refund may not exceed what was paid).
- Revenue is attributed to the month/date the **order** was placed
  (`orders.placed_at`), regardless of when a refund happened.
- Counted orders may have no items (net 0). They still count as orders.
- Dates are `'YYYY-MM-DD'`, timestamps `'YYYY-MM-DD HH:MM:SS'`; the calendar
  month is the first 7 characters.

## Queries

### `monthly_net_revenue` (`:year`, an integer)

Columns `month` (text `'YYYY-MM'`), `net_cents` (integer). Exactly 12 rows for
the year, `'<year>-01'` .. `'<year>-12'` in that order, with `net_cents = 0`
for months without counted revenue. Net revenue of a month is the sum of the net
of all items in counted orders placed in that month.

### `top_products_per_category` (no parameters)

Columns `category` (category name), `product` (product name), `net_cents`,
`rank`. Product net revenue is the sum of the net of its items over all counted
orders; only products with at least one item in a counted order take part
(a fully refunded product has net 0 and does take part). Within each category
rank products by `net_cents` descending with `RANK()` semantics: tied products
share a rank and the next rank is skipped (1, 2, 2, 4). Return every product
with `rank <= 3`, so ties may produce more than three rows for a category.
Categories without a qualifying product don't appear. Order by `category`
ascending, `rank` ascending, `product` ascending.

### `repeat_purchase_rate` (no parameters)

One row per signup-month cohort (the first 7 characters of
`customers.signup_date`), for every month in which at least one customer signed
up. Columns:

- `cohort` text `'YYYY-MM'`;
- `customers`: all customers of the cohort;
- `buyers`: those with at least one counted order;
- `repeaters`: buyers who placed **another** counted order whose date is at most
  30 days after the date (time of day ignored) of their **first** counted order.
  The first order is the one with the smallest `(placed_at, id)`; any other
  counted order qualifies, including one placed the same day or with an equal
  timestamp. Example: first order on `2024-03-31`, another on `2024-04-30` counts;
  one on `2024-05-01` does not;
- `rate`: `repeaters / buyers` as a real rounded to 4 decimals, or `NULL` when
  `buyers = 0`.

Order by `cohort` ascending.

### `threshold_crossings` (`:threshold_cents`, a positive integer)

A customer's **order net** is the sum of the net of the items of one counted
order. Walk a customer's counted orders in `(placed_at, id)` order keeping a
running sum of order net. The **lifetime net** is the sum over all their
counted orders. Return one row for each customer whose lifetime net is
`>= :threshold_cents`: `customer_id`, `name`, `crossed_on` (the `'YYYY-MM-DD'`
date of the first order at which the running sum reached the threshold) and
`lifetime_net_cents`. Customers whose running sum reached the threshold at some
point but whose lifetime net ended below it (because of refunds) are not
returned. Order by `crossed_on` ascending, then `customer_id` ascending.
