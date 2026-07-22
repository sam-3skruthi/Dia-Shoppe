-- 023 — review moderation (hide spam / abusive / mistaken reviews)
-- Adds a `hidden` flag admins can toggle. Hidden reviews stay in the database
-- (nothing is destroyed) but disappear for everyone except admins, and are
-- excluded from public averages.

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false;

-- Replace the open "anyone can view" policy with one that hides hidden reviews
-- from the public while still letting admins see them (to un-hide).
DROP POLICY IF EXISTS "Anyone can view feedback" ON public.feedback;
CREATE POLICY "View non-hidden feedback" ON public.feedback
  FOR SELECT USING (hidden = false OR public.is_admin());

-- Admins can hide / un-hide any review.
CREATE POLICY "Admins can moderate feedback" ON public.feedback
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
