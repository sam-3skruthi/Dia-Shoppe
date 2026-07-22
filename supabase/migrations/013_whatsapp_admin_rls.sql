-- Admins (workers) can see the whole WhatsApp message log — the AdminWhatsApp
-- page reads it. Customers keep seeing only their own rows (002 policy).

CREATE POLICY "Admins can view all whatsapp messages" ON whatsapp_messages
FOR SELECT USING (is_admin());
