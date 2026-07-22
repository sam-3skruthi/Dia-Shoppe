-- COD orders reduce stock at PLACEMENT (unlike online orders, which reduce
-- stock only once payment is verified, in verify-payment/razorpay-webhook).
-- Cancelling an order restocks it — but only if stock was actually taken:
-- an online order still 'pending' when cancelled never had stock removed,
-- so OLD.status = 'pending' is the signal to skip the restock.

-- ── decrement: fires per row when order_items are inserted for a COD order
-- (COD orders are created with status='confirmed' directly — see orders.js) ──
CREATE OR REPLACE FUNCTION decrement_stock_for_cod_item()
RETURNS TRIGGER AS $$
DECLARE
  v_payment_method TEXT;
BEGIN
  SELECT payment_method INTO v_payment_method FROM orders WHERE id = NEW.order_id;
  IF v_payment_method = 'cod' THEN
    UPDATE products SET stock_qty = GREATEST(0, stock_qty - NEW.quantity) WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_order_items_cod_decrement
AFTER INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION decrement_stock_for_cod_item();

-- ── restock: fires when an order flips to 'cancelled' from any status
-- other than 'pending' (covers COD cancellations/refusals and cancelled
-- online orders that had already been paid) ──
CREATE OR REPLACE FUNCTION restock_cancelled_order()
RETURNS TRIGGER AS $$
DECLARE
  item RECORD;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' AND OLD.status != 'pending' THEN
    FOR item IN SELECT product_id, quantity FROM order_items WHERE order_id = NEW.id LOOP
      UPDATE products SET stock_qty = stock_qty + item.quantity WHERE id = item.product_id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_orders_restock_on_cancel
AFTER UPDATE OF status ON orders
FOR EACH ROW
WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION restock_cancelled_order();
