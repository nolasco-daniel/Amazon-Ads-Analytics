// Ingests an Amazon advertising report export (CSV/TSV) for any sponsored ad
// type — Sponsored Products, Brands, or Display — at the campaign level, into
// the same sp_campaign_daily table the API-pulled data uses. This means uploaded
// SB/SD data flows through all the existing ad analysis (ACoS, ROAS, best/worst).
//
// Reuses upsertCampaignRows from db.js (does not modify db.js).

import { upsertCampaignRows } from '../db.js';
import { parseDelimited } from './csv.js';

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
    date: findHeader(headers, (h) => h === 'date' || h.includes('date')),
    campaignId: findHeader(headers, (h) => h.includes('campaignid')),
    campaignName: findHeader(headers, (h) => h.includes('campaign') && h.includes('name'))
      || findHeader(headers, (h) => h.includes('campaign')),
    impressions: findHeader(headers, (h) => h.includes('impressions')),
    clicks: findHeader(headers, (h) => h.includes('clicks')),
    cost: findHeader(headers, (h) => h.includes('spend') || h === 'cost'),
    sales: findHeader(headers, (h) => h.includes('sales')),
    orders: findHeader(headers, (h) => h.includes('orders') || h.includes('purchases') || h.includes('conversions')),
  };
}

export function ingestAdsReport(text, { profileId, date }) {
  const { headers, rows } = parseDelimited(text);
  if (headers.length === 0) {
    return { ok: false, ingested: 0, warnings: ['File is empty or could not be parsed.'] };
  }

  const col = mapColumns(headers);
  const warnings = [];
  if (!col.campaignName && !col.campaignId) warnings.push('No campaign column found — cannot identify campaigns.');
  if (!col.cost && !col.sales) warnings.push('No spend or sales column found — advertising insights will be limited.');

  const out = [];
  for (const r of rows) {
    const campaignName = col.campaignName ? r[col.campaignName] : '';
    const campaignId = (col.campaignId && r[col.campaignId]) || campaignName;
    if (!campaignId) continue;
    out.push({
      date: (col.date ? String(r[col.date]).slice(0, 10) : '') || date,
      campaignId,
      campaignName,
      impressions: Math.round(toNumber(col.impressions && r[col.impressions])),
      clicks: Math.round(toNumber(col.clicks && r[col.clicks])),
      cost: toNumber(col.cost && r[col.cost]),
      purchases: Math.round(toNumber(col.orders && r[col.orders])),
      sales: toNumber(col.sales && r[col.sales]),
    });
  }

  const ingested = upsertCampaignRows(out, profileId);
  return {
    ok: true,
    ingested,
    columnsMatched: Object.fromEntries(Object.entries(col).map(([k, v]) => [k, v || null])),
    warnings,
  };
}
