import { neon } from '@neondatabase/serverless';

let sqlClient;

export function sql() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL manquante. Ajoute-la dans Vercel > Settings > Environment Variables.');
  }
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

export async function ensureSchema() {
  const query = sql();
  await query`
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
  `;
}

export async function recalcOrder(orderId) {
  const query = sql();
  const rows = await query`
    SELECT
      COUNT(*) FILTER (WHERE is_preparable = TRUE) AS total,
      COUNT(*) FILTER (WHERE is_preparable = TRUE AND completed = TRUE) AS done
    FROM order_items
    WHERE order_id = ${orderId}
  `;

  const total = Number(rows[0]?.total || 0);
  const done = Number(rows[0]?.done || 0);
  const progress = total ? Math.round((done / total) * 100) : 0;
  const current = await query`SELECT status FROM orders WHERE id = ${orderId}`;
  const currentStatus = current[0]?.status;
  const status = progress >= 100 ? 'TERMINEE' : currentStatus === 'PAUSEE' ? 'PAUSEE' : progress > 0 ? 'EN_COURS' : 'A_PREPARER';

  await query`
    UPDATE orders
    SET progress = ${progress},
        status = ${status},
        updated_at = NOW(),
        started_at = CASE WHEN ${progress} > 0 AND started_at IS NULL THEN NOW() ELSE started_at END,
        completed_at = CASE WHEN ${progress} >= 100 THEN COALESCE(completed_at, NOW()) ELSE NULL END
    WHERE id = ${orderId}
  `;

  return { progress, status };
}
