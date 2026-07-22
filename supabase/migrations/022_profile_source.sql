-- 022 — first-touch acquisition source on the customer profile
-- Lets the Leads page show where each lead came from (Instagram / Facebook /
-- Google / …) so you can see which platform generates the most LEADS, not
-- just completed sales (orders already carry their own source).
--
-- Captured client-side (first-touch referrer + UTM) and written to the profile
-- the first time the customer is seen logged in.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_detail TEXT;
