'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Topbar from '@/components/Topbar';

export default function AdminPage() {
  const router = useRouter();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!file) return setError('Choisis un fichier PDF.');
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return setError('Le fichier doit être un PDF.');

    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/orders', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import impossible');
      router.push(`/orders/${data.order.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <>
      <Topbar />
      <main className="container">
        <div className="header-row">
          <div>
            <h1>Importer un bon</h1>
            <p className="sub">Le PDF est analysé pour créer la commande et ses lignes de préparation.</p>
          </div>
        </div>

        <div className="card upload-box">
          {error && <div className="notice error">{error}</div>}
          <form onSubmit={submit}>
            <div className="drop">
              <h2>Déposer le bon de production</h2>
              <p className="sub">PDF uniquement</p>
              <input className="file-input" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              {file && <p><strong>{file.name}</strong></p>}
              <button className="btn btn-primary btn-big" disabled={busy}>{busy ? 'Analyse du PDF…' : 'Créer la commande'}</button>
            </div>
          </form>
          <p className="help">Le prototype ne conserve pas le PDF : il sert uniquement à extraire les informations nécessaires à la préparation.</p>
        </div>
      </main>
    </>
  );
}
