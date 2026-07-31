// Ingests a Brand Analytics "Search Query Performance" export (CSV/TSV) into
// SQLite. Each row is a search query with funnel counts (impressions, clicks,
// purchases) split into the query total vs. your ASIN's share, which lets the
// agent spot high-volume queries where your share is low.
//
// Imports the shared db connection from db.js (does not modify db.js).

import db from '../db.js';
import { parseDelimited } from './csv.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS search_query_performance (
    date              TEXT NOT NULL,
    profile_id        TEXT NOT NULL,
    search_query      TEXT NOT NULL DEFAULT '',
    asin              TEXT NOT NULL DEFAULT '',
    volume            INTEGER DEFAULT 0,
    impressions_total INTEGER DEFAULT 0,
    impressions_asin  INTEGER DEFAULT 0,
    clicks_total      INTEGER DEFAULT 0,
    clicks_asin       INTEGER DEFAULT 0,
    purchases_total   INTEGER DEFAULT 0,
    purchases_asin    INTEGER DEFAULT 0,
    PRIMARY KEY (date, profile_id, search_query, asin)
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
  const countCol = (metric, scope) => findHeader(headers,
    (h) => h.includes(metric) && h.includes(scope) && h.includes('count'));
  return {
    searchQuery: findHeader(headers, (h) => h === 'searchquery'),
    asin: findHeader(headers, (h) => h === 'asin'),
    volume: findHeader(headers, (h) => h.includes('searchqueryvolume'))
      || findHeader(headers, (h) => h.includes('volume')),
    impressionsTotal: countCol('impressions', 'total'),
    impressionsAsin: countCol('impressions', 'asin'),
    clicksTotal: countCol('clicks', 'total'),
    clicksAsin: countCol('clicks', 'asin'),
    purchasesTotal: countCol('purchases', 'total'),
    purchasesAsin: countCol('purchases', 'asin'),
  };
}

export function ingestSearchQueryReport(text, { profileId, date }) {
  const { headers, rows } = parseDelimited(text);
  if (headers.length === 0) {
    return { ok: false, ingested: 0, warnings: ['File is empty or could not be parsed.'] };
  }

  const col = mapColumns(headers);
  const warnings = [];
  if (!col.searchQuery) warnings.push('No "Search Query" column found — this does not look like a Search Query Performance report.');
  if (!col.purchasesTotal && !col.clicksTotal) warnings.push('No funnel count columns found — search insights will be limited.');

  const num = (r, c) => Math.round(toNumber(c && r[c]));
  const records = [];
  for (const r of rows) {
    const search_query = col.searchQuery ? r[col.searchQuery] : '';
    if (!search_query) continue;
    records.push({
      search_query,
      asin: col.asin ? r[col.asin] : '',
      volume: num(r, col.volume),
      impressions_total: num(r, col.impressionsTotal),
      impressions_asin: num(r, col.impressionsAsin),
      clicks_total: num(r, col.clicksTotal),
      clicks_asin: num(r, col.clicksAsin),
      purchases_total: num(r, col.purchasesTotal),
      purchases_asin: num(r, col.purchasesAsin),
    });
  }

  const ingested = upsertRows(records, profileId, date);
  return {
    ok: true,
    ingested,
    date,
    columnsMatched: Object.fromEntries(Object.entries(col).map(([k, v]) => [k, v || null])),
    warnings,
  };
}

function upsertRows(records, profileId, date) {
  const stmt = db.prepare(`
    INSERT INTO search_query_performance
      (date, profile_id, search_query, asin, volume,
       impressions_total, impressions_asin, clicks_total, clicks_asin,
       purchases_total, purchases_asin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, profile_id, search_query, asin) DO UPDATE SET
      volume            = excluded.volume,
      impressions_total = excluded.impressions_total,
      impressions_asin  = excluded.impressions_asin,
      clicks_total      = excluded.clicks_total,
      clicks_asin       = excluded.clicks_asin,
      purchases_total   = excluded.purchases_total,
      purchases_asin    = excluded.purchases_asin;
  `);

  db.exec('BEGIN');
  try {
    for (const r of records) {
      stmt.run(
        String(date), String(profileId), String(r.search_query), String(r.asin || ''), r.volume,
        r.impressions_total, r.impressions_asin, r.clicks_total, r.clicks_asin,
        r.purchases_total, r.purchases_asin,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return records.length;
}

// Most recent search-query snapshot on or before `asOf` (for the agent to use).
export function getLatestSearchQueries(profileId, asOf) {
  return db.prepare(`
    SELECT search_query, asin, volume,
      impressions_total, impressions_asin, clicks_total, clicks_asin,
      purchases_total, purchases_asin
    FROM search_query_performance
    WHERE profile_id = ? AND date = (
      SELECT MAX(date) FROM search_query_performance WHERE profile_id = ? AND date <= ?
    );
  `).all(String(profileId), String(profileId), asOf);
}
