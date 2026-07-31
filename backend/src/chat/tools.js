// Tool layer for the conversational agent.
//
// Each tool wraps an existing read-only query (db.js) or rule-based analyzer
// (agent/*.js) so the AI can pull the exact slice of data a question needs,
// instead of us stuffing the whole database into the prompt. Everything here is
// READ-ONLY — no tool changes anything in the database or on Amazon.

import {
  getKpis, getDailySeries, getCampaignBreakdown, getSearchTerms,
} from '../db.js';
import { buildSummary } from '../agent/analyze.js';
import { buildPeriodicSummaries } from '../agent/periods.js';
import { buildProductComparison } from '../agent/compare.js';

const ymd = (d) => d.toISOString().slice(0, 10);

// Default any missing date to a sensible last-30-days window ending today.
function range(from, to) {
  const end = to || ymd(new Date());
  let start = from;
  if (!start) {
    const d = new Date(end);
    d.setDate(d.getDate() - 29);
    start = ymd(d);
  }
  return { from: start, to: end };
}

// Add the same derived metrics the dashboard shows, so the model doesn't have to
// recompute ACoS/ROAS/CTR/CPC/CVR by hand (lower ACoS = better, higher ROAS = better).
function withDerived(row) {
  const cost = row.cost || 0;
  const sales = row.sales || 0;
  const clicks = row.clicks || 0;
  const impressions = row.impressions || 0;
  const purchases = row.purchases || 0;
  return {
    ...row,
    acos: sales > 0 ? cost / sales : null,
    roas: cost > 0 ? sales / cost : null,
    ctr: impressions > 0 ? clicks / impressions : null,
    cpc: clicks > 0 ? cost / clicks : null,
    cvr: clicks > 0 ? purchases / clicks : null,
  };
}

// --- Tool definitions handed to the model (JSON Schema). Descriptions are
// prescriptive about WHEN to call each tool — this measurably improves how
// well the model picks the right one. ---
const dateProps = {
  from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive). Omit for last 30 days.' },
  to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive). Omit for today.' },
};

export const TOOL_DEFS = [
  {
    name: 'get_kpis',
    description:
      'Account-level totals (spend, ad sales, clicks, impressions, purchases) plus derived ACoS/ROAS/CTR/CPC/CVR for a date range. Call this for "how am I doing", overall performance, or any single headline metric.',
    input_schema: { type: 'object', properties: { ...dateProps }, required: [] },
  },
  {
    name: 'get_daily_series',
    description:
      'Day-by-day time series of the same metrics. Call this for trends over time, "which day", spikes/drops, or before/after comparisons within a period.',
    input_schema: { type: 'object', properties: { ...dateProps }, required: [] },
  },
  {
    name: 'get_campaigns',
    description:
      'Per-campaign breakdown sorted by spend, with derived metrics. Call this for "which campaigns", best/worst performers, or campaign-level ACoS/ROAS questions.',
    input_schema: { type: 'object', properties: { ...dateProps }, required: [] },
  },
  {
    name: 'get_search_terms',
    description:
      'Search terms the ads showed for. Set only_wasted=true to get terms that took clicks but made ZERO sales — the prime negative-keyword candidates. Call this for wasted spend, negative keywords, or "what are people searching".',
    input_schema: {
      type: 'object',
      properties: {
        ...dateProps,
        only_wasted: { type: 'boolean', description: 'Only return zero-sale, clicked terms (wasted spend).' },
        limit: { type: 'integer', description: 'Max rows (default 50, cap 200).' },
      },
      required: [],
    },
  },
  {
    name: 'get_analysis_summary',
    description:
      'The full rule-based analyst report for a period: headline, top/underperforming campaigns, wasted spend, anomalies, TACoS, and PRIORITIZED RECOMMENDATIONS. Call this whenever the user asks "what should I do", for advice, or wants a broad health check. This already merges uploaded Business/Inventory/Finance/Reviews/Pricing data when present.',
    input_schema: { type: 'object', properties: { ...dateProps }, required: [] },
  },
  {
    name: 'get_periodic_summaries',
    description:
      'Daily / weekly / monthly performance summaries ending at a given date. Call this for "how was last week/month", recent-period recaps, or period-over-period status.',
    input_schema: {
      type: 'object',
      properties: { as_of: { type: 'string', description: 'End date YYYY-MM-DD. Omit for today.' } },
      required: [],
    },
  },
  {
    name: 'get_comparison',
    description:
      'Compares a period against the prior equivalent window (or explicit prior dates) at the product/campaign level, showing what grew or declined. Call this for "compare", "vs last week/period", or "what changed".',
    input_schema: {
      type: 'object',
      properties: {
        ...dateProps,
        prior_from: { type: 'string', description: 'Optional explicit prior-window start YYYY-MM-DD.' },
        prior_to: { type: 'string', description: 'Optional explicit prior-window end YYYY-MM-DD.' },
      },
      required: [],
    },
  },
];

// Dispatch a tool call to the underlying read-only function. `ctx.profileId`
// is injected by the caller — the model never sees or chooses it.
export function runTool(name, input = {}, ctx = {}) {
  const pid = ctx.profileId;
  switch (name) {
    case 'get_kpis': {
      const { from, to } = range(input.from, input.to);
      return { from, to, ...withDerived(getKpis(pid, from, to)) };
    }
    case 'get_daily_series': {
      const { from, to } = range(input.from, input.to);
      return { from, to, data: getDailySeries(pid, from, to).map(withDerived) };
    }
    case 'get_campaigns': {
      const { from, to } = range(input.from, input.to);
      return { from, to, data: getCampaignBreakdown(pid, from, to).map(withDerived) };
    }
    case 'get_search_terms': {
      const { from, to } = range(input.from, input.to);
      const limit = Math.min(Number(input.limit) || 50, 200);
      const rows = getSearchTerms(pid, from, to, { onlyWasted: !!input.only_wasted, limit }).map(withDerived);
      return { from, to, only_wasted: !!input.only_wasted, data: rows };
    }
    case 'get_analysis_summary': {
      const { from, to } = range(input.from, input.to);
      return buildSummary(pid, from, to);
    }
    case 'get_periodic_summaries': {
      const asOf = input.as_of || ymd(new Date());
      return buildPeriodicSummaries(pid, asOf);
    }
    case 'get_comparison': {
      const { from, to } = range(input.from, input.to);
      return buildProductComparison(pid, from, to, input.prior_from, input.prior_to);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
