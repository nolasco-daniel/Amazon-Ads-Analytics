import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'ads.sqlite'));

// One row per campaign per day. Re-pulling a day overwrites it (attribution updates).
db.exec(`
  CREATE TABLE IF NOT EXISTS sp_campaign_daily (
    date         TEXT    NOT NULL,
    profile_id   TEXT    NOT NULL,
    campaign_id  TEXT    NOT NULL,
    campaign_name TEXT,
    impressions  INTEGER DEFAULT 0,
    clicks       INTEGER DEFAULT 0,
    cost         REAL    DEFAULT 0,
    purchases    INTEGER DEFAULT 0,
    sales        REAL    DEFAULT 0,
    PRIMARY KEY (date, profile_id, campaign_id)
  );
`);

// One row per (search term × matched keyword × campaign) per day.
db.exec(`
  CREATE TABLE IF NOT EXISTS sp_searchterm_daily (
    date         TEXT NOT NULL,
    profile_id   TEXT NOT NULL,
    campaign_id  TEXT NOT NULL,
    campaign_name TEXT,
    ad_group_id  TEXT NOT NULL DEFAULT '',
    keyword      TEXT NOT NULL DEFAULT '',
    match_type   TEXT NOT NULL DEFAULT '',
    search_term  TEXT NOT NULL DEFAULT '',
    impressions  INTEGER DEFAULT 0,
    clicks       INTEGER DEFAULT 0,
    cost         REAL    DEFAULT 0,
    purchases    INTEGER DEFAULT 0,
    sales        REAL    DEFAULT 0,
    PRIMARY KEY (date, profile_id, campaign_id, ad_group_id, keyword, match_type, search_term)
  );
`);

export function upsertSearchTermRows(rows, profileId) {
  const stmt = db.prepare(`
    INSERT INTO sp_searchterm_daily
      (date, profile_id, campaign_id, campaign_name, ad_group_id, keyword, match_type,
       search_term, impressions, clicks, cost, purchases, sales)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, profile_id, campaign_id, ad_group_id, keyword, match_type, search_term)
    DO UPDATE SET
      campaign_name = excluded.campaign_name,
      impressions   = excluded.impressions,
      clicks        = excluded.clicks,
      cost          = excluded.cost,
      purchases     = excluded.purchases,
      sales         = excluded.sales;
  `);

  db.exec('BEGIN');
  try {
    for (const r of rows) {
      stmt.run(
        String(r.date),
        String(profileId),
        String(r.campaignId ?? ''),
        r.campaignName ?? null,
        String(r.adGroupId ?? ''),
        String(r.keyword ?? ''),
        String(r.matchType ?? ''),
        String(r.searchTerm ?? ''),
        Number(r.impressions ?? 0),
        Number(r.clicks ?? 0),
        Number(r.cost ?? 0),
        Number(r.purchases7d ?? r.purchases ?? 0),
        Number(r.sales7d ?? r.sales ?? 0),
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return rows.length;
}

// Aggregate search terms over a window. `onlyWasted` returns terms that got
// clicks but produced zero sales — the prime negative-keyword candidates.
export function getSearchTerms(profileId, from, to, { onlyWasted = false, limit = 100 } = {}) {
  const having = onlyWasted ? 'HAVING SUM(sales) = 0 AND SUM(clicks) > 0' : '';
  return db.prepare(`
    SELECT search_term, keyword, match_type,
      SUM(cost)        AS cost,
      SUM(sales)       AS sales,
      SUM(clicks)      AS clicks,
      SUM(impressions) AS impressions,
      SUM(purchases)   AS purchases
    FROM sp_searchterm_daily
    WHERE profile_id = ? AND date BETWEEN ? AND ?
    GROUP BY search_term, keyword, match_type
    ${having}
    ORDER BY cost DESC
    LIMIT ?;
  `).all(String(profileId), from, to, limit);
}

export function upsertCampaignRows(rows, profileId) {
  const stmt = db.prepare(`
    INSERT INTO sp_campaign_daily
      (date, profile_id, campaign_id, campaign_name, impressions, clicks, cost, purchases, sales)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, profile_id, campaign_id) DO UPDATE SET
      campaign_name = excluded.campaign_name,
      impressions   = excluded.impressions,
      clicks        = excluded.clicks,
      cost          = excluded.cost,
      purchases     = excluded.purchases,
      sales         = excluded.sales;
  `);

  db.exec('BEGIN');
  try {
    for (const r of rows) {
      stmt.run(
        String(r.date),
        String(profileId),
        String(r.campaignId),
        r.campaignName ?? null,
        Number(r.impressions ?? 0),
        Number(r.clicks ?? 0),
        Number(r.cost ?? 0),
        Number(r.purchases7d ?? r.purchases ?? 0),
        Number(r.sales7d ?? r.sales ?? 0),
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return rows.length;
}

export function getKpis(profileId, from, to) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(cost),0)        AS cost,
      COALESCE(SUM(sales),0)       AS sales,
      COALESCE(SUM(clicks),0)      AS clicks,
      COALESCE(SUM(impressions),0) AS impressions,
      COALESCE(SUM(purchases),0)   AS purchases
    FROM sp_campaign_daily
    WHERE profile_id = ? AND date BETWEEN ? AND ?;
  `).get(String(profileId), from, to);
}

export function getDailySeries(profileId, from, to) {
  return db.prepare(`
    SELECT date,
      SUM(cost)        AS cost,
      SUM(sales)       AS sales,
      SUM(clicks)      AS clicks,
      SUM(impressions) AS impressions,
      SUM(purchases)   AS purchases
    FROM sp_campaign_daily
    WHERE profile_id = ? AND date BETWEEN ? AND ?
    GROUP BY date ORDER BY date;
  `).all(String(profileId), from, to);
}

export function getCampaignBreakdown(profileId, from, to) {
  return db.prepare(`
    SELECT campaign_id, campaign_name,
      SUM(cost)        AS cost,
      SUM(sales)       AS sales,
      SUM(clicks)      AS clicks,
      SUM(impressions) AS impressions,
      SUM(purchases)   AS purchases
    FROM sp_campaign_daily
    WHERE profile_id = ? AND date BETWEEN ? AND ?
    GROUP BY campaign_id, campaign_name
    ORDER BY cost DESC;
  `).all(String(profileId), from, to);
}

// Tracks async report requests so we can collect them later (even after a
// restart) instead of blocking on a single long poll that might time out.
db.exec(`
  CREATE TABLE IF NOT EXISTS report_jobs (
    report_id    TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,           -- 'campaigns' | 'searchterms'
    status       TEXT NOT NULL,           -- 'PENDING' | 'DONE' | 'FAILED'
    requested_at TEXT NOT NULL
  );
`);

export function addReportJob(reportId, kind, requestedAt) {
  db.prepare(
    `INSERT OR REPLACE INTO report_jobs (report_id, kind, status, requested_at) VALUES (?, ?, 'PENDING', ?)`
  ).run(reportId, kind, requestedAt);
}

export function getPendingJobs() {
  return db.prepare(
    `SELECT report_id, kind FROM report_jobs WHERE status = 'PENDING' ORDER BY requested_at`
  ).all();
}

export function markJob(reportId, status) {
  db.prepare(`UPDATE report_jobs SET status = ? WHERE report_id = ?`).run(status, reportId);
}

export default db;
