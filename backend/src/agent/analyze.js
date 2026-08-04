// Rule-based Amazon Ads insights agent.
//
// Turns the Sponsored Products data already in SQLite into a business-friendly
// summary: period-over-period headline, best/worst campaigns, wasted spend,
// anomalies, and prioritized recommendations. No LLM / no external API — every
// finding is derived deterministically from the numbers so it is fully explainable.

import {
  getKpis, getDailySeries, getCampaignBreakdown, getSearchTerms,
} from '../db.js';
import { getBusinessSummary } from '../ingest/businessReport.js';
import { getOrdersSummary } from '../ingest/ordersReport.js';
import { buildInventoryHealth } from './inventory.js';
import { buildProfitability } from './profitability.js';
import { buildReviewHealth } from './reviews.js';
import { buildPricingHealth } from './pricing.js';
import { buildSearchOpportunities } from './searchQuery.js';
import { buildListingHealth } from './listings.js';
import { derive, acosStatus, change, priorWindow, daysInclusive } from './metrics.js';

// Shared ordering for recommendations from every area (ads, business, inventory):
// higher priority first, then larger dollar impact.
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const sortRecs = (recs) =>
  [...recs].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.impact - a.impact);

// Target ACoS the agent optimizes toward, and the level it treats as critical.
// These mirror the dashboard's acosStatus buckets.
const ACOS_TARGET = 0.28;
const ACOS_CRITICAL = 0.4;

// --- tiny string formatters, so recommendations read like a human wrote them ---
const money = (v) => `$${(v ?? 0).toFixed(2)}`;
const pctStr = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const signed = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);

// Add site conversion (units / sessions) to a business-report aggregate.
function deriveBusiness(b) {
  if (!b) return null;
  const sessions = b.sessions || 0;
  return { ...b, conversion: sessions > 0 ? (b.units || 0) / sessions : null };
}

export function buildSummary(profileId, from, to) {
  const days = daysInclusive(from, to);
  const prior = priorWindow(from, to);

  const campaigns = getCampaignBreakdown(profileId, from, to).map(derive);

  // Behavior: flag missing data before attempting any analysis.
  if (campaigns.length === 0) {
    return {
      period: { from, to, days },
      dataAvailable: false,
      warnings: [
        'No Sponsored Products data found for this date range. ' +
        'Click "Refresh data" (or run `npm run fetch`) to pull reports from Amazon, ' +
        'and confirm ADS_PROFILE_ID is set.',
      ],
      recommendations: [],
    };
  }

  const curr = derive(getKpis(profileId, from, to));
  const prev = derive(getKpis(profileId, prior.from, prior.to));
  const series = getDailySeries(profileId, from, to).map(derive);
  const wastedTerms = getSearchTerms(profileId, from, to, { onlyWasted: true, limit: 25 });

  const kpiKeys = ['sales', 'cost', 'clicks', 'impressions', 'purchases', 'acos', 'roas', 'ctr', 'cvr'];
  const changes = {};
  for (const k of kpiKeys) changes[k] = change(curr[k], prev[k]);

  // Business Report data (traffic / conversion / Buy Box) — only present if the
  // user has uploaded a Business Report for this window.
  const bizCurr = deriveBusiness(getBusinessSummary(profileId, from, to));
  const bizPrev = deriveBusiness(getBusinessSummary(profileId, prior.from, prior.to));
  const hasBiz = !!bizCurr && (bizCurr.sessions || 0) > 0;
  const bizKeys = ['sessions', 'page_views', 'units', 'sales', 'conversion', 'buy_box_pct'];
  const bizChanges = {};
  if (hasBiz) for (const k of bizKeys) bizChanges[k] = change(bizCurr[k], bizPrev?.[k]);

  // Inventory health (stockout risk / overstock) — only if inventory uploaded.
  const inventory = buildInventoryHealth(profileId, from, to);
  // Profitability (net profit / margin) — only if a finance report uploaded.
  const profitability = buildProfitability(profileId, from, to, curr.cost || 0);
  // Review health (low-rated products) — only if a reviews report uploaded.
  const reviews = buildReviewHealth(profileId, to);
  // Pricing health (above Buy Box) — only if a pricing report uploaded.
  const pricing = buildPricingHealth(profileId, to);
  // Search-query opportunities — only if a Search Query Performance report uploaded.
  const search = buildSearchOpportunities(profileId, to);
  // Listing quality (weak listings) — only if a Product Listings report uploaded.
  const listings = buildListingHealth(profileId, to);

  // TACoS = total ad spend / TOTAL sales (incl. organic). Needs a total-sales
  // figure, which comes from the Business Report or the settlement report.
  // (ACoS, by contrast, uses only ad-attributed sales.)
  const totalSales = hasBiz && (bizCurr.sales || 0) > 0
    ? bizCurr.sales
    : (profitability.hasFinance ? profitability.breakdown.sales : null);
  const tacos = totalSales && totalSales > 0 ? (curr.cost || 0) / totalSales : null;

  // Orders totals — only if an Orders report was uploaded.
  const ordersCurr = getOrdersSummary(profileId, from, to);
  const hasOrders = !!ordersCurr && (ordersCurr.orders || 0) > 0;

  const head = headline(curr, changes, hasBiz ? bizCurr : null, bizChanges);
  if (hasOrders) {
    head.notes.push(`Orders ${ordersCurr.orders} — ${ordersCurr.units} units, ${money(ordersCurr.sales)} order revenue.`);
  }
  if (profitability.hasFinance) {
    const b = profitability.breakdown;
    head.notes.push(`Net profit ${money(b.netProfit)} — margin ${pctStr(b.margin)} on ${money(b.netSales)} net sales.`);
    head.netProfit = b.netProfit;
    head.margin = b.margin;
  }
  if (tacos != null) {
    head.notes.push(`TACoS ${pctStr(tacos)} — ad spend as a share of total sales.`);
    head.tacos = tacos;
  }

  // Weekly seasonality (day-of-week sales pattern).
  const season = seasonality(series);
  if (season) {
    head.notes.push(`Strongest sales day: ${season.best.label} (avg ${money(season.best.avgSales)}); weakest: ${season.worst.label} (avg ${money(season.worst.avgSales)}).`);
  }
  const seasonRecs = (season && season.worst.avgSales > 0 && season.best.avgSales >= season.worst.avgSales * 1.5) ? [{
    priority: 'low',
    impact: season.best.avgSales,
    area: 'advertising',
    title: 'Sales follow a weekly pattern',
    why: `${season.best.label} averages ${money(season.best.avgSales)} vs ${season.worst.label} at ${money(season.worst.avgSales)}.`,
    action: 'Concentrate ad budget and promotions on the strongest days of the week.',
  }] : [];

  // High TACoS means the business leans heavily on paid traffic.
  const tacosRecs = (tacos != null && tacos > 0.2) ? [{
    priority: 'medium',
    impact: curr.cost || 0,
    area: 'advertising',
    title: 'TACoS is high',
    why: `Total ad cost of sales is ${pctStr(tacos)} — ads are a large share of total revenue.`,
    action: 'Grow organic rank so sales rely less on paid, and trim the least efficient campaigns.',
  }] : [];

  const recommendations = sortRecs([
    ...recommend({ curr, changes, campaigns, wastedTerms, biz: hasBiz ? bizCurr : null, bizChanges }),
    ...inventory.recommendations,
    ...profitability.recommendations,
    ...reviews.recommendations,
    ...pricing.recommendations,
    ...search.recommendations,
    ...listings.recommendations,
    ...tacosRecs,
    ...seasonRecs,
  ]);

  return {
    period: { from, to, days },
    comparison: { from: prior.from, to: prior.to },
    dataAvailable: true,
    warnings: dataWarnings(prev, hasBiz, inventory.hasInventory, profitability.hasFinance, reviews.hasReviews, pricing.hasPricing, search.hasSearch, listings.hasListings),
    kpis: { current: curr, prior: prev, change: changes },
    tacos,
    orders: hasOrders ? ordersCurr : null,
    business: hasBiz ? { current: bizCurr, prior: bizPrev, change: bizChanges } : null,
    inventory: inventory.hasInventory ? inventory : null,
    profitability: profitability.hasFinance ? profitability.breakdown : null,
    reviews: reviews.hasReviews ? reviews : null,
    pricing: pricing.hasPricing ? pricing : null,
    search: search.hasSearch ? search : null,
    listings: listings.hasListings ? listings : null,
    seasonality: season,
    headline: head,
    topCampaigns: rankTop(campaigns),
    underperformers: rankUnderperformers(campaigns),
    wastedSpend: summarizeWaste(wastedTerms),
    anomalies: detectAnomalies(series),
    recommendations,
  };
}

// Note when the comparison baseline is empty, so deltas aren't read as real.
// Also nudge the user to upload a Business Report when none is present.
function dataWarnings(prev, hasBiz, hasInventory, hasFinance, hasReviews, hasPricing, hasSearch, hasListings) {
  const warnings = [];
  if (!prev || (prev.sales || 0) === 0) {
    warnings.push('No data in the prior comparison period — period-over-period changes are unavailable.');
  }
  if (!hasBiz) {
    warnings.push('No Business Report uploaded for this period — traffic, conversion and Buy Box insights are unavailable. Use "Upload report" to add them.');
  }
  if (!hasInventory) {
    warnings.push('No Inventory report uploaded — stockout-risk and overstock insights are unavailable. Use "Upload report" to add them.');
  }
  if (!hasFinance) {
    warnings.push('No settlement/finance report uploaded — profitability (net profit, margin, fees, refunds) is unavailable. Use "Upload report" to add it.');
  }
  if (!hasReviews) {
    warnings.push('No reviews report uploaded — low-rating insights are unavailable. Use "Upload report" to add them.');
  }
  if (!hasPricing) {
    warnings.push('No pricing report uploaded — Buy Box pricing insights are unavailable. Use "Upload report" to add them.');
  }
  if (!hasSearch) {
    warnings.push('No Search Query Performance report uploaded — keyword growth opportunities are unavailable. Use "Upload report" to add them.');
  }
  if (!hasListings) {
    warnings.push('No Product Listings report uploaded — listing-quality insights are unavailable. Use "Upload report" to add them.');
  }
  return warnings;
}

function headline(curr, changes, biz, bizChanges = {}) {
  const notes = [
    `Ad sales ${money(curr.sales)} (${signed(changes.sales)} vs prior period).`,
    `Ad spend ${money(curr.cost)} (${signed(changes.cost)}).`,
    `ACoS ${pctStr(curr.acos)} — ${acosStatus(curr.acos)} (${signed(changes.acos)}).`,
    `ROAS ${curr.roas == null ? '—' : curr.roas.toFixed(2) + '×'}.`,
  ];
  if (biz) {
    notes.push(`Sessions ${Math.round(biz.sessions)} (${signed(bizChanges.sessions)}).`);
    notes.push(`Conversion ${pctStr(biz.conversion)} (${signed(bizChanges.conversion)}).`);
    notes.push(`Buy Box ${pctStr(biz.buy_box_pct)} (${signed(bizChanges.buy_box_pct)}).`);
  }
  return {
    sales: curr.sales, spend: curr.cost, acos: curr.acos, roas: curr.roas,
    sessions: biz?.sessions ?? null, conversion: biz?.conversion ?? null, buyBox: biz?.buy_box_pct ?? null,
    notes,
  };
}

// Best performers: highest sales first.
function rankTop(campaigns, limit = 5) {
  return [...campaigns]
    .sort((a, b) => (b.sales || 0) - (a.sales || 0))
    .slice(0, limit)
    .map((c) => ({
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      sales: c.sales, cost: c.cost, acos: c.acos, roas: c.roas,
      status: acosStatus(c.acos),
    }));
}

// Worst performers: real spend but no sales, or ACoS above the critical line.
function rankUnderperformers(campaigns, limit = 5) {
  return campaigns
    .filter((c) => (c.cost || 0) > 0 && ((c.sales || 0) === 0 || c.acos > ACOS_CRITICAL))
    .sort((a, b) => (b.cost || 0) - (a.cost || 0))
    .slice(0, limit)
    .map((c) => ({
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      sales: c.sales, cost: c.cost, acos: c.acos,
      reason: (c.sales || 0) === 0
        ? `Spent ${money(c.cost)} with zero attributed sales.`
        : `ACoS ${pctStr(c.acos)} is above the ${pctStr(ACOS_CRITICAL)} critical line.`,
    }));
}

function summarizeWaste(terms) {
  const total = terms.reduce((s, t) => s + (t.cost || 0), 0);
  return {
    total,
    count: terms.length,
    terms: terms.slice(0, 10).map((t) => ({
      search_term: t.search_term, keyword: t.keyword,
      match_type: t.match_type, cost: t.cost, clicks: t.clicks,
    })),
  };
}

// Scan the daily series for sudden drops/spikes vs a trailing baseline.
// A metric is flagged when it deviates > 30% from the mean of the prior days.
function detectAnomalies(series, { window = 7, threshold = 0.3, minBaselineDays = 3 } = {}) {
  const found = [];
  // For each metric: which direction is "bad" (worth flagging)?
  const metrics = [
    { key: 'sales', bad: 'drop' },
    { key: 'clicks', bad: 'drop' },
    { key: 'cvr', bad: 'drop' },
    { key: 'cost', bad: 'spike' },
    { key: 'acos', bad: 'spike' },
  ];

  for (let i = 0; i < series.length; i++) {
    const prior = series.slice(Math.max(0, i - window), i)
      .map((d) => d);
    if (prior.length < minBaselineDays) continue;

    for (const { key, bad } of metrics) {
      const value = series[i][key];
      const base = prior.map((d) => d[key]).filter((v) => v != null);
      if (value == null || base.length < minBaselineDays) continue;
      const baseline = base.reduce((s, v) => s + v, 0) / base.length;
      if (baseline === 0) continue;

      const delta = (value - baseline) / baseline;
      const isBad = bad === 'drop' ? delta <= -threshold : delta >= threshold;
      if (!isBad) continue;

      found.push({
        date: series[i].date,
        metric: key,
        direction: bad,
        value, baseline,
        change: delta,
        severity: Math.abs(delta),
        note: `${key} was ${signed(delta)} vs its trailing ${base.length}-day average on ${series[i].date}.`,
      });
    }
  }

  // Most severe first, capped so the summary stays readable.
  return found.sort((a, b) => b.severity - a.severity).slice(0, 8);
}

// Detect a weekly sales pattern (day-of-week seasonality) from the daily series.
// Needs at least ~2 weeks of data to be meaningful.
function seasonality(series) {
  if (!series || series.length < 14) return null;
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const sum = Array(7).fill(0);
  const cnt = Array(7).fill(0);
  for (const d of series) {
    const wd = new Date(`${d.date}T00:00:00Z`).getUTCDay();
    sum[wd] += d.sales || 0;
    cnt[wd] += 1;
  }
  const byWeekday = labels.map((label, i) => ({
    day: i, label, avgSales: cnt[i] ? sum[i] / cnt[i] : null, count: cnt[i],
  }));
  const present = byWeekday.filter((w) => w.avgSales != null);
  if (present.length < 2) return null;
  const best = present.reduce((a, b) => (b.avgSales > a.avgSales ? b : a));
  const worst = present.reduce((a, b) => (b.avgSales < a.avgSales ? b : a));
  const overall = present.reduce((s, w) => s + w.avgSales, 0) / present.length;
  return { byWeekday, best, worst, overall };
}

// Build prioritized, evidence-backed recommendations. Each carries an `impact`
// dollar figure used only for sorting; priority is assigned by rule.
function recommend({ curr, changes, campaigns, wastedTerms, biz, bizChanges = {} }) {
  const recs = [];

  // 1) Wasted spend on zero-sale search terms → add negative keywords.
  const wasted = wastedTerms.reduce((s, t) => s + (t.cost || 0), 0);
  if (wasted > 0) {
    recs.push({
      priority: wasted >= 50 ? 'high' : 'medium',
      impact: wasted,
      area: 'advertising',
      title: 'Add negative keywords for wasted spend',
      why: `${wastedTerms.length} search term(s) took clicks but produced no sales, ` +
        `costing ${money(wasted)} in the period.`,
      action: 'Add the top zero-sale search terms as negative keywords to stop the bleed.',
    });
  }

  // 2) High-ACoS / zero-sale campaigns → cut bids or pause.
  const bad = campaigns
    .filter((c) => (c.cost || 0) > 0 && ((c.sales || 0) === 0 || c.acos > ACOS_CRITICAL))
    .sort((a, b) => (b.cost || 0) - (a.cost || 0))
    .slice(0, 3);
  for (const c of bad) {
    const zero = (c.sales || 0) === 0;
    recs.push({
      priority: 'high',
      impact: c.cost || 0,
      area: 'advertising',
      title: zero
        ? `Pause or fix "${c.campaign_name}" (no sales)`
        : `Lower bids on "${c.campaign_name}" (high ACoS)`,
      why: zero
        ? `Spent ${money(c.cost)} with zero attributed sales.`
        : `ACoS ${pctStr(c.acos)} exceeds the ${pctStr(ACOS_CRITICAL)} critical line on ${money(c.cost)} spend.`,
      action: zero
        ? 'Review targeting/landing page or pause the campaign.'
        : `Reduce bids to steer ACoS toward the ${pctStr(ACOS_TARGET)} target.`,
    });
  }

  // 3) Rising ACoS trend period-over-period.
  if (changes.acos != null && changes.acos > 0.15) {
    recs.push({
      priority: 'medium',
      impact: curr.cost || 0,
      area: 'advertising',
      title: 'ACoS is trending up',
      why: `ACoS rose ${signed(changes.acos)} vs the prior period (now ${pctStr(curr.acos)}).`,
      action: 'Check recent bid/budget changes and rein in the least efficient campaigns.',
    });
  }

  // 4) Falling ad sales.
  if (changes.sales != null && changes.sales < -0.15) {
    recs.push({
      priority: 'high',
      impact: curr.sales || 0,
      area: 'sales',
      title: 'Ad sales are dropping',
      why: `Ad sales fell ${signed(changes.sales)} vs the prior period.`,
      action: 'Verify inventory/Buy Box and whether budgets or bids were cut recently.',
    });
  }

  // 5) Weak click-through despite impressions.
  if (curr.ctr != null && curr.ctr < 0.003 && (curr.impressions || 0) > 1000) {
    recs.push({
      priority: 'low',
      impact: 0,
      area: 'advertising',
      title: 'Low click-through rate',
      why: `CTR is ${pctStr(curr.ctr)} across ${curr.impressions} impressions.`,
      action: 'Tighten targeting and improve main image/title/price to earn more clicks.',
    });
  }

  // --- Business Report driven (only when a report has been uploaded) ---
  if (biz) {
    // 6) Low Buy Box — you can't win the sale if you don't hold the Buy Box.
    if (biz.buy_box_pct != null && biz.buy_box_pct < 0.9) {
      recs.push({
        priority: biz.buy_box_pct < 0.7 ? 'high' : 'medium',
        impact: biz.sales || 0,
        area: 'listing',
        title: 'Buy Box share is low',
        why: `Buy Box is ${pctStr(biz.buy_box_pct)} of page views — lost Buy Box means lost sales and wasted ad clicks.`,
        action: 'Check pricing vs competitors, stock/fulfillment health, and account metrics.',
      });
    }

    // 7) Conversion dropping period-over-period.
    if (bizChanges.conversion != null && bizChanges.conversion < -0.15) {
      recs.push({
        priority: 'high',
        impact: biz.sales || 0,
        area: 'listing',
        title: 'Conversion rate is dropping',
        why: `Unit-session conversion fell ${signed(bizChanges.conversion)} (now ${pctStr(biz.conversion)}).`,
        action: 'Review price, main image, title/bullets, reviews and Buy Box for the affected listings.',
      });
    } else if (biz.conversion != null && biz.conversion < 0.05 && (biz.sessions || 0) > 500) {
      // Or a low absolute conversion on meaningful traffic.
      recs.push({
        priority: 'medium',
        impact: biz.sales || 0,
        area: 'listing',
        title: 'Low conversion on strong traffic',
        why: `Conversion is ${pctStr(biz.conversion)} across ${Math.round(biz.sessions)} sessions.`,
        action: 'The listing gets clicks but not orders — improve price, images, and social proof.',
      });
    }

    // 8) Traffic (sessions) falling.
    if (bizChanges.sessions != null && bizChanges.sessions < -0.15) {
      recs.push({
        priority: 'medium',
        impact: biz.sales || 0,
        area: 'traffic',
        title: 'Sessions are falling',
        why: `Sessions dropped ${signed(bizChanges.sessions)} vs the prior period.`,
        action: 'Check organic rank, ad impression share, and whether listings went inactive.',
      });
    }
  }

  return sortRecs(recs);
}
