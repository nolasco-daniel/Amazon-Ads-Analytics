// Minimal delimiter-separated parser for Amazon report exports (CSV or TSV).
// Handles quoted fields, embedded delimiters, escaped quotes ("") and CRLF.
// No external dependencies — Seller Central exports are plain text.

export function parseDelimited(text) {
  const clean = String(text).replace(/^﻿/, ''); // strip BOM
  const delimiter = pickDelimiter(clean);
  const records = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      records.push(row); row = [];
    } else if (ch === '\r') {
      // ignore; the following \n closes the row
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); records.push(row); }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
    return obj;
  });
  return { headers, rows };
}

// Guess the delimiter from the header line: tabs win over commas.
function pickDelimiter(text) {
  const end = text.indexOf('\n');
  const firstLine = end === -1 ? text : text.slice(0, end);
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs > commas ? '\t' : ',';
}
