import pdfParse from 'pdf-parse';

const CODE_RE = /^[A-Z0-9][A-Z0-9._/+\-]{3,}$/i;

const INFO_CODES = new Set(['GTRANS']);
const INFO_PREFIXES = ['INFO'];

function normalize(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return normalize(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function sameY(a, b, tolerance = 6) {
  return Math.abs(a - b) <= tolerance;
}

async function renderPage(pageData) {
  const content = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  });

  return content.items
    .map((item) => ({
      text: normalize(item.str),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0),
      width: Number(item.width || 0),
      height: Number(item.height || 0)
    }))
    .filter((item) => item.text);
}

/* ============================================================
   DÉTECTION DE L'EN-TÊTE DU TABLEAU
   ============================================================ */

function findTableHeader(items) {
  const codeItems = items.filter(
    (item) => normalizeKey(item.text) === 'code'
  );

  const empItems = items.filter(
    (item) => normalizeKey(item.text) === 'emp'
  );

  const depotItems = items.filter(
    (item) => normalizeKey(item.text) === 'depot'
  );

  const designationItems = items.filter(
    (item) => normalizeKey(item.text) === 'designation'
  );

  const qtyItems = items.filter(
    (item) => normalizeKey(item.text) === 'qte'
  );

  let best = null;

  for (const code of codeItems) {
    const nearby = (list) =>
      list.filter((item) => sameY(item.y, code.y, 12));

    const emp = nearby(empItems)[0];
    const depot = nearby(depotItems)[0];
    const designation = nearby(designationItems)[0];

    const qtes = nearby(qtyItems).sort(
      (a, b) => a.x - b.x
    );

    if (!emp || !depot || qtes.length < 1) {
      continue;
    }

    const score =
      5 +
      (designation ? 3 : 0) +
      (qtes.length >= 2 ? 2 : 0) +
      2 +
      2;

    if (!best || score > best.score) {
      best = {
        score,
        y: code.y,
        anchors: {
          code: code.x,
          designation:
            designation?.x ??
            code.x + 45,

          requestedQty:
            qtes[0].x,

          preparedQty:
            qtes[1]?.x ??
            qtes[0].x + 45,

          emp: emp.x,
          depot: depot.x
        }
      };
    }
  }

  if (!best) {
    return null;
  }

  const a = best.anchors;

  /*
   * Les limites sont calculées à partir des positions réellement
   * trouvées dans CE PDF.
   *
   * On ne dépend donc plus de X=335, X=530, etc.
   */

  const codeDesignationBoundary =
    (a.code + a.designation) / 2;

  const designationQtyBoundary =
    (a.designation + a.requestedQty) / 2;

  const qtyPreparedBoundary =
    (a.requestedQty + a.preparedQty) / 2;

  /*
   * Entre "Qté Prép" et "Emp", il existe les colonnes
   * Remarques + N° Colis.
   *
   * On utilise un retrait par rapport à Emp pour éviter
   * d'englober les colonnes précédentes.
   */

  const preparedRemarquesBoundary =
    (a.preparedQty + a.emp - 45) / 2;

  const empDepotBoundary =
    (a.emp + a.depot) / 2;

  return {
    ...best,

    bounds: {
      codeMin: 0,
      codeMax: codeDesignationBoundary,

      designationMin:
        codeDesignationBoundary,

      designationMax:
        designationQtyBoundary,

      requestedQtyMin:
        designationQtyBoundary,

      requestedQtyMax:
        qtyPreparedBoundary,

      empMin:
        preparedRemarquesBoundary,

      empMax:
        empDepotBoundary
    }
  };
}

/* ============================================================
   CODE ARTICLE
   ============================================================ */

function isCodeCandidate(item, header) {
  if (!header) {
    return false;
  }

  /*
   * Le tableau se trouve après l'en-tête.
   * Les coordonnées PDF.js augmentent vers le haut.
   */
  if (item.y >= header.y - 4) {
    return false;
  }

  if (
    item.x < header.bounds.codeMin ||
    item.x >= header.bounds.codeMax
  ) {
    return false;
  }

  if (!CODE_RE.test(item.text)) {
    return false;
  }

  const forbidden = new Set([
    'CODE',
    'CLIENT',
    'COMMANDE',
    'LIVRAISON',
    'DEPOT',
    'DATE',
    'REMARQUES',
    'EMP',
    'PREP',
    'PREPARATION',
    'DEVIS',
    'TYPE',
    'VERSION',
    'LOCALISATION',
    'EQUIPEMENTS',
    'CARACTERISTIQUES'
  ]);

  return !forbidden.has(
    normalizeKey(item.text).toUpperCase()
  );
}

/* ============================================================
   QUANTITÉ
   ============================================================ */

function parseIntegerFragments(items) {
  const ordered = [...items].sort(
    (a, b) => a.x - b.x
  );

  const joined = ordered
    .map((item) =>
      item.text.replace(/\s/g, '')
    )
    .join('');

  if (!/^\d+$/.test(joined)) {
    return null;
  }

  const value = Number(joined);

  return Number.isSafeInteger(value)
    ? value
    : null;
}

function findQuantity(items, codeItem, header) {
  const candidates = items.filter((item) =>
    item.x >= header.bounds.requestedQtyMin &&
    item.x < header.bounds.requestedQtyMax &&
    /^\d+$/.test(item.text) &&
    Math.abs(item.y - codeItem.y) <= 8
  );

  if (!candidates.length) {
    return null;
  }

  const nearest = candidates.reduce(
    (best, item) =>
      Math.abs(item.y - codeItem.y) <
      Math.abs(best.y - codeItem.y)
        ? item
        : best
  );

  const nearestY = nearest.y;

  const sameRow = candidates.filter(
    (item) =>
      Math.abs(item.y - nearestY) <= 1.2
  );

  const value =
    parseIntegerFragments(sameRow);

  if (
    value === null ||
    value < 0
  ) {
    return null;
  }

  return {
    value,
    y: nearestY
  };
}

/* ============================================================
   TEXTE D'UNE COLONNE
   ============================================================ */

function getColumnText(
  items,
  minX,
  maxX,
  y,
  tolerance = 2.2
) {
  return normalize(
    items
      .filter(
        (item) =>
          item.x >= minX &&
          item.x < maxX &&
          Math.abs(item.y - y) <= tolerance
      )
      .sort((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(' ')
  );
}

/* ============================================================
   DÉSIGNATION
   ============================================================ */

function getDesignation(
  items,
  codeItem,
  header,
  nextCodeY
) {
  let text = getColumnText(
    items,
    header.bounds.designationMin,
    header.bounds.designationMax,
    codeItem.y,
    2.5
  );

  /*
   * Une désignation peut exceptionnellement être coupée
   * sur une deuxième ligne.
   */

  const continuation = items
    .filter(
      (item) =>
        item.x >= header.bounds.designationMin &&
        item.x < header.bounds.designationMax &&
        item.y < codeItem.y - 2.5 &&
        (
          nextCodeY == null ||
          item.y > nextCodeY + 2.5
        )
    )
    .sort(
      (a, b) =>
        b.y - a.y ||
        a.x - b.x
    );

  if (continuation.length) {
    const firstY =
      continuation[0].y;

    const line = continuation
      .filter(
        (item) =>
          Math.abs(item.y - firstY) <= 2.5
      )
      .map((item) => item.text)
      .join(' ');

    if (line) {
      text = normalize(
        `${text} ${line}`
      );
    }
  }

  return text;
}

/* ============================================================
   PARSING D'UNE PAGE
   ============================================================ */

function parsePage(pageItems) {
  const header =
    findTableHeader(pageItems);

  if (!header) {
    return {
      items: [],
      warnings: [
        'En-tête du tableau de préparation non détecté sur cette page.'
      ]
    };
  }

  const codes = pageItems
    .filter((item) =>
      isCodeCandidate(item, header)
    )
    .sort(
      (a, b) => b.y - a.y
    );

  const rows = [];
  const warnings = [];

  for (
    let index = 0;
    index < codes.length;
    index += 1
  ) {
    const codeItem = codes[index];

    const nextCodeY =
      codes[index + 1]?.y ??
      null;

    const quantity =
      findQuantity(
        pageItems,
        codeItem,
        header
      );

    const code =
      codeItem.text.toUpperCase();

    if (!quantity) {
      warnings.push(
        `Quantité non détectée pour ${code}.`
      );
      continue;
    }

    const designation =
      getDesignation(
        pageItems,
        codeItem,
        header,
        nextCodeY
      );

    const location =
      getColumnText(
        pageItems,
        header.bounds.empMin,
        header.bounds.empMax,
        quantity.y,
        2.2
      );

    const isInfo =
      INFO_CODES.has(code) ||
      INFO_PREFIXES.some(
        (prefix) =>
          code.startsWith(prefix)
      ) ||
      /EN ATTENTE DE COTE/i.test(
        designation
      );

    if (!designation) {
      warnings.push(
        `Désignation non détectée pour ${code}.`
      );
    }

    if (!location && !isInfo) {
      warnings.push(
        `Emplacement non détecté pour ${code}.`
      );
    }

    if (quantity.value > 10000) {
      warnings.push(
        `Quantité inhabituelle (${quantity.value}) pour ${code}.`
      );
    }

    rows.push({
      code,
      designation,
      requestedQty: quantity.value,
      preparedQty: 0,
      location,
      isPreparable: !isInfo,
      sortOrder: rows.length
    });
  }

  return {
    items: rows,
    warnings
  };
}

/* ============================================================
   EN-TÊTE DU BON
   ============================================================ */

function parseHeader(pages) {
  const firstPage =
    pages[0] || [];

  const allItems =
    pages.flat();

  /* -----------------------------
     Numéro de commande
  ----------------------------- */

  const orderLabel =
    firstPage.find(
      (item) =>
        normalizeKey(item.text) === 'n°' ||
        normalizeKey(item.text) === 'n'
    );

  let orderNumber = '';

  if (orderLabel) {
    const candidates =
      firstPage
        .filter(
          (item) =>
            Math.abs(
              item.y - orderLabel.y
            ) <= 5 &&
            item.x > orderLabel.x &&
            /^\d{4,}$/.test(
              item.text
            )
        )
        .sort(
          (a, b) => a.x - b.x
        );

    orderNumber =
      candidates[0]?.text || '';
  }

  if (!orderNumber) {
    const fallback =
      allItems.find(
        (item) =>
          /^\d{5,}$/.test(
            item.text
          ) &&
          item.x > 250 &&
          item.x < 390
      );

    orderNumber =
      fallback?.text || '';
  }

  /* -----------------------------
     Référence interne
  ----------------------------- */

  const refLabel =
    firstPage.find(
      (item) =>
        normalizeKey(item.text) === 'ref.'
    );

  let internalReference = '';

  if (refLabel) {
    const refLine =
      firstPage
        .filter(
          (item) =>
            Math.abs(
              item.y - refLabel.y
            ) <= 4 &&
            item.x >
              refLabel.x + 30
        )
        .sort(
          (a, b) => a.x - b.x
        )
        .map(
          (item) => item.text
        )
        .join(' ');

    internalReference =
      normalize(
        refLine.replace(
          /^:\s*/,
          ''
        )
      );
  }

  /* -----------------------------
     Date d'enlèvement
  ----------------------------- */

  const pickupLabel =
    firstPage.find(
      (item) =>
        normalizeKey(item.text) ===
        'enlevement'
    );

  let pickupDate = '';

  if (pickupLabel) {
    const date =
      firstPage
        .filter(
          (item) =>
            Math.abs(
              item.y - pickupLabel.y
            ) <= 5 &&
            item.x >
              pickupLabel.x &&
            /\d{2}\/\d{2}\/\d{2,4}/.test(
              item.text
            )
        )
        .sort(
          (a, b) => a.x - b.x
        )[0];

    pickupDate =
      date?.text || '';
  }

  /* -----------------------------
     Client
  ----------------------------- */

  const clientLabel =
    firstPage.find(
      (item) =>
        normalizeKey(item.text) ===
        'client'
    );

  let client = '';

  if (clientLabel) {
    /*
     * Dans le PDF CEGID, le code client est
     * sur la même ligne que "Client",
     * tandis que le nom est sur la ligne
     * juste en dessous.
     */

    const nameCandidates =
      firstPage
        .filter(
          (item) =>
            item.x >= clientLabel.x &&
            item.x <
              clientLabel.x + 180 &&
            item.y < clientLabel.y &&
            clientLabel.y -
              item.y <= 25
        )
        .sort(
          (a, b) =>
            b.y - a.y ||
            a.x - b.x
        );

    if (nameCandidates.length) {
      const nameY =
        nameCandidates[0].y;

      client =
        normalize(
          nameCandidates
            .filter(
              (item) =>
                Math.abs(
                  item.y - nameY
                ) <= 3
            )
            .sort(
              (a, b) =>
                a.x - b.x
            )
            .map(
              (item) =>
                item.text
            )
            .join(' ')
        );
    }

    /*
     * Si le nom n'est pas trouvé,
     * on conserve au moins le code client.
     */

    if (!client) {
      const clientCode =
        firstPage
          .filter(
            (item) =>
              Math.abs(
                item.y -
                  clientLabel.y
              ) <= 5 &&
              item.x >
                clientLabel.x
          )
          .sort(
            (a, b) =>
              a.x - b.x
          )[0];

      client =
        clientCode?.text || '';
    }
  }

  return {
    orderNumber:
      orderNumber ||
      `IMPORT-${Date.now()}`,

    client,

    internalReference,

    pickupDate
  };
}

/* ============================================================
   DOUBLONS / CONTRÔLES
   ============================================================ */

function deduplicateRows(
  rows,
  warnings
) {
  const result = [];
  const seen = new Set();

  for (const row of rows) {
    const key = [
      row.page,
      row.code,
      row.requestedQty,
      row.location
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    result.push({
      ...row,
      sortOrder:
        result.length
    });
  }

  const codeCounts =
    new Map();

  for (const row of result) {
    codeCounts.set(
      row.code,
      (codeCounts.get(row.code) || 0) + 1
    );
  }

  for (const [code, count] of codeCounts) {
    if (count > 1) {
      warnings.push(
        `${code} apparaît ${count} fois : vérifie les lignes avant validation.`
      );
    }
  }

  return result;
}

/* ============================================================
   FONCTION PRINCIPALE
   ============================================================ */

export async function parseProductionPdf(
  buffer
) {
  const pages = [];

  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const items =
        await renderPage(
          pageData
        );

      pages.push(items);

      return items
        .map(
          (item) => item.text
        )
        .join(' ');
    }
  });

  const header =
    parseHeader(pages);

  const warnings = [];
  const allRows = [];

  for (
    let pageIndex = 0;
    pageIndex < pages.length;
    pageIndex += 1
  ) {
    const parsed =
      parsePage(
        pages[pageIndex]
      );

    allRows.push(
      ...parsed.items.map(
        (item) => ({
          ...item,
          page:
            pageIndex + 1
        })
      )
    );

    warnings.push(
      ...parsed.warnings.map(
        (warning) =>
          `Page ${
            pageIndex + 1
          } : ${warning}`
      )
    );
  }

  const items =
    deduplicateRows(
      allRows,
      warnings
    );

  const preparableCount =
    items.filter(
      (item) =>
        item.isPreparable
    ).length;

  const excludedCount =
    items.length -
    preparableCount;

  if (
    !header.orderNumber ||
    header.orderNumber.startsWith(
      'IMPORT-'
    )
  ) {
    warnings.unshift(
      'Numéro de commande non détecté : contrôle obligatoire.'
    );
  }

  if (!header.client) {
    warnings.push(
      'Client non détecté.'
    );
  }

  if (!header.internalReference) {
    warnings.push(
      'Référence interne non détectée.'
    );
  }

  if (!items.length) {
    warnings.unshift(
      'Aucune ligne de tableau détectée.'
    );
  }

  if (preparableCount < 3) {
    warnings.push(
      `Seulement ${preparableCount} ligne(s) préparables détectée(s). Vérifie le PDF.`
    );
  }

  return {
    ...header,

    items,

    warnings: [
      ...new Set(warnings)
    ],

    stats: {
      pages: pages.length,
      totalRows: items.length,
      preparableRows:
        preparableCount,
      excludedRows:
        excludedCount
    }
  };
}
