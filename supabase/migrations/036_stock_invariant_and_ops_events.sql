-- 036 — inventory invariant + operational alerts (DEV first; NOT applied to production)
--
-- INVARIANT: an order is never 'confirmed' unless every unit it asked for has been
-- fully taken from stock, in the same transaction. No silent partial deduction,
-- no clamping to zero.
--
--   * COD / order-item insert  : refused with INSUFFICIENT_STOCK when stock < quantity
--   * paid online order        : if stock is short at payment time the payment is
--                                still recorded, the order goes to 'on_hold' (nothing
--                                deducted), a refund request is opened that needs an
--                                admin, and a critical ops event is raised.
--   * admin resolves a held order with fulfil_held_order() or refund_held_order().
--   * all of it is idempotent: a replayed payment event changes nothing.

------------------------------------------------------------------------
-- 1. States and reasons
------------------------------------------------------------------------
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'paid', 'confirmed', 'shipped', 'delivered', 'cancelled', 'rto', 'on_hold'));
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS hold_reason TEXT;

ALTER TABLE public.refund_requests DROP CONSTRAINT IF EXISTS refund_requests_reason_check;
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_reason_check
  CHECK (reason IN ('late_payment_after_cancel', 'customer_cancel', 'admin_cancel', 'duplicate_payment',
                    'rto', 'courier_cancel', 'amount_mismatch', 'insufficient_stock'));

------------------------------------------------------------------------
-- 2. Admin-visible operational events (idempotent per open problem)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ops_events (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity    TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  source      TEXT NOT NULL,
  code        TEXT NOT NULL,
  message     TEXT NOT NULL,
  entity      TEXT,
  entity_id   BIGINT,
  detail      JSONB,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID
);
-- one OPEN event per (code, entity, entity_id): repeats of the same problem do not pile up
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_events_open
  ON public.ops_events (code, entity, entity_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ops_events_open ON public.ops_events (severity, at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.ops_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read ops events" ON public.ops_events;
CREATE POLICY "Admins read ops events" ON public.ops_events FOR SELECT USING (public.is_admin());
REVOKE ALL ON public.ops_events FROM anon, authenticated;
GRANT SELECT ON public.ops_events TO authenticated;
GRANT ALL ON public.ops_events TO service_role;

CREATE OR REPLACE FUNCTION private.raise_ops_event(
  p_severity TEXT, p_source TEXT, p_code TEXT, p_message TEXT, p_entity TEXT, p_entity_id BIGINT, p_detail JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  INSERT INTO public.ops_events (severity, source, code, message, entity, entity_id, detail)
  VALUES (p_severity, p_source, p_code, p_message, p_entity, p_entity_id, p_detail)
  ON CONFLICT (code, entity, entity_id) WHERE resolved_at IS NULL DO NOTHING
$$;

CREATE OR REPLACE FUNCTION private.resolve_ops_events(p_code TEXT, p_entity TEXT, p_entity_id BIGINT)
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.ops_events SET resolved_at = now(), resolved_by = auth.uid()
   WHERE code = p_code AND entity = p_entity AND entity_id = p_entity_id AND resolved_at IS NULL
$$;
REVOKE ALL ON FUNCTION private.raise_ops_event(TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.resolve_ops_events(TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_ops_event(p_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  UPDATE public.ops_events SET resolved_at = now(), resolved_by = auth.uid() WHERE id = p_id AND resolved_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.resolve_ops_event(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_ops_event(BIGINT) TO authenticated;

------------------------------------------------------------------------
-- 3. Strict stock engine
------------------------------------------------------------------------
-- Lock the products an order needs (in id order, so no deadlocks) and report any shortfall.
CREATE OR REPLACE FUNCTION private.order_stock_shortages(p_order_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v JSONB;
BEGIN
  PERFORM 1 FROM public.products
   WHERE id IN (SELECT product_id FROM public.order_items WHERE order_id = p_order_id)
   ORDER BY id FOR UPDATE;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('product_id', s.product_id, 'name', s.name,
                                               'requested', s.needed, 'available', s.stock_qty)), '[]'::jsonb)
    INTO v
    FROM (
      SELECT oi.product_id, p.name, p.stock_qty, SUM(oi.quantity) AS needed
        FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
       WHERE oi.order_id = p_order_id AND oi.stock_deducted_qty IS NULL
       GROUP BY oi.product_id, p.name, p.stock_qty
    ) s
   WHERE s.needed > GREATEST(COALESCE(s.stock_qty, 0), 0);
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION private.order_stock_shortages(BIGINT) FROM PUBLIC, anon, authenticated;

-- Take stock for ONE line: all or nothing. Never clamps, never goes below zero.
CREATE OR REPLACE FUNCTION private.deduct_item_stock(p_item_id BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_item  public.order_items%ROWTYPE;
  v_stock INTEGER;
BEGIN
  SELECT * INTO v_item FROM public.order_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.stock_deducted_qty IS NOT NULL THEN RETURN 0; END IF;

  SELECT stock_qty INTO v_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
  IF COALESCE(v_stock, 0) < v_item.quantity THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: only % left (% requested) for product %', COALESCE(v_stock, 0), v_item.quantity, v_item.product_id
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.products SET stock_qty = stock_qty - v_item.quantity WHERE id = v_item.product_id;
  UPDATE public.order_items SET stock_deducted_qty = v_item.quantity WHERE id = p_item_id;
  RETURN v_item.quantity;
END $$;

-- Early, friendly refusal when an order line is created for more than exists.
-- (A check, not a reservation: the authoritative gate is at payment / COD deduction.)
CREATE OR REPLACE FUNCTION public.check_order_item_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_stock INTEGER;
BEGIN
  SELECT stock_qty INTO v_stock FROM public.products WHERE id = NEW.product_id;
  IF COALESCE(v_stock, 0) < NEW.quantity THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: only % left (% requested) for product %', COALESCE(v_stock, 0), NEW.quantity, NEW.product_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_order_items_check_stock ON public.order_items;
CREATE TRIGGER trg_order_items_check_stock BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.check_order_item_stock();

-- The legacy single-purpose RPC keeps working but obeys the same invariant.
CREATE OR REPLACE FUNCTION public.confirm_online_payment(p_order_id BIGINT, p_payment_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_won BOOLEAN := false; v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_status IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  IF v_status = 'pending' THEN
    IF jsonb_array_length(private.order_stock_shortages(p_order_id)) > 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: order % cannot be confirmed', p_order_id USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.orders SET status = 'confirmed', payment_id = p_payment_id WHERE id = p_order_id;
    v_won := true;
  END IF;
  SELECT status INTO v_status FROM public.orders WHERE id = p_order_id;
  IF v_status IN ('confirmed', 'paid', 'shipped', 'delivered') THEN PERFORM private.reserve_order_stock(p_order_id); END IF;
  RETURN jsonb_build_object('found', true, 'won', v_won, 'status', v_status);
END $$;

------------------------------------------------------------------------
-- 4. settle_payment with the invariant
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_payment(
  p_payment_id TEXT, p_rzp_order_id TEXT, p_amount_paise BIGINT, p_source TEXT, p_raw JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_order  public.orders%ROWTYPE;
  v_pay    BIGINT;
  v_amount NUMERIC := p_amount_paise / 100.0;
  v_req    BIGINT;
  v_short  JSONB;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE razorpay_order_id = p_rzp_order_id FOR UPDATE;

  INSERT INTO public.payments (razorpay_payment_id, razorpay_order_id, order_id, amount, source, raw)
  VALUES (p_payment_id, p_rzp_order_id, v_order.id, v_amount, p_source, p_raw)
  ON CONFLICT (razorpay_payment_id) DO NOTHING
  RETURNING id INTO v_pay;

  IF v_pay IS NULL THEN
    RETURN jsonb_build_object('result', 'duplicate_event',
                              'order_status', (SELECT status FROM public.orders WHERE id = v_order.id));
  END IF;

  IF v_order.id IS NULL THEN
    PERFORM private.raise_ops_event('critical', 'settle_payment', 'orphan_payment',
      'A captured payment matches no order', 'payment', v_pay, jsonb_build_object('razorpay_payment_id', p_payment_id));
    RETURN jsonb_build_object('result', 'orphan');
  END IF;

  IF v_order.status IN ('cancelled', 'rto') THEN
    UPDATE public.orders SET payment_id = COALESCE(payment_id, p_payment_id) WHERE id = v_order.id;
    v_req := private.open_refund(v_pay, v_order.id, v_amount, 'late_payment_after_cancel', false);
    RETURN jsonb_build_object('result', 'late_payment_refund', 'order_status', v_order.status, 'refund_request_id', v_req);
  END IF;

  IF v_amount <> v_order.total_amount THEN
    v_req := private.open_refund(v_pay, v_order.id, v_amount, 'amount_mismatch', true);
    PERFORM private.raise_ops_event('warning', 'settle_payment', 'amount_mismatch',
      'Payment amount differs from the order total', 'order', v_order.id,
      jsonb_build_object('paid', v_amount, 'expected', v_order.total_amount));
    RETURN jsonb_build_object('result', 'amount_mismatch', 'order_status', v_order.status, 'refund_request_id', v_req);
  END IF;

  IF v_order.status = 'pending' OR (v_order.payment_id IS NULL AND v_order.payment_method <> 'cod') THEN
    -- THE INVARIANT: confirm only if every requested unit can be taken right now
    v_short := private.order_stock_shortages(v_order.id);
    IF jsonb_array_length(v_short) > 0 THEN
      IF v_order.status = 'pending' THEN
        UPDATE public.orders SET status = 'on_hold', hold_reason = 'insufficient_stock', payment_id = p_payment_id
         WHERE id = v_order.id;
      ELSE
        UPDATE public.orders SET payment_id = p_payment_id WHERE id = v_order.id;
      END IF;
      v_req := private.open_refund(v_pay, v_order.id, v_amount, 'insufficient_stock', true);
      PERFORM private.raise_ops_event('critical', 'settle_payment', 'insufficient_stock',
        'Paid order cannot be fulfilled: stock ran out before payment arrived', 'order', v_order.id,
        jsonb_build_object('shortages', v_short, 'refund_request_id', v_req));
      RETURN jsonb_build_object('result', 'held_insufficient_stock', 'order_status', 'on_hold',
                                'refund_request_id', v_req, 'shortages', v_short);
    END IF;

    UPDATE public.orders
       SET status = CASE WHEN v_order.status = 'pending' THEN 'confirmed' ELSE v_order.status END,
           payment_id = p_payment_id
     WHERE id = v_order.id;
    PERFORM private.reserve_order_stock(v_order.id);
    RETURN jsonb_build_object('result', 'confirmed', 'order_status', 'confirmed');
  END IF;

  v_req := private.open_refund(v_pay, v_order.id, v_amount, 'duplicate_payment', false);
  RETURN jsonb_build_object('result', 'duplicate_payment_refund', 'order_status', v_order.status, 'refund_request_id', v_req);
END $$;

------------------------------------------------------------------------
-- 5. Admin resolution of a held order
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fulfil_held_order(p_order_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.orders WHERE id = p_order_id AND status = 'on_hold' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order % is not on hold', p_order_id; END IF;
  IF jsonb_array_length(private.order_stock_shortages(p_order_id)) > 0 THEN
    RAISE EXCEPTION 'order % is still short of stock - restock first, or refund it', p_order_id;
  END IF;
  PERFORM private.reserve_order_stock(p_order_id);
  UPDATE public.orders SET status = 'confirmed', hold_reason = NULL WHERE id = p_order_id;
  UPDATE public.refund_requests
     SET status = 'rejected', approved_by = auth.uid(), approved_at = now(), decision_note = 'order fulfilled after restock'
   WHERE order_id = p_order_id AND reason = 'insufficient_stock' AND status = 'requested';
  PERFORM private.resolve_ops_events('insufficient_stock', 'order', p_order_id);
END $$;

CREATE OR REPLACE FUNCTION public.refund_held_order(p_order_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  UPDATE public.orders
     SET status = 'cancelled', cancelled_by = 'admin', cancelled_at = now(),
         cancellation_reason = 'Out of stock after payment - refunded', hold_reason = NULL
   WHERE id = p_order_id AND status = 'on_hold';
  IF NOT FOUND THEN RAISE EXCEPTION 'order % is not on hold', p_order_id; END IF;
  UPDATE public.refund_requests
     SET status = 'approved', approved_by = auth.uid(), approved_at = now(), decision_note = 'admin refunded the held order'
   WHERE order_id = p_order_id AND reason = 'insufficient_stock' AND status = 'requested';
  PERFORM private.resolve_ops_events('insufficient_stock', 'order', p_order_id);
END $$;
REVOKE ALL ON FUNCTION public.fulfil_held_order(BIGINT), public.refund_held_order(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fulfil_held_order(BIGINT), public.refund_held_order(BIGINT) TO authenticated;

------------------------------------------------------------------------
-- 6. Safety net for the two-step checkout (order row, then its items):
--    an order whose items never arrived is cancelled after 10 minutes.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.cancel_empty_orders(p_minutes INTEGER DEFAULT 10)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE public.orders o
     SET status = 'cancelled', cancelled_by = 'system', cancelled_at = now(),
         cancellation_reason = 'Order was incomplete (no items)'
   WHERE o.status IN ('pending', 'confirmed')
     AND o.created_at < now() - make_interval(mins => p_minutes)
     AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION private.cancel_empty_orders(INTEGER) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('cancel-empty-orders') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cancel-empty-orders');
  PERFORM cron.schedule('cancel-empty-orders', '*/10 * * * *', 'select private.cancel_empty_orders(10)');
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron not scheduled (%): schedule private.cancel_empty_orders(10) every 10 minutes', SQLERRM;
END $$;
