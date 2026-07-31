import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { config } from './config.js';
import { adsRequest } from './adsClient.js';
import { getKpis, getDailySeries, getCampaignBreakdown, getSearchTerms } from './db.js';
import { fetchAll, collectPending } from './jobs/fetchReports.js';
import { buildSummary } from './agent/analyze.js';
import { buildPeriodicSummaries } from './agent/periods.js';
import { buildProductComparison } from './agent/compare.js';
import { ingestBusinessReport } from './ingest/businessReport.js';
import { ingestInventoryReport } from './ingest/inventoryReport.js';
import { ingestFinanceReport } from './ingest/financeReport.js';
import { ingestReviewsReport } from './ingest/reviewsReport.js';
import { ingestPricingReport } from './ingest/pricingReport.js';
import { ingestSearchQueryReport } from './ingest/searchQueryReport.js';
import { ingestOrdersReport } from './ingest/ordersReport.js';
import { ingestAdsReport } from './ingest/adsReport.js';
import { ingestListingsReport } from './ingest/listingsReport.js';
import { chat as chatAgent } from './chat/agent.js';

const app = express();
app.use(cors());
app.use(express.json());

const ymd = (d) => d.toISOString().slice(0, 10);

// Only accept real YYYY-MM-DD dates; anything malformed is ignored so it can't
// reach the SQL layer. Checks both the shape and that the date actually exists.
function cleanYmd(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || ymd(d) !== v ? null : v;
}

function range(q) {
  const to = cleanYmd(q.to) || ymd(new Date());
  let from = cleanYmd(q.from);
  if (!from) {
    const d = new Date(to);
    d.setDate(d.getDate() - 29); // default: last 30 days
    from = ymd(d);
  }
  return { from, to };
}

// Add ACoS / ROAS / CTR / CPC / CVR to any aggregate row.
function withDerived(row) {
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

app.get('/api/health', (req, res) => {
  res.json({ ok: true, profileId: config.profileId || null });
});

// Helper: list your Amazon ad profiles so you can grab your ADS_PROFILE_ID.
app.get('/api/profiles', async (req, res) => {
  try {
    const data = await adsRequest({ path: '/v2/profiles', profileId: '' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/kpis', (req, res) => {
  const { from, to } = range(req.query);
  const pid = req.query.profileId || config.profileId;
  res.json({ from, to, ...withDerived(getKpis(pid, from, to)) });
});

app.get('/api/series', (req, res) => {
  const { from, to } = range(req.query);
  const pid = req.query.profileId || config.profileId;
  res.json({ from, to, data: getDailySeries(pid, from, to).map(withDerived) });
});

app.get('/api/campaigns', (req, res) => {
  const { from, to } = range(req.query);
  const pid = req.query.profileId || config.profileId;
  res.json({ from, to, data: getCampaignBreakdown(pid, from, to).map(withDerived) });
});

app.get('/api/searchterms', (req, res) => {
  const { from, to } = range(req.query);
  const pid = req.query.profileId || config.profileId;
  const onlyWasted = req.query.wasted === '1' || req.query.wasted === 'true';
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = getSearchTerms(pid, from, to, { onlyWasted, limit }).map(withDerived);
  res.json({ from, to, data: rows });
});

// Rule-based analyst: turns the stored ad data into a business-friendly summary
// (headline, best/worst campaigns, wasted spend, anomalies, recommendations).
app.get('/api/agent/summary', (req, res) => {
  const { from, to } = range(req.query);
  const pid = req.query.profileId || config.profileId;
  res.json(buildSummary(pid, from, to));
});

// Daily / weekly / monthly performance summaries ending at ?asOf (default today).
app.get('/api/agent/periodic', (req, res) => {
  const pid = req.query.profileId || config.profileId;
  const asOf = cleanYmd(req.query.asOf) || ymd(new Date());
  res.json(buildPeriodicSummaries(pid, asOf));
});

// Product-level comparison of [from,to] vs the prior window (or ?priorFrom/priorTo).
app.get('/api/agent/compare', (req, res) => {
  const { from, to } = range(req.query);
  const pid = req.query.profileId || config.profileId;
  res.json(buildProductComparison(pid, from, to, cleanYmd(req.query.priorFrom), cleanYmd(req.query.priorTo)));
});

// Conversational AI agent — the dashboard chat box hits this. Send the plain
// text conversation so far; Gemini reads the data (read-only) and replies.
// e.g. POST /api/chat  { "messages": [{ "role": "user", "content": "..." }] }
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, profileId } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Send { messages: [{ role, content }] }.' });
    }
    const pid = profileId || config.profileId;
    const out = await chatAgent({ messages, profileId: pid });
    res.json(out);
  } catch (e) {
    console.error('chat failed:', e.message);
    let msg = e.message;
    if (/api key|authentication|api_key|permission/i.test(e.message)) {
      msg = 'AI is not configured — set GEMINI_API_KEY in backend/.env.';
    } else if (/RESOURCE_EXHAUSTED|quota|rate.?limit|429/i.test(e.message)) {
      msg = 'The AI is busy (free-tier rate limit). Please wait a few seconds and try again.';
    }
    res.status(500).json({ error: msg });
  }
});

// Supported report exports, keyed by ?kind=. Add new report types here.
const UPLOAD_HANDLERS = {
  business: ingestBusinessReport,
  inventory: ingestInventoryReport,
  finance: ingestFinanceReport,
  reviews: ingestReviewsReport,
  pricing: ingestPricingReport,
  searchquery: ingestSearchQueryReport,
  orders: ingestOrdersReport,
  advertising: ingestAdsReport,
  listings: ingestListingsReport,
};

// Upload a Seller Central report export (CSV/TSV) for the agent to ingest.
// Send the raw file text as the body; kind/date/profileId come from the query.
// e.g. POST /api/agent/upload?kind=inventory&date=2026-07-15
app.post('/api/agent/upload', express.text({ type: () => true, limit: '15mb' }), (req, res) => {
  try {
    const kind = req.query.kind || 'business';
    const pid = req.query.profileId || config.profileId;
    const date = req.query.date || ymd(new Date());
    if (typeof req.body !== 'string' || req.body.length === 0) {
      return res.status(400).json({ error: 'Empty upload — POST the CSV/TSV file content as the request body.' });
    }
    const handler = UPLOAD_HANDLERS[kind];
    if (!handler) {
      const supported = Object.keys(UPLOAD_HANDLERS).join(', ');
      return res.status(400).json({ error: `Unsupported report kind "${kind}". Supported: ${supported}.` });
    }
    res.json(handler(req.body, { profileId: pid, date }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manually pull fresh data now (the dashboard's "Refresh data" button hits this).
// Runs in the background so the request returns immediately (reports can take minutes).
let refreshing = false;
app.post('/api/refresh', (req, res) => {
  if (refreshing) return res.json({ ok: true, alreadyRunning: true });
  const days = Number(req.body?.days) || config.refreshDays;
  refreshing = true;
  fetchAll({ days })
    .catch((e) => console.error('refresh failed:', e.message))
    .finally(() => { refreshing = false; });
  res.json({ ok: true, started: true });
});

app.get('/api/refresh/status', (req, res) => res.json({ refreshing }));

// Automatic daily pull (default 06:00 server time; set REFRESH_CRON to change).
cron.schedule(config.refreshCron, () => {
  console.log('⏰ Daily fetch triggered');
  fetchAll({ days: config.refreshDays }).catch((e) => console.error('cron fetch failed:', e.message));
});

// Every 10 minutes, sweep up any reports that have finished generating.
// This catches slow reports even if a fetch loop ended or the server restarted.
cron.schedule('*/10 * * * *', () => {
  collectPending().catch((e) => console.error('collect sweep failed:', e.message));
});

app.listen(config.port, () => {
  console.log(`🚀 Backend running on http://localhost:${config.port}`);
  console.log('   Health: GET /api/health   |   Find your profile id: GET /api/profiles');
});
