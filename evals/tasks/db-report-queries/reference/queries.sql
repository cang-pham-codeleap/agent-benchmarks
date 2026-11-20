-- name: monthly_net_revenue
WITH RECURSIVE months(m) AS (
  SELECT 1 UNION ALL SELECT m + 1 FROM months WHERE m < 12
),
item_net AS (
  SELECT oi.order_id,
         oi.quantity * oi.unit_price_cents
           - COALESCE((SELECT SUM(r.amount_cents) FROM refunds r WHERE r.order_item_id = oi.id), 0) AS net
  FROM order_items oi
)
SELECT printf('%04d-%02d', :year, m) AS month,
       COALESCE((SELECT SUM(i.net)
                 FROM item_net i JOIN orders o ON o.id = i.order_id
                 WHERE o.status IN ('paid', 'shipped')
                   AND substr(o.placed_at, 1, 7) = printf('%04d-%02d', :year, m)), 0) AS net_cents
FROM months
ORDER BY month;

-- name: top_products_per_category
WITH item_net AS (
  SELECT oi.order_id, oi.product_id,
         oi.quantity * oi.unit_price_cents
           - COALESCE((SELECT SUM(r.amount_cents) FROM refunds r WHERE r.order_item_id = oi.id), 0) AS net
  FROM order_items oi
),
prod AS (
  SELECT p.category_id, p.name AS product, SUM(i.net) AS net_cents
  FROM item_net i
  JOIN orders o ON o.id = i.order_id AND o.status IN ('paid', 'shipped')
  JOIN products p ON p.id = i.product_id
  GROUP BY p.id
),
ranked AS (
  SELECT category_id, product, net_cents,
         RANK() OVER (PARTITION BY category_id ORDER BY net_cents DESC) AS rnk
  FROM prod
)
SELECT c.name AS category, r.product, r.net_cents, r.rnk AS rank
FROM ranked r JOIN categories c ON c.id = r.category_id
WHERE r.rnk <= 3
ORDER BY category, rank, product;

-- name: repeat_purchase_rate
WITH counted AS (
  SELECT id, customer_id, placed_at FROM orders WHERE status IN ('paid', 'shipped')
),
firsts AS (
  SELECT customer_id, id, date(placed_at) AS d
  FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY placed_at, id) AS rn FROM counted)
  WHERE rn = 1
),
flags AS (
  SELECT substr(c.signup_date, 1, 7) AS cohort,
         f.customer_id IS NOT NULL AS buyer,
         EXISTS (SELECT 1 FROM counted o
                 WHERE o.customer_id = c.id AND o.id <> f.id
                   AND julianday(date(o.placed_at)) - julianday(f.d) <= 30) AS repeater
  FROM customers c LEFT JOIN firsts f ON f.customer_id = c.id
)
SELECT cohort, COUNT(*) AS customers, SUM(buyer) AS buyers, SUM(repeater) AS repeaters,
       CASE WHEN SUM(buyer) = 0 THEN NULL ELSE ROUND(SUM(repeater) * 1.0 / SUM(buyer), 4) END AS rate
FROM flags
GROUP BY cohort
ORDER BY cohort;

-- name: threshold_crossings
WITH order_net AS (
  SELECT o.id, o.customer_id, o.placed_at,
         COALESCE((SELECT SUM(oi.quantity * oi.unit_price_cents) FROM order_items oi WHERE oi.order_id = o.id), 0)
         - COALESCE((SELECT SUM(r.amount_cents) FROM refunds r JOIN order_items oi ON oi.id = r.order_item_id
                     WHERE oi.order_id = o.id), 0) AS net
  FROM orders o WHERE o.status IN ('paid', 'shipped')
),
running AS (
  SELECT *,
         SUM(net) OVER (PARTITION BY customer_id ORDER BY placed_at, id
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS run,
         SUM(net) OVER (PARTITION BY customer_id) AS total
  FROM order_net
),
crossed AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY placed_at, id) AS rn
  FROM running
  WHERE run >= :threshold_cents AND total >= :threshold_cents
)
SELECT c.id AS customer_id, c.name, date(x.placed_at) AS crossed_on, x.total AS lifetime_net_cents
FROM crossed x JOIN customers c ON c.id = x.customer_id
WHERE x.rn = 1
ORDER BY crossed_on, customer_id;
