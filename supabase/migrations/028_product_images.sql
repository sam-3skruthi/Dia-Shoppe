-- 028 — multiple images per product (storefront gallery)
--
-- images is an ordered JSON array of public URLs:
--   ["https://…/a.jpg", "https://…/b.jpg", "https://…/c.jpg"]
-- The FIRST entry is the primary image (cards, cart, order emails).
--
-- image_url is kept and stays in sync with images[0] so nothing that already
-- reads it breaks; new code prefers images and falls back to image_url.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS images JSONB;

COMMENT ON COLUMN public.products.images IS
  'Ordered array of image URLs; images[0] is the primary. image_url mirrors images[0] for backwards compatibility.';

-- Backfill: existing single images become a one-item gallery.
UPDATE public.products
   SET images = jsonb_build_array(image_url)
 WHERE images IS NULL
   AND image_url IS NOT NULL
   AND image_url <> '';
