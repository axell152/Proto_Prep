// lib/pdfParser.js

function clean(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function noSpace(value) {
  return clean(value).replace(/\s/g, "");
}

const CODE_RE =
  /^[A-Z][A-Z0-9+./-]{3,}$/;

const NON_PREPARABLE_RE =
  /^(INFO|GTRANS|NAV)\b/i;

const SEPARATOR_RE =
  /^(\*{5,}|-+$)$/;


// ------------------------------------------------------------
// Utilitaires
// ------------------------------------------------------------

function sortItems(items) {
  return [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 2) {
      return b.y - a.y;
    }

    return a.x - b.x;
  });
}

function normalizeText(items) {
  return items
    .map((item) => clean(item.str))
    .filter(Boolean)
    .join(" ");
}


// ------------------------------------------------------------
// Informations générales
// ------------------------------------------------------------

function extractOrderNumber(items) {
  const text = normalizeText(items);

  const match = text.match(
    /\bn[°ºo]?\s*[:.]?\s*(\d{4,10})\b/i
  );

  return match?.[1] || "";
}


function extractClient(items) {
  const exact = items.find(
    (item) =>
      /J\s+BONET\s+ETABLISSEMENTS/i.test(
        clean(item.str)
      )
  );

  if (exact) {
    return clean(exact.str);
  }

  return "";
}


function extractInternalReference(items) {
  const text = normalizeText(items);

  const match = text.match(
    /Réf\.?\s*Interne\s*:\s*(.*?)\s+Pages\s*:/i
  );

  return match
    ? clean(match[1])
    : "";
}


function extractPickupDate(items) {
  const text = normalizeText(items);

  const match = text.match(
    /Enlèvement\s*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i
  );

  return match?.[1] || "";
}


// ------------------------------------------------------------
// En-tête dynamique
// ------------------------------------------------------------

function findHeader(items, pageWidth) {
  const code = items.find((item) => {
    const value = clean(item.str);

    return (
      /^Code$/i.test(value) &&
      item.x < pageWidth * 0.30
    );
  });

  if (!code) {
    return null;
  }

  const sameLine = items
    .filter(
      (item) =>
        Math.abs(item.y - code.y) <= 5
    )
    .sort((a, b) => a.x - b.x);

  const quantity = sameLine.find(
    (item) =>
      /Qt[ée]\s*$/i.test(clean(item.str)) ||
      /Qt[ée]\s*à\s*livr/i.test(
        clean(item.str)
      )
  );

  // Dans ce PDF PDF.js peut séparer :
  // "Qté" / "à" / "livr."
  //
  // On prend directement la position du premier "Qté"
  // appartenant à "Qté à livr."
  const quantityHeader =
    quantity ||
    sameLine.find(
      (item) =>
        /^Qt[ée]$/i.test(
          clean(item.str)
        ) &&
        item.x > code.x
    );

  if (!quantityHeader) {
    return null;
  }

  return {
    y: code.y,
    codeX: code.x,
    quantityX: quantityHeader.x,
    quantityW:
      quantityHeader.w || 30,
  };
}


// ------------------------------------------------------------
// Références produit
// ------------------------------------------------------------

function isProductCodeValue(value) {
  const ref =
    clean(value).toUpperCase();

  if (!CODE_RE.test(ref)) {
    return false;
  }

  if (NON_PREPARABLE_RE.test(ref)) {
    return false;
  }

  if (
    /^(CODE|CLIENT|CONTACT|TEL|DATE|DEPOT|LIVRAISON|COMMERCIAL|PAGES)$/i.test(
      ref
    )
  ) {
    return false;
  }

  return true;
}


function isProductCode(item, header, pageWidth) {
  const value = clean(item.str);

  if (!isProductCodeValue(value)) {
    return false;
  }

  // Les références CEGID sont dans la colonne Code.
  //
  // On utilise une zone suffisamment large pour ne pas
  // dépendre d'une largeur de page précise.
  return (
    item.x >= header.codeX - 20 &&
    item.x < 170
  );
}


// ------------------------------------------------------------
// Quantité
// ------------------------------------------------------------

function isQuantity(item, header) {
  const value = noSpace(item.str);

  if (!/^\d+$/.test(value)) {
    return false;
  }

  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number <= 0 ||
    number >= 100000
  ) {
    return false;
  }

  // Dans le PDF réel la quantité est autour de x=350.
  //
  // On garde une marge importante car PDF.js peut légèrement
  // modifier les positions.
  return (
    item.x >= header.quantityX + 5 &&
    item.x <= header.quantityX + 60
  );
}


function findQuantityForCode(
  codeItem,
  items,
  header
) {
  const candidates = items
    .filter((item) =>
      isQuantity(
        item,
        header
      )
    )
    .map((item) => ({
      item,
      distance:
        Math.abs(
          item.y - codeItem.y
        ),
    }))
    .filter(
      (candidate) =>
        candidate.distance <= 9
    )
    .sort(
      (a, b) =>
        a.distance -
        b.distance
    );

  if (!candidates.length) {
    return 0;
  }

  return Number(
    noSpace(
      candidates[0].item.str
    )
  );
}


// ------------------------------------------------------------
// Désignation
// ------------------------------------------------------------

function getDesignationItems(
  rowItems,
  codeItem,
  header
) {
  return rowItems
    .filter(
      (item) =>
        item !== codeItem &&
        item.x > 70 &&
        item.x < header.quantityX - 5
    )
    .sort(
      (a, b) =>
        a.x - b.x
    );
}


function cleanDesignation(
  items,
  ref
) {
  let value = items
    .map((item) => clean(item.str))
    .filter(Boolean)
    .join(" ");

  if (!value) {
    return "";
  }

  // Sécurité : retirer la référence si elle a été
  // incluse dans la désignation.
  const escaped =
    ref.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  value = value.replace(
    new RegExp(
      `^${escaped}\\s*`,
      "i"
    ),
    ""
  );

  // Coordonnées d'emplacement CEGID éventuelles.
  value = value.replace(
    /\s+[A-Z]\d{2,3}\s+\d{2,4}\s+002\b/gi,
    ""
  );

  value = value.replace(
    /\s+002\b/gi,
    ""
  );

  return clean(value);
}


// ------------------------------------------------------------
// Regroupement des lignes
// ------------------------------------------------------------

function groupRows(items) {
  const sorted = [...items]
    .filter(
      (item) =>
        clean(item.str)
    )
    .sort((a, b) => {
      if (
        Math.abs(a.y - b.y) > 2
      ) {
        return b.y - a.y;
      }

      return a.x - b.x;
    });

  const rows = [];

  for (const item of sorted) {
    let row =
      rows.find(
        (candidate) =>
          Math.abs(
            candidate.y - item.y
          ) <= 5
      );

    if (!row) {
      row = {
        y: item.y,
        items: [],
      };

      rows.push(row);
    }

    row.items.push(item);
  }

  for (const row of rows) {
    row.items.sort(
      (a, b) =>
        a.x - b.x
    );
  }

  return rows;
}


// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

function parsePage(
  page,
  pageNumber
) {
  const items =
    page.items.filter(
      (item) =>
        clean(item.str)
    );

  const header =
    findHeader(
      items,
      page.width
    );

  if (!header) {
    return {
      items: [],
      warnings: [],
    };
  }

  // Seulement les éléments situés sous l'en-tête.
  const tableItems =
    items.filter(
      (item) =>
        item.y <
        header.y - 4
    );

  const rows =
    groupRows(
      tableItems
    );

  const result = [];
  const warnings = [];

  for (
    let rowIndex = 0;
    rowIndex < rows.length;
    rowIndex++
  ) {
    const row =
      rows[rowIndex];

    if (
      SEPARATOR_RE.test(
        clean(
          row.items
            .map(
              (item) =>
                item.str
            )
            .join(" ")
        )
      )
    ) {
      continue;
    }

    const codeItems =
      row.items.filter(
        (item) =>
          isProductCode(
            item,
            header,
            page.width
          )
      );

    if (!codeItems.length) {
      continue;
    }

    for (
      const codeItem of codeItems
    ) {
      const ref =
        clean(
          codeItem.str
        ).toUpperCase();

      // ------------------------------------------------------
      // Quantité
      // ------------------------------------------------------

      const requestedQty =
        findQuantityForCode(
          codeItem,
          tableItems,
          header
        );

      // ------------------------------------------------------
      // Désignation
      // ------------------------------------------------------

      const designationItems =
        getDesignationItems(
          row.items,
          codeItem,
          header
        );

      let designation =
        cleanDesignation(
          designationItems,
          ref
        );

      // ------------------------------------------------------
      // Désignation sur plusieurs lignes
      // ------------------------------------------------------

      if (!designation) {
        const continuation = [];

        for (
          let i = 1;
          i <= 3 &&
          rowIndex + i <
            rows.length;
          i++
        ) {
          const nextRow =
            rows[rowIndex + i];

          const nextHasCode =
            nextRow.items.some(
              (item) =>
                isProductCode(
                  item,
                  header,
                  page.width
                )
            );

          if (nextHasCode) {
            break;
          }

          const text =
            nextRow.items
              .filter(
                (item) =>
                  item.x >
                    70 &&
                  item.x <
                    header.quantityX - 5
              )
              .map(
                (item) =>
                  clean(item.str)
              )
              .filter(Boolean)
              .join(" ");

          if (!text) {
            continue;
          }

          if (
            /^\d+$/.test(text)
          ) {
            continue;
          }

          if (
            SEPARATOR_RE.test(text)
          ) {
            break;
          }

          continuation.push(text);
        }

        designation =
          clean(
            continuation.join(" ")
          );
      }

      result.push({
        ref,
        reference: ref,
        designation,
        requestedQty,
        preparedQty: 0,
        location: "",
        page: pageNumber,
        warning:
          requestedQty
            ? null
            : "Quantité introuvable",
      });

      if (!requestedQty) {
        warnings.push(
          `Page ${pageNumber} : quantité introuvable pour ${ref}.`
        );
      }
    }
  }

  return {
    items: result,
    warnings,
  };
}


// ------------------------------------------------------------
// Doublons
// ------------------------------------------------------------

function mergeDuplicates(items) {
  const map =
    new Map();

  for (
    const item of items
  ) {
    if (
      !map.has(item.ref)
    ) {
      map.set(
        item.ref,
        {
          ...item,
          reference:
            item.ref,
        }
      );

      continue;
    }

    const existing =
      map.get(item.ref);

    existing.requestedQty +=
      item.requestedQty;

    if (
      !existing.designation &&
      item.designation
    ) {
      existing.designation =
        item.designation;
    }
  }

  return [
    ...map.values(),
  ];
}


// ------------------------------------------------------------
// Export principal
// ------------------------------------------------------------

export function parseProductionPages(
  pages
) {
  const allItems =
    pages.flatMap(
      (page) =>
        page.items || []
    );

  if (!allItems.length) {
    throw new Error(
      "Aucun texte détecté dans le PDF."
    );
  }

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

  const lines = [];
  const warnings = [];

  for (
    let i = 0;
    i < pages.length;
    i++
  ) {
    const result =
      parsePage(
        pages[i],
        i + 1
      );

    lines.push(
      ...result.items
    );

    warnings.push(
      ...result.warnings
    );
  }

  const items =
    mergeDuplicates(
      lines
    );

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

  if (!items.length) {
    warnings.push(
      "Aucune ligne préparable détectée."
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
      detectedLines:
        items.length,
    },
  };
}

export default parseProductionPages;
