import pdfParse from 'pdf-parse';

const CODE_RE = /^[A-Z0-9][A-Z0-9._/-]{3,}$/i;
const LOCATION_RE = /^[A-Z][0-9]{1,3}\s*[0-9]{2,4}$/i;

function normalize(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function roundY(y) {
  return Math.round(Number(y) * 2) / 2;
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

function groupRows(items) {
  const rows = [];
  for (const item of items) {
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 1.8);
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => row.items.sort((a, b) => a.x - b.x));
}

function parseHeader(text) {
  const compact = text.replace(/\r/g, '');
  const orderMatch = compact.match(/n°\s*([0-9]{4,})/i);
  const refMatch = compact.match(/Réf\.\s*Interne\s*:\s*([^\n]+)/i);
  const pickupMatch = compact.match(/Enlèvement\s*:\s*([0-9]{2}\/\s*[0-9]{2}\/\s*[0-9]{2,4})/i);
  const clientMatch = compact.match(/Client\s*:\s*[^\n]+\s*\n([^\n]+)/i);

  return {
    orderNumber: orderMatch?.[1] || `IMPORT-${Date.now()}`,
    internalReference: normalize(refMatch?.[1] || ''),
    pickupDate: normalize(pickupMatch?.[1] || ''),
    client: normalize(clientMatch?.[1] || '')
  };
}

function parseRows(pageRows) {
  const output = [];
  let sortOrder = 0;

  for (const row of pageRows) {
    const codeItem = row.find((item) => item.x < 70 && CODE_RE.test(item.text));
    if (!codeItem) continue;

    const code = codeItem.text.toUpperCase();
    const designationItem = row.find((item) => item.x >= 75 && item.x < 340);
    const qtyCandidates = row.filter((item) => item.x >= 330 && item.x < 430);
    const locationItem = row.find((item) => item.x >= 500 && item.x < 570 && LOCATION_RE.test(item.text));

    const qtyText = qtyCandidates.map((item) => item.text).find((text) => /^\d+$/.test(text));
    if (!qtyText) continue;

    const requestedQty = Math.max(0, Number(qtyText));
    if (!Number.isFinite(requestedQty)) continue;

    const designation = normalize(
      designationItem?.text || row
        .filter((item) => item.x >= 75 && item.x < 500)
        .map((item) => item.text)
        .join(' ')
    );

    const isInfo = code.startsWith('INFO') || /EN ATTENTE DE COTE/i.test(designation) || code === 'GTRANS';

    output.push({
      code,
      designation,
      requestedQty,
      preparedQty: 0,
      location: normalize(locationItem?.text || ''),
      isPreparable: !isInfo,
      sortOrder: sortOrder++
    });
  }

  return output;
}

export async function parseProductionPdf(buffer) {
  const result = await pdfParse(buffer, { pagerender: renderPage });
  const header = parseHeader(result.text);

  // The default text is useful for the header, while pagerender gives us
  // coordinates so the preparation quantity is read from the correct column.
  const pages = [];
  await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const items = await renderPage(pageData);
      pages.push(items);
      return items.map((item) => JSON.stringify(item)).join('\n');
    }
  });

  const rows = pages.flatMap((page) => groupRows(page));
  const items = parseRows(rows);

  return {
    ...header,
    items,
    rawTextLength: result.text.length
  };
}
