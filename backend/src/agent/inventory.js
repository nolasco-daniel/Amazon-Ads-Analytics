// Inventory health analysis: joins the latest stock snapshot with recent sales
// velocity (from Business Report units) to estimate days of cover, then flags
// products at risk of stocking out or sitting overstocked.
//
// Pure-ish orchestration: it reads via the ingest getters and returns a plain
// object; buildSummary() merges the results into the overall agent summary.

import { getLatestInventory } from '../ingest/inventoryReport.js';
import { getProductUnits } from '../ingest/businessReport.js';
import { daysInclusive } from './metrics.js';

// Thresholds (days of cover). Tune to your lead times.
const STOCKOUT_DAYS = 14;   // reorder before this
const OVERSTOCK_DAYS = 90;  // too much capital tied up beyond this
const COVER_TARGET_DAYS = 60; // reorder up to this many days of stock

const money = (v) => `$${(v ?? 0).toFixed(2)}`;
const round = (v) => (v == null ? null : Math.round(v));

export function buildInventoryHealth(profileId, from, to) {
  const inv = getLatestInventory(profileId, to);
  if (!inv.length) {
    return { hasInventory: false, items: [], stockoutRisk: [], overstock: [], recommendations: [] };
  }

  const days = daysInclusive(from, to);
  const bySku = new Map();
  const byAsin = new Map();
  for (const u of getProductUnits(profileId, from, to)) {
    if (u.sku) bySku.set(u.sku, u);
    if (u.asin) byAsin.set(u.asin, u);
  }

  const items = inv.map((p) => {
    const sold = (p.sku && bySku.get(p.sku)) || (p.asin && byAsin.get(p.asin)) || null;
    const soldUnits = sold ? sold.units : 0;
    const velocity = days > 0 ? soldUnits / days : 0; // units/day
    // Prefer velocity-based cover; fall back to a report-provided value.
    const daysOfCover = velocity > 0 ? p.available / velocity
      : (p.days_of_supply != null ? p.days_of_supply : null);
    return {
      sku: p.sku, asin: p.asin, title: p.title,
      available: p.available, inbound: p.inbound, price: p.price,
      soldUnits, velocity, daysOfCover,
    };
  });

  const stockoutRisk = items
    .filter((i) => i.velocity > 0 && i.daysOfCover != null && i.daysOfCover < STOCKOUT_DAYS)
    .sort((a, b) => a.daysOfCover - b.daysOfCover);

  const overstock = items
    .filter((i) => i.available > 0 && i.daysOfCover != null && i.daysOfCover > OVERSTOCK_DAYS)
    .sort((a, b) => b.available * b.price - a.available * a.price);

  return {
    hasInventory: true,
    asOf: to,
    items,
    stockoutRisk,
    overstock,
    recommendations: recommend(stockoutRisk, overstock),
  };
}

function recommend(stockoutRisk, overstock) {
  const recs = [];

  for (const i of stockoutRisk.slice(0, 5)) {
    const id = i.sku || i.asin;
    const cover = round(i.daysOfCover);
    const suggestQty = Math.max(0, Math.round(i.velocity * COVER_TARGET_DAYS - i.available - (i.inbound || 0)));
    const urgent = i.daysOfCover < 7 || i.available === 0;
    recs.push({
      priority: urgent ? 'high' : 'medium',
      impact: i.velocity * (i.price || 0) * 30, // ~monthly sales at risk
      area: 'inventory',
      title: `Reorder ${id}${i.available === 0 ? ' (out of stock)' : ` (~${cover} days left)`}`,
      why: `Selling ~${i.velocity.toFixed(1)} units/day with ${i.available} in stock`
        + `${i.inbound ? ` (+${i.inbound} inbound)` : ''} — about ${cover} days of cover.`,
      action: suggestQty > 0
        ? `Send ~${suggestQty} units to reach ${COVER_TARGET_DAYS} days of cover.`
        : 'Confirm inbound quantities cover demand before the next sales cycle.',
    });
  }

  for (const i of overstock.slice(0, 3)) {
    const id = i.sku || i.asin;
    const cover = round(i.daysOfCover);
    recs.push({
      priority: 'low',
      impact: i.available * (i.price || 0), // capital tied up
      area: 'inventory',
      title: `Reduce stock on ${id} (~${cover} days of cover)`,
      why: `${i.available} units in stock — about ${cover} days of cover (${money(i.available * (i.price || 0))} tied up).`,
      action: 'Slow reorders, run a promotion, or lower price to avoid long-term storage fees.',
    });
  }

  return recs;
}
