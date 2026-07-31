// Search-query opportunity analysis: finds queries with real purchase demand
// where your ASIN captures only a small share of the funnel — the clearest
// growth opportunities. Also exposes impression/click/purchase share so a
// weak step in the funnel (seen but not clicked, clicked but not bought) shows.

import { getLatestSearchQueries } from '../ingest/searchQueryReport.js';

const LOW_SHARE = 0.5;       // capturing under half of a query's purchases = room to grow
const HIGH_OPPORTUNITY = 0.15; // capturing under 15% on real demand = high priority

const pctStr = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const share = (part, total) => (total > 0 ? part / total : null);

export function buildSearchOpportunities(profileId, asOf) {
  const rows = getLatestSearchQueries(profileId, asOf);
  if (!rows.length) {
    return { hasSearch: false, opportunities: [], recommendations: [] };
  }

  const items = rows.map((r) => ({
    query: r.search_query,
    volume: r.volume,
    purchasesTotal: r.purchases_total,
    purchasesAsin: r.purchases_asin,
    purchaseShare: share(r.purchases_asin, r.purchases_total),
    clickShare: share(r.clicks_asin, r.clicks_total),
    impressionShare: share(r.impressions_asin, r.impressions_total),
  }));

  const opportunities = items
    .filter((i) => i.purchasesTotal > 0 && (i.purchaseShare == null || i.purchaseShare < LOW_SHARE))
    // Score by unmet demand: total purchases you are NOT capturing.
    .map((i) => ({ ...i, score: i.purchasesTotal * (1 - (i.purchaseShare ?? 0)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return { hasSearch: true, asOf, opportunities, recommendations: recommend(opportunities) };
}

function recommend(opportunities) {
  return opportunities.slice(0, 5).map((i) => ({
    priority: (i.purchaseShare != null && i.purchaseShare < HIGH_OPPORTUNITY) ? 'high' : 'medium',
    impact: i.score,
    area: 'search',
    title: `Grow share on "${i.query}"`,
    why: `${i.purchasesTotal} purchases on this query but you capture ${pctStr(i.purchaseShare)} `
      + `(impression share ${pctStr(i.impressionShare)}, click share ${pctStr(i.clickShare)}).`,
    action: 'Target this keyword with Sponsored Products and tune the listing (title/image/price) to convert its traffic.',
  }));
}
