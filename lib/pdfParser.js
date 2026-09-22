import pdfParse from 'pdf-parse';

// ============================================================
// Détection des lignes du bon de production
// ============================================================

const CODE_RE = /^[A-Z0-9][A-Z0-9._/+\-]{3,}$/i;

const INFO_CODES = new Set(['GTRANS']);
const INFO_PREFIXES = ['INFO'];

function normalize(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundY(value) {
  return Math.round(Number(value) * 100) / 100;
}

// ============================================================
// Lecture des éléments texte avec leurs coordonnées PDF
// ============================================================

async function renderPage(pageData) {
  const content = await pageData.getTextContent({
    normalizeWhitespace: false,
    disableCombineTextItems: false
  });

  return content.items
    .map((item) => ({
      text: normalize(item.str),
      x: Number(item.transform?.[4] || 0),
      y: roundY(item.transform?.[5] || 0)
    }))
    .filter((item) => item.text);
}

// ============================================================
// Détection d'un code article
// ============================================================

function isCodeCandidate(item) {
  if (!item.text) return false;

  // Les codes articles sont dans la première colonne.
  if (item.x >= 75) return false;

  // Évite les textes trop courts ou les éléments de l'en-tête.
  if (!CODE_RE.test(item.text)) return false;

  // Évite certains mots génériques susceptibles d'être détectés
  // comme des codes.
  const forbidden = new Set([
    'CODE',
    'DESIGNATION',
    'CLIENT',
    'COMMANDE',
    'LIVRAISON',
    'DEPOT',
    'DATE',
    'REMARQUES',
    'EMP',
    'PREP',
    'PREPARATION'
  ]);

  return !forbidden.has(item.text.toUpperCase());
}

// ============================================================
// Détection des quantités
// ============================================================

function isQtyToken(item) {
  // La colonne "Qté à livr." se trouve autour de X = 335.
  if (item.x < 325 || item.x >= 385) return false;

  return /^\d+$/.test(item.text);
}

function parseQuantityToken(tokens) {
  if (!tokens.length) return null;

  const value = tokens
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((item) => item.text)
    .join('');

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
}

// ============================================================
// Désignation
// ============================================================

function getDesignation(items, codeItem, nextCodeY) {
  const sameLine = items
    .filter(
      (item) =>
        item.x >= 75 &&
        item.x < 325 &&
        Math.abs(item.y - codeItem.y) <= 2
    )
    .sort((a, b) => a.x - b.x);

  let text = sameLine.map((item) => item.text).join(' ');

  // Certaines désignations peuvent être sur plusieurs lignes.
  const continuation = items
    .filter(
      (item) =>
        item.x >= 75 &&
        item.x < 325 &&
        item.y < codeItem.y &&
        item.y >= Math.max(codeItem.y - 12, nextCodeY + 1)
    )
    .sort((a, b) => {
      if (b.y !== a.y) return b.y - a.y;
      return a.x - b.x;
    });

  if (continuation.length) {
    const continuationText = continuation
      .map((item) => item.text)
      .join(' ');

    if (continuationText) {
      text = `${text} ${continuationText}`;
    }
  }

  return normalize(text);
}

// ============================================================
// Emplacement
// ============================================================

function getLocation(items, qtyY) {
  /*
   * Dans le PDF, l'emplacement peut être séparé en plusieurs
   * éléments texte :
   *
   * E80
   * 110
   *
   * On les rassemble.
   */

  const locationParts = items
    .filter(
      (item) =>
        item.x >= 500 &&
        item.x < 575 &&
        Math.abs(item.y - qtyY) <= 2
    )
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 0.5) {
        return b.y - a.y;
      }

      return a.x - b.x;
    })
    .map((item) => item.text);

  return normalize(locationParts.join(' '));
}

// ============================================================
// Détection des lignes
// ============================================================

function parseRows(pages) {
  const output = [];
  let sortOrder = 0;

  for (const pageItems of pages) {
    const items = pageItems;

    // --------------------------------------------------------
    // Codes articles
    // --------------------------------------------------------

    const codes = items
      .filter(isCodeCandidate)
      .sort((a, b) => b.y - a.y);

    // --------------------------------------------------------
    // Quantités
    // --------------------------------------------------------

    const quantities = items.filter(isQtyToken);

    // --------------------------------------------------------
    // Association code -> quantité
    // --------------------------------------------------------

    for (let index = 0; index < codes.length; index += 1) {
      const codeItem = codes[index];

      const nextCode = codes[index + 1];

      /*
       * Les coordonnées PDF vont du bas vers le haut.
       * Une ligne suivante possède donc généralement un Y inférieur.
       */

      const nextCodeY = nextCode
        ? nextCode.y
        : Number.NEGATIVE_INFINITY;

      // Recherche de la quantité proche verticalement.
      const candidates = quantities
        .filter((item) => {
          const difference = Math.abs(item.y - codeItem.y);

          return difference <= 8;
        })
        .sort(
          (a, b) =>
            Math.abs(a.y - codeItem.y) -
            Math.abs(b.y - codeItem.y)
        );

      if (!candidates.length) {
        continue;
      }

      /*
       * On prend la position Y de la quantité la plus proche.
       */
      const qtyY = candidates[0].y;

      /*
       * Plusieurs morceaux peuvent constituer une seule quantité.
       *
       * Exemple :
       *
       * 1
       * 500
       *
       * devient :
       *
       * 1500
       */
      const qtyTokens = quantities.filter(
        (item) => Math.abs(item.y - qtyY) <= 1
      );

      const requestedQty = parseQuantityToken(qtyTokens);

      if (requestedQty === null) {
        continue;
      }

      if (requestedQty <= 0) {
        continue;
      }

      // ------------------------------------------------------
      // Informations de la ligne
      // ------------------------------------------------------

      const code = codeItem.text.toUpperCase();

      const designation = getDesignation(
        items,
        codeItem,
        nextCodeY
      );

      const location = getLocation(items, qtyY);

      // ------------------------------------------------------
      // Lignes non préparables
      // ------------------------------------------------------

      const isInfo =
        INFO_CODES.has(code) ||
        INFO_PREFIXES.some((prefix) =>
          code.startsWith(prefix)
        ) ||
        /EN ATTENTE DE COTE/i.test(designation);

      // ------------------------------------------------------
      // Ajout
      // ------------------------------------------------------

      output.push({
        code,
        designation,
        requestedQty,
        preparedQty: 0,
        location,
        isPreparable: !isInfo,
        sortOrder
      });

      sortOrder += 1;
    }
  }

  return output;
}

// ============================================================
// Détection de l'en-tête du bon
// ============================================================

function parseHeader(text) {
  const compact = String(text || '').replace(/\r/g, '');

  /*
   * Exemple attendu :
   *
   * n° 164404
   * ou
   * N° 164404
   */

  const orderMatch = compact.match(
    /(?:n\s*(?:°|º|o)|num(?:éro)?\s*(?:de\s*)?commande?)\s*[:.]?\s*([0-9]{4,})/i
  );

  const refMatch = compact.match(
    /Réf\.\s*Interne\s*[:.]?\s*([^\n]+)/i
  );

  const pickupMatch = compact.match(
    /Enlèvement\s*[:.]?\s*([0-9]{2}\s*\/\s*[0-9]{2}\s*\/\s*[0-9]{2,4})/i
  );

  const clientMatch = compact.match(
    /Client\s*[:.]?\s*([^\n]+)/i
  );

  return {
    orderNumber:
      orderMatch?.[1] ||
      `IMPORT-${Date.now()}`,

    internalReference:
      normalize(refMatch?.[1] || ''),

    pickupDate:
      normalize(pickupMatch?.[1] || ''),

    client:
      normalize(clientMatch?.[1] || '')
  };
}

// ============================================================
// Fonction principale
// ============================================================

export async function parseProductionPdf(buffer) {
  // Première lecture : texte global pour l'en-tête.
  const result = await pdfParse(buffer, {
    pagerender: renderPage
  });

  const header = parseHeader(result.text);

  // Deuxième lecture : récupération des coordonnées
  // de chaque élément texte.
  const pages = [];

  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const items = await renderPage(pageData);

      pages.push(items);

      return items
        .map((item) => JSON.stringify(item))
        .join('\n');
    }
  });

  const items = parseRows(pages);

  return {
    ...header,
    items,
    rawTextLength: result.text.length
  };
}
