'use client';

import {
  useEffect,
  useState
} from 'react';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import Topbar from '@/components/Topbar';

export default function OrderPage() {
  const params = useParams();
  const id = params.id;

  const [data, setData] =
    useState(null);

  const [error, setError] =
    useState('');

  const [partial, setPartial] =
    useState({});

  const [busyId, setBusyId] =
    useState(null);

  async function load() {
    try {
      const res =
        await fetch(
          `/api/orders/${id}`,
          {
            cache:
              'no-store'
          }
        );

      const json =
        await res.json();

      if (!res.ok) {
        throw new Error(
          json.error ||
            'Erreur'
        );
      }

      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (id) {
      load();
    }
  }, [id]);

  async function togglePause() {
    try {
      const res =
        await fetch(
          `/api/orders/${id}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type':
                'application/json'
            },
            body: JSON.stringify({
              action:
                'togglePause'
            })
          }
        );

      const json =
        await res.json();

      if (!res.ok) {
        throw new Error(
          json.error ||
            'Impossible de modifier le statut'
        );
      }

      setData(json);
    } catch (e) {
      setError(e.message);
    }
  }

  async function updateItem(
    itemId,
    action,
    value
  ) {
    setBusyId(itemId);
    setError('');

    try {
      const res =
        await fetch(
          `/api/orders/${id}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type':
                'application/json'
            },
            body: JSON.stringify({
              itemId,
              action,
              value
            })
          }
        );

      const json =
        await res.json();

      if (!res.ok) {
        throw new Error(
          json.error ||
            'Modification impossible'
        );
      }

      setData(json);

      setPartial(
        (p) => ({
          ...p,
          [itemId]: ''
        })
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function setProductionStatus(
    itemId,
    status
  ) {
    setBusyId(itemId);
    setError('');

    try {
      const res =
        await fetch(
          `/api/orders/${id}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type':
                'application/json'
            },
            body: JSON.stringify({
              itemId,
              action:
                'setProductionStatus',
              value: status
            })
          }
        );

      const json =
        await res.json();

      if (!res.ok) {
        throw new Error(
          json.error ||
            'Impossible de modifier le statut OF'
        );
      }

      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (!data) {
    return (
      <>
        <Topbar />

        <main className="container">
          {error ? (
            <div className="notice error">
              {error}
            </div>
          ) : (
            <div className="loading">
              Chargement…
            </div>
          )}
        </main>
      </>
    );
  }

  const {
    order,
    items
  } = data;

  /*
   * Les lignes OF ne sont pas disponibles
   * pour la préparation.
   */
  const activeItems =
    items.filter(
      (item) =>
        item.is_preparable &&
        item.production_status !==
          'OF'
    );

  const done =
    activeItems.filter(
      (item) =>
        item.completed
    ).length;

  const missing =
    activeItems.reduce(
      (sum, item) =>
        sum +
        Math.max(
          0,
          item.requested_qty -
            item.prepared_qty
        ),
      0
    );

  return (
    <>
      <Topbar />

      <main className="container">

        <Link
          href="/"
          className="back"
        >
          ← Retour aux commandes
        </Link>

        <div className="detail-head">

          <div>
            <h1>
              Commande #
              {order.order_number}
            </h1>

            <p className="sub">
              {order.client}
              {' · '}
              {order.internal_reference}
            </p>
          </div>

          <div className="detail-actions">

            {order.status !==
              'TERMINEE' && (
              <button
                className="btn btn-secondary"
                onClick={
                  togglePause
                }
              >
                {order.status ===
                'PAUSEE'
                  ? '▶ Reprendre'
                  : '⏸ Mettre en pause'}
              </button>
            )}

            <Link
              className="btn btn-primary"
              href="/"
            >
              Fermer
            </Link>

          </div>
        </div>

        {error && (
          <div className="notice error">
            {error}
          </div>
        )}

        <div className="card">

          <div className="progress">
            <div
              style={{
                width: `${order.progress}%`
              }}
            />
          </div>

          <div className="progress-line">
            <strong>
              {order.progress}%
            </strong>

            <span>
              {done} /{' '}
              {activeItems.length}{' '}
              lignes terminées
            </span>
          </div>

        </div>

        <div className="kpis">

          <div className="kpi">
            <span>
              Lignes disponibles
            </span>

            <strong>
              {activeItems.length}
            </strong>
          </div>

          <div className="kpi">
            <span>
              Terminées
            </span>

            <strong>
              {done}
            </strong>
          </div>

          <div className="kpi">
            <span>
              Manquant
            </span>

            <strong>
              {missing}
            </strong>
          </div>

          <div className="kpi">
            <span>
              Statut
            </span>

            <strong
              style={{
                fontSize: 16,
                marginTop: 8
              }}
            >
              {order.status ===
              'TERMINEE'
                ? 'TERMINÉE'
                : order.status ===
                    'PAUSEE'
                  ? 'EN PAUSE'
                  : order.status ===
                      'EN_COURS'
                    ? 'EN COURS'
                    : 'À PRÉPARER'}
            </strong>
          </div>

        </div>

        <div className="items">

          {items.map((item) => {

            const current =
              partial[item.id] ??
              '';

            const isOF =
              item.production_status ===
              'OF';

            const isOFF =
              item.production_status ===
              'OFF';

            return (
              <article
                className={`item ${
                  item.completed
                    ? 'done'
                    : ''
                } ${
                  !item.is_preparable
                    ? 'info'
                    : ''
                }`}
                key={item.id}
              >

                <div>

                  <div className="item-code">
                    {item.code}
                  </div>

                  <div className="item-desc">
                    {item.designation ||
                      'Désignation non détectée'}
                  </div>

                  <div className="item-meta">

                    <span className="tag">
                      <strong>
                        {
                          item.requested_qty
                        }
                      </strong>{' '}
                      demandé
                      {item.requested_qty >
                      1
                        ? 's'
                        : ''}
                    </span>

                    {item.location && (
                      <span className="tag tag-location">
                        📍{' '}
                        {item.location}
                      </span>
                    )}

                    {!item.is_preparable && (
                      <span className="tag">
                        Information /
                        hors préparation
                      </span>
                    )}

                    {isOF && (
                      <span
                        className="tag"
                        style={{
                          background:
                            '#fff3cd',
                          color:
                            '#856404',
                          fontWeight:
                            700
                        }}
                      >
                        🏭 OF EN COURS
                      </span>
                    )}

                    {isOFF && (
                      <span
                        className="tag"
                        style={{
                          background:
                            '#d4edda',
                          color:
                            '#155724',
                          fontWeight:
                            700
                        }}
                      >
                        ✓ FABRICATION TERMINÉE
                      </span>
                    )}

                    {item.completed && (
                      <span className="tag">
                        ✓ Préparé
                      </span>
                    )}

                  </div>

                </div>

                {isOF ? (

                  <div className="item-actions">

                    <button
                      className="btn btn-primary"
                      disabled={
                        busyId ===
                        item.id
                      }
                      onClick={() =>
                        setProductionStatus(
                          item.id,
                          'OFF'
                        )
                      }
                    >
                      ✓ OF terminé
                    </button>

                  </div>

                ) : item.is_preparable ? (

                  <div className="item-actions">

                    {item.completed ? (

                      <button
                        className="done-btn active"
                        disabled={
                          busyId ===
                          item.id
                        }
                        onClick={() =>
                          updateItem(
                            item.id,
                            'reset'
                          )
                        }
                      >
                        ✓ Préparé
                      </button>

                    ) : (

                      <>

                        <button
                          className="done-btn"
                          disabled={
                            busyId ===
                            item.id
                          }
                          onClick={() =>
                            updateItem(
                              item.id,
                              'complete'
                            )
                          }
                        >
                          ✓ Tout préparé
                        </button>

                        <div className="partial">

                          <input
                            inputMode="numeric"
                            type="number"
                            min="0"
                            max={
                              item.requested_qty
                            }
                            placeholder="partiel"
                            value={
                              current
                            }
                            onChange={(e) =>
                              setPartial(
                                (p) => ({
                                  ...p,
                                  [item.id]:
                                    e.target.value
                                })
                              )
                            }
                          />

                          <button
                            className="btn btn-secondary"
                            disabled={
                              busyId ===
                                item.id ||
                              current ===
                                ''
                            }
                            onClick={() =>
                              updateItem(
                                item.id,
                                'partial',
                                Number(
                                  current
                                )
                              )
                            }
                          >
                            OK
                          </button>

                        </div>

                      </>
                    )}

                  </div>

                ) : null}

              </article>
            );
          })}

        </div>

      </main>
    </>
  );
}
