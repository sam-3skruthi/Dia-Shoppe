-- Dia Shoppe — Realtime + Storage Setup

-- Enable Realtime (admin dashboard needs live order updates)
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE cart_items;

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true)
ON CONFLICT DO NOTHING;

INSERT INTO storage.buckets (id, name, public) VALUES ('invoices', 'invoices', false)
ON CONFLICT DO NOTHING;

-- Storage policies
CREATE POLICY "Public read product images" ON storage.objects
FOR SELECT USING (bucket_id = 'product-images');

CREATE POLICY "Admins manage product images" ON storage.objects
FOR ALL USING (
  bucket_id = 'product-images' AND
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Users view own invoices" ON storage.objects
FOR SELECT USING (
  bucket_id = 'invoices' AND auth.uid()::text = (storage.foldername(name))[1]
);
