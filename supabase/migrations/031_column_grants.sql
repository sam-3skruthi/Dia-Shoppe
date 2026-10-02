-- 031 — make the column revokes in 030 actually bite
--
-- 030 tried REVOKE UPDATE (col) ... but `authenticated` held a TABLE-level
-- UPDATE grant, which covers every column and is not affected by a
-- column-level revoke. The privilege escalation was therefore still open.
--
-- Correct pattern: drop the table-wide grant, then hand back only the columns
-- the application legitimately writes. Edge Functions use the service role,
-- which bypasses all of this, so triggers and webhooks are unaffected.

------------------------------------------------------------------------
-- user_profiles — everything except role / id / email / is_active
------------------------------------------------------------------------
REVOKE UPDATE ON public.user_profiles FROM anon, authenticated;

GRANT UPDATE (
  first_name,
  last_name,
  phone,
  whatsapp_marketing_opt_in,
  marketing_opt_in_at,
  source,
  source_detail,
  updated_at
) ON public.user_profiles TO authenticated;

------------------------------------------------------------------------
-- orders — fulfilment fields only; never money, payment or ownership
------------------------------------------------------------------------
REVOKE UPDATE ON public.orders FROM anon, authenticated;

GRANT UPDATE (
  status,
  courier,
  tracking_number,
  cancellation_reason,
  cancelled_at,
  cancelled_by,
  notes,
  updated_at
) ON public.orders TO authenticated;

------------------------------------------------------------------------
-- order_items — never updated from the browser; inserts still allowed and
-- are re-priced by the trigger from 030
------------------------------------------------------------------------
REVOKE UPDATE ON public.order_items FROM anon, authenticated;
