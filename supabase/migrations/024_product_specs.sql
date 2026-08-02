-- 024 — per-product specifications table shown on the product detail page
--
-- Stored as a JSON array of label/value rows, in the order the worker
-- entered them in Admin → Products:
--   [{"k": "Warranty", "v": "2 Years"}, {"k": "Battery", "v": "2 x AAA"}]
--
-- Nullable / empty by design: when a product has no specs the storefront
-- falls back to the auto-generated table (brand, model from slug, category,
-- standard warranty text), so existing products keep working unchanged.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS specs JSONB;

COMMENT ON COLUMN public.products.specs IS
  'Optional per-product specification rows: [{"k": label, "v": value}, ...]. NULL/empty = product page shows the auto-generated spec table.';
