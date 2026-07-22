-- 018 — buyer acquisition source ("where did they find us?")
-- Captured first-touch on the frontend (referrer + UTM) and attached to the
-- order at checkout, so the admin dashboard can show which channels
-- (Instagram / Facebook / Google / WhatsApp / Direct …) actually drive sales.
--
-- source        → the classified channel, e.g. 'Instagram', 'Google', 'Direct'
-- source_detail → raw utm_source / 'referral' / 'direct' for finer inspection

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_detail TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_source ON public.orders (source);
