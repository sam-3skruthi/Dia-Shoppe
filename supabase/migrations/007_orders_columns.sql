-- Dia Shoppe — Extra order columns needed by checkout
--   shipping_name: recipient's name (may differ from the account holder's)
--   payment_method: cod | upi | card | netbanking — how the customer chose to pay

ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_name VARCHAR(150);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) DEFAULT 'cod';
