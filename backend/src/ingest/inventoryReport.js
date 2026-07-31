// Ingests an Amazon FBA / Manage Inventory report export (CSV/TSV) into SQLite.
// Column wording varies by report type, so headers are matched fuzzily. Rows are
// keyed by the snapshot date so the latest stock position can be looked up later.
//
// Imports the shared db connection from db.js (does not modify db.js).

import db from '../db.js';
import { parseDelimited } from './csv.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS inventory_snapshot (
    date           TEXT NOT NULL,
    profile_id     TEXT NOT NULL,
    sku            TEXT NOT NULL DEFAULT '',
    asin           TEXT NOT NULL DEFAULT '',
    title          TEXT,
    available      INTEGER DEFAULT 0,
    inbound        INTEGER DEFAULT 0,
    reserved       INTEGER DEFAULT 0,
    days_of_supply REAL,
    price          REAL DEFAULT 0,
    PRIMARY KEY (date, profile_id, sku, asin)
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
    // "sku" but not "fnsku" (which also contains "sku").
    sku: findHeader(headers, (h) => h === 'sku' || (h.includes('sku') && !h.includes('fnsku'))),
    asin: findHeader(headers, (h) => h.includes('asin')),
    title: findHeader(headers, (h) => h.includes('productname') || h.includes('title')),
    available: findHeader(headers, (h) => h.includes('afnfulfillablequantity'))
      || findHeader(headers, (h) => h.includes('available') && h.includes('quantity'))
      || findHeader(headers, (h) => h === 'available'),
    inbound: findHeader(headers, (h) => h.includes('inboundshipped'))
      || findHeader(headers, (h) => h.includes('inbound') && h.includes('quantity'))
      || findHeader(headers, (h) => h.includes('inbound')),
    reserved: findHeader(headers, (h) => h.includes('reserved')),
    daysOfSupply: findHeader(headers, (h) => h.includes('daysofsupply')),
    price: findHeader(headers, (h) => h.includes('yourprice'))
      || findHeader(headers, (h) => h === 'price'),
  };
}

export function ingestInventoryReport(text, { profileId, date }) {
  const { headers, rows } = parseDelimited(text);
  if (headers.length === 0) {
    return { ok: false, ingested: 0, warnings: ['File is empty or could not be parsed.'] };
  }

  const col = mapColumns(headers);
  const warnings = [];
  if (!col.sku && !col.asin) warnings.push('No SKU or ASIN column found — cannot identify products.');
  if (!col.available) warnings.push('No available-quantity column found — stock levels will be unavailable.');

  const records = [];
  for (const r of rows) {
    const sku = col.sku ? r[col.sku] : '';
    const asin = col.asin ? r[col.asin] : '';
    if (!sku && !asin) continue;
    records.push({
      sku, asin,
      title: col.title ? r[col.title] : null,
      available: Math.round(toNumber(col.available && r[col.available])),
      inbound: Math.round(toNumber(col.inbound && r[col.inbound])),
      reserved: Math.round(toNumber(col.reserved && r[col.reserved])),
      daysOfSupply: col.daysOfSupply ? toNumber(r[col.daysOfSupply]) : null,
      price: toNumber(col.price && r[col.price]),
    });
  }

  const ingested = upsertInventoryRows(records, profileId, date);
  return {
    ok: true,
    ingested,
    date,
    columnsMatched: Object.fromEntries(Object.entries(col).map(([k, v]) => [k, v || null])),
    warnings,
  };
}

function upsertInventoryRows(records, profileId, date) {
  const stmt = db.prepare(`
    INSERT INTO inventory_snapshot
      (date, profile_id, sku, asin, title, available, inbound, reserved, days_of_supply, price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, profile_id, sku, asin) DO UPDATE SET
      title          = excluded.title,
      available      = excluded.available,
      inbound        = excluded.inbound,
      reserved       = excluded.reserved,
      days_of_supply = excluded.days_of_supply,
      price          = excluded.price;
  `);

  db.exec('BEGIN');
  try {
    for (const r of records) {
      stmt.run(
        String(date), String(profileId), String(r.sku || ''), String(r.asin || ''),
        r.title ?? null, r.available, r.inbound, r.reserved, r.daysOfSupply, r.price,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return records.length;
}

// The most recent inventory snapshot on or before `asOf` (for the agent to use).
export function getLatestInventory(profileId, asOf) {
  return db.prepare(`
    SELECT sku, asin, title, available, inbound, reserved, days_of_supply, price
    FROM inventory_snapshot
    WHERE profile_id = ? AND date = (
      SELECT MAX(date) FROM inventory_snapshot WHERE profile_id = ? AND date <= ?
    );
  `).all(String(profileId), String(profileId), asOf);
}
