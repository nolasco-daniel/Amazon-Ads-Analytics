// Pricing analysis: flags listings priced above the Buy Box price, which is a
// common reason for losing the Buy Box (and therefore sales and ad efficiency).
// Recommends matching/beating the Buy Box, worst gap first.

import { getLatestPricing } from '../ingest/pricingReport.js';

const NOISE = 0.005;        // ignore sub-cent rounding differences
const BIG_GAP_PCT = 0.05;   // > 5% above Buy Box is a high-priority gap

const money = (v) => `$${(v ?? 0).toFixed(2)}`;
const signed = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);

export function buildPricingHealth(profileId, asOf) {
  const rows = getLatestPricing(profileId, asOf);
  if (!rows.length) {
    return { hasPricing: false, items: [], aboveBuyBox: [], recommendations: [] };
  }

  const items = rows.map((r) => ({
    asin: r.asin, sku: r.sku, title: r.title,
    yourPrice: r.your_price, buyBoxPrice: r.buy_box_price, lowestPrice: r.lowest_price,
  }));

  const aboveBuyBox = items
    .filter((i) => i.yourPrice != null && i.buyBoxPrice != null && i.yourPrice > i.buyBoxPrice + NOISE)
    .map((i) => ({ ...i, gap: i.yourPrice - i.buyBoxPrice, gapPct: (i.yourPrice - i.buyBoxPrice) / i.buyBoxPrice }))
    .sort((a, b) => b.gap - a.gap);

  return { hasPricing: true, asOf, items, aboveBuyBox, recommendations: recommend(aboveBuyBox) };
}

function recommend(aboveBuyBox) {
  return aboveBuyBox.slice(0, 5).map((i) => {
    const id = i.sku || i.asin;
    return {
      priority: i.gapPct > BIG_GAP_PCT ? 'high' : 'medium',
      impact: i.gap,
      area: 'pricing',
      title: `Lower price on ${id} to win the Buy Box`,
      why: `Priced ${money(i.yourPrice)} vs Buy Box ${money(i.buyBoxPrice)} (${signed(i.gapPct)} higher).`,
      action: `Match or beat ${money(i.buyBoxPrice)} to regain the Buy Box.`,
    };
  });
}
