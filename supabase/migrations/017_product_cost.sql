-- 017 — private per-product cost price (for profit / margin analytics)
-- cost_price is what the shop PAYS for the item. It is admin-only data:
-- never selected by the storefront, only used in the admin dashboard to
-- compute profit = revenue - (cost_price x quantity) and margin %.
--
-- Nullable: existing products have no cost yet, and profit math simply
-- treats a missing cost as "unknown" (excluded from profit, still counted
-- in revenue) until a worker fills it in.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10, 2);

COMMENT ON COLUMN public.products.cost_price IS
  'Private wholesale/purchase cost paid by the shop. Admin-only; never exposed to customers. Used for profit & margin analytics.';
