import { neon } from '@neondatabase/serverless';

let sqlClient;

export function sql() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL manquante. Ajoute-la dans Vercel > Settings > Environment Variables.'
    );
  }

  if (!sqlClient) {
    sqlClient = neon(process.env.DATABASE_URL);
  }

  return sqlClient;
}

export async function ensureSchema() {
  const query = sql();

  // Neon HTTP driver : une instruction SQL par requête.

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
    )
  `;

  await query`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      code VARCHAR(100) NOT NULL,
      designation TEXT NOT NULL DEFAULT '',
      requested_qty INTEGER NOT NULL DEFAULT 0,
      prepared_qty INTEGER NOT NULL DEFAULT 0,
      location VARCHAR(120),
      is_preparable BOOLEAN NOT NULL DEFAULT TRUE,

      production_status VARCHAR(10) NOT NULL DEFAULT 'STOCK',

      completed BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Migration pour les commandes déjà présentes en base.
  await query`
    ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS production_status VARCHAR(10) NOT NULL DEFAULT 'STOCK'
  `;

  await query`
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id
    ON order_items(order_id)
  `;

  await query`
    CREATE INDEX IF NOT EXISTS idx_order_items_production_status
    ON order_items(production_status)
  `;
}

export async function recalcOrder(orderId) {
  const query = sql();

  /*
   * Une ligne OF n'est pas encore disponible pour le préparateur.
   *
   * STOCK = disponible
   * OFF   = fabrication terminée / disponible
   * OF    = fabrication en cours / indisponible
   *
   * Les lignes informatives ont déjà is_preparable = FALSE.
   */

  const rows = await query`
    SELECT
      COUNT(*) FILTER (
        WHERE is_preparable = TRUE
          AND production_status <> 'OF'
      ) AS total,

      COUNT(*) FILTER (
        WHERE is_preparable = TRUE
          AND production_status <> 'OF'
          AND completed = TRUE
      ) AS done

    FROM order_items
    WHERE order_id = ${orderId}
  `;

  const total = Number(rows[0]?.total || 0);
  const done = Number(rows[0]?.done || 0);

  const progress = total
    ? Math.round((done / total) * 100)
    : 0;

  const current = await query`
    SELECT status
    FROM orders
    WHERE id = ${orderId}
  `;

  const currentStatus = current[0]?.status;

  const status =
    progress >= 100
      ? 'TERMINEE'
      : currentStatus === 'PAUSEE'
        ? 'PAUSEE'
        : progress > 0
          ? 'EN_COURS'
          : 'A_PREPARER';

  await query`
    UPDATE orders
    SET
      progress = ${progress},
      status = ${status},
      updated_at = NOW(),

      started_at =
        CASE
          WHEN ${progress} > 0
            AND started_at IS NULL
          THEN NOW()
          ELSE started_at
        END,

      completed_at =
        CASE
          WHEN ${progress} >= 100
          THEN COALESCE(completed_at, NOW())
          ELSE NULL
        END

    WHERE id = ${orderId}
  `;

  return {
    progress,
    status
  };
}
