// Product-level performance comparison across two date ranges. Defaults the
// comparison window to the equal-length period immediately before [from, to],
// or accepts an explicit prior range. Surfaces the biggest sales risers and
// fallers so attention goes to what actually moved.

import { getProductMetrics } from '../ingest/businessReport.js';
import { priorWindow, change } from './metrics.js';

export function buildProductComparison(profileId, from, to, priorFrom, priorTo) {
  const prior = (priorFrom && priorTo) ? { from: priorFrom, to: priorTo } : priorWindow(from, to);

  const cur = getProductMetrics(profileId, from, to);
  const prev = getProductMetrics(profileId, prior.from, prior.to);
  if (cur.length === 0 && prev.length === 0) {
    return { hasData: false, period: { from, to }, comparison: prior, risers: [], fallers: [] };
  }

  const keyOf = (r) => r.sku || r.asin;
  const prevMap = new Map(prev.map((r) => [keyOf(r), r]));

  const items = cur.map((r) => {
    const p = prevMap.get(keyOf(r)) || { sessions: 0, units: 0, sales: 0 };
    const convCur = r.sessions > 0 ? r.units / r.sessions : null;
    const convPrev = p.sessions > 0 ? p.units / p.sessions : null;
    return {
      id: keyOf(r), asin: r.asin, sku: r.sku,
      sales: r.sales, priorSales: p.sales,
      salesDelta: r.sales - p.sales,
      salesChange: change(r.sales, p.sales),
      units: r.units, priorUnits: p.units,
      conversion: convCur, conversionChange: change(convCur, convPrev),
    };
  });

  const moved = items.filter((i) => (i.sales || 0) > 0 || (i.priorSales || 0) > 0);
  const risers = [...moved].sort((a, b) => b.salesDelta - a.salesDelta)
    .filter((i) => i.salesDelta > 0).slice(0, 10);
  const fallers = [...moved].sort((a, b) => a.salesDelta - b.salesDelta)
    .filter((i) => i.salesDelta < 0).slice(0, 10);

  return { hasData: true, period: { from, to }, comparison: prior, risers, fallers };
}
