CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number VARCHAR(80) NOT NULL UNIQUE,
  client VARCHAR(255),
  internal_reference TEXT,
  pickup_date VARCHAR(40),
  source_filename TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'A_PREPARER',
  progress INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  code VARCHAR(100) NOT NULL,
  designation TEXT NOT NULL DEFAULT '',
  requested_qty INTEGER NOT NULL DEFAULT 0,
  prepared_qty INTEGER NOT NULL DEFAULT 0,
  location VARCHAR(120),
  is_preparable BOOLEAN NOT NULL DEFAULT TRUE,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
