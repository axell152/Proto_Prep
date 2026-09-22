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


// ------------------------------------------------------------
// Informations générales
// ------------------------------------------------------------

function extractOrderNumber(items) {
  const text = items
    .map((item) => clean(item.str))
    .join(" ");

  const match = text.match(
    /\bn[°ºo]?\s*[:.]?\s*(\d{4,10})\b/i
  );

  return match?.[1] || "";
}


function extractClient(items) {
  const sorted = [...items].sort(
    (a, b) => {
      if (Math.abs(a.y - b.y) > 2) {
        return b.y - a.y;
      }

      return a.x - b.x;
    }
  );

  const index = sorted.findIndex(
    (item) =>
      /^Client\s*:/i.test(
        clean(item.str)
      )
  );

  if (index === -1) {
    return "";
  }

  const clientLine = sorted[index];

  // Même ligne
  const sameLine = sorted
    .filter(
      (item) =>
        Math.abs(
          item.y - clientLine.y
        ) <= 3
    )
    .sort(
      (a, b) => a.x - b.x
    )
    .map((item) => clean(item.str))
    .filter(Boolean);

  const clientText = sameLine
    .join(" ")
    .replace(
      /^Client\s*:\s*C?\d+\s*/i,
      ""
    )
    .trim();

  if (clientText) {
    return clientText;
  }

  // Ligne suivante
  const next = sorted
    .filter(
      (item) =>
        item.y < clientLine.y &&
        item.y >
          clientLine.y - 25
    )
    .sort(
      (a, b) =>
        Math.abs(
          a.y - clientLine.y
        ) -
        Math.abs(
          b.y - clientLine.y
        )
    )
    .find((item) => {
      const value = clean(item.str);

      return (
        value &&
        !/^C\d+$/i.test(value) &&
        !/^DEPOT\b/i.test(value) &&
        !/^Date\b/i.test(value)
      );
    });

  return next
    ? clean(next.str)
    : "";
}


function extractInternalReference(items) {
  const text = items
    .map((item) => clean(item.str))
    .join(" ");

  const match = text.match(
    /Réf\.?\s*Interne\s*:\s*(.+?)(?=\s+Enlèvement\s*:|\s+n[°ºo]\s*|$)/i
  );

  return match
    ? clean(match[1])
    : "";
}


function extractPickupDate(items) {
  const text = items
    .map((item) => clean(item.str))
    .join(" ");

  const match = text.match(
    /Enlèvement\s*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i
  );

  return match?.[1] || "";
}


// ------------------------------------------------------------
// En-tête dynamique
// ------------------------------------------------------------

function findHeader(items, pageWidth) {
  const code = items.find(
    (item) =>
      /^Code$/i.test(
        clean(item.str)
      ) &&
      item.x < pageWidth * 0.25
  );

  if (!code) {
    return null;
  }

  const sameLine = items
    .filter(
      (item) =>
        Math.abs(
          item.y - code.y
        ) <= 4
    )
    .sort(
      (a, b) => a.x - b.x
    );

  const quantity = sameLine.find(
    (item) =>
      /Qt[ée]\s*à\s*livr/i.test(
        clean(item.str)
      )
  );

  if (!quantity) {
    return null;
  }

  return {
    y: code.y,
    codeX: code.x,
    quantityX: quantity.x,
    quantityW: quantity.w || 30,
  };
}


// ------------------------------------------------------------
// Référence
// ------------------------------------------------------------

function isProductCode(
  item,
  header,
  pageWidth
) {
  const value =
    clean(item.str).toUpperCase();

  if (!CODE_RE.test(value)) {
    return false;
  }

  if (
    NON_PREPARABLE_RE.test(value)
  ) {
    return false;
  }

  if (
    /^\d+$/.test(value)
  ) {
    return false;
  }

  const maxX = Math.max(
    header.codeX +
      pageWidth * 0.08,
    header.quantityX * 0.45
  );

  return item.x <= maxX;
}


// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

function parsePage(
  page,
  pageNumber
) {
  const items = page.items
    .filter(
      (item) =>
        clean(item.str)
    );

  const header = findHeader(
    items,
    page.width
  );

  if (!header) {
    return {
      items: [],
      warnings: [],
    };
  }

  const codes = items
    .filter((item) =>
      item.y <
        header.y - 4 &&
      isProductCode(
        item,
        header,
        page.width
      )
    )
    .sort(
      (a, b) =>
        b.y - a.y
    );

  const quantityMin =
    header.quantityX - 8;

  const quantityMax =
    header.quantityX +
    Math.max(
      header.quantityW,
      30
    ) +
    25;

  const quantities = items.filter(
    (item) => {
      const value =
        noSpace(item.str);

      if (!/^\d+$/.test(value)) {
        return false;
      }

      return (
        item.x >= quantityMin &&
        item.x <= quantityMax
      );
    }
  );

  const result = [];
  const warnings = [];

  for (const code of codes) {
    const ref =
      clean(code.str)
        .toUpperCase();

    const quantity =
      quantities
        .filter(
          (item) =>
            Math.abs(
              item.y - code.y
            ) <= 6
        )
        .map((item) =>
          noSpace(item.str)
        )
        .join("");

    const requestedQty =
      /^\d+$/.test(quantity)
        ? Number(quantity)
        : 0;

    if (!requestedQty) {
      warnings.push(
        `Page ${pageNumber} : quantité introuvable pour ${ref}.`
      );
    }

    const designation =
      items
        .filter(
          (item) =>
            Math.abs(
              item.y - code.y
            ) <= 5 &&
            item.x >
              code.x &&
            item.x <
              quantityMin &&
            item.str !== code.str
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

    result.push({
      ref,
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
  const map = new Map();

  for (const item of items) {
    if (!map.has(item.ref)) {
      map.set(item.ref, {
        ...item,
      });
      continue;
    }

    const existing =
      map.get(item.ref);

    existing.requestedQty +=
      item.requestedQty;

    if (
      !existing.designation
    ) {
      existing.designation =
        item.designation;
    }
  }

  return [...map.values()];
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
    mergeDuplicates(lines);

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
      detectedLines: items.length,
    },
  };
}

export default parseProductionPages;
