import {
  ensureSchema,
  sql,
  recalcOrder
} from '@/lib/db';

import {
  parseProductionPdf
} from '@/lib/pdfParser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ============================================================
   LISTE DES COMMANDES
   ============================================================ */

export async function GET() {
  try {
    await ensureSchema();

    const query = sql();

    const orders = await query`
      SELECT
        o.*,
        COUNT(i.id)::int AS item_count
      FROM orders o
      LEFT JOIN order_items i
        ON i.order_id = o.id
        AND i.is_preparable = TRUE
        AND i.production_status <> 'OF'
      GROUP BY o.id
      ORDER BY
        CASE o.status
          WHEN 'EN_COURS' THEN 1
          WHEN 'A_PREPARER' THEN 2
          ELSE 3
        END,
        o.created_at DESC
    `;

    return Response.json({
      orders
    });

  } catch (error) {
    return Response.json(
      {
        error: error.message
      },
      { status: 500 }
    );
  }
}


/* ============================================================
   NETTOYAGE DES DONNÉES VALIDÉES
   ============================================================ */

function cleanParsedData(parsed) {
  if (
    !parsed ||
    !Array.isArray(parsed.items)
  ) {
    throw new Error(
      'Données de contrôle invalides.'
    );
  }

  const items = parsed.items
    .filter(
      (item) =>
        item &&
        String(
          item.code || ''
        ).trim()
    )
    .map(
      (item, index) => {
        const requestedQty =
          Number(
            item.requestedQty
          );

        if (
          !Number.isInteger(
            requestedQty
          ) ||
          requestedQty < 0
        ) {
          throw new Error(
            `Quantité invalide pour ${
              item.code ||
              `la ligne ${index + 1}`
            }.`
          );
        }

        /*
         * Par défaut :
         *
         * rien = STOCK
         *
         * Le bureau peut choisir OF.
         *
         * OFF n'est pas proposé à l'import :
         * il intervient lorsque la fabrication est terminée.
         */

        const productionStatus =
          item.isPreparable === false
            ? 'STOCK'
            : String(
                item.productionStatus || 'STOCK'
              )
                .trim()
                .toUpperCase() === 'OF'
              ? 'OF'
              : 'STOCK';

        return {
  code: String(
    item.code
  )
    .trim()
    .toUpperCase(),

  designation:
    String(
      item.designation ||
        ''
    ).trim(),

  requestedQty,

  preparedQty: 0,

  location:
    String(
      item.location ||
        ''
    ).trim(),

  isPreparable:
    item.isPreparable !==
    false,

  productionStatus:
    item.productionStatus === 'OF'
      ? 'OF'
      : 'STOCK',

  sortOrder: index
};
      }
    );

  if (!items.length) {
    throw new Error(
      'Aucune ligne à enregistrer.'
    );
  }

  return {
    orderNumber:
      String(
        parsed.orderNumber || ''
      ).trim(),

    client:
      String(
        parsed.client || ''
      ).trim(),

    internalReference:
      String(
        parsed.internalReference || ''
      ).trim(),

    pickupDate:
      String(
        parsed.pickupDate || ''
      ).trim(),

    items
  };
}


/* ============================================================
   CRÉATION DE LA COMMANDE
   ============================================================ */

export async function POST(request) {
  try {
    await ensureSchema();

    const contentType =
      request.headers.get(
        'content-type'
      ) || '';

    let parsed;
    let sourceFilename =
      'import.pdf';

    /*
     * Mode actuel :
     * le bureau vérifie d'abord le PDF,
     * puis envoie les données corrigées.
     */

    if (
      contentType.includes(
        'application/json'
      )
    ) {
      const body =
        await request.json();

      /*
       * Accepte les deux formats :
       *
       * { parsed: {...} }
       *
       * ou directement :
       *
       * { orderNumber, items, ... }
       *
       * Cela évite une incompatibilité
       * entre la page admin et l'API.
       */

      parsed =
        cleanParsedData(
          body.parsed || body
        );

      sourceFilename =
        String(
          body.sourceFilename ||
            sourceFilename
        );

    } else {
      /*
       * Ancien fonctionnement conservé.
       */

      const form =
        await request.formData();

      const file =
        form.get('file');

      if (
        !file ||
        typeof file.arrayBuffer !==
          'function'
      ) {
        return Response.json(
          {
            error:
              'Aucun PDF reçu.'
          },
          { status: 400 }
        );
      }

      sourceFilename =
        file.name ||
        sourceFilename;

      const buffer =
        Buffer.from(
          await file.arrayBuffer()
        );

      parsed =
        cleanParsedData(
          await parseProductionPdf(
            buffer
          )
        );
    }

    if (
      !parsed.orderNumber ||
      parsed.orderNumber.startsWith(
        'IMPORT-'
      )
    ) {
      return Response.json(
        {
          error:
            'Le numéro de commande doit être vérifié avant création.'
        },
        { status: 422 }
      );
    }

    const query = sql();

    const existing =
      await query`
        SELECT id
        FROM orders
        WHERE order_number =
          ${parsed.orderNumber}
      `;

    if (existing.length) {
      return Response.json(
        {
          error:
            `La commande ${parsed.orderNumber} existe déjà.`,

          order: {
            id:
              existing[0].id
          }
        },
        { status: 409 }
      );
    }

    const inserted =
      await query`
        INSERT INTO orders (
          order_number,
          client,
          internal_reference,
          pickup_date,
          source_filename
        )
        VALUES (
          ${parsed.orderNumber},
          ${parsed.client},
          ${parsed.internalReference},
          ${parsed.pickupDate},
          ${sourceFilename}
        )
        RETURNING *
      `;

    const order =
      inserted[0];

    for (
      const item of parsed.items
    ) {
      await query`
        INSERT INTO order_items (
          order_id,
          code,
          designation,
          requested_qty,
          prepared_qty,
          location,
          is_preparable,
          production_status,
          sort_order
        )
        VALUES (
          ${order.id},
          ${item.code},
          ${item.designation},
          ${item.requestedQty},
          ${item.preparedQty},
          ${item.location},
          ${item.isPreparable},
          ${item.productionStatus},
          ${item.sortOrder}
        )
      `;
    }

    await recalcOrder(
      order.id
    );

    return Response.json({
      order: {
        id: order.id,
        order_number:
          order.order_number
      },

      detectedItems:
        parsed.items.length
    });

  } catch (error) {
    console.error(error);

    return Response.json(
      {
        error:
          error.message ||
          'Import impossible.'
      },
      { status: 500 }
    );
  }
}
