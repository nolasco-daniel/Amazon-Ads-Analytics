// Pure, dependency-free analysis helpers shared by the insights agent and the API.
// Keeping these here (rather than in server.js) lets both the HTTP layer and the
// rule-based agent compute metrics the exact same way.

// Add ACoS / ROAS / CTR / CPC / CVR to an aggregate row of raw ad metrics.
export function derive(row = {}) {
  const cost = row.cost || 0;
  const sales = row.sales || 0;
  const clicks = row.clicks || 0;
  const impressions = row.impressions || 0;
  const purchases = row.purchases || 0;
  return {
    ...row,
    acos: sales > 0 ? cost / sales : null,     // ad spend as % of sales (lower = better)
    roas: cost > 0 ? sales / cost : null,      // return on ad spend (higher = better)
    ctr: impressions > 0 ? clicks / impressions : null,
    cpc: clicks > 0 ? cost / clicks : null,
    cvr: clicks > 0 ? purchases / clicks : null,
  };
}

// ACoS health bucket. Mirrors the frontend's acosStatus thresholds so the
// agent's judgments match exactly what the dashboard shows.
export function acosStatus(acos) {
  if (acos == null) return 'none';
  if (acos <= 0.25) return 'good';
  if (acos <= 0.4) return 'warning';
  return 'critical';
}

// Signed fractional change from `prev` to `curr` (0.2 means +20%).
// Returns null when there is no meaningful baseline to compare against.
export function change(curr, prev) {
  if (prev == null || prev === 0 || curr == null) return null;
  return (curr - prev) / prev;
}

// --- date helpers on 'YYYY-MM-DD' strings (UTC math, no timezone drift) ---

function toUTC(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(ymd, n) {
  return new Date(toUTC(ymd) + n * 86400000).toISOString().slice(0, 10);
}

export function daysInclusive(from, to) {
  return Math.round((toUTC(to) - toUTC(from)) / 86400000) + 1;
}

// The equal-length window immediately before [from, to], for period-over-period
// comparison (e.g. last 30 days vs the 30 days before that).
export function priorWindow(from, to) {
  const days = daysInclusive(from, to);
  const priorTo = addDays(from, -1);
  const priorFrom = addDays(priorTo, -(days - 1));
  return { from: priorFrom, to: priorTo, days };
}
