-- 016 — WhatsApp opt-in / consent capture
-- Adds the consent flags needed to (a) legally send order updates and
-- (b) build a marketing broadcast audience of only opted-in customers.
--
-- Consent model:
--   orders.whatsapp_opt_in            → this customer agreed to order-status
--                                       updates for THIS order (default true;
--                                       transactional, expected when ordering).
--   user_profiles.whatsapp_marketing_opt_in → explicit, separate opt-in to
--                                       receive offers / promotions (default
--                                       false; only true when the box is ticked).
--   user_profiles.marketing_opt_in_at → when that marketing consent was given
--                                       (audit trail — Meta requires provable
--                                       opt-in for marketing templates).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS whatsapp_marketing_opt_in BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at TIMESTAMPTZ;

-- Fast lookup of the opted-in broadcast audience.
CREATE INDEX IF NOT EXISTS idx_profiles_marketing_optin
  ON public.user_profiles (whatsapp_marketing_opt_in)
  WHERE whatsapp_marketing_opt_in = true;
