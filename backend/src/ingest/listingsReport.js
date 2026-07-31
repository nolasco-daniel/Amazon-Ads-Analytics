// Ingests a Product Listings export (CSV/TSV) into SQLite, capturing signals of
// listing quality: title length, number of images, number of bullet points, and
// whether a description exists. Fields that the export doesn't contain are stored
// as NULL (unknown) so the agent only judges what it can actually see.
//
// Imports the shared db connection from db.js (does not modify db.js).

import db from '../db.js';
import { parseDelimited } from './csv.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS product_listings (
    date            TEXT NOT NULL,
    profile_id      TEXT NOT NULL,
    sku             TEXT NOT NULL DEFAULT '',
    asin            TEXT NOT NULL DEFAULT '',
    title           TEXT,
    title_len       INTEGER,
    images          INTEGER,
    bullets         INTEGER,
    has_description INTEGER,
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
    sku: findHeader(headers, (h) => h === 'sku' || (h.includes('sku') && !h.includes('fnsku'))),
    asin: findHeader(headers, (h) => h.includes('asin')),
    title: findHeader(headers, (h) => h.includes('title') || h.includes('itemname') || h.includes('productname')),
    description: findHeader(headers, (h) => h.includes('description')),
    imageCount: findHeader(headers, (h) => h.includes('imagecount') || h.includes('numberofimages')),
    bulletCount: findHeader(headers, (h) => h.includes('bulletpointcount') || h.includes('bulletcount')),
    // Amazon flat files often have bullet-point1..5 and multiple image-url columns.
    bulletCols: headers.filter((h) => norm(h).includes('bulletpoint')),
    imageCols: headers.filter((h) => norm(h).includes('image') && norm(h).includes('url')),
  };
}

const countNonEmpty = (row, cols) => cols.reduce((n, c) => n + (String(row[c] ?? '').trim() ? 1 : 0), 0);

export function ingestListingsReport(text, { profileId, date }) {
  const { headers, rows } = parseDelimited(text);
  if (headers.length === 0) {
    return { ok: false, ingested: 0, warnings: ['File is empty or could not be parsed.'] };
  }

  const col = mapColumns(headers);
  const warnings = [];
  if (!col.sku && !col.asin) warnings.push('No SKU or ASIN column found — cannot identify products.');
  if (!col.title && !col.imageCount && col.bulletCols.length === 0) {
    warnings.push('No title/image/bullet columns found — listing-quality insights will be limited.');
  }

  const knowsImages = !!col.imageCount || col.imageCols.length > 0;
  const knowsBullets = !!col.bulletCount || col.bulletCols.length > 0;

  const records = [];
  for (const r of rows) {
    const sku = col.sku ? r[col.sku] : '';
    const asin = col.asin ? r[col.asin] : '';
    if (!sku && !asin) continue;
    const title = col.title ? String(r[col.title] ?? '') : '';
    records.push({
      sku, asin, title: title || null,
      titleLen: col.title ? title.trim().length : null,
      images: knowsImages
        ? (col.imageCount ? Math.round(toNumber(r[col.imageCount])) : countNonEmpty(r, col.imageCols))
        : null,
      bullets: knowsBullets
        ? (col.bulletCount ? Math.round(toNumber(r[col.bulletCount])) : countNonEmpty(r, col.bulletCols))
        : null,
      hasDescription: col.description ? (String(r[col.description] ?? '').trim() ? 1 : 0) : null,
    });
  }

  const ingested = upsertListingRows(records, profileId, date);
  return {
    ok: true,
    ingested,
    date,
    columnsMatched: {
      sku: col.sku || null, asin: col.asin || null, title: col.title || null,
      images: knowsImages ? (col.imageCount || `${col.imageCols.length} image columns`) : null,
      bullets: knowsBullets ? (col.bulletCount || `${col.bulletCols.length} bullet columns`) : null,
    },
    warnings,
  };
}

function upsertListingRows(records, profileId, date) {
  const stmt = db.prepare(`
    INSERT INTO product_listings (date, profile_id, sku, asin, title, title_len, images, bullets, has_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, profile_id, sku, asin) DO UPDATE SET
      title           = excluded.title,
      title_len       = excluded.title_len,
      images          = excluded.images,
      bullets         = excluded.bullets,
      has_description = excluded.has_description;
  `);

  db.exec('BEGIN');
  try {
    for (const r of records) {
      stmt.run(
        String(date), String(profileId), String(r.sku || ''), String(r.asin || ''),
        r.title ?? null, r.titleLen, r.images, r.bullets, r.hasDescription,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return records.length;
}

// Most recent listings snapshot on or before `asOf` (for the agent to use).
export function getLatestListings(profileId, asOf) {
  return db.prepare(`
    SELECT sku, asin, title, title_len, images, bullets, has_description
    FROM product_listings
    WHERE profile_id = ? AND date = (
      SELECT MAX(date) FROM product_listings WHERE profile_id = ? AND date <= ?
    );
  `).all(String(profileId), String(profileId), asOf);
}
