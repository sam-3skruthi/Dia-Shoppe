-- Dia Shoppe — Admin RLS additions
-- 1. is_admin() helper: SECURITY DEFINER so a policy on user_profiles can
--    check roles without infinitely recursing into its own policy.
-- 2. Admins can view all order line items (AdminOrders showed 0 items for
--    other customers' orders without this).
-- 3. Admins can view all customer profiles (needed by the Customers page).

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

CREATE POLICY "Admins can view all order items" ON order_items
FOR SELECT USING (public.is_admin());

CREATE POLICY "Admins can view all profiles" ON user_profiles
FOR SELECT USING (public.is_admin());
