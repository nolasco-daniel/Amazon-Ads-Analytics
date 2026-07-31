// Ingests an Amazon settlement / transaction flat file (CSV/TSV) into SQLite,
// aggregating each line-item amount into daily P&L buckets: sales, refunds,
// fees, shipping and other. Combined later with ad spend to compute net profit.
//
// The settlement flat file has one row per amount (amount-type /
// amount-description / amount), so we classify and sum by posted-date.
//
// Imports the shared db connection from db.js (does not modify db.js).

import db from '../db.js';
import { parseDelimited } from './csv.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS finance_daily (
    date       TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    sales      REAL DEFAULT 0,   -- product principal on orders
    refunds    REAL DEFAULT 0,   -- principal refunded (positive)
    fees       REAL DEFAULT 0,   -- Amazon fees (positive cost)
    shipping   REAL DEFAULT 0,   -- net shipping charges
    other      REAL DEFAULT 0,   -- promotions, adjustments, etc. (signed)
    PRIMARY KEY (date, profile_id)
  );
`);

const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function findHeader(headers, test) {
  return headers.find((h) => test(norm(h)));
}

function toNumber(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function mapColumns(headers) {
  return {
    date: findHeader(headers, (h) => h === 'posteddate' || (h.includes('posted') && h.includes('date'))),
    txnType: findHeader(headers, (h) => h.includes('transactiontype')),
    amountType: findHeader(headers, (h) => h.includes('amounttype')),
    amountDesc: findHeader(headers, (h) => h.includes('amountdescription')),
    amount: findHeader(headers, (h) => h === 'amount'),
  };
}

// Which P&L bucket a settlement line belongs to.
function classify(amountType, desc) {
  const t = norm(amountType);
  const d = norm(desc);
  if (d.includes('principal')) return 'principal';
  if (d.includes('shipping')) return 'shipping';
  if (t.includes('fee') || d.includes('commission') || d.includes('fba')) return 'fee';
  return 'other';
}

export function ingestFinanceReport(text, { profileId, date }) {
  const { headers, rows } = parseDelimited(text);
  if (headers.length === 0) {
    return { ok: false, ingested: 0, warnings: ['File is empty or could not be parsed.'] };
  }

  const col = mapColumns(headers);
  const warnings = [];
  if (!col.amount) warnings.push('No amount column found — this does not look like a settlement report.');
  if (!col.amountDesc && !col.amountType) warnings.push('No amount-type/description column — fees and refunds cannot be classified.');

  // Aggregate into per-day buckets. Rows without a posted date fall back to the
  // upload date so nothing is silently dropped.
  const byDate = new Map();
  const bucket = (d) => {
    if (!byDate.has(d)) byDate.set(d, { sales: 0, refunds: 0, fees: 0, shipping: 0, other: 0 });
    return byDate.get(d);
  };

  for (const r of rows) {
    if (!col.amount) break;
    const amount = toNumber(r[col.amount]);
    if (amount === 0) continue;
    const day = (col.date ? String(r[col.date]).slice(0, 10) : '') || date;
    const kind = classify(col.amountType ? r[col.amountType] : '', col.amountDesc ? r[col.amountDesc] : '');
    const b = bucket(day);

    if (kind === 'principal') {
      if (amount >= 0) b.sales += amount;
      else b.refunds += -amount;
    } else if (kind === 'shipping') {
      b.shipping += amount;
    } else if (kind === 'fee') {
      b.fees += -amount; // fees are negative in the file → store as positive cost
    } else {
      b.other += amount;
    }
  }

  const ingested = upsertFinanceDays(byDate, profileId);
  return {
    ok: true,
    ingested,
    days: byDate.size,
    columnsMatched: Object.fromEntries(Object.entries(col).map(([k, v]) => [k, v || null])),
    warnings,
  };
}

function upsertFinanceDays(byDate, profileId) {
  const stmt = db.prepare(`
    INSERT INTO finance_daily (date, profile_id, sales, refunds, fees, shipping, other)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, profile_id) DO UPDATE SET
      sales    = excluded.sales,
      refunds  = excluded.refunds,
      fees     = excluded.fees,
      shipping = excluded.shipping,
      other    = excluded.other;
  `);

  db.exec('BEGIN');
  try {
    for (const [day, b] of byDate) {
      stmt.run(String(day), String(profileId), b.sales, b.refunds, b.fees, b.shipping, b.other);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return byDate.size;
}

// Aggregate finance buckets over a window (for the profitability analysis).
export function getFinanceSummary(profileId, from, to) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(sales),0)    AS sales,
      COALESCE(SUM(refunds),0)  AS refunds,
      COALESCE(SUM(fees),0)     AS fees,
      COALESCE(SUM(shipping),0) AS shipping,
      COALESCE(SUM(other),0)    AS other
    FROM finance_daily
    WHERE profile_id = ? AND date BETWEEN ? AND ?;
  `).get(String(profileId), from, to);
}
