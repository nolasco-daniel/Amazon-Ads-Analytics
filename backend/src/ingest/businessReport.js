// Ingests an Amazon "Business Report — Detail Page Sales and Traffic" export
// (CSV/TSV) into SQLite. Column wording varies by marketplace, so headers are
// matched fuzzily. Rows are keyed by the report's period-end date so repeated
// uploads build up history for trend analysis.
//
// Imports the shared db connection from db.js (does not modify db.js).

import db from '../db.js';
import { parseDelimited } from './csv.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS business_report_daily (
    date        TEXT NOT NULL,
    profile_id  TEXT NOT NULL,
    asin        TEXT NOT NULL DEFAULT '',
    sku         TEXT NOT NULL DEFAULT '',
    title       TEXT,
    sessions    INTEGER DEFAULT 0,
    page_views  INTEGER DEFAULT 0,
    buy_box_pct REAL DEFAULT 0,   -- fraction 0..1
    units       INTEGER DEFAULT 0,
    sales       REAL DEFAULT 0,
    conversion  REAL DEFAULT 0,   -- unit-session %, fraction 0..1
    PRIMARY KEY (date, profile_id, asin, sku)
  );
`);

const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function findHeader(headers, test) {
  return headers.find((h) => test(norm(h)));
}

// Parse a numeric cell, stripping currency symbols, thousands separators, %, etc.
function toNumber(v) {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
const toFraction = (v) => toNumber(v) / 100; // "12.5%" -> 0.125

// Resolve which actual header maps to each field we care about.
function mapColumns(headers) {
  return {
    asin: findHeader(headers, (h) => h.includes('childasin'))
      || findHeader(headers, (h) => h.includes('asin')),
    sku: findHeader(headers, (h) => h.includes('sku')),
    title: findHeader(headers, (h) => h.includes('title')),
    sessions: findHeader(headers, (h) => h.includes('sessions') && h.includes('total'))
      || findHeader(headers, (h) => h.startsWith('sessions')),
    pageViews: findHeader(headers, (h) => h.includes('pageviews') && h.includes('total'))
      || findHeader(headers, (h) => h.startsWith('pageviews')),
    buyBox: findHeader(headers, (h) => h.includes('buybox')),
    units: findHeader(headers, (h) => h.includes('unitsordered') && !h.includes('b2b')),
    sales: findHeader(headers, (h) => h.includes('orderedproductsales') && !h.includes('b2b')),
    conversion: findHeader(headers, (h) => h.includes('unitsessionpercentage') && !h.includes('b2b')),
  };
}

export function ingestBusinessReport(text, { profileId, date }) {
  const { headers, rows } = parseDelimited(text);
  if (headers.length === 0) {
    return { ok: false, ingested: 0, warnings: ['File is empty or could not be parsed.'] };
  }

  const col = mapColumns(headers);
  const warnings = [];
  if (!col.asin && !col.sku) warnings.push('No ASIN or SKU column found — cannot identify products.');
  if (!col.sessions) warnings.push('No Sessions column found — traffic/conversion insights will be limited.');
  if (!col.sales) warnings.push('No Ordered Product Sales column found — revenue insights will be limited.');

  const records = [];
  for (const r of rows) {
    const asin = col.asin ? r[col.asin] : '';
    const sku = col.sku ? r[col.sku] : '';
    if (!asin && !sku) continue;
    records.push({
      asin, sku,
      title: col.title ? r[col.title] : null,
      sessions: Math.round(toNumber(col.sessions && r[col.sessions])),
      pageViews: Math.round(toNumber(col.pageViews && r[col.pageViews])),
      buyBox: col.buyBox ? toFraction(r[col.buyBox]) : 0,
      units: Math.round(toNumber(col.units && r[col.units])),
      sales: toNumber(col.sales && r[col.sales]),
      conversion: col.conversion ? toFraction(r[col.conversion]) : 0,
    });
  }

  const ingested = upsertBusinessRows(records, profileId, date);
  return {
    ok: true,
    ingested,
    date,
    columnsMatched: Object.fromEntries(Object.entries(col).map(([k, v]) => [k, v || null])),
    warnings,
  };
}

function upsertBusinessRows(records, profileId, date) {
  const stmt = db.prepare(`
    INSERT INTO business_report_daily
      (date, profile_id, asin, sku, title, sessions, page_views, buy_box_pct, units, sales, conversion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, profile_id, asin, sku) DO UPDATE SET
      title       = excluded.title,
      sessions    = excluded.sessions,
      page_views  = excluded.page_views,
      buy_box_pct = excluded.buy_box_pct,
      units       = excluded.units,
      sales       = excluded.sales,
      conversion  = excluded.conversion;
  `);

  db.exec('BEGIN');
  try {
    for (const r of records) {
      stmt.run(
        String(date), String(profileId), String(r.asin || ''), String(r.sku || ''),
        r.title ?? null, r.sessions, r.pageViews, r.buyBox, r.units, r.sales, r.conversion,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return records.length;
}

// Per-product units and sales over a window — used to estimate sales velocity
// for inventory forecasting.
export function getProductUnits(profileId, from, to) {
  return db.prepare(`
    SELECT asin, sku,
      COALESCE(SUM(units),0) AS units,
      COALESCE(SUM(sales),0) AS sales
    FROM business_report_daily
    WHERE profile_id = ? AND date BETWEEN ? AND ?
    GROUP BY asin, sku;
  `).all(String(profileId), from, to);
}

// Per-product metrics over a window — used for product-level date-range
// comparison (sessions/units/sales per ASIN+SKU).
export function getProductMetrics(profileId, from, to) {
  return db.prepare(`
    SELECT asin, sku,
      COALESCE(SUM(sessions),0) AS sessions,
      COALESCE(SUM(units),0)    AS units,
      COALESCE(SUM(sales),0)    AS sales
    FROM business_report_daily
    WHERE profile_id = ? AND date BETWEEN ? AND ?
    GROUP BY asin, sku;
  `).all(String(profileId), from, to);
}

// Aggregate business metrics over a window. Buy Box is session-weighted so
// high-traffic products count more than low-traffic ones.
export function getBusinessSummary(profileId, from, to) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(sessions),0)   AS sessions,
      COALESCE(SUM(page_views),0) AS page_views,
      COALESCE(SUM(units),0)      AS units,
      COALESCE(SUM(sales),0)      AS sales,
      SUM(buy_box_pct * sessions) / NULLIF(SUM(sessions), 0) AS buy_box_pct
    FROM business_report_daily
    WHERE profile_id = ? AND date BETWEEN ? AND ?;
  `).get(String(profileId), from, to);
}
