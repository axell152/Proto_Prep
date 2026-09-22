'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Topbar from '@/components/Topbar';

export default function AdminPage() {
  const router = useRouter();

  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);

  // ============================================================
  // ANALYSER LE PDF
  // ============================================================

  async function analyze(e) {
    e.preventDefault();

    setError('');
    setPreview(null);
    setConfirmed(false);

    if (!file) {
      return setError('Choisis un fichier PDF.');
    }

    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      return setError('Le fichier doit être un PDF.');
    }

    setBusy(true);

    try {
      const form = new FormData();
      form.append('file', file);

      const res = await fetch('/api/orders/preview', {
        method: 'POST',
        body: form,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Analyse impossible');
      }

      setPreview(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // ============================================================
  // MODIFIER UNE INFO DE COMMANDE
  // ============================================================

  function updateHeader(field, value) {
    setPreview((current) => ({
      ...current,
      parsed: {
        ...current.parsed,
        [field]: value,
      },
    }));

    setConfirmed(false);
  }

  // ============================================================
  // MODIFIER UNE LIGNE
  // ============================================================

  function updateItem(index, field, value) {
    setPreview((current) => ({
      ...current,
      parsed: {
        ...current.parsed,
        items: current.parsed.items.map((item, i) =>
          i === index
            ? {
                ...item,
                [field]: value,
              }
            : item
        ),
      },
    }));

    setConfirmed(false);
  }

  // ============================================================
  // SUPPRIMER UNE LIGNE
  // ============================================================

  function removeItem(index) {
    setPreview((current) => ({
      ...current,
      parsed: {
        ...current.parsed,
        items: current.parsed.items
          .filter((_, i) => i !== index)
          .map((item, i) => ({
            ...item,
            sortOrder: i,
          })),
      },
    }));

    setConfirmed(false);
  }

  // ============================================================
  // AJOUTER UNE LIGNE
  // ============================================================

  function addItem() {
    setPreview((current) => ({
      ...current,
      parsed: {
        ...current.parsed,
        items: [
          ...current.parsed.items,
          {
            code: '',
            designation: '',
            requestedQty: 1,
            preparedQty: 0,
            location: '',
            isPreparable: true,
            sortOrder: current.parsed.items.length,
            page: null,
          },
        ],
      },
    }));

    setConfirmed(false);
  }

  // ============================================================
  // CRÉER LA COMMANDE APRÈS CONTRÔLE
  // ============================================================

  async function createOrder() {
    if (!preview?.parsed || !confirmed) {
      return;
    }

    setError('');
    setBusy(true);

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceFilename: preview.filename,
          parsed: preview.parsed,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error || 'Création impossible'
        );
      }

      router.push(`/orders/${data.order.id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const parsed = preview?.parsed;
  const warnings = parsed?.warnings || [];

  const preparableItems =
    parsed?.items?.filter(
      (item) => item.isPreparable !== false
    ) || [];

  return (
    <>
      <Topbar />

      <main className="container">

        {/* ======================================================
            TITRE
        ====================================================== */}

        <div className="header-row">
          <div>
            <h1>Importer un bon</h1>

            <p className="sub">
              Le PDF est analysé avant la création de la
              commande. Vérifie les lignes détectées avant
              validation.
            </p>
          </div>
        </div>

        {/* ======================================================
            ERREUR
        ====================================================== */}

        {error && (
          <div className="notice error">
            {error}
          </div>
        )}

        {/* ======================================================
            ÉTAPE 1 : IMPORT DU PDF
        ====================================================== */}

        {!preview && (
          <div className="card upload-box">

            <form onSubmit={analyze}>

              <div className="drop">

                <h2>
                  Déposer le bon de production
                </h2>

                <p className="sub">
                  PDF uniquement
                </p>

                <input
                  className="file-input"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) =>
                    setFile(
                      e.target.files?.[0] || null
                    )
                  }
                />

                {file && (
                  <p>
                    <strong>
                      {file.name}
                    </strong>
                  </p>
                )}

                <button
                  className="btn btn-primary btn-big"
                  disabled={busy}
                >
                  {busy
                    ? 'Analyse du PDF…'
                    : 'Analyser le bon'}
                </button>

              </div>

            </form>

            <p className="help">
              Le PDF sert uniquement à extraire les
              informations nécessaires à la préparation.
            </p>

          </div>
        )}

        {/* ======================================================
            ÉTAPE 2 : CONTRÔLE
        ====================================================== */}

        {preview && parsed && (
          <>

            {/* ==================================================
                RÉSUMÉ
            ================================================== */}

            <div
              className="card"
              style={{
                marginBottom: 14,
              }}
            >

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 20,
                  flexWrap: 'wrap',
                }}
              >

                <div>
                  <h2>
                    Contrôle du bon
                  </h2>

                  <p className="sub">
                    {preview.filename}
                  </p>
                </div>

                <div
                  style={{
                    textAlign: 'right',
                  }}
                >
                  <strong
                    style={{
                      fontSize: 24,
                    }}
                  >
                    {preparableItems.length}
                  </strong>

                  <div className="sub">
                    lignes préparables
                  </div>
                </div>

              </div>

              {/* AVERTISSEMENTS */}

              {warnings.length > 0 ? (
                <div
                  className="notice"
                  style={{
                    marginTop: 16,
                    marginBottom: 0,
                    background: '#fff7e8',
                    color: '#7a4a00',
                  }}
                >

                  <strong>
                    ⚠️ Vérifications nécessaires
                  </strong>

                  <ul
                    style={{
                      margin: '8px 0 0 20px',
                    }}
                  >

                    {warnings.map(
                      (warning, index) => (
                        <li
                          key={`${warning}-${index}`}
                        >
                          {warning}
                        </li>
                      )
                    )}

                  </ul>

                </div>
              ) : (
                <div
                  className="notice"
                  style={{
                    marginTop: 16,
                    marginBottom: 0,
                    background: '#eaf8ef',
                    color: '#146b3d',
                  }}
                >
                  ✓ Aucun avertissement détecté
                  automatiquement.
                </div>
              )}

            </div>

            {/* ==================================================
                INFORMATIONS COMMANDE
            ================================================== */}

            <div
              className="card"
              style={{
                marginBottom: 14,
              }}
            >

              <h2>
                Informations de la commande
              </h2>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit,minmax(210px,1fr))',
                  gap: 12,
                  marginTop: 14,
                }}
              >

                <label>
                  <span className="sub">
                    N° commande
                  </span>

                  <input
                    value={parsed.orderNumber || ''}
                    onChange={(e) =>
                      updateHeader(
                        'orderNumber',
                        e.target.value
                      )
                    }
                    style={inputStyle}
                  />
                </label>

                <label>
                  <span className="sub">
                    Client
                  </span>

                  <input
                    value={parsed.client || ''}
                    onChange={(e) =>
                      updateHeader(
                        'client',
                        e.target.value
                      )
                    }
                    style={inputStyle}
                  />
                </label>

                <label>
                  <span className="sub">
                    Référence interne
                  </span>

                  <input
                    value={
                      parsed.internalReference || ''
                    }
                    onChange={(e) =>
                      updateHeader(
                        'internalReference',
                        e.target.value
                      )
                    }
                    style={inputStyle}
                  />
                </label>

                <label>
                  <span className="sub">
                    Enlèvement
                  </span>

                  <input
                    value={parsed.pickupDate || ''}
                    onChange={(e) =>
                      updateHeader(
                        'pickupDate',
                        e.target.value
                      )
                    }
                    style={inputStyle}
                  />
                </label>

              </div>

            </div>

            {/* ==================================================
                LIGNES DÉTECTÉES
            ================================================== */}

            <div className="card">

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >

                <div>
                  <h2>
                    Lignes détectées
                  </h2>

                  <p className="sub">
                    Corrige ou supprime une ligne si nécessaire.
                  </p>
                </div>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={addItem}
                >
                  + Ajouter une ligne
                </button>

              </div>

              <div
                style={{
                  overflowX: 'auto',
                  marginTop: 14,
                }}
              >

                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    minWidth: 850,
                  }}
                >

                  <thead>
                    <tr
                      style={{
                        textAlign: 'left',
                        borderBottom:
                          '2px solid #e2e6ec',
                      }}
                    >

                      <th style={thStyle}>
                        Page
                      </th>

                      <th style={thStyle}>
                        Code
                      </th>

                      <th style={thStyle}>
                        Désignation
                      </th>

                      <th style={thStyle}>
                        Qté
                      </th>

                      <th style={thStyle}>
                        Emplacement
                      </th>

                      <th style={thStyle}>
                        Type
                      </th>

                      <th style={thStyle}></th>

                    </tr>
                  </thead>

                  <tbody>

                    {parsed.items.map(
                      (item, index) => (

                        <tr
                          key={`${item.code}-${index}`}
                          style={{
                            borderBottom:
                              '1px solid #edf0f4',
                          }}
                        >

                          <td style={tdStyle}>
                            {item.page || '-'}
                          </td>

                          <td style={tdStyle}>

                            <input
                              value={item.code || ''}
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  'code',
                                  e.target.value.toUpperCase()
                                )
                              }
                              style={{
                                ...inputStyle,
                                width: 130,
                                fontWeight: 700,
                              }}
                            />

                          </td>

                          <td style={tdStyle}>

                            <input
                              value={
                                item.designation || ''
                              }
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  'designation',
                                  e.target.value
                                )
                              }
                              style={{
                                ...inputStyle,
                                minWidth: 280,
                              }}
                            />

                          </td>

                          <td style={tdStyle}>

                            <input
                              type="number"
                              min="0"
                              value={
                                item.requestedQty ?? 0
                              }
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  'requestedQty',
                                  Number(
                                    e.target.value
                                  )
                                )
                              }
                              style={{
                                ...inputStyle,
                                width: 80,
                              }}
                            />

                          </td>

                          <td style={tdStyle}>

                            <input
                              value={
                                item.location || ''
                              }
                              onChange={(e) =>
                                updateItem(
                                  index,
                                  'location',
                                  e.target.value
                                )
                              }
                              style={{
                                ...inputStyle,
                                width: 120,
                              }}
                            />

                          </td>

                          <td style={tdStyle}>

                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={() =>
                                updateItem(
                                  index,
                                  'isPreparable',
                                  item.isPreparable === false
                                )
                              }
                            >
                              {item.isPreparable === false
                                ? 'Hors préparation'
                                : 'Préparable'}
                            </button>

                          </td>

                          <td style={tdStyle}>

                            <button
                              type="button"
                              className="btn btn-danger"
                              onClick={() =>
                                removeItem(index)
                              }
                            >
                              Supprimer
                            </button>

                          </td>

                        </tr>

                      )
                    )}

                  </tbody>

                </table>

              </div>

            </div>

            {/* ==================================================
                VALIDATION
            ================================================== */}

            <div
              className="card"
              style={{
                marginTop: 14,
              }}
            >

              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                }}
              >

                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) =>
                    setConfirmed(
                      e.target.checked
                    )
                  }
                  style={{
                    width: 18,
                    height: 18,
                    marginTop: 3,
                  }}
                />

                <span>

                  <strong>
                    J'ai vérifié les lignes
                    de préparation.
                  </strong>

                  <br />

                  <span className="sub">
                    La commande sera créée avec
                    les informations affichées
                    ci-dessus.
                  </span>

                </span>

              </label>

              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginTop: 18,
                }}
              >

                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    setPreview(null);
                    setConfirmed(false);
                  }}
                >
                  ← Refaire l'analyse
                </button>

                <button
                  type="button"
                  className="btn btn-primary btn-big"
                  disabled={
                    busy ||
                    !confirmed ||
                    !parsed.orderNumber ||
                    !parsed.items.length
                  }
                  onClick={createOrder}
                >
                  {busy
                    ? 'Création…'
                    : '✓ Créer la commande'}
                </button>

              </div>

            </div>

          </>
        )}

      </main>
    </>
  );
}

const inputStyle = {
  display: 'block',
  width: '100%',
  marginTop: 5,
  padding: '9px 10px',
  border: '1px solid #d7dce4',
  borderRadius: 8,
  background: '#fff',
  color: '#17202a',
};

const thStyle = {
  padding: '9px 8px',
  fontSize: 12,
  color: '#697386',
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: 8,
};
