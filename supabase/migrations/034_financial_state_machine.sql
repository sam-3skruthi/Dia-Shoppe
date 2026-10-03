-- 034 — financial state machine (DEV first; NOT yet applied to production)
--
--  * payments            : every captured Razorpay payment, whatever the order status
--  * refund_requests     : refunds are rows, not side effects; one active refund per payment
--  * financial_audit     : append-only trail of payments and refund decisions
--  * settle_payment()    : single atomic entry point for verify-payment + webhook
--  * late payment after cancel -> automatic full refund
--  * RTO -> order status 'rto' -> refund needs ADMIN approval (approve_refund)
--  * pending online orders expire after 30 minutes (pg_cron)

------------------------------------------------------------------------
-- 0. New order status: rto (returned to origin)
------------------------------------------------------------------------
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'paid', 'confirmed', 'shipped', 'delivered', 'cancelled', 'rto'));

------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id                  BIGSERIAL PRIMARY KEY,
  razorpay_payment_id TEXT NOT NULL UNIQUE,
  razorpay_order_id   TEXT,
  order_id            BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  amount              NUMERIC(10, 2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured', 'refunded')),
  source              TEXT NOT NULL,                       -- verify-payment | razorpay-webhook | legacy
  raw                 JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments(order_id);

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id                 BIGSERIAL PRIMARY KEY,
  payment_id         BIGINT NOT NULL REFERENCES public.payments(id),
  order_id           BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  amount             NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  reason             TEXT NOT NULL CHECK (reason IN (
                       'late_payment_after_cancel', 'customer_cancel', 'admin_cancel',
                       'duplicate_payment', 'rto', 'courier_cancel', 'amount_mismatch')),
  status             TEXT NOT NULL DEFAULT 'requested' CHECK (status IN (
                       'requested', 'approved', 'processing', 'processed', 'failed', 'rejected')),
  requires_approval  BOOLEAN NOT NULL DEFAULT false,
  approved_by        UUID,
  approved_at        TIMESTAMPTZ,
  decision_note      TEXT,
  razorpay_refund_id TEXT,
  error              TEXT,
  attempts           INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ
);
-- the double-refund guard: only ONE live refund per payment, ever
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_one_active_per_payment
  ON public.refund_requests(payment_id)
  WHERE status IN ('requested', 'approved', 'processing', 'processed');

CREATE TABLE IF NOT EXISTS public.financial_audit (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor     UUID,                 -- NULL = system / service role
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id BIGINT,
  detail    JSONB
);
CREATE INDEX IF NOT EXISTS idx_fin_audit_entity ON public.financial_audit(entity, entity_id);

ALTER TABLE public.payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read payments"  ON public.payments;
DROP POLICY IF EXISTS "Admins read refunds"   ON public.refund_requests;
DROP POLICY IF EXISTS "Admins read audit"     ON public.financial_audit;
CREATE POLICY "Admins read payments" ON public.payments        FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins read refunds"  ON public.refund_requests FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins read audit"    ON public.financial_audit FOR SELECT USING (public.is_admin());
REVOKE ALL ON public.payments, public.refund_requests, public.financial_audit FROM anon, authenticated;
GRANT SELECT ON public.payments, public.refund_requests, public.financial_audit TO authenticated;
GRANT ALL ON public.payments, public.refund_requests, public.financial_audit TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Money that moved before this migration existed
INSERT INTO public.payments (razorpay_payment_id, razorpay_order_id, order_id, amount, status, source, created_at)
SELECT o.payment_id, o.razorpay_order_id, o.id, o.total_amount,
       CASE WHEN o.refund_status = 'processed' THEN 'refunded' ELSE 'captured' END,
       'legacy', o.created_at
  FROM public.orders o
 WHERE o.payment_id IS NOT NULL
ON CONFLICT (razorpay_payment_id) DO NOTHING;

------------------------------------------------------------------------
-- 2. Audit trail (append-only, written by triggers)
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_payment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- 1) what Razorpay told us (the capture event), 2) that we stored it in the ledger
  INSERT INTO public.financial_audit(actor, action, entity, entity_id, detail)
  VALUES (auth.uid(), 'payment_captured', 'payment', NEW.id,
          jsonb_build_object('razorpay_payment_id', NEW.razorpay_payment_id, 'order_id', NEW.order_id,
                             'amount', NEW.amount, 'source', NEW.source));
  INSERT INTO public.financial_audit(actor, action, entity, entity_id, detail)
  VALUES (auth.uid(), 'payment_recorded', 'payment', NEW.id,
          jsonb_build_object('razorpay_payment_id', NEW.razorpay_payment_id, 'order_id', NEW.order_id,
                             'amount', NEW.amount, 'ledger_status', NEW.status));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_payment ON public.payments;
CREATE TRIGGER trg_audit_payment AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment();

CREATE OR REPLACE FUNCTION public.audit_refund_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.financial_audit(actor, action, entity, entity_id, detail)
    VALUES (auth.uid(), 'refund_' || CASE NEW.status WHEN 'processing' THEN 'submitted' ELSE NEW.status END, 'refund_request', NEW.id,
            jsonb_build_object('order_id', NEW.order_id, 'payment_id', NEW.payment_id, 'amount', NEW.amount,
                               'reason', NEW.reason, 'from', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
                               'error', NEW.error, 'razorpay_refund_id', NEW.razorpay_refund_id));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_refund ON public.refund_requests;
CREATE TRIGGER trg_audit_refund AFTER INSERT OR UPDATE ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_refund_request();

-- keep the legacy orders.refund_* columns (used by the admin Orders list) in sync
CREATE OR REPLACE FUNCTION public.sync_order_refund_columns()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.order_id IS NOT NULL THEN
    UPDATE public.orders SET
      refund_status = CASE NEW.status
                        WHEN 'requested' THEN 'awaiting_approval'
                        WHEN 'approved' THEN 'pending'
                        WHEN 'processing' THEN 'pending'
                        WHEN 'processed' THEN 'processed'
                        WHEN 'failed' THEN 'failed'
                        WHEN 'rejected' THEN 'rejected' END,
      refund_id     = COALESCE(NEW.razorpay_refund_id, refund_id),
      refund_amount = NEW.amount,
      refund_error  = NEW.error,
      refund_at     = now()
    WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sync_order_refund ON public.refund_requests;
CREATE TRIGGER trg_sync_order_refund AFTER INSERT OR UPDATE OF status ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_refund_columns();

------------------------------------------------------------------------
-- 3. Execute approved refunds (replaces trg_orders_auto_refund)
------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_orders_auto_refund ON public.orders;

CREATE OR REPLACE FUNCTION public.dispatch_refund_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_url TEXT := private.project_url();
BEGIN
  IF v_url IS NULL THEN RAISE WARNING 'project_url missing in Vault; process-refund not called'; RETURN NEW; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/process-refund',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-hook-secret', private.hook_secret('hook_process_refund')),
    body := jsonb_build_object('refund_request_id', NEW.id)
  );
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_dispatch_refund ON public.refund_requests;
CREATE TRIGGER trg_dispatch_refund AFTER INSERT OR UPDATE OF status ON public.refund_requests
  FOR EACH ROW WHEN (NEW.status = 'approved')
  EXECUTE FUNCTION public.dispatch_refund_request();

-- Every refund is first REQUESTED, then (by policy or by an admin) APPROVED, so the
-- audit trail always shows the full chain. Policy-approved ones are stamped as such.
CREATE OR REPLACE FUNCTION private.open_refund(
  p_payment BIGINT, p_order BIGINT, p_amount NUMERIC, p_reason TEXT, p_needs_approval BOOLEAN)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO public.refund_requests (payment_id, order_id, amount, reason, status, requires_approval)
  VALUES (p_payment, p_order, p_amount, p_reason, 'requested', p_needs_approval)
  RETURNING id INTO v_id;
  IF NOT p_needs_approval THEN
    UPDATE public.refund_requests
       SET status = 'approved', approved_at = now(), decision_note = 'auto-approved by policy: ' || p_reason
     WHERE id = v_id;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION private.open_refund(BIGINT, BIGINT, NUMERIC, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- Cancelled / RTO order that holds captured money -> create the refund request.
CREATE OR REPLACE FUNCTION public.create_refund_on_cancel()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r RECORD; v_reason TEXT; v_needs BOOLEAN;
BEGIN
  IF NEW.status = 'rto' THEN v_reason := 'rto'; v_needs := true;
  ELSIF NEW.cancelled_by = 'courier' THEN v_reason := 'courier_cancel'; v_needs := true;
  ELSIF NEW.cancelled_by = 'customer' THEN v_reason := 'customer_cancel'; v_needs := false;
  ELSE v_reason := 'admin_cancel'; v_needs := false;
  END IF;

  FOR r IN
    SELECT p.id, p.amount FROM public.payments p
     WHERE p.order_id = NEW.id AND p.status = 'captured'
       AND NOT EXISTS (SELECT 1 FROM public.refund_requests rr
                        WHERE rr.payment_id = p.id AND rr.status IN ('requested', 'approved', 'processing', 'processed'))
  LOOP
    PERFORM private.open_refund(r.id, NEW.id, r.amount, v_reason, v_needs);
  END LOOP;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_orders_refund_request ON public.orders;
CREATE TRIGGER trg_orders_refund_request AFTER UPDATE OF status ON public.orders
  FOR EACH ROW WHEN (NEW.status IN ('cancelled', 'rto') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.create_refund_on_cancel();

-- Stock comes back for RTO as well as cancellation (exactly once, per-line flag from 032)
CREATE OR REPLACE FUNCTION public.restock_cancelled_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r RECORD;
BEGIN
  IF NEW.status IN ('cancelled', 'rto') AND OLD.status NOT IN ('cancelled', 'rto') THEN
    FOR r IN
      SELECT id, product_id, stock_deducted_qty FROM public.order_items
       WHERE order_id = NEW.id AND stock_deducted_qty > 0 AND stock_restored_at IS NULL
       ORDER BY product_id, id
    LOOP
      UPDATE public.order_items SET stock_restored_at = now()
       WHERE id = r.id AND stock_restored_at IS NULL;
      IF FOUND THEN
        UPDATE public.products SET stock_qty = stock_qty + r.stock_deducted_qty WHERE id = r.product_id;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_orders_restock_on_cancel ON public.orders;
CREATE TRIGGER trg_orders_restock_on_cancel AFTER UPDATE OF status ON public.orders
  FOR EACH ROW WHEN (NEW.status IN ('cancelled', 'rto') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.restock_cancelled_order();

------------------------------------------------------------------------
-- 4. settle_payment: the ONE atomic entry point for a captured payment
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
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE razorpay_order_id = p_rzp_order_id FOR UPDATE;

  INSERT INTO public.payments (razorpay_payment_id, razorpay_order_id, order_id, amount, source, raw)
  VALUES (p_payment_id, p_rzp_order_id, v_order.id, v_amount, p_source, p_raw)
  ON CONFLICT (razorpay_payment_id) DO NOTHING
  RETURNING id INTO v_pay;

  -- same payment delivered again (retry, webhook + browser, replay): nothing to do
  IF v_pay IS NULL THEN
    RETURN jsonb_build_object('result', 'duplicate_event',
                              'order_status', (SELECT status FROM public.orders WHERE id = v_order.id));
  END IF;

  IF v_order.id IS NULL THEN
    RETURN jsonb_build_object('result', 'orphan');      -- money in, no matching order: visible in payments + reconciliation
  END IF;

  -- customer cancelled (or the order expired / was returned) before the money arrived
  IF v_order.status IN ('cancelled', 'rto') THEN
    UPDATE public.orders SET payment_id = COALESCE(payment_id, p_payment_id) WHERE id = v_order.id;
    v_req := private.open_refund(v_pay, v_order.id, v_amount, 'late_payment_after_cancel', false);
    RETURN jsonb_build_object('result', 'late_payment_refund', 'order_status', v_order.status, 'refund_request_id', v_req);
  END IF;

  -- captured amount differs from what the order costs: do not confirm, ask an admin
  IF v_amount <> v_order.total_amount THEN
    v_req := private.open_refund(v_pay, v_order.id, v_amount, 'amount_mismatch', true);
    RETURN jsonb_build_object('result', 'amount_mismatch', 'order_status', v_order.status, 'refund_request_id', v_req);
  END IF;

  IF v_order.status = 'pending' OR (v_order.payment_id IS NULL AND v_order.payment_method <> 'cod') THEN
    UPDATE public.orders
       SET status = CASE WHEN v_order.status = 'pending' THEN 'confirmed' ELSE v_order.status END,
           payment_id = p_payment_id
     WHERE id = v_order.id;
    PERFORM private.reserve_order_stock(v_order.id);
    RETURN jsonb_build_object('result', 'confirmed', 'order_status', 'confirmed');
  END IF;

  -- order already paid by a different payment: customer paid twice
  v_req := private.open_refund(v_pay, v_order.id, v_amount, 'duplicate_payment', false);
  RETURN jsonb_build_object('result', 'duplicate_payment_refund', 'order_status', v_order.status, 'refund_request_id', v_req);
END $$;
REVOKE ALL ON FUNCTION public.settle_payment(TEXT, TEXT, BIGINT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_payment(TEXT, TEXT, BIGINT, TEXT, JSONB) TO service_role;

------------------------------------------------------------------------
-- 5. Admin decisions (is_admin() enforced inside; audited by trigger)
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_refund(p_request_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  UPDATE public.refund_requests
     SET status = 'approved', approved_by = auth.uid(), approved_at = now()
   WHERE id = p_request_id AND status = 'requested';
  IF NOT FOUND THEN RAISE EXCEPTION 'refund request % is not awaiting approval', p_request_id; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reject_refund(p_request_id BIGINT, p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  UPDATE public.refund_requests
     SET status = 'rejected', approved_by = auth.uid(), approved_at = now(), decision_note = p_note
   WHERE id = p_request_id AND status = 'requested';
  IF NOT FOUND THEN RAISE EXCEPTION 'refund request % is not awaiting approval', p_request_id; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.retry_refund(p_request_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  UPDATE public.refund_requests SET status = 'approved', error = NULL
   WHERE id = p_request_id AND status = 'failed';
  IF NOT FOUND THEN RAISE EXCEPTION 'refund request % is not in failed state', p_request_id; END IF;
END $$;

REVOKE ALL ON FUNCTION public.approve_refund(BIGINT), public.reject_refund(BIGINT, TEXT), public.retry_refund(BIGINT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_refund(BIGINT), public.reject_refund(BIGINT, TEXT), public.retry_refund(BIGINT)
  TO authenticated;

------------------------------------------------------------------------
-- 6. Pending online orders expire after 30 minutes
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.expire_pending_orders(p_minutes INTEGER DEFAULT 30)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE public.orders
     SET status = 'cancelled', cancelled_by = 'system', cancelled_at = now(),
         cancellation_reason = 'Payment not completed within ' || p_minutes || ' minutes'
   WHERE status = 'pending' AND payment_method <> 'cod'
     AND created_at < now() - make_interval(mins => p_minutes);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION private.expire_pending_orders(INTEGER) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule('expire-pending-orders')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-pending-orders');
  PERFORM cron.schedule('expire-pending-orders', '*/5 * * * *', 'select private.expire_pending_orders(30)');
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron not scheduled (%): enable the pg_cron extension and schedule private.expire_pending_orders(30) every 5 minutes', SQLERRM;
END $$;
