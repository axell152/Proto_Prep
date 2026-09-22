// lib/pdfParser.js
//
// Parser des BONS DE PRODUCTION CEGID.
//
// IMPORTANT :
// Ce fichier ne charge PAS pdfjs-dist.
// PDF.js est chargé dans le navigateur.
// Le parser reçoit directement les pages contenant :
//   - str
//   - x
//   - y
//   - w
//
// Cette architecture reprend le principe de Navette :
// pdfjs -> extraction des positions -> analyse dynamique du tableau.


// -----------------------------------------------------------------------------
// Nettoyage
// -----------------------------------------------------------------------------

function clean(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function noSpace(value) {
  return clean(value).replace(/[\s\u00a0]/g, "");
}


// -----------------------------------------------------------------------------
// Références CEGID
// -----------------------------------------------------------------------------

const CODE_RE =
  /^[A-Z][A-Z0-9+./-]{3,}$/;


// Informations / prestations qui ne doivent pas devenir
// des lignes de préparation.
const NON_PREPARABLE_RE =
  /^(INFO|GTRANS|NAV)\b/i;


// -----------------------------------------------------------------------------
// Regroupement des éléments par ligne Y
// -----------------------------------------------------------------------------

function groupByY(items, tolerance = 3) {
  const groups = [];

  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) <= tolerance) {
      return a.x - b.x;
    }

    return b.y - a.y;
  });

  for (const item of sorted) {
    let group = groups.find(
      (group) =>
        Math.abs(group.y - item.y) <= tolerance
    );

    if (!group) {
      group = {
        y: item.y,
        items: [],
        text: "",
      };

      groups.push(group);
    }

    group.items.push(item);

    group.y =
      group.items.reduce(
        (sum, current) => sum + current.y,
        0
      ) / group.items.length;
  }

  for (const group of groups) {
    group.items.sort(
      (a, b) => a.x - b.x
    );

    group.text = group.items
      .map((item) => clean(item.str))
      .filter(Boolean)
      .join(" ");
  }

  return groups.sort(
    (a, b) => b.y - a.y
  );
}


// -----------------------------------------------------------------------------
// Informations générales
// -----------------------------------------------------------------------------

function extractOrderNumber(allItems) {
  const texts = allItems.map((item) =>
    clean(item.str)
  );

  for (const text of texts) {
    const match = text.match(
      /\bn[°ºo]?\s*[:.]?\s*(\d{4,10})\b/i
    );

    if (match) {
      return match[1];
    }
  }

  const joined = texts.join(" ");

  const match = joined.match(
    /\bn[°ºo]?\s*[:.]?\s*(\d{4,10})\b/i
  );

  return match
    ? match[1]
    : "";
}


function extractClient(allItems) {
  const items = [...allItems].sort(
    (a, b) => {
      if (
        Math.abs(a.y - b.y) > 2
      ) {
        return b.y - a.y;
      }

      return a.x - b.x;
    }
  );

  const index = items.findIndex(
    (item) =>
      /^Client\s*:/i.test(
        clean(item.str)
      )
  );

  if (index < 0) {
    return "";
  }

  const clientItem = items[index];

  const sameLine = items
    .filter(
      (item) =>
        Math.abs(
          item.y - clientItem.y
        ) <= 3
    )
    .sort(
      (a, b) => a.x - b.x
    );

  const parts = sameLine
    .map((item) =>
      clean(item.str)
    )
    .filter(Boolean);

  const clientIndex = parts.findIndex(
    (value) =>
      /^Client\s*:/i.test(value)
  );

  if (clientIndex >= 0) {
    const after = parts
      .slice(clientIndex)
      .join(" ")
      .replace(
        /^Client\s*:\s*/i,
        ""
      )
      .trim();

    if (
      after &&
      !/^C\d+$/i.test(after)
    ) {
      return after;
    }
  }

  // Dans le PDF CEGID :
  //
  // Client : C12962
  // J BONET ETABLISSEMENTS
  //
  // Le nom peut donc se trouver sur la ligne suivante.

  const nextCandidates = items
    .filter(
      (item) =>
        item.y < clientItem.y &&
        item.y >
          clientItem.y - 25 &&
        item.x < 500
    )
    .sort(
      (a, b) => {
        const dyA =
          Math.abs(
            a.y - clientItem.y
          );

        const dyB =
          Math.abs(
            b.y - clientItem.y
          );

        if (dyA !== dyB) {
          return dyA - dyB;
        }

        return a.x - b.x;
      }
    );

  for (const item of nextCandidates) {
    const value = clean(item.str);

    if (
      !value ||
      /^n[°ºo]/i.test(value) ||
      /^DEPOT\b/i.test(value) ||
      /^Date\b/i.test(value)
    ) {
      continue;
    }

    if (
      /^C\d+$/i.test(value)
    ) {
      continue;
    }

    return value;
  }

  return "";
}


function extractInternalReference(allItems) {
  const joined = allItems
    .map((item) =>
      clean(item.str)
    )
    .join(" ");

  const match = joined.match(
    /Réf\.?\s*Interne\s*:\s*(.+?)(?=\s+Enlèvement\s*:|\s+n[°ºo]\s*|$)/i
  );

  if (match) {
    return clean(match[1]);
  }

  const index = allItems.findIndex(
    (item) =>
      /Réf\.?\s*Interne/i.test(
        clean(item.str)
      )
  );

  if (index < 0) {
    return "";
  }

  const item = allItems[index];

  const sameLine = allItems
    .filter(
      (current) =>
        Math.abs(
          current.y - item.y
        ) <= 3
    )
    .sort(
      (a, b) => a.x - b.x
    )
    .map((current) =>
      clean(current.str)
    )
    .filter(Boolean)
    .join(" ");

  return sameLine
    .replace(
      /Réf\.?\s*Interne\s*:?\s*/i,
      ""
    )
    .trim();
}


function extractPickupDate(allItems) {
  const joined = allItems
    .map((item) =>
      clean(item.str)
    )
    .join(" ");

  const match = joined.match(
    /Enlèvement\s*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i
  );

  return match
    ? match[1]
    : "";
}


// -----------------------------------------------------------------------------
// Détection dynamique de l'en-tête
// -----------------------------------------------------------------------------

function findProductionHeader(
  items,
  pageWidth
) {
  const codeHeaders =
    items.filter(
      (item) =>
        /^Code$/i.test(
          clean(item.str)
        ) &&
        item.x <
          pageWidth * 0.25
    );

  for (const codeHeader of codeHeaders) {
    const sameLine =
      items
        .filter(
          (item) =>
            Math.abs(
              item.y -
                codeHeader.y
            ) <= 4
        )
        .sort(
          (a, b) =>
            a.x - b.x
        );

    const qte =
      sameLine.find(
        (item) =>
          /Qt[ée]\s*à\s*livr/i.test(
            clean(item.str)
          )
      );

    if (qte) {
      return {
        y: codeHeader.y,
        codeX: codeHeader.x,
        codeW: codeHeader.w,
        qteX: qte.x,
        qteW: qte.w,
      };
    }
  }

  return null;
}


// -----------------------------------------------------------------------------
// Limite inférieure du tableau
// -----------------------------------------------------------------------------

function findTableBottom(
  items,
  headerY
) {
  const possible =
    items.filter((item) => {
      const text =
        clean(item.str);

      return (
        /TOTAL/i.test(text) ||
        /OBSERVATION/i.test(text)
      );
    });

  const below =
    possible.filter(
      (item) =>
        item.y < headerY
    );

  if (!below.length) {
    return 0;
  }

  return Math.max(
    ...below.map(
      (item) => item.y
    )
  );
}


// -----------------------------------------------------------------------------
// Vérification référence
// -----------------------------------------------------------------------------

function isValidProductCode(
  item,
  header,
  pageWidth
) {
  const value =
    clean(item.str).toUpperCase();

  if (!value) {
    return false;
  }

  if (!CODE_RE.test(value)) {
    return false;
  }

  if (
    NON_PREPARABLE_RE.test(value)
  ) {
    return false;
  }

  // Zone dynamique de la colonne Code.
  const codeMax =
    Math.max(
      header.codeX +
        pageWidth * 0.08,

      header.qteX * 0.45
    );

  if (item.x > codeMax) {
    return false;
  }

  if (/^\d+$/.test(value)) {
    return false;
  }

  return true;
}


// -----------------------------------------------------------------------------
// Quantité
// -----------------------------------------------------------------------------

function getQuantityForCode(
  codeItem,
  quantityItems
) {
  const candidates =
    quantityItems
      .filter(
        (item) =>
          Math.abs(
            item.y -
              codeItem.y
          ) <= 6
      )
      .sort(
        (a, b) =>
          a.x - b.x
      );

  if (!candidates.length) {
    return null;
  }

  const value =
    candidates
      .map((item) =>
        noSpace(item.str)
      )
      .join("");

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const quantity =
    Number(value);

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return null;
  }

  return quantity;
}


// -----------------------------------------------------------------------------
// Parsing d'une page
// -----------------------------------------------------------------------------

function parseProductionPage(
  page,
  pageNumber
) {
  const items =
    page.items.filter(
      (item) =>
        clean(item.str) !== ""
    );

  const header =
    findProductionHeader(
      items,
      page.width
    );

  if (!header) {
    return {
      items: [],
      warnings: [],
    };
  }

  const tableBottom =
    findTableBottom(
      items,
      header.y
    );

  const inTable =
    (item) =>
      item.y <
        header.y - 4 &&
      item.y >
        tableBottom;

  // ---------------------------------------------------------------------------
  // Références
  // ---------------------------------------------------------------------------

  const codes =
    items
      .filter(
        (item) =>
          inTable(item) &&
          isValidProductCode(
            item,
            header,
            page.width
          )
      )
      .sort(
        (a, b) =>
          b.y - a.y
      );

  // ---------------------------------------------------------------------------
  // Zone quantité
  // ---------------------------------------------------------------------------

  const qteMin =
    header.qteX - 8;

  const qteMax =
    header.qteX +
    Math.max(
      header.qteW,
      30
    ) +
    25;

  const quantityItems =
    items.filter(
      (item) => {
        if (!inTable(item)) {
          return false;
        }

        const value =
          noSpace(item.str);

        if (!/^\d+$/.test(value)) {
          return false;
        }

        return (
          item.x >= qteMin &&
          item.x <= qteMax
        );
      }
    );

  const parsed = [];
  const warnings = [];

  // ---------------------------------------------------------------------------
  // Lignes
  // ---------------------------------------------------------------------------

  for (const codeItem of codes) {
    const ref =
      clean(
        codeItem.str
      ).toUpperCase();

    const requestedQty =
      getQuantityForCode(
        codeItem,
        quantityItems
      );

    if (
      requestedQty === null
    ) {
      warnings.push(
        `Page ${pageNumber} : quantité introuvable pour ${ref}.`
      );

      parsed.push({
        ref,
        designation: "",
        requestedQty: 0,
        preparedQty: 0,
        location: "",
        page: pageNumber,
        warning:
          "Quantité introuvable",
      });

      continue;
    }

    // -------------------------------------------------------------------------
    // Désignation
    // -------------------------------------------------------------------------

    const designation =
      items
        .filter(
          (item) => {
            if (!inTable(item)) {
              return false;
            }

            if (
              Math.abs(
                item.y -
                  codeItem.y
              ) > 5
            ) {
              return false;
            }

            if (
              item === codeItem
            ) {
              return false;
            }

            return (
              item.x >
                codeItem.x +
                  codeItem.w &&
              item.x < qteMin
            );
          }
        )
        .sort(
          (a, b) =>
            a.x - b.x
        )
        .map((item) =>
          clean(item.str)
        )
        .filter(Boolean)
        .join(" ");

    // -------------------------------------------------------------------------
    // Emplacement
    // -------------------------------------------------------------------------

    let location = "";

    const sameLine =
      items
        .filter(
          (item) =>
            Math.abs(
              item.y -
                codeItem.y
            ) <= 5
        )
        .sort(
          (a, b) =>
            a.x - b.x
        );

    const empIndex =
      sameLine.findIndex(
        (item) =>
          /^Emp$/i.test(
            clean(item.str)
          )
      );

    if (empIndex >= 0) {
      const empHeader =
        sameLine[empIndex];

      const locationItem =
        sameLine.find(
          (item, index) =>
            index >
              empIndex &&
            clean(item.str) &&
            !/^\d+$/.test(
              clean(item.str)
            )
        );

      if (locationItem) {
        location =
          clean(
            locationItem.str
          );
      }
    }

    parsed.push({
      ref,
      designation,
      requestedQty,
      preparedQty: 0,
      location,
      page: pageNumber,
      warning: null,
    });
  }

  return {
    items: parsed,
    warnings,
  };
}


// -----------------------------------------------------------------------------
// Fusion des doublons
// -----------------------------------------------------------------------------

function mergeDuplicateLines(
  items
) {
  const map =
    new Map();

  for (const item of items) {
    const ref =
      item.ref.toUpperCase();

    if (!map.has(ref)) {
      map.set(ref, {
        ...item,
      });

      continue;
    }

    const existing =
      map.get(ref);

    existing.requestedQty +=
      Number(
        item.requestedQty || 0
      );

    if (
      !existing.designation &&
      item.designation
    ) {
      existing.designation =
        item.designation;
    }

    if (
      !existing.location &&
      item.location
    ) {
      existing.location =
        item.location;
    }

    if (item.warning) {
      existing.warning =
        existing.warning
          ? `${existing.warning} ${item.warning}`
          : item.warning;
    }
  }

  return [
    ...map.values(),
  ];
}


// -----------------------------------------------------------------------------
// Fonction principale
// -----------------------------------------------------------------------------

export function parseProductionPages(
  pages
) {
  if (
    !Array.isArray(pages) ||
    !pages.length
  ) {
    throw new Error(
      "Aucune page PDF à analyser."
    );
  }

  const allItems =
    pages.flatMap(
      (page) =>
        Array.isArray(page.items)
          ? page.items
          : []
    );

  if (!allItems.length) {
    throw new Error(
      "Aucun texte exploitable n'a été trouvé dans le PDF."
    );
  }

  // Informations générales
  const orderNumber =
    extractOrderNumber(
      allItems
    );

  const client =
    extractClient(
      allItems
    );

  const internalReference =
    extractInternalReference(
      allItems
    );

  const pickupDate =
    extractPickupDate(
      allItems
    );

  // Lignes
  const allLines = [];
  const warnings = [];

  let pagesWithTable = 0;

  for (
    let i = 0;
    i < pages.length;
    i++
  ) {
    const result =
      parseProductionPage(
        pages[i],
        i + 1
      );

    if (
      result.items.length
    ) {
      pagesWithTable++;
      allLines.push(
        ...result.items
      );
    }

    warnings.push(
      ...result.warnings
    );
  }

  const items =
    mergeDuplicateLines(
      allLines
    );

  // Vérifications
  if (!orderNumber) {
    warnings.push(
      "Numéro de commande non détecté."
    );
  }

  if (!client) {
    warnings.push(
      "Client non détecté."
    );
  }

  if (!internalReference) {
    warnings.push(
      "Référence interne non détectée."
    );
  }

  if (!pickupDate) {
    warnings.push(
      "Date d'enlèvement non détectée."
    );
  }

  if (!pagesWithTable) {
    warnings.push(
      "Aucune ligne de préparation détectée dans le tableau."
    );
  }

  if (!items.length) {
    warnings.push(
      "Aucune référence préparable détectée."
    );
  }

  const linesWithoutQuantity =
    items.filter(
      (item) =>
        !Number.isFinite(
          Number(
            item.requestedQty
          )
        ) ||
        Number(
          item.requestedQty
        ) <= 0
    );

  if (
    linesWithoutQuantity.length
  ) {
    warnings.push(
      `${linesWithoutQuantity.length} ligne(s) ont une quantité à vérifier.`
    );
  }

  return {
    orderNumber,
    client,
    internalReference,
    pickupDate,

    items,

    warnings: [
      ...new Set(warnings),
    ],

    stats: {
      pages: pages.length,
      pagesWithTable,
      detectedLines:
        items.length,
      linesWithoutQuantity:
        linesWithoutQuantity.length,
    },
  };
}

export default parseProductionPages;
