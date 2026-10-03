-- 038 — refund failure handling, admin alerts, automatic retry, customer notification
-- (DEV first; NOT applied to production)
--
--   refund fails
--     -> audit row (already: refund_failed)
--     -> admin-visible ops event (warning)            [ops_events]
--     -> automatic retry with backoff 10m, 30m, 2h, 6h (max 5 attempts)
--     -> still failing after 5: critical ops event + customer told we are sorting it out
--   refund succeeds (first try or after retries)
--     -> ops events resolved, customer told it is processed (exactly once)
--
-- A temporary Razorpay/API failure never reaches the customer: they hear only the FINAL outcome.

ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.refund_stamp_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.status_changed_at := now(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_refund_stamp ON public.refund_requests;
CREATE TRIGGER trg_refund_stamp BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.refund_stamp_status_change();

------------------------------------------------------------------------
-- Customer notification outbox (exactly one row per kind + refund + channel)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_notifications (
  id                BIGSERIAL PRIMARY KEY,
  at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind              TEXT NOT NULL,                 -- refund_processed | refund_delayed
  order_id          BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  refund_request_id BIGINT REFERENCES public.refund_requests(id) ON DELETE SET NULL,
  channel           TEXT NOT NULL DEFAULT 'email', -- whatsapp joins in P1 (queue)
  recipient         TEXT,
  status            TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent', 'skipped', 'failed')),
  error             TEXT,
  UNIQUE (kind, refund_request_id, channel)
);
ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read notifications" ON public.customer_notifications;
CREATE POLICY "Admins read notifications" ON public.customer_notifications FOR SELECT USING (public.is_admin());
REVOKE ALL ON public.customer_notifications FROM anon, authenticated;
GRANT SELECT ON public.customer_notifications TO authenticated;
GRANT ALL ON public.customer_notifications TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'hook_refund_notify') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'hook_refund_notify',
      'Shared secret between the refund DB triggers and the refund-notify Edge Function');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.dispatch_refund_notify(p_refund_request_id BIGINT, p_kind TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_url TEXT := private.project_url();
BEGIN
  IF v_url IS NULL THEN RAISE WARNING 'project_url missing in Vault; refund-notify not called'; RETURN; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/refund-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', private.hook_secret('hook_refund_notify')),
    body := jsonb_build_object('refund_request_id', p_refund_request_id, 'kind', p_kind));
END $$;
REVOKE ALL ON FUNCTION private.dispatch_refund_notify(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

------------------------------------------------------------------------
-- Status transitions -> ops events + notifications
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_status_side_effects()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'requested' AND NEW.requires_approval THEN
    PERFORM private.raise_ops_event('warning', 'refunds', 'refund_needs_approval',
      'A refund is waiting for admin approval (' || NEW.reason || ')', 'refund_request', NEW.id,
      jsonb_build_object('order_id', NEW.order_id, 'amount', NEW.amount, 'reason', NEW.reason));
  ELSIF NEW.status IN ('approved', 'rejected') THEN
    PERFORM private.resolve_ops_events('refund_needs_approval', 'refund_request', NEW.id);
  ELSIF NEW.status = 'failed' THEN
    PERFORM private.raise_ops_event('warning', 'process-refund', 'refund_failed',
      'A refund attempt failed; it will be retried automatically', 'refund_request', NEW.id,
      jsonb_build_object('order_id', NEW.order_id, 'amount', NEW.amount, 'attempts', NEW.attempts, 'error', NEW.error));
  ELSIF NEW.status = 'processed' THEN
    PERFORM private.resolve_ops_events('refund_failed', 'refund_request', NEW.id);
    PERFORM private.resolve_ops_events('refund_retries_exhausted', 'refund_request', NEW.id);
    PERFORM private.resolve_ops_events('refund_stalled', 'refund_request', NEW.id);
    PERFORM private.dispatch_refund_notify(NEW.id, 'refund_processed');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_refund_side_effects ON public.refund_requests;
CREATE TRIGGER trg_refund_side_effects AFTER INSERT OR UPDATE OF status ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.refund_status_side_effects();

------------------------------------------------------------------------
-- Automatic retry with backoff + exhaustion handling
------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.retry_failed_refunds()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_n INTEGER; r RECORD;
BEGIN
  UPDATE public.refund_requests
     SET status = 'approved'
   WHERE status = 'failed' AND attempts < 5
     AND status_changed_at < now() - make_interval(mins =>
           CASE attempts WHEN 1 THEN 10 WHEN 2 THEN 30 WHEN 3 THEN 120 ELSE 360 END);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- out of attempts: shout once, tell the customer once
  FOR r IN SELECT id, order_id, amount, error FROM public.refund_requests WHERE status = 'failed' AND attempts >= 5 LOOP
    PERFORM private.raise_ops_event('critical', 'process-refund', 'refund_retries_exhausted',
      'A refund could not be completed after 5 attempts - manual action needed', 'refund_request', r.id,
      jsonb_build_object('order_id', r.order_id, 'amount', r.amount, 'last_error', r.error));
    IF NOT EXISTS (SELECT 1 FROM public.customer_notifications WHERE kind = 'refund_delayed' AND refund_request_id = r.id) THEN
      PERFORM private.dispatch_refund_notify(r.id, 'refund_delayed');
    END IF;
  END LOOP;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION private.retry_failed_refunds() FROM PUBLIC, anon, authenticated;

-- stalled 'processing' (migration 035) now also tells the admin
CREATE OR REPLACE FUNCTION private.requeue_stuck_refunds(p_minutes INTEGER DEFAULT 15)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_n INTEGER := 0; r RECORD;
BEGIN
  FOR r IN SELECT id, order_id FROM public.refund_requests
            WHERE status = 'processing' AND processing_since < now() - make_interval(mins => p_minutes) LOOP
    UPDATE public.refund_requests
       SET status = 'approved', error = 'recovered after a stalled attempt (no result recorded for ' || p_minutes || '+ minutes)'
     WHERE id = r.id;
    PERFORM private.raise_ops_event('warning', 'process-refund', 'refund_stalled',
      'A refund attempt stalled and was re-queued', 'refund_request', r.id, jsonb_build_object('order_id', r.order_id));
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('retry-failed-refunds') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retry-failed-refunds');
  PERFORM cron.schedule('retry-failed-refunds', '*/5 * * * *', 'select private.retry_failed_refunds()');
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron not scheduled (%): schedule private.retry_failed_refunds() every 5 minutes', SQLERRM;
END $$;
