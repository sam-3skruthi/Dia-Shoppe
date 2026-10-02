-- 030 — security hardening
--
-- Three real holes found in the audit, in severity order.
--
-- 1. PRIVILEGE ESCALATION. "Users can update own profile" had no WITH CHECK,
--    and `authenticated` held UPDATE on user_profiles.role. Any logged-in
--    customer could run one statement and make themselves an admin:
--        update user_profiles set role='admin' where id = auth.uid();
--
-- 2. PRICE TAMPERING. Order totals and line prices came from the browser and
--    nothing re-checked them. create-razorpay-order reads orders.total_amount
--    "server-side", but that value was itself client-supplied — so a customer
--    could buy a 42,999 device for 1 rupee.
--
-- 3. ORDER FIELD TAMPERING. The cancel policy correctly pins status to
--    'cancelled', but the same UPDATE could also rewrite total_amount or
--    refund_status, which feed the automatic refund.

------------------------------------------------------------------------
-- 1. Lock down role changes
------------------------------------------------------------------------

-- Nobody but the service role (Edge Functions) may change a role. Admin
-- promotion happens through the signup allow-list in migration 025.
REVOKE UPDATE (role) ON public.user_profiles FROM anon, authenticated;

-- Belt and braces: even if the grant is restored, the policy now refuses a
-- row whose role differs from the one already stored.
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users can update own profile"
  ON public.user_profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role IS NOT DISTINCT FROM (SELECT p.role FROM public.user_profiles p WHERE p.id = auth.uid())
  );

------------------------------------------------------------------------
-- 2. Prices and totals are decided by the database, not the browser
------------------------------------------------------------------------

-- The price a customer should pay right now: the sale price when a sale event
-- is live, otherwise the catalogue price. Mirrors lib/sale.js.
CREATE OR REPLACE FUNCTION public.effective_product_price(p_product_id BIGINT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT sp.sale_price
       FROM public.sale_products sp
       JOIN public.sale_events se ON se.id = sp.sale_event_id
      WHERE sp.product_id = p_product_id
        AND se.is_active
        AND now() BETWEEN se.starts_at AND se.ends_at
      ORDER BY se.created_at DESC
      LIMIT 1),
    (SELECT p.price FROM public.products p WHERE p.id = p_product_id)
  );
$$;

-- Overwrite whatever price the client sent with the real one.
CREATE OR REPLACE FUNCTION public.enforce_order_item_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.price_at_purchase := public.effective_product_price(NEW.product_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_enforce_price ON public.order_items;
CREATE TRIGGER trg_order_items_enforce_price
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_item_price();

-- Recompute the order total from the (now trustworthy) line items.
-- Delivery rule mirrors the checkout: free over 2000, otherwise a flat 99.
CREATE OR REPLACE FUNCTION public.recompute_order_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id BIGINT;
  v_subtotal NUMERIC;
  v_shipping NUMERIC;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  SELECT COALESCE(SUM(price_at_purchase * quantity), 0)
    INTO v_subtotal
    FROM public.order_items
   WHERE order_id = v_order_id;

  v_shipping := CASE WHEN v_subtotal >= 2000 OR v_subtotal = 0 THEN 0 ELSE 99 END;

  UPDATE public.orders
     SET total_amount = v_subtotal + v_shipping
   WHERE id = v_order_id
     AND total_amount IS DISTINCT FROM v_subtotal + v_shipping;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_recompute_total ON public.order_items;
CREATE TRIGGER trg_order_items_recompute_total
  AFTER INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.recompute_order_total();

------------------------------------------------------------------------
-- 3. Money and payment columns are not customer-writable
------------------------------------------------------------------------
-- Workers still update status, courier and tracking; customers still cancel.
-- Everything below is written only by Edge Functions (service role, which
-- bypasses these grants) or by the triggers above.
REVOKE UPDATE (
  total_amount, payment_id, razorpay_order_id, user_id,
  refund_id, refund_status, refund_amount, email_sent_at
) ON public.orders FROM anon, authenticated;

REVOKE UPDATE (price_at_purchase, quantity, product_id, order_id)
  ON public.order_items FROM anon, authenticated;
