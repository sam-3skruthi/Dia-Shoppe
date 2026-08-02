-- 027 — automatic Razorpay refund when an order is cancelled
--
-- Columns record the outcome of every refund attempt so the admin Orders page
-- can show it (and so a FAILED refund is loud rather than silent — that is
-- real money owed to a customer).
--
--   refund_status: 'pending' | 'processed' | 'failed' | 'not_applicable'
--     not_applicable = COD / never paid, so there is nothing to send back.
--
-- The trigger fires on cancellation and calls the process-refund Edge
-- Function via pg_net (same pattern as the WhatsApp trigger in 012).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS refund_id     TEXT,
  ADD COLUMN IF NOT EXISTS refund_status TEXT,
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS refund_error  TEXT,
  ADD COLUMN IF NOT EXISTS refund_at     TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.refund_status IS
  'pending | processed | failed | not_applicable (COD or never paid). failed means money is still owed — admin must act.';

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.trigger_order_refund()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://vkcwfwgxelmamuydwrow.supabase.co/functions/v1/process-refund',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', 'b1ca51169a236b7845306139b5b094a96dad62dd72314708'
    ),
    body := jsonb_build_object('order_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_auto_refund ON public.orders;
CREATE TRIGGER trg_orders_auto_refund
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled')
  EXECUTE FUNCTION public.trigger_order_refund();
