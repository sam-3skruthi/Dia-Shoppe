-- 019 — admin read access to cart_items (for the Leads / abandoned-cart page)
-- Lets admins see every customer's live cart so the dashboard can surface
-- abandoned carts and let staff send a WhatsApp reminder. Customers still
-- only see/modify their own cart (policies from 002 are unchanged).

CREATE POLICY "Admins can view all carts" ON public.cart_items
  FOR SELECT USING (public.is_admin());
