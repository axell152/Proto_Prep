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

function sameY(a, b, tolerance = 3) {
  return Math.abs(a.y - b.y) <= tolerance;
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
  const sorted = sortItems(items);

  const clientIndex = sorted.findIndex((item) =>
    /^Client\s*:/i.test(clean(item.str))
  );

  if (clientIndex === -1) {
    return "";
  }

  const clientItem = sorted[clientIndex];

  // On cherche d'abord le code client et le nom sur la même
  // zone verticale.
  const nearby = sorted
    .filter(
      (item) =>
        Math.abs(item.y - clientItem.y) <= 35 &&
        item.y <= clientItem.y
    )
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 2) {
        return b.y - a.y;
      }

      return a.x - b.x;
    });

  const codeIndex = nearby.findIndex((item) =>
    /^C\d+$/i.test(clean(item.str))
  );

  if (codeIndex !== -1) {
    const codeItem = nearby[codeIndex];

    const candidates = nearby
      .filter(
        (item) =>
          item.y < codeItem.y &&
          item.y > codeItem.y - 20
      )
      .sort((a, b) => {
        if (Math.abs(a.y - b.y) > 2) {
          return b.y - a.y;
        }

        return a.x - b.x;
      });

    const company = candidates.find((item) => {
      const value = clean(item.str);

      if (!value) return false;
      if (/^C\d+$/i.test(value)) return false;
      if (/^(DEPOT|Date|Contact|Tel|Livraison)\b/i.test(value)) {
        return false;
      }

      return /[A-ZÀ-ÖØ-Ý]/i.test(value);
    });

    if (company) {
      return clean(company.str);
    }
  }

  // Fallback : recherche d'une ligne contenant directement
  // le nom du client.
  const fallback = sorted.find((item) => {
    const value = clean(item.str);

    return (
      value.length > 3 &&
      /J\s+BONET\s+ETABLISSEMENTS/i.test(value)
    );
  });

  return fallback
    ? clean(fallback.str)
    : "";
}


function extractInternalReference(items) {
  const text = normalizeText(items);

  const match = text.match(
    /Réf\.?\s*Interne\s*:\s*(.*?)(?=\s+Pages?\s*:|\s+Commercial\s*:|\s+Enlèvement\s*:|$)/i
  );

  if (!match) {
    return "";
  }

  return clean(match[1])
    .replace(/\s+BON DE PRODUCTION.*$/i, "")
    .replace(/\s+Date\s*:\s*.*$/i, "")
    .trim();
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
    .filter((item) => sameY(item, code, 5))
    .sort((a, b) => a.x - b.x);

  const quantity = sameLine.find((item) =>
    /Qt[ée]\s*à\s*livr/i.test(clean(item.str))
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
// Références produit
// ------------------------------------------------------------

function isProductCodeValue(value) {
  const ref = clean(value).toUpperCase();

  if (!CODE_RE.test(ref)) {
    return false;
  }

  if (NON_PREPARABLE_RE.test(ref)) {
    return false;
  }

  // Exclusions évidentes du texte administratif.
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

  // Une référence produit doit être dans la zone gauche
  // du tableau. Cela évite notamment de considérer des
  // mots de désignation comme des références.
  const maxX = Math.max(
    header.codeX + pageWidth * 0.12,
    header.quantityX * 0.48
  );

  return item.x <= maxX;
}


// ------------------------------------------------------------
// Lignes visuelles
// ------------------------------------------------------------

function groupRows(items) {
  const sorted = [...items]
    .filter((item) => clean(item.str))
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 2.5) {
        return b.y - a.y;
      }

      return a.x - b.x;
    });

  const rows = [];

  for (const item of sorted) {
    let row = rows.find(
      (candidate) =>
        Math.abs(candidate.y - item.y) <= 2.5
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
    row.items.sort((a, b) => a.x - b.x);

    row.text = row.items
      .map((item) => clean(item.str))
      .filter(Boolean)
      .join(" ");
  }

  return rows;
}


// ------------------------------------------------------------
// Quantités
// ------------------------------------------------------------

function isStandaloneQuantity(value) {
  const normalized = noSpace(value);

  if (!/^\d+$/.test(normalized)) {
    return false;
  }

  const number = Number(normalized);

  return (
    Number.isFinite(number) &&
    number > 0 &&
    number < 100000
  );
}


function quantityFromText(text) {
  const value = clean(text);

  if (!value) {
    return null;
  }

  // Quantité placée au début :
  // "10 DBUT37C ..."
  let match = value.match(
    /^(\d{1,5})\s+(?=[A-Z][A-Z0-9+./-]{3,}\b)/
  );

  if (match) {
    return Number(match[1]);
  }

  return null;
}


function getRowQuantity(row, header) {
  // 1. Quantité explicitement placée dans la colonne Qté à livr.
  const columnCandidates = row.items
    .filter((item) => {
      const value = noSpace(item.str);

      return (
        isStandaloneQuantity(value) &&
        item.x >= header.quantityX - 15 &&
        item.x <=
          header.quantityX +
            Math.max(header.quantityW, 35) +
            35
      );
    })
    .sort((a, b) => a.x - b.x);

  if (columnCandidates.length) {
    return Number(noSpace(columnCandidates[0].str));
  }

  // 2. Quantité au début du texte.
  const beginningQuantity =
    quantityFromText(row.text);

  if (beginningQuantity) {
    return beginningQuantity;
  }

  // 3. Quantité présente après la désignation.
  //
  // Exemple :
  // RPLAUPASF93 PLINTHE AUTOMATIQUE FINE, LG 930MM 8 A30 540 002
  //
  // On cherche un entier avant une éventuelle zone de stockage.
  const tokens = row.text.split(/\s+/);

  for (let i = 1; i < tokens.length; i++) {
    const token = noSpace(tokens[i]);

    if (!isStandaloneQuantity(token)) {
      continue;
    }

    // On évite les dimensions et longueurs courantes.
    const previous = tokens[i - 1] || "";
    const next = tokens[i + 1] || "";

    if (/MM$/i.test(previous)) {
      continue;
    }

    if (/^\d+X\d+/i.test(previous)) {
      continue;
    }

    // Une quantité suivie d'une zone du type A30/B50/E80
    // est très probablement la quantité recherchée.
    if (
      /^[A-Z]\d{2,3}$/i.test(next)
    ) {
      return Number(token);
    }
  }

  return null;
}


// ------------------------------------------------------------
// Nettoyage de désignation
// ------------------------------------------------------------

function removeReferenceFromText(text, ref) {
  let value = clean(text);

  if (!value) {
    return "";
  }

  const escaped = ref.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  value = value.replace(
    new RegExp(`^${escaped}\\s*`, "i"),
    ""
  );

  // Quantité placée avant la référence.
  value = value.replace(
    /^\d{1,5}\s+(?=[A-Z][A-Z0-9+./-]{3,}\b)/,
    ""
  );

  return clean(value);
}


function cleanDesignation(text, ref, quantity) {
  let value = removeReferenceFromText(
    text,
    ref
  );

  if (!value) {
    return "";
  }

  // Retirer une quantité finale lorsque le PDF l'a placée
  // après la désignation.
  if (quantity) {
    const escapedQty = String(quantity).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    value = value.replace(
      new RegExp(
        `\\s+${escapedQty}(?=\\s+[A-Z]\\d{2,3}\\b|\\s+\\d{2,4}\\s*$)`,
        "i"
      ),
      ""
    );
  }

  // Retirer les coordonnées de stockage CEGID :
  // E40 150 002
  // B50 590 002
  // A30 540 002
  // etc.
  value = value.replace(
    /\s+[A-Z]\d{2,3}\s+\d{2,4}\s+002\b/gi,
    ""
  );

  // Variante où seul 002 est présent.
  value = value.replace(
    /\s+002\b/gi,
    ""
  );

  return clean(value);
}


// ------------------------------------------------------------
// Détection des références contenues dans une ligne
// ------------------------------------------------------------

function findCodesInRow(row, header, pageWidth) {
  return row.items
    .filter((item) =>
      isProductCode(
        item,
        header,
        pageWidth
      )
    )
    .map((item) => ({
      item,
      ref: clean(item.str).toUpperCase(),
    }));
}


// ------------------------------------------------------------
// Page
// ------------------------------------------------------------

function parsePage(page, pageNumber) {
  const items = page.items
    .filter((item) => clean(item.str));

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

  const rows = groupRows(items);

  // On ne travaille que sous l'en-tête du tableau.
  const tableRows = rows.filter(
    (row) =>
      row.y < header.y - 4
  );

  const result = [];
  const warnings = [];

  for (let rowIndex = 0; rowIndex < tableRows.length; rowIndex++) {
    const row = tableRows[rowIndex];

    if (SEPARATOR_RE.test(clean(row.text))) {
      continue;
    }

    const codes = findCodesInRow(
      row,
      header,
      page.width
    );

    // --------------------------------------------------------
    // Référence présente sur cette ligne
    // --------------------------------------------------------

    if (codes.length) {
      for (const codeData of codes) {
        const {
          item: codeItem,
          ref,
        } = codeData;

        let quantity =
          getRowQuantity(
            row,
            header
          );

        // Si la quantité est sur une ligne précédente
        // (cas très fréquent dans le PDF CEGID) :
        //
        // 2
        // EPPBL26N01 ...
        //
        if (!quantity) {
          for (
            let previousIndex =
              rowIndex - 1;
            previousIndex >= 0 &&
            previousIndex >= rowIndex - 2;
            previousIndex--
          ) {
            const previousRow =
              tableRows[previousIndex];

            const previousText =
              clean(previousRow.text);

            // Une ligne contenant uniquement une quantité
            // est la correspondance la plus fiable.
            if (
              previousRow.items.length === 1 &&
              isStandaloneQuantity(
                previousText
              )
            ) {
              quantity = Number(
                noSpace(previousText)
              );

              break;
            }

            // Sinon, on accepte une quantité isolée dans
            // la ligne précédente.
            const candidate =
              getRowQuantity(
                previousRow,
                header
              );

            if (
              candidate &&
              previousText.length < 15
            ) {
              quantity = candidate;
              break;
            }
          }
        }

        // ----------------------------------------------------
        // Quantité sur la ligne suivante
        // ----------------------------------------------------

        if (!quantity) {
          for (
            let nextIndex =
              rowIndex + 1;
            nextIndex <
              tableRows.length &&
            nextIndex <= rowIndex + 1;
            nextIndex++
          ) {
            const nextRow =
              tableRows[nextIndex];

            const nextText =
              clean(nextRow.text);

            if (
              nextRow.items.length === 1 &&
              isStandaloneQuantity(
                nextText
              )
            ) {
              quantity = Number(
                noSpace(nextText)
              );

              break;
            }
          }
        }

        const requestedQty =
          Number.isFinite(quantity)
            ? quantity
            : 0;

        // ----------------------------------------------------
        // Désignation
        // ----------------------------------------------------

        let designation =
          cleanDesignation(
            row.text,
            ref,
            requestedQty
          );

        // Si la désignation est répartie sur plusieurs
        // lignes, on ajoute les lignes suivantes tant qu'il
        // n'y a pas de nouvelle référence.
        if (!designation) {
          const continuation = [];

          for (
            let nextIndex =
              rowIndex + 1;
            nextIndex <
              tableRows.length &&
            nextIndex <= rowIndex + 3;
            nextIndex++
          ) {
            const nextRow =
              tableRows[nextIndex];

            if (
              findCodesInRow(
                nextRow,
                header,
                page.width
              ).length
            ) {
              break;
            }

            const text =
              clean(nextRow.text);

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

          designation = clean(
            continuation.join(" ")
          );
        }

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

        if (!requestedQty) {
          warnings.push(
            `Page ${pageNumber} : quantité introuvable pour ${ref}.`
          );
        }

        // Une seule référence par ligne dans ce PDF.
        // On évite de générer plusieurs lignes identiques
        // si PDF.js a fragmenté le texte.
        break;
      }

      continue;
    }

    // --------------------------------------------------------
    // Ligne sans référence :
    // elle peut être une quantité située AVANT une référence.
    // On ne crée aucune ligne ici.
    // --------------------------------------------------------
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
      !existing.designation &&
      item.designation
    ) {
      existing.designation =
        item.designation;
    }

    // On conserve la première page comme référence.
    if (!existing.page && item.page) {
      existing.page = item.page;
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
