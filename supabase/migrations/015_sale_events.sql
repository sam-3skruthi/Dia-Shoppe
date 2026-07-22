-- Sale events: admin sets a name, banner text, start/end dates and per-product
-- sale prices; the storefront shows it automatically while "live" and it
-- reverts by itself once ends_at passes — no code or manual cleanup needed.
-- Real prices in `products` are never touched; sale prices are an overlay
-- looked up by the frontend for the currently-active event only.

CREATE TABLE sale_events (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  banner_text VARCHAR(255),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE sale_products (
  sale_event_id BIGINT REFERENCES sale_events(id) ON DELETE CASCADE NOT NULL,
  product_id BIGINT REFERENCES products(id) ON DELETE CASCADE NOT NULL,
  sale_price DECIMAL(10, 2) NOT NULL CHECK (sale_price >= 0),
  PRIMARY KEY (sale_event_id, product_id)
);

CREATE INDEX idx_sale_events_active_window ON sale_events(is_active, starts_at, ends_at);

ALTER TABLE sale_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_products ENABLE ROW LEVEL SECURITY;

-- storefront needs to read these to show the banner + discounted prices
CREATE POLICY "Anyone can view sale events" ON sale_events FOR SELECT USING (TRUE);
CREATE POLICY "Anyone can view sale products" ON sale_products FOR SELECT USING (TRUE);

-- is_admin() defined in migration 009
CREATE POLICY "Admins can manage sale events" ON sale_events FOR ALL USING (is_admin());
CREATE POLICY "Admins can manage sale products" ON sale_products FOR ALL USING (is_admin());

GRANT SELECT ON sale_events, sale_products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON sale_events, sale_products TO authenticated;
GRANT USAGE ON SEQUENCE sale_events_id_seq TO authenticated;
