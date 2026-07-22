-- Dia Shoppe — Row Level Security Policies

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
-- categories: public catalog metadata; enable RLS with public read
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- ---- categories ----
CREATE POLICY "Anyone can view categories" ON categories
FOR SELECT USING (TRUE);

CREATE POLICY "Only admins can modify categories" ON categories
FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ---- user_profiles ----
CREATE POLICY "Users can view own profile" ON user_profiles
FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON user_profiles
FOR UPDATE USING (auth.uid() = id);

-- ---- products ----
CREATE POLICY "Anyone can view active products" ON products
FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Only admins can modify products" ON products
FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ---- cart_items ----
CREATE POLICY "Users can view own cart" ON cart_items
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cart" ON cart_items
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cart" ON cart_items
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own cart" ON cart_items
FOR DELETE USING (auth.uid() = user_id);

-- ---- orders ----
CREATE POLICY "Users can view own orders" ON orders
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own orders" ON orders
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all orders" ON orders
FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Admins can update all orders" ON orders
FOR UPDATE USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ---- order_items ----
CREATE POLICY "Users can view own order items" ON order_items
FOR SELECT USING (
  EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
);

CREATE POLICY "Users can insert own order items" ON order_items
FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM orders WHERE orders.id = order_items.order_id AND orders.user_id = auth.uid())
);

-- ---- feedback ----
CREATE POLICY "Users can submit feedback" ON feedback
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anyone can view feedback" ON feedback
FOR SELECT USING (TRUE);

-- ---- whatsapp_messages ----
CREATE POLICY "Users can view own messages" ON whatsapp_messages
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all messages" ON whatsapp_messages
FOR SELECT USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);
