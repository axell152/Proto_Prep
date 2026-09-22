import pdfParse from 'pdf-parse';

// The production PDF has a real table layout. The code is in the first column,
// while the "Qté à livr." value is about 3.7 points lower on the PDF text layer.
// We therefore match the two columns by coordinates instead of requiring them
// to be on the exact same text row.
const CODE_RE = /^[A-Z0-9][A-Z0-9._/+\-]{3,}$/i;
const INFO_CODES = new Set(['GTRANS']);
const INFO_PREFIXES = ['INFO'];

function normalize(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function roundY(y) {
  return Math.round(Number(y) * 100) / 100;
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
      y: roundY(item.transform?.[5] || 0)
    }))
    .filter((item) => item.text);
}

function isCodeCandidate(item) {
  // Table starts around y=330 on every page. Restricting the search to the
  // code column prevents header words such as "Livraison" or "Commande"
  // from being considered article codes.
  return item.x < 75 && item.y > 330 && CODE_RE.test(item.text);
}

function isQtyToken(item) {
  return item.x >= 335 && item.x < 375 && item.y > 330 && /^\d+$/.test(item.text);
}

function parseQuantityToken(tokens) {
  // Some cells are printed as two PDF text objects, e.g. "1" + "500".
  // Visually this is "1 500", so concatenate the numeric fragments.
  const value = tokens
    .sort((a, b) => a.x - b.x)
    .map((item) => item.text)
    .join('');

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getDesignation(items, codeItem, nextCodeY) {
  const sameLine = items
    .filter((item) =>
      item.x >= 75 &&
      item.x < 335 &&
      Math.abs(item.y - codeItem.y) <= 1.5
    )
    .sort((a, b) => a.x - b.x);

  let text = sameLine.map((item) => item.text).join(' ');

  // A few descriptions wrap onto a second visual line. Include only nearby
  // continuation text before the next article code.
  const continuation = items
    .filter((item) =>
      item.x >= 75 &&
      item.x < 335 &&
      item.y > codeItem.y + 1.5 &&
      item.y <= Math.min(codeItem.y + 10.5, nextCodeY - 1.5)
    )
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));

  if (continuation.length) {
    const continuationText = continuation.map((item) => item.text).join(' ');
    text = `${text} ${continuationText}`.trim();
  }

  return normalize(text);
}

function getLocation(items, qtyY) {
  // Emp is printed as two PDF text objects, e.g. "E80" + "110".
  const locationParts = items
    .filter((item) =>
      item.x >= 520 &&
      item.x < 560 &&
      Math.abs(item.y - qtyY) <= 1.2
    )
    .sort((a, b) => a.x - b.x)
    .map((item) => item.text);

  return normalize(locationParts.join(' '));
}

function parseRows(pages) {
  const output = [];
  let sortOrder = 0;

  for (const pageItems of pages) {
    const items = pageItems;
    const codes = items
      .filter(isCodeCandidate)
      .sort((a, b) => a.y - b.y);

    const quantities = items.filter(isQtyToken);

    for (let index = 0; index < codes.length; index += 1) {
      const codeItem = codes[index];
      const nextCodeY = codes[index + 1]?.y ?? Number.POSITIVE_INFINITY;

      // The quantity is normally 3.7 points below the code. A 5.5 point
      // window safely covers the different PDF renderings without jumping to
      // the previous/next article row.
      const candidates = quantities
        .filter((item) => Math.abs(item.y - codeItem.y) <= 5.5)
        .sort((a, b) => Math.abs(a.y - codeItem.y) - Math.abs(b.y - codeItem.y));

      if (!candidates.length) continue;

      const qtyY = candidates[0].y;
      const qtyTokens = quantities.filter((item) => Math.abs(item.y - qtyY) <= 0.8);
      const requestedQty = parseQuantityToken(qtyTokens);
      if (requestedQty === null) continue;

      const code = codeItem.text.toUpperCase();
      const designation = getDesignation(items, codeItem, nextCodeY);
      const location = getLocation(items, qtyY);
      const isInfo =
        INFO_CODES.has(code) ||
        INFO_PREFIXES.some((prefix) => code.startsWith(prefix)) ||
        /EN ATTENTE DE COTE/i.test(designation);

      output.push({
        code,
        designation,
        requestedQty,
        preparedQty: 0,
        location,
        isPreparable: !isInfo,
        sortOrder: sortOrder++
      });
    }
  }

  return output;
}

function parseHeader(text) {
  const compact = text.replace(/\r/g, '');
  const orderMatch = compact.match(/n°\s*([0-9]{4,})/i);
  const refMatch = compact.match(/Réf\.\s*Interne\s*:\s*([^\n]+)/i);
  const pickupMatch = compact.match(/Enlèvement\s*:\s*([0-9]{2}\/\s*[0-9]{2}\/\s*[0-9]{2,4})/i);
  const clientMatch = compact.match(/Client\s*:\s*[^\n]+\n([^\n]+)/i);

  return {
    orderNumber: orderMatch?.[1] || `IMPORT-${Date.now()}`,
    internalReference: normalize(refMatch?.[1] || ''),
    pickupDate: normalize(pickupMatch?.[1] || ''),
    client: normalize(clientMatch?.[1] || '')
  };
}

export async function parseProductionPdf(buffer) {
  const result = await pdfParse(buffer, { pagerender: renderPage });
  const header = parseHeader(result.text);

  const pages = [];
  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const items = await renderPage(pageData);
      pages.push(items);
      return items.map((item) => JSON.stringify(item)).join('\n');
    }
  });

  const items = parseRows(pages);

  return {
    ...header,
    items,
    rawTextLength: result.text.length
  };
}
