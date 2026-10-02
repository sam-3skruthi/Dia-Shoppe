-- 032 — P0 security + data integrity (forward migration; history untouched)
--
--  A. Internal hook secrets move out of SQL literals into Supabase Vault.
--     Migrations 012/027/029 embedded one shared secret; it is treated as
--     compromised. Each internal function now has its OWN secret, generated
--     inside Postgres (never typed or printed anywhere).
--  B. Stock is tracked per order line, so a cancellation restores exactly what
--     was taken, exactly once. Fixes 026 overwriting 014's pending guard.
--  C. cost_price moves to an admin-only table. products.cost_price stays as a
--     write-through column that is always NULL, so the storefront's select('*')
--     keeps working and nothing private is exposed.
--  D. One atomic, idempotent DB function confirms an online payment and takes
--     stock; verify-payment and razorpay-webhook both call it.

------------------------------------------------------------------------
-- A. Hook secrets in Vault
------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

DO $$
DECLARE n TEXT;
BEGIN
  FOREACH n IN ARRAY ARRAY['hook_whatsapp_notify', 'hook_order_email', 'hook_process_refund'] LOOP
    IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = n) THEN
      PERFORM vault.create_secret(
        encode(extensions.gen_random_bytes(24), 'hex'), n,
        'Shared secret between a DB trigger and its Edge Function (rotated by migration 032)');
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION private.hook_secret(p_name TEXT)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name $$;
REVOKE ALL ON FUNCTION private.hook_secret(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_whatsapp_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://vkcwfwgxelmamuydwrow.supabase.co/functions/v1/whatsapp-notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-hook-secret', private.hook_secret('hook_whatsapp_notify')),
    body := jsonb_build_object('order_id', NEW.id, 'new_status', NEW.status,
                               'old_status', COALESCE(OLD.status, ''))
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_order_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://vkcwfwgxelmamuydwrow.supabase.co/functions/v1/order-email',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-hook-secret', private.hook_secret('hook_order_email')),
    body := jsonb_build_object('order_id', NEW.id)
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trigger_order_refund()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://vkcwfwgxelmamuydwrow.supabase.co/functions/v1/process-refund',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-hook-secret', private.hook_secret('hook_process_refund')),
    body := jsonb_build_object('order_id', NEW.id)
  );
  RETURN NEW;
END $$;

------------------------------------------------------------------------
-- B + D. Per-line stock accounting and atomic operations
------------------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS stock_deducted_qty INTEGER,        -- NULL = nothing taken yet
  ADD COLUMN IF NOT EXISTS stock_restored_at  TIMESTAMPTZ;    -- set once when given back

COMMENT ON COLUMN public.order_items.stock_deducted_qty IS
  'Units actually removed from products.stock_qty for this line (may be < quantity if stock ran out). NULL until deducted.';
COMMENT ON COLUMN public.order_items.stock_restored_at IS
  'When those units were returned after cancellation. Non-NULL means never restore again.';

-- Backfill from what the old rules did: COD took stock at placement, online
-- took it at payment. Cancelled orders were already restocked by the old trigger.
UPDATE public.order_items oi
   SET stock_deducted_qty = oi.quantity
  FROM public.orders o
 WHERE o.id = oi.order_id
   AND oi.stock_deducted_qty IS NULL
   AND (o.payment_method = 'cod' OR o.payment_id IS NOT NULL);

UPDATE public.order_items oi
   SET stock_restored_at = now()
  FROM public.orders o
 WHERE o.id = oi.order_id
   AND o.status = 'cancelled'
   AND oi.stock_deducted_qty IS NOT NULL
   AND oi.stock_restored_at IS NULL;

-- A customer INSERTs order_items directly (RLS); never let them pre-set the
-- accounting columns to dodge the stock deduction.
CREATE OR REPLACE FUNCTION public.reset_order_item_stock_flags()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.stock_deducted_qty := NULL;
  NEW.stock_restored_at  := NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_order_items_reset_stock_flags ON public.order_items;
CREATE TRIGGER trg_order_items_reset_stock_flags
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.reset_order_item_stock_flags();

-- Take stock for ONE line. Idempotent (row flag), never below zero.
CREATE OR REPLACE FUNCTION private.deduct_item_stock(p_item_id BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_item  public.order_items%ROWTYPE;
  v_stock INTEGER;
  v_take  INTEGER;
BEGIN
  SELECT * INTO v_item FROM public.order_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND OR v_item.stock_deducted_qty IS NOT NULL THEN RETURN 0; END IF;

  SELECT stock_qty INTO v_stock FROM public.products WHERE id = v_item.product_id FOR UPDATE;
  v_take := LEAST(GREATEST(COALESCE(v_stock, 0), 0), v_item.quantity);

  UPDATE public.products SET stock_qty = stock_qty - v_take WHERE id = v_item.product_id;
  UPDATE public.order_items SET stock_deducted_qty = v_take WHERE id = p_item_id;
  RETURN v_take;
END $$;
REVOKE ALL ON FUNCTION private.deduct_item_stock(BIGINT) FROM PUBLIC, anon, authenticated;

-- Take stock for a whole order (lines locked in product order → no deadlocks).
CREATE OR REPLACE FUNCTION private.reserve_order_stock(p_order_id BIGINT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r RECORD; v_total INTEGER := 0;
BEGIN
  FOR r IN SELECT id FROM public.order_items WHERE order_id = p_order_id ORDER BY product_id, id LOOP
    v_total := v_total + private.deduct_item_stock(r.id);
  END LOOP;
  RETURN v_total;
END $$;
REVOKE ALL ON FUNCTION private.reserve_order_stock(BIGINT) FROM PUBLIC, anon, authenticated;

-- COD: stock is taken as each line is inserted (unchanged behaviour, new engine).
CREATE OR REPLACE FUNCTION public.decrement_stock_for_cod_item()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (SELECT payment_method FROM public.orders WHERE id = NEW.order_id) = 'cod' THEN
    PERFORM private.deduct_item_stock(NEW.id);
  END IF;
  RETURN NEW;
END $$;

-- Cancellation: give back exactly what was taken, once per line.
CREATE OR REPLACE FUNCTION public.restock_cancelled_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r RECORD;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    FOR r IN
      SELECT id, product_id, stock_deducted_qty FROM public.order_items
       WHERE order_id = NEW.id AND stock_deducted_qty > 0 AND stock_restored_at IS NULL
       ORDER BY product_id, id
    LOOP
      -- the flag update is the "exactly once" gate
      UPDATE public.order_items SET stock_restored_at = now()
       WHERE id = r.id AND stock_restored_at IS NULL;
      IF FOUND THEN
        UPDATE public.products SET stock_qty = stock_qty + r.stock_deducted_qty WHERE id = r.product_id;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

-- Online payment: confirm + take stock in ONE transaction. Safe to call from
-- verify-payment, the webhook, or both at once, any number of times.
CREATE OR REPLACE FUNCTION public.confirm_online_payment(p_order_id BIGINT, p_payment_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_won BOOLEAN := false; v_status TEXT;
BEGIN
  UPDATE public.orders SET status = 'confirmed', payment_id = p_payment_id
   WHERE id = p_order_id AND status = 'pending'
  RETURNING true INTO v_won;
  v_won := COALESCE(v_won, false);

  SELECT status INTO v_status FROM public.orders WHERE id = p_order_id;
  IF v_status IS NULL THEN RETURN jsonb_build_object('found', false); END IF;

  -- replay-safe: even if someone else confirmed first, make sure stock was taken
  IF v_status IN ('confirmed', 'paid', 'shipped', 'delivered') THEN
    PERFORM private.reserve_order_stock(p_order_id);
  END IF;
  RETURN jsonb_build_object('found', true, 'won', v_won, 'status', v_status);
END $$;
REVOKE ALL ON FUNCTION public.confirm_online_payment(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_online_payment(BIGINT, TEXT) TO service_role;

------------------------------------------------------------------------
-- C. cost_price → admin-only table
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_costs (
  product_id BIGINT PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  cost_price NUMERIC(10, 2) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage product costs" ON public.product_costs;
CREATE POLICY "Admins manage product costs" ON public.product_costs
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.product_costs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_costs TO authenticated;
GRANT ALL ON public.product_costs TO service_role;

INSERT INTO public.product_costs (product_id, cost_price)
SELECT id, cost_price FROM public.products WHERE cost_price IS NOT NULL
ON CONFLICT (product_id) DO UPDATE SET cost_price = EXCLUDED.cost_price;

-- Existing admin UI keeps writing products.cost_price; divert it to the private
-- table and blank the public column. NULL from the UI means "no change".
CREATE OR REPLACE FUNCTION public.divert_product_cost()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.product_costs (product_id, cost_price)
  VALUES (NEW.id, NEW.cost_price)
  ON CONFLICT (product_id) DO UPDATE SET cost_price = EXCLUDED.cost_price, updated_at = now();
  UPDATE public.products SET cost_price = NULL WHERE id = NEW.id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_products_divert_cost ON public.products;
CREATE TRIGGER trg_products_divert_cost
  AFTER INSERT OR UPDATE OF cost_price ON public.products
  FOR EACH ROW WHEN (NEW.cost_price IS NOT NULL)
  EXECUTE FUNCTION public.divert_product_cost();

UPDATE public.products SET cost_price = NULL WHERE cost_price IS NOT NULL;
