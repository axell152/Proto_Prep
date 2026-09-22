import { ensureSchema, sql, recalcOrder } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    await ensureSchema();
    const query = sql();
    const orderRows = await query`SELECT * FROM orders WHERE id = ${params.id}`;
    if (!orderRows.length) return Response.json({ error: 'Commande introuvable.' }, { status: 404 });
    const items = await query`SELECT * FROM order_items WHERE order_id = ${params.id} ORDER BY sort_order, id`;
    return Response.json({ order: orderRows[0], items });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    await ensureSchema();
    const body = await request.json();
    const query = sql();
    if (body.action === 'togglePause') {
      const current = await query`SELECT * FROM orders WHERE id = ${params.id}`;
      if (!current.length) return Response.json({ error: 'Commande introuvable.' }, { status: 404 });
      const nextStatus = current[0].status === 'PAUSEE' ? (Number(current[0].progress) > 0 ? 'EN_COURS' : 'A_PREPARER') : 'PAUSEE';
      await query`UPDATE orders SET status = ${nextStatus}, updated_at = NOW() WHERE id = ${params.id}`;
      const orderRows = await query`SELECT * FROM orders WHERE id = ${params.id}`;
      const items = await query`SELECT * FROM order_items WHERE order_id = ${params.id} ORDER BY sort_order, id`;
      return Response.json({ order: orderRows[0], items });
    }

    const itemId = Number(body.itemId);
    if (!itemId) return Response.json({ error: 'Ligne invalide.' }, { status: 400 });
    const found = await query`SELECT * FROM order_items WHERE id = ${itemId} AND order_id = ${params.id}`;
    if (!found.length) return Response.json({ error: 'Ligne introuvable.' }, { status: 404 });
    const item = found[0];

    if (body.action === 'complete') {
      await query`UPDATE order_items SET prepared_qty = requested_qty, completed = TRUE, updated_at = NOW() WHERE id = ${itemId}`;
    } else if (body.action === 'reset') {
      await query`UPDATE order_items SET prepared_qty = 0, completed = FALSE, updated_at = NOW() WHERE id = ${itemId}`;
    } else if (body.action === 'partial') {
      const value = Math.max(0, Math.min(item.requested_qty, Number(body.value)));
      await query`UPDATE order_items SET prepared_qty = ${value}, completed = ${value >= item.requested_qty}, updated_at = NOW() WHERE id = ${itemId}`;
    } else {
      return Response.json({ error: 'Action inconnue.' }, { status: 400 });
    }

    await recalcOrder(params.id);
    const orderRows = await query`SELECT * FROM orders WHERE id = ${params.id}`;
    const items = await query`SELECT * FROM order_items WHERE order_id = ${params.id} ORDER BY sort_order, id`;
    return Response.json({ order: orderRows[0], items });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
