-- 040 — financial safety net (DEV first; NOT applied to production)
--
--  * FULL-REFUND-ONLY (launch decision): a refund request must equal the captured payment amount. Partial refunds are not supported
--    anywhere; they are blocked in the database, in process-refund, and a partial refund made outside the system raises an alert.
--  * payment.failed events are recorded (information only: no money moved)
--  * refund.created / processed / failed events from Razorpay are reconciled with our refund requests (refund_events)
--  * daily reconciliation against Razorpay (reconciliation_runs), orphan / missing / untracked-refund findings -> ops_events
--  * periodic audit-chain verification with stored anchors (audit_anchors) -> ops_events if broken
--  * financial_health(): one admin call that summarises everything that needs a human
-- Requires 034-038.
------------------------------------------------------------------------
-- 1. full refunds only
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.refund_full_only()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_paid NUMERIC;
BEGIN
  SELECT amount INTO v_paid FROM public.payments WHERE id = NEW.payment_id;
  IF v_paid IS NULL OR NEW.amount <> v_paid THEN
    RAISE EXCEPTION 'partial refunds are not supported: refund % must equal the captured amount %', NEW.amount, v_paid USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_refund_full_only ON public.refund_requests;
CREATE TRIGGER trg_refund_full_only BEFORE INSERT OR UPDATE OF amount, payment_id ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION private.refund_full_only();

------------------------------------------------------------------------
-- 2. payment.failed (information only)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_failures (
  id                  BIGSERIAL PRIMARY KEY,
  razorpay_payment_id TEXT NOT NULL UNIQUE,
  razorpay_order_id   TEXT,
  order_id            BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  amount              NUMERIC(10, 2),
  method              TEXT,
  error_code          TEXT,
  error_reason        TEXT,
  error_description   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_failures_order ON public.payment_failures (order_id);

-- Idempotent. A failed attempt moves no money and never changes an order: the customer can retry on the same order.
CREATE OR REPLACE FUNCTION public.record_payment_failure(p_payment JSONB)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id TEXT := p_payment->>'id'; v_order BIGINT;
BEGIN
  IF v_id IS NULL THEN RETURN 'ignored'; END IF;
  SELECT id INTO v_order FROM public.orders WHERE razorpay_order_id = p_payment->>'order_id';
  INSERT INTO public.payment_failures (razorpay_payment_id, razorpay_order_id, order_id, amount, method, error_code, error_reason, error_description)
  VALUES (v_id, p_payment->>'order_id', v_order, (p_payment->>'amount')::numeric / 100.0, p_payment->>'method',
          left(p_payment->>'error_code', 100), left(p_payment->>'error_reason', 200), left(p_payment->>'error_description', 300))
  ON CONFLICT (razorpay_payment_id) DO NOTHING;
  RETURN CASE WHEN FOUND THEN 'recorded' ELSE 'duplicate' END;
END $$;

------------------------------------------------------------------------
-- 3. refund events from Razorpay
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.refund_events (
  id                 BIGSERIAL PRIMARY KEY,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  razorpay_refund_id TEXT NOT NULL,
  razorpay_status    TEXT NOT NULL,
  payment_id         BIGINT REFERENCES public.payments(id),
  refund_request_id  BIGINT REFERENCES public.refund_requests(id),
  amount             NUMERIC(10, 2),
  outcome            TEXT NOT NULL,
  UNIQUE (razorpay_refund_id, razorpay_status)
);

CREATE OR REPLACE FUNCTION public.settle_refund_event(
  p_refund_id TEXT, p_payment_id TEXT, p_status TEXT, p_amount_paise BIGINT, p_rr_id BIGINT DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE p public.payments%ROWTYPE; rr public.refund_requests%ROWTYPE; v_amount NUMERIC := p_amount_paise / 100.0; v_out TEXT; v_new BIGINT;
BEGIN
  IF p_refund_id IS NULL OR p_status NOT IN ('created', 'pending', 'processed', 'failed') THEN RETURN 'ignored'; END IF;
  SELECT * INTO p FROM public.payments WHERE razorpay_payment_id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM private.raise_ops_event('warning', 'refund-events', 'refund_event_unknown_payment', 'Razorpay reported a refund for a payment we do not have',
      'refund_event', abs(hashtext(p_refund_id))::bigint, jsonb_build_object('refund', p_refund_id, 'payment', p_payment_id));
    RETURN 'unknown_payment';
  END IF;

  SELECT * INTO rr FROM public.refund_requests WHERE razorpay_refund_id = p_refund_id;
  IF NOT FOUND AND p_rr_id IS NOT NULL THEN SELECT * INTO rr FROM public.refund_requests WHERE id = p_rr_id AND payment_id = p.id; END IF;

  -- dedupe: the same refund id + status is handled once
  IF EXISTS (SELECT 1 FROM public.refund_events WHERE razorpay_refund_id = p_refund_id AND razorpay_status = p_status) THEN RETURN 'duplicate'; END IF;

  IF rr.id IS NULL THEN
    -- a refund our system did not ask for (made in the Razorpay dashboard, or a lost record)
    IF p_status IN ('created', 'pending', 'processed') THEN
      IF v_amount <> p.amount THEN
        v_out := 'partial_outside_system';
        PERFORM private.raise_ops_event('critical', 'refund-events', 'partial_refund_outside_system',
          'A PARTIAL refund was made outside the system; partial refunds are not supported, reconcile by hand', 'payment', p.id,
          jsonb_build_object('refund', p_refund_id, 'amount', v_amount, 'paid', p.amount));
      ELSIF p_status = 'processed' THEN
        INSERT INTO public.refund_requests (payment_id, order_id, amount, reason, status, requires_approval, razorpay_refund_id, processed_at, decision_note)
        VALUES (p.id, p.order_id, p.amount, 'admin_cancel', 'processed', false, p_refund_id, now(), 'recorded from a Razorpay refund event; created outside this system')
        ON CONFLICT DO NOTHING RETURNING id INTO v_new;
        UPDATE public.payments SET status = 'refunded' WHERE id = p.id;
        v_out := CASE WHEN v_new IS NULL THEN 'conflict_existing_active_request' ELSE 'recorded_outside_system' END;
        PERFORM private.raise_ops_event('critical', 'refund-events', 'refund_outside_system',
          'A full refund was made outside the system (Razorpay dashboard?); it has been recorded', 'payment', p.id, jsonb_build_object('refund', p_refund_id));
      ELSE
        v_out := 'noted_outside_system';
      END IF;
    ELSE
      v_out := 'failed_outside_system';
    END IF;
  ELSIF p_status = 'processed' THEN
    IF rr.status = 'processed' THEN v_out := 'already_processed';
    ELSE
      UPDATE public.refund_requests SET status = 'processed', razorpay_refund_id = p_refund_id, error = NULL, processed_at = coalesce(processed_at, now()) WHERE id = rr.id;
      UPDATE public.payments SET status = 'refunded' WHERE id = p.id;
      v_out := 'finalised';
    END IF;
  ELSIF p_status = 'failed' THEN
    IF rr.status = 'processed' THEN
      -- we believed it was done; Razorpay says it was not. Money has NOT gone back to the customer.
      UPDATE public.refund_requests SET status = 'failed', error = 'Razorpay reported this refund as failed after we recorded it as processed' WHERE id = rr.id;
      UPDATE public.payments SET status = 'captured' WHERE id = p.id;
      PERFORM private.raise_ops_event('critical', 'refund-events', 'refund_failed_at_gateway',
        'Razorpay reports a refund we marked processed as FAILED: the customer has not been refunded', 'refund_request', rr.id,
        jsonb_build_object('refund', p_refund_id, 'order_id', rr.order_id));
      v_out := 'reopened_after_gateway_failure';
    ELSE
      v_out := 'failed_noted';
    END IF;
  ELSE
    v_out := 'noted';
  END IF;

  INSERT INTO public.refund_events (razorpay_refund_id, razorpay_status, payment_id, refund_request_id, amount, outcome)
  VALUES (p_refund_id, p_status, p.id, rr.id, v_amount, v_out) ON CONFLICT DO NOTHING;
  RETURN v_out;
END $$;

------------------------------------------------------------------------
-- 4. reconciliation runs
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id                 BIGSERIAL PRIMARY KEY,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  window_from        TIMESTAMPTZ NOT NULL,
  window_to          TIMESTAMPTZ NOT NULL,
  razorpay_payments  INT,
  ledger_payments    INT,
  ok                 BOOLEAN,                       -- true: nothing needed a human
  findings           JSONB NOT NULL DEFAULT '[]'::jsonb,
  error              TEXT,
  trigger_source     TEXT NOT NULL DEFAULT 'cron'
);

CREATE OR REPLACE FUNCTION public.record_reconciliation_run(
  p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_rzp INT, p_ledger INT, p_findings JSONB, p_error TEXT, p_source TEXT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id BIGINT; v_open INT;
BEGIN
  SELECT count(*) INTO v_open FROM jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) f WHERE f->>'severity' = 'critical';
  INSERT INTO public.reconciliation_runs (window_from, window_to, razorpay_payments, ledger_payments, ok, findings, error, finished_at, trigger_source)
  VALUES (p_from, p_to, p_rzp, p_ledger, p_error IS NULL AND v_open = 0, coalesce(p_findings, '[]'::jsonb), left(p_error, 500), now(), coalesce(p_source, 'cron'))
  RETURNING id INTO v_id;
  IF p_error IS NOT NULL THEN
    PERFORM private.raise_ops_event('critical', 'reconcile', 'reconcile_run_failed', 'The daily Razorpay reconciliation could not run: ' || left(p_error, 150), 'reconciliation_run', v_id, NULL);
  ELSIF v_open > 0 THEN
    PERFORM private.raise_ops_event('critical', 'reconcile', 'reconcile_discrepancy', v_open || ' reconciliation finding(s) need a human', 'reconciliation_run', v_id, jsonb_build_object('run', v_id));
  END IF;
  RETURN v_id;
END $$;

------------------------------------------------------------------------
-- 5. audit-chain verification with stored checkpoints
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_anchors (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  rows      BIGINT NOT NULL,
  head_seq  BIGINT,
  head_hash TEXT,
  intact    BOOLEAN NOT NULL,
  first_bad_seq BIGINT
);
CREATE OR REPLACE FUNCTION private.audit_anchor_ro() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = ''
AS $$ BEGIN RAISE EXCEPTION 'audit_anchors is append-only' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_audit_anchor_ro ON public.audit_anchors;
CREATE TRIGGER trg_audit_anchor_ro BEFORE UPDATE OR DELETE ON public.audit_anchors FOR EACH ROW EXECUTE FUNCTION private.audit_anchor_ro();

-- Same verification as audit_chain_status() but runnable by the scheduler. Also checks the chain still CONTAINS the previous anchor
-- (catches deletion of the newest rows, which the chain alone cannot show).
CREATE OR REPLACE FUNCTION private.audit_verify_job()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_bad BIGINT; v_rows BIGINT; v_head RECORD; v_prev RECORD; v_intact BOOLEAN; v_contains BOOLEAN := true;
BEGIN
  SELECT min(o.chain_seq) INTO v_bad
    FROM (SELECT f.*, lag(f.row_hash) OVER (ORDER BY f.chain_seq) AS exp_prev FROM public.financial_audit f) o
   WHERE o.prev_hash IS DISTINCT FROM COALESCE(o.exp_prev, repeat('0', 64))
      OR o.row_hash  IS DISTINCT FROM private.audit_row_hash(o.chain_seq, o.at, o.actor, o.action, o.entity, o.entity_id, o.detail, o.prev_hash);
  SELECT count(*) INTO v_rows FROM public.financial_audit;
  SELECT chain_seq, row_hash INTO v_head FROM public.financial_audit ORDER BY chain_seq DESC LIMIT 1;
  SELECT * INTO v_prev FROM public.audit_anchors WHERE intact AND head_seq IS NOT NULL ORDER BY id DESC LIMIT 1;
  IF v_prev.id IS NOT NULL THEN
    v_contains := EXISTS (SELECT 1 FROM public.financial_audit WHERE chain_seq = v_prev.head_seq AND row_hash = v_prev.head_hash);
  END IF;
  v_intact := v_bad IS NULL AND v_contains;
  INSERT INTO public.audit_anchors (rows, head_seq, head_hash, intact, first_bad_seq) VALUES (v_rows, v_head.chain_seq, v_head.row_hash, v_intact, v_bad);
  IF NOT v_intact THEN
    PERFORM private.raise_ops_event('critical', 'audit-verify', 'audit_chain_broken',
      CASE WHEN v_bad IS NOT NULL THEN 'The financial audit chain is broken at sequence ' || v_bad
           ELSE 'The previous audit checkpoint is missing from the chain: recent audit rows were removed' END,
      'financial_audit', 1, jsonb_build_object('first_bad_seq', v_bad, 'rows', v_rows, 'contains_previous_anchor', v_contains));
  END IF;
  RETURN jsonb_build_object('intact', v_intact, 'rows', v_rows, 'first_bad_seq', v_bad, 'contains_previous_anchor', v_contains);
END $$;
REVOKE ALL ON FUNCTION private.audit_verify_job() FROM PUBLIC, anon, authenticated;

------------------------------------------------------------------------
-- 6. financial_health(): what needs a human, in one call (admin only)
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.financial_health()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_rec RECORD; v_anchor RECORD;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_rec FROM public.reconciliation_runs ORDER BY id DESC LIMIT 1;
  SELECT * INTO v_anchor FROM public.audit_anchors ORDER BY id DESC LIMIT 1;
  RETURN jsonb_build_object(
    'open_critical_events', (SELECT count(*) FROM public.ops_events WHERE resolved_at IS NULL AND severity = 'critical'),
    'open_warning_events',  (SELECT count(*) FROM public.ops_events WHERE resolved_at IS NULL AND severity = 'warning'),
    'open_events_by_code',  coalesce((SELECT jsonb_object_agg(code, n) FROM (SELECT code, count(*) n FROM public.ops_events WHERE resolved_at IS NULL GROUP BY code) x), '{}'::jsonb),
    'refunds_awaiting_approval', (SELECT count(*) FROM public.refund_requests WHERE status = 'requested' AND requires_approval),
    'refunds_failed',            (SELECT count(*) FROM public.refund_requests WHERE status = 'failed'),
    'refunds_in_flight_over_15m', (SELECT count(*) FROM public.refund_requests WHERE status = 'processing' AND processing_since < now() - interval '15 minutes'),
    'pending_online_orders_over_30m', (SELECT count(*) FROM public.orders WHERE status = 'pending' AND payment_method = 'online' AND created_at < now() - interval '30 minutes'),
    'held_orders', (SELECT count(*) FROM public.orders WHERE status = 'on_hold'),
    'payment_failures_24h', (SELECT count(*) FROM public.payment_failures WHERE created_at > now() - interval '24 hours'),
    'last_reconciliation', CASE WHEN v_rec.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_rec.id, 'at', v_rec.finished_at, 'ok', v_rec.ok, 'age_hours', round(extract(epoch FROM now() - v_rec.finished_at) / 3600.0, 1)) END,
    'reconciliation_stale', coalesce(v_rec.finished_at, '-infinity'::timestamptz) < now() - interval '36 hours',
    'last_audit_check', CASE WHEN v_anchor.id IS NULL THEN NULL ELSE jsonb_build_object('at', v_anchor.at, 'intact', v_anchor.intact, 'rows', v_anchor.rows, 'head_seq', v_anchor.head_seq, 'head_hash', v_anchor.head_hash) END,
    'audit_check_stale', coalesce(v_anchor.at, '-infinity'::timestamptz) < now() - interval '36 hours');
END $$;
REVOKE ALL ON FUNCTION public.financial_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financial_health() TO authenticated, service_role;

------------------------------------------------------------------------
-- 7. access, scheduler
------------------------------------------------------------------------
ALTER TABLE public.payment_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_anchors ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['payment_failures', 'refund_events', 'reconciliation_runs', 'audit_anchors'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Admins read %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Admins read %1$s" ON public.%1$I FOR SELECT USING (public.is_admin())', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_anchors FROM service_role;
REVOKE ALL ON FUNCTION public.record_payment_failure(JSONB), public.settle_refund_event(TEXT, TEXT, TEXT, BIGINT, BIGINT),
  public.record_reconciliation_run(TIMESTAMPTZ, TIMESTAMPTZ, INT, INT, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_failure(JSONB), public.settle_refund_event(TEXT, TEXT, TEXT, BIGINT, BIGINT),
  public.record_reconciliation_run(TIMESTAMPTZ, TIMESTAMPTZ, INT, INT, JSONB, TEXT, TEXT) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'hook_reconcile') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'hook_reconcile',
      'Shared secret between pg_cron and the razorpay-reconcile Edge Function');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.call_function(p_slug TEXT, p_hook TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_url TEXT := private.project_url();
BEGIN
  IF v_url IS NULL THEN RAISE WARNING 'project_url missing in Vault; % not called', p_slug; RETURN; END IF;
  PERFORM net.http_post(url := v_url || '/functions/v1/' || p_slug,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', private.hook_secret(p_hook)),
    body := '{}'::jsonb, timeout_milliseconds := 55000);
END $$;
REVOKE ALL ON FUNCTION private.call_function(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname IN ('razorpay-reconcile', 'audit-verify');
  PERFORM cron.schedule('razorpay-reconcile', '0 3 * * *', $c$select private.call_function('razorpay-reconcile', 'hook_reconcile')$c$);
  PERFORM cron.schedule('audit-verify', '30 3 * * *', $c$select private.audit_verify_job()$c$);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron not scheduled (%): enable pg_cron and schedule razorpay-reconcile (daily) and private.audit_verify_job() (daily)', SQLERRM;
END $$;
