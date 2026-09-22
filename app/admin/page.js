'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Topbar from '@/components/Topbar';
import { parseProductionPages } from '@/lib/pdfParser';

export default function AdminPage() {
  const router = useRouter();

  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [validated, setValidated] = useState(false);

  async function analyzePdf() {
    setError('');
    setParsed(null);
    setValidated(false);

    if (!file) {
      setError('Choisis un fichier PDF.');
      return;
    }

    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      setError('Le fichier doit être un PDF.');
      return;
    }

    setBusy(true);

    try {
      // PDF.js est chargé UNIQUEMENT côté navigateur
      const pdfjsLib = await import('pdfjs-dist');

      pdfjsLib.GlobalWorkerOptions.workerSrc =
        '/pdf.worker.min.mjs';

      const buffer = await file.arrayBuffer();

      const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
      }).promise;

      const pages = [];

      for (
        let pageNumber = 1;
        pageNumber <= pdf.numPages;
        pageNumber++
      ) {
        const page = await pdf.getPage(pageNumber);

        const viewport = page.getViewport({
          scale: 1,
        });

        const content = await page.getTextContent();

        const items = content.items
          .filter(
            (item) =>
              typeof item.str === 'string' &&
              item.str.trim()
          )
          .map((item) => ({
            str: item.str,
            x: Number(
              item.transform?.[4] || 0
            ),
            y: Number(
              item.transform?.[5] || 0
            ),
            w: Number(
              item.width || 0
            ),
          }));

        pages.push({
          width: viewport.width,
          height: viewport.height,
          items,
        });
      }

      const result = parseProductionPages(pages);

      setParsed(result);
    } catch (e) {
      console.error(e);

      setError(
        e?.message ||
          'Impossible d’analyser le PDF.'
      );
    } finally {
      setBusy(false);
    }
  }

  function updateItem(index, field, value) {
    setParsed((current) => {
      if (!current) {
        return current;
      }

      const items = [...current.items];

      items[index] = {
        ...items[index],
        [field]:
          field === 'requestedQty'
            ? Number(value)
            : value,
      };

      return {
        ...current,
        items,
      };
    });
  }

  async function createOrder() {
    if (!parsed) {
      return;
    }

    if (!validated) {
      setError(
        'Valide d’abord les données détectées.'
      );
      return;
    }

    setBusy(true);
    setError('');

    try {
      const response = await fetch(
        '/api/orders',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify(parsed),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            'Création impossible.'
        );
      }

      router.push(
        `/orders/${data.order.id}`
      );
    } catch (e) {
      setError(
        e?.message ||
          'Création impossible.'
      );
      setBusy(false);
    }
  }

  return (
    <>
      <Topbar />

      <main className="container">
        <div className="header-row">
          <div>
            <h1>
              Importer un bon
            </h1>

            <p className="sub">
              Analyse du bon de production CEGID
            </p>
          </div>
        </div>

        <div className="card upload-box">
          {error && (
            <div className="notice error">
              {error}
            </div>
          )}

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
              onChange={(e) => {
                setFile(
                  e.target.files?.[0] ||
                    null
                );
                setParsed(null);
                setError('');
              }}
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
              disabled={
                busy || !file
              }
              onClick={analyzePdf}
            >
              {busy
                ? 'Analyse du PDF…'
                : 'Analyser le PDF'}
            </button>
          </div>
        </div>

        {parsed && (
          <div
            className="card"
            style={{
              marginTop: 20,
            }}
          >
            <h2>
              Vérification
            </h2>

            <div
              style={{
                display: 'grid',
                gap: 8,
                marginBottom: 20,
              }}
            >
              <div>
                <strong>
                  Commande :
                </strong>{' '}
                {parsed.orderNumber ||
                  'NON DÉTECTÉE'}
              </div>

              <div>
                <strong>
                  Client :
                </strong>{' '}
                {parsed.client ||
                  'NON DÉTECTÉ'}
              </div>

              <div>
                <strong>
                  Référence interne :
                </strong>{' '}
                {parsed.internalReference ||
                  'NON DÉTECTÉE'}
              </div>

              <div>
                <strong>
                  Enlèvement :
                </strong>{' '}
                {parsed.pickupDate ||
                  'NON DÉTECTÉ'}
              </div>

              <div>
                <strong>
                  Lignes détectées :
                </strong>{' '}
                {parsed.items.length}
              </div>
            </div>

            {parsed.warnings.length > 0 && (
              <div
                className="notice"
                style={{
                  marginBottom: 20,
                }}
              >
                <strong>
                  Vérifications :
                </strong>

                <ul>
                  {parsed.warnings.map(
                    (
                      warning,
                      index
                    ) => (
                      <li
                        key={index}
                      >
                        {warning}
                      </li>
                    )
                  )}
                </ul>
              </div>
            )}

            <div
              style={{
                overflowX: 'auto',
              }}
            >
              <table>
                <thead>
                  <tr>
                    <th>
                      Référence
                    </th>
                    <th>
                      Désignation
                    </th>
                    <th>
                      Qté
                    </th>
                    <th>
                      Page
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {parsed.items.map(
                    (
                      item,
                      index
                    ) => (
                      <tr
                        key={`${item.ref}-${index}`}
                      >
                        <td>
                          <input
                            value={
                              item.ref
                            }
                            onChange={(
                              e
                            ) =>
                              updateItem(
                                index,
                                'ref',
                                e.target
                                  .value
                              )
                            }
                          />
                        </td>

                        <td>
                          <input
                            value={
                              item.designation
                            }
                            onChange={(
                              e
                            ) =>
                              updateItem(
                                index,
                                'designation',
                                e.target
                                  .value
                              )
                            }
                          />
                        </td>

                        <td>
                          <input
                            type="number"
                            min="0"
                            value={
                              item.requestedQty
                            }
                            onChange={(
                              e
                            ) =>
                              updateItem(
                                index,
                                'requestedQty',
                                e.target
                                  .value
                              )
                            }
                          />
                        </td>

                        <td>
                          {item.page}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>

            <div
              style={{
                marginTop: 20,
              }}
            >
              <label
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems:
                    'center',
                }}
              >
                <input
                  type="checkbox"
                  checked={
                    validated
                  }
                  onChange={(e) =>
                    setValidated(
                      e.target.checked
                    )
                  }
                />

                J'ai vérifié les informations
                détectées avant de créer la
                commande.
              </label>
            </div>

            <button
              className="btn btn-primary btn-big"
              style={{
                marginTop: 20,
              }}
              disabled={
                busy ||
                !validated
              }
              onClick={
                createOrder
              }
            >
              {busy
                ? 'Création…'
                : 'Créer la commande'}
            </button>
          </div>
        )}
      </main>
    </>
  );
}
