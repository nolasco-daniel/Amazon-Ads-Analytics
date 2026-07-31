// Ingests an Amazon Orders report ("All Orders" / order report) export (CSV/TSV)
// into SQLite, aggregating line items into daily totals: order count, units, and
// revenue by purchase date. Cancelled lines are skipped.
//
// Imports the shared db connection from db.js (does not modify db.js).

import db from '../db.js';
import { parseDelimited } from './csv.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS orders_daily (
    date       TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    orders     INTEGER DEFAULT 0,
    units      INTEGER DEFAULT 0,
    sales      REAL DEFAULT 0,
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
    date: findHeader(headers, (h) => h.includes('purchasedate'))
      || findHeader(headers, (h) => h.includes('purchase') && h.includes('date')),
    orderId: findHeader(headers, (h) => h.includes('amazonorderid'))
      || findHeader(headers, (h) => h.includes('orderid')),
    quantity: findHeader(headers, (h) => h.includes('quantity')),
    price: findHeader(headers, (h) => h.includes('itemprice'))
      || findHeader(headers, (h) => h === 'price' || (h.includes('price') && !h.includes('per'))),
    status: findHeader(headers, (h) => h.includes('orderstatus') || h.includes('itemstatus')),
  };
}

export function ingestOrdersReport(text, { profileId, date }) {
  const { headers, rows } = parseDelimited(text);
  if (headers.length === 0) {
    return { ok: false, ingested: 0, warnings: ['File is empty or could not be parsed.'] };
  }

  const col = mapColumns(headers);
  const warnings = [];
  if (!col.date) warnings.push('No purchase-date column found — orders will all be dated to the upload date.');
  if (!col.price && !col.quantity) warnings.push('No price or quantity column found — order revenue/units will be limited.');

  // Aggregate per day: distinct order ids, unit sum, revenue sum.
  const byDate = new Map();
  const bucket = (d) => {
    if (!byDate.has(d)) byDate.set(d, { orderIds: new Set(), units: 0, sales: 0 });
    return byDate.get(d);
  };

  for (const r of rows) {
    const status = col.status ? String(r[col.status]) : '';
    if (/cancel/i.test(status)) continue; // skip cancelled lines
    const day = (col.date ? String(r[col.date]).slice(0, 10) : '') || date;
    const b = bucket(day);
    if (col.orderId && r[col.orderId]) b.orderIds.add(r[col.orderId]);
    b.units += Math.round(toNumber(col.quantity && r[col.quantity]));
    b.sales += toNumber(col.price && r[col.price]);
  }

  const ingested = upsertOrderDays(byDate, profileId);
  return {
    ok: true,
    ingested,
    days: byDate.size,
    columnsMatched: Object.fromEntries(Object.entries(col).map(([k, v]) => [k, v || null])),
    warnings,
  };
}

function upsertOrderDays(byDate, profileId) {
  const stmt = db.prepare(`
    INSERT INTO orders_daily (date, profile_id, orders, units, sales)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date, profile_id) DO UPDATE SET
      orders = excluded.orders,
      units  = excluded.units,
      sales  = excluded.sales;
  `);

  db.exec('BEGIN');
  try {
    for (const [day, b] of byDate) {
      const orders = b.orderIds.size || 0;
      stmt.run(String(day), String(profileId), orders, b.units, b.sales);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return byDate.size;
}

// Aggregate order totals over a window (for the agent to use).
export function getOrdersSummary(profileId, from, to) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(orders),0) AS orders,
      COALESCE(SUM(units),0)  AS units,
      COALESCE(SUM(sales),0)  AS sales
    FROM orders_daily
    WHERE profile_id = ? AND date BETWEEN ? AND ?;
  `).get(String(profileId), from, to);
}
