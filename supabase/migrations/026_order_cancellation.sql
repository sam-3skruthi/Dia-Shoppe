-- 026 — customer-initiated cancellation + courier auto-tracking support
--
-- 1. cancellation_reason / cancelled_at / cancelled_by  — why an order was
--    cancelled and who did it (customer or admin), for the admin list and
--    for spotting patterns ("delivery too slow" repeating = a real problem).
-- 2. courier tracking fields used by the aggregator webhook (Shiprocket etc.)
--    so shipped / out-for-delivery / delivered update themselves.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by        TEXT,          -- 'customer' | 'admin'
  ADD COLUMN IF NOT EXISTS courier_status      TEXT,          -- raw status from the courier
  ADD COLUMN IF NOT EXISTS courier_updated_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.cancellation_reason IS
  'Reason chosen by the customer (or typed by an admin) when the order was cancelled.';
COMMENT ON COLUMN public.orders.courier_status IS
  'Latest raw status text from the courier aggregator webhook; orders.status is the mapped version.';

-- Customers may cancel their OWN order, and only before it ships.
-- Everything else about the row stays locked down by the existing policies.
DROP POLICY IF EXISTS "Customers can cancel their own pending orders" ON public.orders;
CREATE POLICY "Customers can cancel their own pending orders"
  ON public.orders
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND status IN ('pending', 'paid', 'confirmed')
  )
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'cancelled'
  );

-- Put stock back when an order is cancelled, exactly once.
CREATE OR REPLACE FUNCTION public.restock_cancelled_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.products p
       SET stock_qty = p.stock_qty + oi.quantity
      FROM public.order_items oi
     WHERE oi.order_id = NEW.id
       AND p.id = oi.product_id;
  END IF;
  RETURN NEW;
END;
$$;

-- NOTE: the trigger itself lives in the migration that first added it
-- (trg_orders_restock_on_cancel). Creating a second trigger on the same
-- function here would restock the items TWICE on cancellation, so this
-- migration only defines/updates the function.
DROP TRIGGER IF EXISTS trg_restock_cancelled_order ON public.orders;
