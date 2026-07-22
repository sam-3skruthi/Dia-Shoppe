-- Dia Shoppe — Courier tracking details, filled by workers when marking shipped
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100);
