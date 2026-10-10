-- 042 — order-status guard for the frozen admin UI + manual (operator) decisions. DEV first; NOT applied to production.
--
-- WHY: the existing admin Orders screen PATCHes orders.status directly from a fixed dropdown
-- (pending/paid/confirmed/shipped/delivered/cancelled). With 034-041 that could move
--   * an on_hold order (paid, stock short)          -> confirmed/shipped/delivered with NO stock taken,
--   * a pending order with a mismatched payment     -> confirmed/shipped with NO stock taken and no payment settled,
--   * an rto order                                   -> delivered/cancelled with its refund request left dangling,
--   * a cancelled order (stock back, refund running) -> confirmed/shipped again.
--
-- RULES for DIRECT updates by API roles (anon, authenticated, service_role) — i.e. PostgREST / the admin UI:
--   G1 on_hold   -> nothing.   Resolve with fulfil_held_order / refund_held_order (or the manual procedure below).
--   G2 rto       -> nothing.   Terminal; the refund is decided with approve_refund / reject_refund.
--   G3 cancelled -> nothing.   Terminal; stock was returned and a refund may already be moving.
--   G4 pending   -> cancelled only. An online order is confirmed only by payment settlement
--                  (settle_payment / confirm_online_payment), which takes the stock in the same transaction.
--                  This covers every amount-mismatch order (they stay pending).
--   G5 anything  -> on_hold never (only settle_payment holds an order).
-- Everything else is unchanged (confirmed -> shipped -> delivered, admin/customer cancel, -> rto, ...).
--
-- The approved workflows are SECURITY DEFINER functions owned by postgres, so inside them current_user is
-- 'postgres' and the guard does not apply: settle_payment, confirm_online_payment, fulfil_held_order,
-- refund_held_order, courier_apply_event, expire_pending_orders, cancel_empty_orders. pg_cron also runs as postgres.
-- The guard function is SECURITY INVOKER on purpose: it must see the caller's role.

------------------------------------------------------------------------
-- 1. The guard
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_order_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR current_user NOT IN ('anon', 'authenticated', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'on_hold' THEN
    RAISE EXCEPTION 'ORDER_STATUS_BLOCKED: order % is on hold (paid, stock short). It can only be fulfilled after restock or refunded, through the held-order procedure.', OLD.id
      USING ERRCODE = 'P0001';
  ELSIF OLD.status = 'rto' THEN
    RAISE EXCEPTION 'ORDER_STATUS_BLOCKED: order % was returned to sender (RTO). Its status is final; decide the refund through the refund procedure.', OLD.id
      USING ERRCODE = 'P0001';
  ELSIF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'ORDER_STATUS_BLOCKED: order % is cancelled. A cancelled order cannot be reopened.', OLD.id
      USING ERRCODE = 'P0001';
  ELSIF NEW.status = 'on_hold' THEN
    RAISE EXCEPTION 'ORDER_STATUS_BLOCKED: only payment settlement can put order % on hold.', OLD.id
      USING ERRCODE = 'P0001';
  ELSIF OLD.status = 'pending' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'ORDER_STATUS_BLOCKED: order % has no settled payment. It is confirmed automatically when a correct payment arrives; it can only be cancelled by hand.', OLD.id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_order_status_change() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_orders_status_guard ON public.orders;
CREATE TRIGGER trg_orders_status_guard BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_status_change();

------------------------------------------------------------------------
-- 2. Manual decisions while the admin UI cannot make them (frozen frontend).
--    Run ONLY from the Supabase SQL editor / Management API (postgres). Not callable by any API role.
--    Each call: names the deciding admin (must be an active admin profile), locks the row, acts as that
--    admin through the SAME functions the future UI will use (so approved_by / audit actor = that admin),
--    writes an extra 'manual_decision' audit row (operator, note, DB session user), and is idempotent:
--    repeating a decision that already took effect returns already_* and changes nothing.
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.manual_admin_id(p_admin_email TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v UUID;
BEGIN
  SELECT id INTO v FROM public.user_profiles
   WHERE lower(email) = lower(trim(p_admin_email)) AND role = 'admin' AND COALESCE(is_active, true);
  IF v IS NULL THEN RAISE EXCEPTION 'MANUAL_DECISION: % is not an active admin', p_admin_email USING ERRCODE = '42501'; END IF;
  RETURN v;
END $$;

-- act as the named admin: auth.uid() / is_admin() see that admin for this transaction only
CREATE OR REPLACE FUNCTION private.manual_act_as(p_admin UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_prev TEXT := current_setting('request.jwt.claims', true);
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_admin, 'role', 'authenticated')::text, true);
  RETURN COALESCE(v_prev, '');
END $$;

CREATE OR REPLACE FUNCTION private.manual_refund_decision(
  p_request_id BIGINT, p_decision TEXT, p_admin_email TEXT, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_admin UUID; v_req public.refund_requests%ROWTYPE; v_order_status TEXT; v_prev TEXT; v_result TEXT;
BEGIN
  IF p_decision NOT IN ('approve', 'reject') THEN RAISE EXCEPTION 'MANUAL_DECISION: decision must be approve or reject'; END IF;
  IF COALESCE(trim(p_note), '') = '' THEN RAISE EXCEPTION 'MANUAL_DECISION: a note (why) is required'; END IF;
  v_admin := private.manual_admin_id(p_admin_email);

  SELECT * INTO v_req FROM public.refund_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_DECISION: refund request % not found', p_request_id; END IF;
  SELECT status INTO v_order_status FROM public.orders WHERE id = v_req.order_id;

  IF v_req.reason = 'insufficient_stock' AND v_order_status = 'on_hold' THEN
    RAISE EXCEPTION 'MANUAL_DECISION: request % belongs to held order %; use private.manual_held_order_decision', p_request_id, v_req.order_id;
  END IF;

  IF p_decision = 'approve' AND v_req.status IN ('approved', 'processing', 'processed') THEN
    RETURN jsonb_build_object('result', 'already_approved', 'refund_status', v_req.status);
  ELSIF p_decision = 'reject' AND v_req.status = 'rejected' THEN
    RETURN jsonb_build_object('result', 'already_rejected', 'refund_status', v_req.status);
  ELSIF v_req.status <> 'requested' THEN
    RAISE EXCEPTION 'MANUAL_DECISION: refund request % is %; cannot %', p_request_id, v_req.status, p_decision;
  END IF;

  v_prev := private.manual_act_as(v_admin);
  IF p_decision = 'approve' THEN
    PERFORM public.approve_refund(p_request_id);
    UPDATE public.refund_requests SET decision_note = 'manual: ' || p_note WHERE id = p_request_id;
    v_result := 'approved';
  ELSE
    PERFORM public.reject_refund(p_request_id, 'manual: ' || p_note);
    v_result := 'rejected';
  END IF;
  IF v_req.reason = 'amount_mismatch' THEN
    PERFORM private.resolve_ops_events('amount_mismatch', 'order', v_req.order_id);
  END IF;
  INSERT INTO public.financial_audit(actor, action, entity, entity_id, detail)
  VALUES (v_admin, 'manual_decision', 'refund_request', p_request_id,
          jsonb_build_object('decision', p_decision, 'note', p_note, 'admin_email', lower(trim(p_admin_email)),
                             'db_session_user', session_user, 'order_id', v_req.order_id, 'reason', v_req.reason,
                             'order_status', v_order_status));
  PERFORM set_config('request.jwt.claims', v_prev, true);
  RETURN jsonb_build_object('result', v_result,
                            'refund_status', (SELECT status FROM public.refund_requests WHERE id = p_request_id));
END $$;

CREATE OR REPLACE FUNCTION private.manual_held_order_decision(
  p_order_id BIGINT, p_decision TEXT, p_admin_email TEXT, p_note TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_admin UUID; v_status TEXT; v_hold TEXT; v_prev TEXT;
BEGIN
  IF p_decision NOT IN ('fulfil', 'refund') THEN RAISE EXCEPTION 'MANUAL_DECISION: decision must be fulfil or refund'; END IF;
  IF COALESCE(trim(p_note), '') = '' THEN RAISE EXCEPTION 'MANUAL_DECISION: a note (why) is required'; END IF;
  v_admin := private.manual_admin_id(p_admin_email);

  SELECT status, hold_reason INTO v_status, v_hold FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'MANUAL_DECISION: order % not found', p_order_id; END IF;

  IF v_status <> 'on_hold' THEN
    -- idempotent repeat: the same decision already took effect
    IF p_decision = 'refund' AND v_status = 'cancelled'
       AND EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id = p_order_id AND reason = 'insufficient_stock'
                    AND status IN ('approved', 'processing', 'processed')) THEN
      RETURN jsonb_build_object('result', 'already_refunded', 'order_status', v_status);
    ELSIF p_decision = 'fulfil' AND v_status IN ('confirmed', 'shipped', 'delivered')
       AND EXISTS (SELECT 1 FROM public.refund_requests WHERE order_id = p_order_id AND reason = 'insufficient_stock'
                    AND status = 'rejected') THEN
      RETURN jsonb_build_object('result', 'already_fulfilled', 'order_status', v_status);
    END IF;
    RAISE EXCEPTION 'MANUAL_DECISION: order % is % (not on hold); cannot %', p_order_id, v_status, p_decision;
  END IF;

  v_prev := private.manual_act_as(v_admin);
  IF p_decision = 'fulfil' THEN PERFORM public.fulfil_held_order(p_order_id);   -- refuses while still short of stock
  ELSE PERFORM public.refund_held_order(p_order_id);
  END IF;
  INSERT INTO public.financial_audit(actor, action, entity, entity_id, detail)
  VALUES (v_admin, 'manual_decision', 'order', p_order_id,
          jsonb_build_object('decision', p_decision, 'note', p_note, 'admin_email', lower(trim(p_admin_email)),
                             'db_session_user', session_user, 'hold_reason', v_hold));
  PERFORM set_config('request.jwt.claims', v_prev, true);
  RETURN jsonb_build_object('result', CASE p_decision WHEN 'fulfil' THEN 'fulfilled' ELSE 'refunded' END,
                            'order_status', (SELECT status FROM public.orders WHERE id = p_order_id));
END $$;

REVOKE ALL ON FUNCTION private.manual_admin_id(TEXT), private.manual_act_as(UUID),
                       private.manual_refund_decision(BIGINT, TEXT, TEXT, TEXT),
                       private.manual_held_order_decision(BIGINT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
