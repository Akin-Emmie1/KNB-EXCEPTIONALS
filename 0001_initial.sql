CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  category_type TEXT NOT NULL CHECK (category_type IN ('collectibles', 'beauty')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (category_type, slug)
);
CREATE INDEX IF NOT EXISTS categories_type_name_idx ON categories(category_type, name);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  long_description TEXT NOT NULL DEFAULT '',
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  old_price_minor INTEGER CHECK (old_price_minor IS NULL OR old_price_minor >= 0),
  tag TEXT CHECK (tag IS NULL OR tag IN ('new', 'sale')),
  material TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  in_stock INTEGER NOT NULL DEFAULT 1 CHECK (in_stock IN (0, 1)),
  main_image_key TEXT,
  sizes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sizes_json)),
  colors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(colors_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS products_category_created_idx ON products(category_id, created_at DESC);
CREATE INDEX IF NOT EXISTS products_stock_idx ON products(in_stock);

CREATE TABLE IF NOT EXISTS product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS product_images_product_order_idx ON product_images(product_id, sort_order);

CREATE TABLE IF NOT EXISTS salon_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 720),
  image_key TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS salon_services_active_name_idx ON salon_services(is_active, name);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  service_id TEXT REFERENCES salon_services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 720),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS appointments_schedule_idx ON appointments(status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS appointments_created_idx ON appointments(created_at DESC);
CREATE INDEX IF NOT EXISTS appointments_service_idx ON appointments(service_id, starts_at);

CREATE TABLE IF NOT EXISTS salon_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
  opening_hours_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(opening_hours_json)),
  slot_interval_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_interval_minutes BETWEEN 5 AND 180),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT OR IGNORE INTO salon_settings (id, timezone, opening_hours_json, slot_interval_minutes)
VALUES (1, 'Africa/Lagos', '{}', 30);

CREATE TABLE IF NOT EXISTS site_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT OR IGNORE INTO site_settings (setting_key, setting_value) VALUES
  ('business_name', 'KNB EXCEPTIONALS'),
  ('contact_phone', ''),
  ('contact_email', ''),
  ('whatsapp_number', ''),
  ('business_address', '');

INSERT OR IGNORE INTO categories (id, name, slug, category_type) VALUES
  ('collectibles-clothes', 'Clothes', 'clothes', 'collectibles'),
  ('collectibles-shoes', 'Shoes', 'shoes', 'collectibles'),
  ('collectibles-bags', 'Bags', 'bags', 'collectibles'),
  ('collectibles-accessories', 'Accessories', 'accessories', 'collectibles'),
  ('beauty-weave-ons', 'Weave-ons', 'weave-ons', 'beauty'),
  ('beauty-hair-extensions', 'Hair extensions', 'hair-extensions', 'beauty'),
  ('beauty-attachments', 'Attachments', 'attachments', 'beauty'),
  ('beauty-wigs', 'Wigs', 'wigs', 'beauty'),
  ('beauty-hair-accessories', 'Hair accessories', 'hair-accessories', 'beauty'),
  ('beauty-other', 'Other hair & beauty merchandise', 'other-hair-beauty', 'beauty');
