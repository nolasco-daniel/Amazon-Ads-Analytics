// Ingests a customer reviews / ratings export (CSV/TSV) into SQLite, storing an
// average rating and review count per product. Handles two shapes:
//   - one row per review (a 1-5 "rating" column)      -> averaged, counted
//   - one row per product (an average-rating + count) -> used directly
//
// Imports the shared db connection from db.js (does not modify db.js).

import db from '../db.js';
import { parseDelimited } from './csv.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS product_reviews (
    date        TEXT NOT NULL,
    profile_id  TEXT NOT NULL,
    asin        TEXT NOT NULL DEFAULT '',
    sku         TEXT NOT NULL DEFAULT '',
    title       TEXT,
    avg_rating  REAL,
    num_reviews INTEGER DEFAULT 0,
    PRIMARY KEY (date, profile_id, asin, sku)
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
    asin: findHeader(headers, (h) => h.includes('asin')),
    sku: findHeader(headers, (h) => h === 'sku' || (h.includes('sku') && !h.includes('fnsku'))),
    title: findHeader(headers, (h) => h.includes('productname') || h.includes('title')),
    // A per-product average, if the export provides one.
    avgRating: findHeader(headers, (h) => h.includes('averagerating') || h.includes('avgrating') || h.includes('starrating')),
    // A single review's star rating (per-review exports).
    rating: findHeader(headers, (h) => h === 'rating' || (h.includes('rating') && !h.includes('count') && !h.includes('number'))),
    numReviews: findHeader(headers, (h) => h.includes('reviewcount') || h.includes('ratingscount')
      || (h.includes('reviews') && (h.includes('count') || h.includes('number')))
      || h.includes('numberofreviews')),
  };
}

export function ingestReviewsReport(text, { profileId, date }) {
  const { headers, rows } = parseDelimited(text);
  if (headers.length === 0) {
    return { ok: false, ingested: 0, warnings: ['File is empty or could not be parsed.'] };
  }

  const col = mapColumns(headers);
  const warnings = [];
  if (!col.asin && !col.sku) warnings.push('No ASIN or SKU column found — cannot identify products.');
  if (!col.avgRating && !col.rating) warnings.push('No rating column found — review insights will be unavailable.');

  // Accumulate per product: sum/count of per-review ratings, plus any provided
  // average and review count.
  const acc = new Map();
  const keyOf = (asin, sku) => `${asin}||${sku}`;
  for (const r of rows) {
    const asin = col.asin ? r[col.asin] : '';
    const sku = col.sku ? r[col.sku] : '';
    if (!asin && !sku) continue;
    const k = keyOf(asin, sku);
    if (!acc.has(k)) {
      acc.set(k, { asin, sku, title: col.title ? r[col.title] : null, ratingSum: 0, ratingN: 0, avgProvided: null, countProvided: 0 });
    }
    const a = acc.get(k);
    if (col.rating && r[col.rating] !== '') {
      a.ratingSum += toNumber(r[col.rating]);
      a.ratingN += 1;
    }
    if (col.avgRating && r[col.avgRating] !== '') a.avgProvided = toNumber(r[col.avgRating]);
    if (col.numReviews && r[col.numReviews] !== '') a.countProvided = Math.max(a.countProvided, Math.round(toNumber(r[col.numReviews])));
  }

  const records = [...acc.values()].map((a) => ({
    asin: a.asin,
    sku: a.sku,
    title: a.title,
    // Prefer a provided average; otherwise average the per-review ratings.
    avgRating: a.avgProvided != null ? a.avgProvided : (a.ratingN > 0 ? a.ratingSum / a.ratingN : null),
    numReviews: a.countProvided || a.ratingN,
  }));

  const ingested = upsertReviewRows(records, profileId, date);
  return {
    ok: true,
    ingested,
    date,
    columnsMatched: Object.fromEntries(Object.entries(col).map(([k, v]) => [k, v || null])),
    warnings,
  };
}

function upsertReviewRows(records, profileId, date) {
  const stmt = db.prepare(`
    INSERT INTO product_reviews (date, profile_id, asin, sku, title, avg_rating, num_reviews)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, profile_id, asin, sku) DO UPDATE SET
      title       = excluded.title,
      avg_rating  = excluded.avg_rating,
      num_reviews = excluded.num_reviews;
  `);

  db.exec('BEGIN');
  try {
    for (const r of records) {
      stmt.run(
        String(date), String(profileId), String(r.asin || ''), String(r.sku || ''),
        r.title ?? null, r.avgRating, r.numReviews,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return records.length;
}

// Most recent reviews snapshot on or before `asOf` (for the agent to use).
export function getLatestReviews(profileId, asOf) {
  return db.prepare(`
    SELECT asin, sku, title, avg_rating, num_reviews
    FROM product_reviews
    WHERE profile_id = ? AND date = (
      SELECT MAX(date) FROM product_reviews WHERE profile_id = ? AND date <= ?
    );
  `).all(String(profileId), String(profileId), asOf);
}
