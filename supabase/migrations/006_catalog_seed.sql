-- Dia Shoppe — Catalog columns + seed data
-- Part 1: columns the storefront needs that the base schema lacked
--   slug: clean URLs (/products/accu-chek-instant-s)
--   original_price: strike-through MRP shown next to selling price
--   badge: marketing tag shown on the card (Best Seller / Popular / …)
--   rating: star rating shown on cards (until real review aggregation exists)
-- Part 2: the 6 categories + 18 products currently hardcoded in the frontend

-- ===== Part 1: columns =====
ALTER TABLE categories ADD COLUMN IF NOT EXISTS slug VARCHAR(100) UNIQUE;

ALTER TABLE products ADD COLUMN IF NOT EXISTS slug VARCHAR(150) UNIQUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS original_price DECIMAL(10, 2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS badge VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS rating INT DEFAULT 4 CHECK (rating >= 1 AND rating <= 5);

CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);

-- ===== Part 2: seed categories =====
INSERT INTO categories (slug, name, description) VALUES
  ('glucose',     'Glucose Monitors',   'Accu-Chek, OneTouch, Freestyle & more'),
  ('bp',          'BP Monitors',        'Omron & digital BP apparatus'),
  ('respiratory', 'Respiratory',        'Nebulizers, oxygen, CPAP / BiPAP'),
  ('hospital',    'Hospital Equipment', 'Beds, patient care, furniture'),
  ('mobility',    'Walking Aids',       'Wheelchairs, walkers, mobility'),
  ('devices',     'Other Devices',      'Stethoscopes, massagers, suction')
ON CONFLICT (slug) DO NOTHING;

-- ===== Part 2: seed products =====
INSERT INTO products (slug, name, brand, sku, price, original_price, badge, rating, stock_qty, category_id)
VALUES
  ('accu-chek-instant-s',        'Accu-Chek Instant S Glucometer',            'Roche',       'DS-GLU-001', 1299,  1599,  'Best Seller', 5, 24, (SELECT id FROM categories WHERE slug = 'glucose')),
  ('omron-hem-7120',             'Omron HEM-7120 BP Monitor',                 'Omron',       'DS-BP-001',  1850,  2200,  'Popular',     5, 12, (SELECT id FROM categories WHERE slug = 'bp')),
  ('philips-portable-nebulizer', 'Philips Portable Nebulizer',                'Philips',     'DS-RES-001', 3499,  4200,  'Top Pick',    4, 7,  (SELECT id FROM categories WHERE slug = 'respiratory')),
  ('onetouch-select-plus',       'OneTouch Select Plus Glucometer',           'OneTouch',    'DS-GLU-002', 999,   1299,  NULL,          4, 31, (SELECT id FROM categories WHERE slug = 'glucose')),
  ('dr-morepen-gluco-one',       'Dr. Morepen Gluco One BG-03',               'Dr. Morepen', 'DS-GLU-003', 649,   849,   'New',         4, 40, (SELECT id FROM categories WHERE slug = 'glucose')),
  ('contour-plus',               'Contour Plus Glucometer',                   'Bayer',       'DS-GLU-004', 1150,  1450,  NULL,          4, 0,  (SELECT id FROM categories WHERE slug = 'glucose')),
  ('freestyle-libre-sensor',     'Freestyle Libre Sensor',                    'Freestyle',   'DS-GLU-005', 4999,  5500,  'Premium',     5, 5,  (SELECT id FROM categories WHERE slug = 'glucose')),
  ('omron-hem-7361t',            'Omron HEM-7361T BP Monitor (AFib)',         'Omron',       'DS-BP-002',  4250,  4990,  NULL,          5, 9,  (SELECT id FROM categories WHERE slug = 'bp')),
  ('bpl-oxy-5-concentrator',     'BPL Oxy 5 Oxygen Concentrator',             'BPL',         'DS-RES-002', 38999, 44999, NULL,          4, 3,  (SELECT id FROM categories WHERE slug = 'respiratory')),
  ('philips-respironics-cpap',   'Philips DreamStation CPAP',                 'Philips',     'DS-RES-003', 42999, 49999, 'Top Pick',    5, 2,  (SELECT id FROM categories WHERE slug = 'respiratory')),
  ('littmann-classic-iii',       'Littmann Classic III Stethoscope',          'Littmann',    'DS-DEV-001', 8499,  9500,  'Best Seller', 5, 18, (SELECT id FROM categories WHERE slug = 'devices')),
  ('arkray-glucocard-01',        'Arkray Glucocard 01-mini',                  'Arkray',      'DS-GLU-006', 749,   999,   NULL,          4, 22, (SELECT id FROM categories WHERE slug = 'glucose')),
  ('fowler-hospital-bed',        'Semi-Fowler Hospital Bed (2-Function)',     'BPL',         'DS-HOS-001', 24999, 29999, NULL,          4, 4,  (SELECT id FROM categories WHERE slug = 'hospital')),
  ('foldable-wheelchair',        'Foldable Steel Wheelchair',                 'BPL',         'DS-MOB-001', 6999,  8499,  'Popular',     4, 14, (SELECT id FROM categories WHERE slug = 'mobility')),
  ('aluminium-walker',           'Adjustable Aluminium Walker',               'BPL',         'DS-MOB-002', 1899,  2400,  NULL,          4, 27, (SELECT id FROM categories WHERE slug = 'mobility')),
  ('omron-nebulizer-ne-c101',    'Omron NE-C101 Compressor Nebulizer',        'Omron',       'DS-RES-004', 2199,  2699,  NULL,          4, 16, (SELECT id FROM categories WHERE slug = 'respiratory')),
  ('digital-thermometer',        'Dr. Morepen Digital Thermometer',           'Dr. Morepen', 'DS-DEV-002', 149,   249,   NULL,          4, 60, (SELECT id FROM categories WHERE slug = 'devices')),
  ('pulse-oximeter',             'BPL Smart Pulse Oximeter',                  'BPL',         'DS-DEV-003', 1099,  1499,  'Best Seller', 5, 33, (SELECT id FROM categories WHERE slug = 'devices'))
ON CONFLICT (slug) DO NOTHING;
