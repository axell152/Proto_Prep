'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Topbar from '@/components/Topbar';

const labels = { A_PREPARER: 'À préparer', EN_COURS: 'En cours', PAUSEE: 'En pause', TERMINEE: 'Terminée' };

export default function HomePage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/orders', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setOrders(data.orders || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  return (
    <>
      <Topbar />
      <main className="container">
        <div className="header-row">
          <div>
            <h1>Commandes</h1>
            <p className="sub">Choisis librement la commande que tu veux préparer.</p>
          </div>
          <Link className="btn btn-primary" href="/admin">+ Importer un PDF</Link>
        </div>

        {error && <div className="notice error">{error}</div>}
        {loading ? <div className="loading">Chargement…</div> : orders.length === 0 ? (
          <div className="card empty">
            <h2>Aucune commande</h2>
            <p className="sub">Dépose ton premier bon de production PDF pour commencer.</p>
            <br />
            <Link className="btn btn-primary" href="/admin">Importer un bon</Link>
          </div>
        ) : (
          <div className="grid">
            {orders.map((order) => (
              <Link className="card order-card" href={`/orders/${order.id}`} key={order.id}>
                <div className="order-top">
                  <div className="order-number">#{order.order_number}</div>
                  <div className={`status status-${order.status.toLowerCase()}`}>{labels[order.status] || order.status}</div>
                </div>
                <div className="meta"><strong>{order.client || 'Client non détecté'}</strong></div>
                <div className="meta">{order.internal_reference || 'Référence interne non détectée'}</div>
                <div className="progress"><div style={{ width: `${order.progress}%` }} /></div>
                <div className="progress-line"><span>{order.progress}% préparé</span><span>{order.item_count} lignes</span></div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
