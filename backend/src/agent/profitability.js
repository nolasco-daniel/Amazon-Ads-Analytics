// Profitability analysis: combines the settlement P&L buckets (sales, refunds,
// fees, shipping) with ad spend to compute net profit, margin, refund rate and
// fee share, then flags thin margins, losses and high refunds.
//
// buildSummary() passes in ad spend so ad cost is included in net profit.

import { getFinanceSummary } from '../ingest/financeReport.js';

// Thresholds — tune to your business.
const THIN_MARGIN = 0.1;      // < 10% net margin is thin
const HIGH_REFUND_RATE = 0.08; // > 8% of sales refunded is high
const HIGH_FEE_RATE = 0.35;    // fees > 35% of sales is heavy

const pctStr = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const money = (v) => `$${(v ?? 0).toFixed(2)}`;

export function buildProfitability(profileId, from, to, adSpend = 0) {
  const f = getFinanceSummary(profileId, from, to);
  const hasFinance = !!f && ((f.sales || 0) !== 0 || (f.fees || 0) !== 0 || (f.refunds || 0) !== 0);
  if (!hasFinance) return { hasFinance: false, recommendations: [] };

  const sales = f.sales || 0;
  const refunds = f.refunds || 0;
  const fees = f.fees || 0;
  const shipping = f.shipping || 0;
  const other = f.other || 0;

  const netSales = sales - refunds;
  const netProfit = sales - refunds - fees + shipping + other - adSpend;
  const margin = netSales > 0 ? netProfit / netSales : null;
  const refundRate = sales > 0 ? refunds / sales : null;
  const feeRate = sales > 0 ? fees / sales : null;

  const breakdown = {
    sales, refunds, netSales, fees, shipping, other, adSpend,
    netProfit, margin, refundRate, feeRate,
  };

  return { hasFinance: true, breakdown, recommendations: recommend(breakdown) };
}

function recommend(b) {
  const recs = [];

  if (b.netProfit < 0) {
    recs.push({
      priority: 'high',
      impact: Math.abs(b.netProfit),
      area: 'profitability',
      title: 'Operating at a loss',
      why: `Net profit is ${money(b.netProfit)} after ${money(b.fees)} fees, ${money(b.refunds)} refunds and ${money(b.adSpend)} ad spend on ${money(b.netSales)} net sales.`,
      action: 'Raise price or cut ad spend/COGS on the products dragging margin negative.',
    });
  } else if (b.margin != null && b.margin < THIN_MARGIN) {
    recs.push({
      priority: 'medium',
      impact: b.netSales,
      area: 'profitability',
      title: 'Thin profit margin',
      why: `Net margin is ${pctStr(b.margin)} (${money(b.netProfit)} on ${money(b.netSales)} net sales).`,
      action: 'Review pricing, ad efficiency (ACoS/TACoS) and Amazon fees on low-margin items.',
    });
  }

  if (b.refundRate != null && b.refundRate > HIGH_REFUND_RATE) {
    recs.push({
      priority: 'medium',
      impact: b.refunds,
      area: 'profitability',
      title: 'High refund rate',
      why: `${pctStr(b.refundRate)} of sales were refunded (${money(b.refunds)}).`,
      action: 'Check listing accuracy, product quality and negative reviews for the top refunded items.',
    });
  }

  if (b.feeRate != null && b.feeRate > HIGH_FEE_RATE) {
    recs.push({
      priority: 'low',
      impact: b.fees,
      area: 'profitability',
      title: 'Amazon fees are a large share of sales',
      why: `Fees are ${pctStr(b.feeRate)} of sales (${money(b.fees)}).`,
      action: 'Review FBA size/weight tiers and referral category; consider repackaging or price changes.',
    });
  }

  return recs;
}
