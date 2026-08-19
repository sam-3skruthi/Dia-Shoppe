-- 029 — order confirmation email for EVERY confirmed order
--
-- Two gaps this closes:
--   1. Checkout asks for an email but never stored it, so guest orders had no
--      address to write to → shipping_email.
--   2. The email was sent from verify-payment, i.e. only for online payments;
--      cash-on-delivery buyers got nothing. A trigger on 'confirmed' now covers
--      both, and email_sent_at makes it exactly-once.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_email TEXT,
  ADD COLUMN IF NOT EXISTS email_sent_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.shipping_email IS
  'Email captured at checkout; used for the order confirmation (guests have no account address).';
COMMENT ON COLUMN public.orders.email_sent_at IS
  'Stamped once the confirmation email is accepted by Resend. Prevents duplicate sends on retries.';

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.notify_order_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://vkcwfwgxelmamuydwrow.supabase.co/functions/v1/order-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', 'b1ca51169a236b7845306139b5b094a96dad62dd72314708'
    ),
    body := jsonb_build_object('order_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

-- online payments: pending → confirmed
DROP TRIGGER IF EXISTS trg_orders_email_update ON public.orders;
CREATE TRIGGER trg_orders_email_update
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed')
  EXECUTE FUNCTION public.notify_order_email();

-- COD orders are inserted already 'confirmed'
DROP TRIGGER IF EXISTS trg_orders_email_insert ON public.orders;
CREATE TRIGGER trg_orders_email_insert
  AFTER INSERT ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed')
  EXECUTE FUNCTION public.notify_order_email();
