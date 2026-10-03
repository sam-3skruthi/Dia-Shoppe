-- 035 — refund crash recovery (DEV first; NOT applied to production)
--
-- A refund request is claimed (approved -> processing) before Razorpay is called.
-- If the function dies after the claim - before Razorpay answered, or after it
-- accepted the refund but before we saved 'processed' - the row used to sit in
-- 'processing' forever. It never claimed success wrongly, but it was never
-- recovered either.
--
-- Now: processing_since is stamped on claim; a cron job returns requests that
-- stalled for 15+ minutes to 'approved', which re-dispatches process-refund.
-- process-refund first asks Razorpay whether a refund for this request already
-- exists (notes.refund_request_id) and, if so, just records it instead of
-- refunding again. Net effect: at-least-once execution, at-most-once money.

ALTER TABLE public.refund_requests ADD COLUMN IF NOT EXISTS processing_since TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION private.requeue_stuck_refunds(p_minutes INTEGER DEFAULT 15)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE public.refund_requests
     SET status = 'approved',
         error = 'recovered after a stalled attempt (no result recorded for ' || p_minutes || '+ minutes)'
   WHERE status = 'processing'
     AND processing_since < now() - make_interval(mins => p_minutes);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION private.requeue_stuck_refunds(INTEGER) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('requeue-stuck-refunds')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'requeue-stuck-refunds');
  PERFORM cron.schedule('requeue-stuck-refunds', '*/10 * * * *', 'select private.requeue_stuck_refunds(15)');
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_cron not scheduled (%): schedule private.requeue_stuck_refunds(15) every 10 minutes', SQLERRM;
END $$;
