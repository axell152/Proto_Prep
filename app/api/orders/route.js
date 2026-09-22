import { ensureSchema, sql, recalcOrder } from '@/lib/db';
import { parseProductionPdf } from '@/lib/pdfParser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await ensureSchema();
    const query = sql();
    const orders = await query`
      SELECT o.*, COUNT(i.id)::int AS item_count
      FROM orders o
      LEFT JOIN order_items i ON i.order_id = o.id AND i.is_preparable = TRUE
      GROUP BY o.id
      ORDER BY CASE o.status WHEN 'EN_COURS' THEN 1 WHEN 'A_PREPARER' THEN 2 ELSE 3 END, o.created_at DESC
    `;
    return Response.json({ orders });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    await ensureSchema();
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return Response.json({ error: 'Aucun PDF reçu.' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseProductionPdf(buffer);
    if (!parsed.items.length) return Response.json({ error: 'Aucune ligne de préparation détectée dans ce PDF.' }, { status: 422 });

    const query = sql();
    const existing = await query`SELECT id FROM orders WHERE order_number = ${parsed.orderNumber}`;
    if (existing.length) return Response.json({ error: `La commande ${parsed.orderNumber} existe déjà.`, order: { id: existing[0].id } }, { status: 409 });

    const inserted = await query`
      INSERT INTO orders (order_number, client, internal_reference, pickup_date, source_filename)
      VALUES (${parsed.orderNumber}, ${parsed.client}, ${parsed.internalReference}, ${parsed.pickupDate}, ${file.name})
      RETURNING *
    `;
    const order = inserted[0];

    for (const item of parsed.items) {
      await query`
        INSERT INTO order_items (order_id, code, designation, requested_qty, prepared_qty, location, is_preparable, sort_order)
        VALUES (${order.id}, ${item.code}, ${item.designation}, ${item.requestedQty}, ${item.preparedQty}, ${item.location}, ${item.isPreparable}, ${item.sortOrder})
      `;
    }

    await recalcOrder(order.id);
    return Response.json({ order: { id: order.id, order_number: order.order_number }, detectedItems: parsed.items.length });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error.message || 'Import impossible.' }, { status: 500 });
  }
}
