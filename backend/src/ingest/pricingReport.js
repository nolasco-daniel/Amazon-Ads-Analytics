// Ingests a pricing / competitive-price report export (CSV/TSV) into SQLite,
// storing your price alongside the Buy Box and lowest competitor price per
// product, so the agent can flag mispriced listings.
//
// Imports the shared db connection from db.js (does not modify db.js).

import db from '../db.js';
import { parseDelimited } from './csv.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS product_pricing (
    date          TEXT NOT NULL,
    profile_id    TEXT NOT NULL,
    sku           TEXT NOT NULL DEFAULT '',
    asin          TEXT NOT NULL DEFAULT '',
    title         TEXT,
    your_price    REAL,
    buy_box_price REAL,
    lowest_price  REAL,
    PRIMARY KEY (date, profile_id, sku, asin)
  );
`);

const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

function findHeader(headers, test) {
  return headers.find((h) => test(norm(h)));
}

// Parse a price cell; returns null for blank so "no data" differs from "$0".
function toPrice(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function mapColumns(headers) {
  return {
    sku: findHeader(headers, (h) => h === 'sku' || h.includes('sellersku')
      || (h.includes('sku') && !h.includes('fnsku'))),
    asin: findHeader(headers, (h) => h.includes('asin')),
    title: findHeader(headers, (h) => h.includes('productname') || h.includes('title') || h.includes('itemname')),
    yourPrice: findHeader(headers, (h) => h.includes('yourprice') || h.includes('sellingprice'))
      || findHeader(headers, (h) => h === 'price'),
    buyBoxPrice: findHeader(headers, (h) => h.includes('buyboxprice'))
      || findHeader(headers, (h) => h.includes('buybox') && h.includes('price')),
    lowestPrice: findHeader(headers, (h) => h.includes('lowestprice'))
      || findHeader(headers, (h) => h.includes('lowest') && h.includes('price')),
  };
}

export function ingestPricingReport(text, { profileId, date }) {
  const { headers, rows } = parseDelimited(text);
  if (headers.length === 0) {
    return { ok: false, ingested: 0, warnings: ['File is empty or could not be parsed.'] };
  }

  const col = mapColumns(headers);
  const warnings = [];
  if (!col.sku && !col.asin) warnings.push('No SKU or ASIN column found — cannot identify products.');
  if (!col.yourPrice) warnings.push('No price column found — pricing insights will be unavailable.');

  const records = [];
  for (const r of rows) {
    const sku = col.sku ? r[col.sku] : '';
    const asin = col.asin ? r[col.asin] : '';
    if (!sku && !asin) continue;
    records.push({
      sku, asin,
      title: col.title ? r[col.title] : null,
      yourPrice: col.yourPrice ? toPrice(r[col.yourPrice]) : null,
      buyBoxPrice: col.buyBoxPrice ? toPrice(r[col.buyBoxPrice]) : null,
      lowestPrice: col.lowestPrice ? toPrice(r[col.lowestPrice]) : null,
    });
  }

  const ingested = upsertPricingRows(records, profileId, date);
  return {
    ok: true,
    ingested,
    date,
    columnsMatched: Object.fromEntries(Object.entries(col).map(([k, v]) => [k, v || null])),
    warnings,
  };
}

function upsertPricingRows(records, profileId, date) {
  const stmt = db.prepare(`
    INSERT INTO product_pricing (date, profile_id, sku, asin, title, your_price, buy_box_price, lowest_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, profile_id, sku, asin) DO UPDATE SET
      title         = excluded.title,
      your_price    = excluded.your_price,
      buy_box_price = excluded.buy_box_price,
      lowest_price  = excluded.lowest_price;
  `);

  db.exec('BEGIN');
  try {
    for (const r of records) {
      stmt.run(
        String(date), String(profileId), String(r.sku || ''), String(r.asin || ''),
        r.title ?? null, r.yourPrice, r.buyBoxPrice, r.lowestPrice,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return records.length;
}

// Most recent pricing snapshot on or before `asOf` (for the agent to use).
export function getLatestPricing(profileId, asOf) {
  return db.prepare(`
    SELECT sku, asin, title, your_price, buy_box_price, lowest_price
    FROM product_pricing
    WHERE profile_id = ? AND date = (
      SELECT MAX(date) FROM product_pricing WHERE profile_id = ? AND date <= ?
    );
  `).all(String(profileId), String(profileId), asOf);
}
