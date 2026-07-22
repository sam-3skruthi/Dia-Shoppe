-- WhatsApp order updates: whenever an order's status changes (admin UI,
-- verify-payment, Razorpay webhook — anyone), call the whatsapp-notify Edge
-- Function via pg_net. The function decides which statuses are worth a
-- message and logs every attempt to whatsapp_messages.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION notify_whatsapp_status()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://vkcwfwgxelmamuydwrow.supabase.co/functions/v1/whatsapp-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hook-secret', 'b1ca51169a236b7845306139b5b094a96dad62dd72314708'
    ),
    body := jsonb_build_object(
      'order_id', NEW.id,
      'new_status', NEW.status,
      'old_status', COALESCE(OLD.status, '')
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_orders_whatsapp_update
AFTER UPDATE OF status ON orders
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION notify_whatsapp_status();

-- COD orders are created directly as 'confirmed', so cover INSERT too
CREATE TRIGGER trg_orders_whatsapp_insert
AFTER INSERT ON orders
FOR EACH ROW
WHEN (NEW.status = 'confirmed')
EXECUTE FUNCTION notify_whatsapp_status();
