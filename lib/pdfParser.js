// lib/pdfParser.js
//
// Analyse des "BONS DE PRODUCTION DE LA COMMANDE" CEGID.
//
// Principe repris de l'analyseur Navette :
// - on récupère chaque élément texte avec ses coordonnées PDF
// - on détecte dynamiquement les colonnes du tableau
// - on ne dépend pas de coordonnées X fixes
// - une référence est associée à la quantité située sur la même ligne
//
// Important : ce parser ne crée aucune commande.
// Il retourne uniquement les données extraites.

async function loadPdfJs() {
  return await import("pdfjs-dist/legacy/build/pdf.mjs");
}

const clean = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const compact = (value) =>
  clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const noSpace = (value) =>
  clean(value).replace(/[\s\u00a0]/g, "");


// -----------------------------------------------------------------------------
// Références produit
// -----------------------------------------------------------------------------
//
// Les références CEGID de ton bon ressemblent notamment à :
// EPL4029N
// EPCJ429N
// EPLO429E
// EPP3D26N
// I10MCI3
// DJ3PALN01
// RMOPODV
// etc.
//
// On reste volontairement assez large.
// Les exclusions viennent ensuite.
// -----------------------------------------------------------------------------

const CODE_RE = /^[A-Z][A-Z0-9+./-]{3,}$/;


// Certaines références présentes dans le PDF ne sont pas des produits
// préparables. Elles correspondent à des informations / prestations.
//
// On les exclut explicitement pour éviter de transformer par exemple
// INFO29X, GTRANS ou NAV13 en ligne de préparation.
const NON_PREPARABLE_RE = /^(INFO|GTRANS|NAV)\b/i;


// -----------------------------------------------------------------------------
// Extraction PDF -> pages d'éléments texte avec coordonnées
// -----------------------------------------------------------------------------

async function extractPages(buffer) {
  const pdfjs = await loadPdfJs();

  const data = new Uint8Array(buffer);

  const loadingTask = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  const pdf = await loadingTask.promise;

  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);

    const viewport = page.getViewport({ scale: 1 });

    const content = await page.getTextContent();

    const items = content.items
      .filter((item) => typeof item.str === "string" && item.str.trim() !== "")
      .map((item) => ({
        str: item.str,
        x: Number(item.transform?.[4] ?? 0),
        y: Number(item.transform?.[5] ?? 0),
        w: Number(item.width ?? 0),
      }));

    pages.push({
      width: viewport.width,
      height: viewport.height,
      items,
    });
  }

  return pages;
}


// -----------------------------------------------------------------------------
// Utilitaires lignes
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
      (g) => Math.abs(g.y - item.y) <= tolerance
    );

    if (!group) {
      group = {
        y: item.y,
        items: [],
      };

      groups.push(group);
    }

    group.items.push(item);

    // Moyenne pour stabiliser légèrement la ligne
    group.y =
      group.items.reduce((sum, current) => sum + current.y, 0) /
      group.items.length;
  }

  for (const group of groups) {
    group.items.sort((a, b) => a.x - b.x);

    group.text = group.items
      .map((item) => clean(item.str))
      .filter(Boolean)
      .join(" ");
  }

  return groups.sort((a, b) => b.y - a.y);
}


function textAround(items, pattern) {
  return items.find((item) => pattern.test(clean(item.str)));
}


// -----------------------------------------------------------------------------
// Informations générales du bon
// -----------------------------------------------------------------------------

function extractOrderNumber(allItems) {
  // Cas typique du PDF :
  // n° 164404 DEPOT GRAVESON
  //
  // On regarde également les variantes "N°", "No", etc.

  const texts = allItems.map((item) => clean(item.str));

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];

    const match = text.match(
      /\bn[°ºo]?\s*[:.]?\s*(\d{4,10})\b/i
    );

    if (match) {
      return match[1];
    }
  }

  // Recherche dans le texte concaténé
  const joined = texts.join(" ");

  const match = joined.match(
    /\bn[°ºo]?\s*[:.]?\s*(\d{4,10})\b/i
  );

  return match ? match[1] : "";
}


function extractClient(allItems) {
  const items = [...allItems].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 2) return b.y - a.y;
    return a.x - b.x;
  });

  const clientIndex = items.findIndex((item) =>
    /^Client\s*:/i.test(clean(item.str))
  );

  if (clientIndex < 0) {
    return "";
  }

  const first = clean(items[clientIndex].str)
    .replace(/^Client\s*:/i, "")
    .trim();

  // Dans ton PDF, "Client : C12962" est suivi par :
  // J BONET ETABLISSEMENTS
  //
  // On prend donc le texte suivant si nécessaire.

  if (first && !/^C\d+$/i.test(first)) {
    return first;
  }

  const baseY = items[clientIndex].y;

  const next = items
    .filter(
      (item, index) =>
        index !== clientIndex &&
        Math.abs(item.y - baseY) < 18 &&
        item.x < 500
    )
    .sort((a, b) => {
      const dyA = Math.abs(a.y - baseY);
      const dyB = Math.abs(b.y - baseY);

      if (dyA !== dyB) return dyA - dyB;

      return a.x - b.x;
    })
    .find((item) => {
      const value = clean(item.str);

      return (
        value &&
        !/^n[°ºo]/i.test(value) &&
        !/^DEPOT\b/i.test(value) &&
        !/^Date\b/i.test(value)
      );
    });

  return next ? clean(next.str) : first;
}


function extractInternalReference(allItems) {
  const joined = allItems
    .map((item) => clean(item.str))
    .join(" ");

  const match = joined.match(
    /Réf\.?\s*Interne\s*:\s*(.+?)(?=\s+Enlèvement\s*:|\s+n[°ºo]\s*|$)/i
  );

  if (match) {
    return clean(match[1]);
  }

  // Variante plus tolérante
  const index = allItems.findIndex((item) =>
    /Réf\.?\s*Interne/i.test(clean(item.str))
  );

  if (index >= 0) {
    const current = clean(allItems[index].str)
      .replace(/Réf\.?\s*Interne\s*:?\s*/i, "")
      .trim();

    if (current) return current;

    const y = allItems[index].y;

    const sameLine = allItems
      .filter((item) => Math.abs(item.y - y) <= 3)
      .sort((a, b) => a.x - b.x)
      .map((item) => clean(item.str))
      .filter(Boolean)
      .join(" ");

    return sameLine
      .replace(/Réf\.?\s*Interne\s*:?\s*/i, "")
      .trim();
  }

  return "";
}


function extractPickupDate(allItems) {
  const joined = allItems
    .map((item) => clean(item.str))
    .join(" ");

  const match = joined.match(
    /Enlèvement\s*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i
  );

  return match ? match[1] : "";
}


// -----------------------------------------------------------------------------
// Détection de l'en-tête du tableau
// -----------------------------------------------------------------------------

function findProductionHeader(items, pageWidth) {
  const codeHeaders = items.filter(
    (item) =>
      /^Code$/i.test(clean(item.str)) &&
      item.x < pageWidth * 0.25
  );

  if (!codeHeaders.length) {
    return null;
  }

  for (const codeHeader of codeHeaders) {
    const sameLine = items
      .filter((item) => Math.abs(item.y - codeHeader.y) <= 4)
      .sort((a, b) => a.x - b.x);

    const qte = sameLine.find((item) =>
      /Qt[ée]\s*à\s*livr/i.test(clean(item.str))
    );

    if (qte) {
      return {
        y: codeHeader.y,
        codeX: codeHeader.x,
        qteX: qte.x,
        qteW: qte.w,
        items: sameLine,
      };
    }
  }

  return null;
}


// -----------------------------------------------------------------------------
// Détection des limites du tableau
// -----------------------------------------------------------------------------

function findTableBottom(items, headerY) {
  const possibleFooters = items.filter((item) => {
    const text = clean(item.str);

    return (
      /PLAN\s+CLIENT/i.test(text) ||
      /TOTAL/i.test(text) ||
      /OBSERVATION/i.test(text)
    );
  });

  const belowHeader = possibleFooters.filter(
    (item) => item.y < headerY
  );

  if (belowHeader.length) {
    return Math.max(...belowHeader.map((item) => item.y));
  }

  return 0;
}


// -----------------------------------------------------------------------------
// Détection des références
// -----------------------------------------------------------------------------

function isValidProductCode(item, header, pageWidth) {
  const value = clean(item.str).toUpperCase();

  if (!value) return false;

  if (!CODE_RE.test(value)) return false;

  if (NON_PREPARABLE_RE.test(value)) return false;

  // La colonne Code se trouve à gauche du tableau.
  // On prend une marge dynamique autour de la position de l'en-tête.
  const codeMax = Math.max(
    header.codeX + pageWidth * 0.08,
    header.qteX * 0.45
  );

  if (item.x > codeMax) return false;

  // On évite de considérer des nombres seuls comme des références.
  if (/^\d+$/.test(value)) return false;

  return true;
}


// -----------------------------------------------------------------------------
// Quantité d'une ligne
// -----------------------------------------------------------------------------

function getQuantityForCode(codeItem, quantityItems) {
  const candidates = quantityItems
    .filter((item) => Math.abs(item.y - codeItem.y) <= 6)
    .sort((a, b) => a.x - b.x);

  if (!candidates.length) {
    return null;
  }

  const value = candidates
    .map((item) => noSpace(item.str))
    .join("");

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const quantity = Number(value);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  return quantity;
}


// -----------------------------------------------------------------------------
// Parsing des lignes préparables
// -----------------------------------------------------------------------------

function parseProductionLines(page, pageNumber) {
  const items = page.items.filter(
    (item) => clean(item.str) !== ""
  );

  const header = findProductionHeader(items, page.width);

  if (!header) {
    return {
      items: [],
      warning: null,
    };
  }

  const yBottom = findTableBottom(items, header.y);

  const inTable = (item) =>
    item.y < header.y - 4 &&
    item.y > yBottom;

  // ---------------------------------------------------------------------------
  // Références
  // ---------------------------------------------------------------------------

  const codes = items
    .filter((item) =>
      inTable(item) &&
      isValidProductCode(item, header, page.width)
    )
    .sort((a, b) => b.y - a.y);

  // ---------------------------------------------------------------------------
  // Zone quantité
  // ---------------------------------------------------------------------------
  //
  // Contrairement au premier parser, on ne fixe PAS :
  //
  // x = 300
  //
  // On utilise la position réelle de "Qté à livr." trouvée dans le PDF.
  // ---------------------------------------------------------------------------

  const qteMin = header.qteX - 8;
  const qteMax = header.qteX + Math.max(header.qteW, 30) + 25;

  const quantityItems = items.filter((item) => {
    if (!inTable(item)) return false;

    const text = noSpace(item.str);

    if (!/^\d+$/.test(text)) return false;

    return (
      item.x >= qteMin &&
      item.x <= qteMax
    );
  });

  const parsed = [];
  const warnings = [];

  for (const codeItem of codes) {
    const ref = clean(codeItem.str).toUpperCase();

    const quantity = getQuantityForCode(
      codeItem,
      quantityItems
    );

    if (quantity === null) {
      warnings.push(
        `Page ${pageNumber} : quantité introuvable pour ${ref}.`
      );

      // On garde la ligne avec quantité 0 pour validation manuelle.
      parsed.push({
        ref,
        designation: "",
        requestedQty: 0,
        preparedQty: 0,
        location: "",
        page: pageNumber,
        warning: "Quantité introuvable",
      });

      continue;
    }

    // -------------------------------------------------------------------------
    // Désignation
    // -------------------------------------------------------------------------
    //
    // On récupère les textes situés entre la colonne Code et la colonne Qté.
    // Cela permet de conserver une désignation sans dépendre d'un X fixe.
    // -------------------------------------------------------------------------

    const designationParts = items
      .filter((item) => {
        if (!inTable(item)) return false;

        if (Math.abs(item.y - codeItem.y) > 5) return false;

        if (item === codeItem) return false;

        const x = item.x;

        return (
          x > codeItem.x + codeItem.w &&
          x < qteMin
        );
      })
      .sort((a, b) => a.x - b.x)
      .map((item) => clean(item.str))
      .filter(Boolean);

    const designation = designationParts.join(" ");

    // -------------------------------------------------------------------------
    // Emplacement
    // -------------------------------------------------------------------------
    //
    // "Emp" se trouve normalement après N° Colis.
    // On tente de le détecter dynamiquement.
    // -------------------------------------------------------------------------

    const sameLine = items
      .filter(
        (item) => Math.abs(item.y - codeItem.y) <= 5
      )
      .sort((a, b) => a.x - b.x);

    let location = "";

    const empIndex = sameLine.findIndex((item) =>
      /^Emp$/i.test(clean(item.str))
    );

    if (empIndex >= 0) {
      const empHeader = sameLine[empIndex];

      const locationItem = items
        .filter(
          (item) =>
            Math.abs(item.y - codeItem.y) <= 5 &&
            item.x > empHeader.x
        )
        .sort((a, b) => a.x - b.x)
        .find((item) => {
          const value = clean(item.str);

          return value && !/^\d+$/.test(value);
        });

      if (locationItem) {
        location = clean(locationItem.str);
      }
    }

    parsed.push({
      ref,
      designation,
      requestedQty: quantity,
      preparedQty: 0,
      location,
      page: pageNumber,
      warning: null,
    });
  }

  return {
    items: parsed,
    warning: warnings.length ? warnings.join(" ") : null,
  };
}


// -----------------------------------------------------------------------------
// Déduplication
// -----------------------------------------------------------------------------

function mergeDuplicateLines(items) {
  const map = new Map();

  for (const item of items) {
    const ref = item.ref.toUpperCase();

    if (!map.has(ref)) {
      map.set(ref, {
        ...item,
      });

      continue;
    }

    const existing = map.get(ref);

    existing.requestedQty += Number(item.requestedQty || 0);

    if (!existing.designation && item.designation) {
      existing.designation = item.designation;
    }

    if (!existing.location && item.location) {
      existing.location = item.location;
    }

    if (item.warning) {
      existing.warning = existing.warning
        ? `${existing.warning} ${item.warning}`
        : item.warning;
    }
  }

  return [...map.values()];
}


// -----------------------------------------------------------------------------
// Fonction principale
// -----------------------------------------------------------------------------

export async function parseProductionPdf(buffer) {
  if (!buffer) {
    throw new Error("Aucun PDF fourni.");
  }

  const pages = await extractPages(buffer);

  if (!pages.length) {
    throw new Error("Le PDF ne contient aucune page.");
  }

  const allItems = pages.flatMap((page) => page.items);

  if (!allItems.length) {
    throw new Error(
      "Aucun texte exploitable n'a été trouvé dans le PDF."
    );
  }

  // ---------------------------------------------------------------------------
  // Informations générales
  // ---------------------------------------------------------------------------

  const orderNumber = extractOrderNumber(allItems);
  const client = extractClient(allItems);
  const internalReference = extractInternalReference(allItems);
  const pickupDate = extractPickupDate(allItems);

  // ---------------------------------------------------------------------------
  // Lignes
  // ---------------------------------------------------------------------------

  const allLines = [];
  const warnings = [];

  let pagesWithTable = 0;

  for (let i = 0; i < pages.length; i++) {
    const result = parseProductionLines(
      pages[i],
      i + 1
    );

    if (result.items.length > 0) {
      pagesWithTable++;
      allLines.push(...result.items);
    }

    if (result.warning) {
      warnings.push(result.warning);
    }
  }

  const items = mergeDuplicateLines(allLines);

  // ---------------------------------------------------------------------------
  // Vérifications
  // ---------------------------------------------------------------------------

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

  const linesWithoutQuantity = items.filter(
    (item) =>
      !Number.isFinite(Number(item.requestedQty)) ||
      Number(item.requestedQty) <= 0
  );

  if (linesWithoutQuantity.length) {
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

    warnings: [...new Set(warnings)],

    stats: {
      pages: pages.length,
      pagesWithTable,
      detectedLines: items.length,
      linesWithoutQuantity: linesWithoutQuantity.length,
    },
  };
}


// Alias de compatibilité si une ancienne route utilise parsePdf.
export const parsePdf = parseProductionPdf;

export default parseProductionPdf;
