import { useEffect, useState, useCallback } from 'react';
import { getKpis, getSeries, getCampaigns, getSearchTerms, getAgentSummary, getPeriodic, getCompare, uploadReport, refreshData, getRefreshStatus } from './api.js';
import KpiTiles from './components/KpiTiles.jsx';
import SpendSalesChart from './components/SpendSalesChart.jsx';
import CampaignTable from './components/CampaignTable.jsx';
import SearchTermTable from './components/SearchTermTable.jsx';
import InsightsPanel from './components/InsightsPanel.jsx';
import PeriodicSummaries from './components/PeriodicSummaries.jsx';
import ProductComparison from './components/ProductComparison.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import * as XLSX from 'xlsx';

const ymd = (d) => d.toISOString().slice(0, 10);
function rangeFor(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: ymd(from), to: ymd(to) };
}

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export default function App() {
  const [days, setDays] = useState(30);
  const [kpis, setKpis] = useState(null);
  const [series, setSeries] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [searchTerms, setSearchTerms] = useState([]);
  const [summary, setSummary] = useState(null);
  const [periodic, setPeriodic] = useState(null);
  const [compare, setCompare] = useState(null);
  const [onlyWasted, setOnlyWasted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reportKind, setReportKind] = useState('business');
  const [uploadMsg, setUploadMsg] = useState(null);
  const [theme, setTheme] = useState(null); // null = follow OS

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = rangeFor(days);
      const [k, s, c, st, ag, pg, cmp] = await Promise.all([
        getKpis(params),
        getSeries(params),
        getCampaigns(params),
        getSearchTerms({ ...params, wasted: onlyWasted ? 1 : 0, limit: 100 }),
        getAgentSummary(params),
        getPeriodic({ asOf: params.to }),
        getCompare(params),
      ]);
      setKpis(k);
      setSeries(s.data);
      setCampaigns(c.data);
      setSearchTerms(st.data);
      setSummary(ag);
      setPeriodic(pg);
      setCompare(cmp);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, [days, onlyWasted]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
  }, [theme]);

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      await refreshData(14); // kicks off a background pull on the server
      // Amazon reports take minutes — poll until the server finishes, then reload.
      const started = Date.now();
      while (Date.now() - started < 20 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 5000));
        const { refreshing: busy } = await getRefreshStatus();
        if (!busy) break;
      }
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setRefreshing(false);
    }
  }

  // Import a Seller Central Business Report (CSV/TSV) and store it for the agent.
  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-selected later
    if (!file) return;
    setUploadMsg('Uploading…');
    try {
      // Excel files are converted to CSV in the browser so the backend only
      // ever deals with plain text.
      const isExcel = /\.xlsx?$/i.test(file.name);
      let text;
      if (isExcel) {
        const wb = XLSX.read(await file.arrayBuffer());
        text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      } else {
        text = await file.text();
      }
      const { to } = rangeFor(days);
      const res = await uploadReport(reportKind, to, text);
      const warn = res.warnings?.length ? ` — ${res.warnings.length} warning(s): ${res.warnings.join(' ')}` : '';
      setUploadMsg(`Imported ${res.ingested} ${reportKind} row(s) dated ${res.date}${warn}`);
      await load();
    } catch (err) {
      setUploadMsg(err.response?.data?.error || err.message);
    }
  }

  const hasData = series.length > 0 || (kpis && kpis.impressions > 0);

  return (
    <div className="app">
      <div className="header">
        <h1>
          Amazon Ads Analytics <span className="sub">Sponsored Products</span>
        </h1>
        <div className="controls">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              className={`btn ${days === p.days ? 'active' : ''}`}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
          <button className="btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? '☀︎' : '☾'}
          </button>
          <select
            className="btn"
            value={reportKind}
            onChange={(e) => setReportKind(e.target.value)}
            style={{ cursor: 'pointer' }}
            title="Report type to upload"
          >
            <option value="business">Business report</option>
            <option value="orders">Orders report</option>
            <option value="inventory">Inventory report</option>
            <option value="finance">Settlement / finance</option>
            <option value="reviews">Reviews / ratings</option>
            <option value="pricing">Pricing</option>
            <option value="searchquery">Search query performance</option>
            <option value="advertising">Advertising (SP/SB/SD)</option>
            <option value="listings">Product listings</option>
          </select>
          <label className="btn" style={{ cursor: 'pointer' }}>
            Upload report
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" hidden onChange={handleUpload} />
          </label>
          <button className="btn primary" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Fetching… (may take a few min)' : 'Refresh data'}
          </button>
        </div>
      </div>

      {uploadMsg && (
        <div className="empty" style={{ padding: '10px 14px', textAlign: 'left', fontSize: 13 }}>
          {uploadMsg}
        </div>
      )}

      {error && (
        <div className="error">
          <strong>Couldn’t load data.</strong>
          <div style={{ marginTop: 6, fontSize: 13 }}>{error}</div>
        </div>
      )}

      {loading && !error && <div className="empty">Loading…</div>}

      {!loading && !error && !hasData && (
        <div className="empty">
          <strong>No data yet.</strong>
          <p style={{ marginTop: 8 }}>
            Add your credentials to <code>backend/.env</code>, set <code>ADS_PROFILE_ID</code>,
            then click <strong>Refresh data</strong> to pull from Amazon.
          </p>
        </div>
      )}

      {!loading && !error && hasData && (
        <>
          <KpiTiles kpis={kpis} />
          <PeriodicSummaries data={periodic} />
          <InsightsPanel summary={summary} />
          <ProductComparison data={compare} />
          <SpendSalesChart data={series} />
          <CampaignTable rows={campaigns} />
          <SearchTermTable
            rows={searchTerms}
            onlyWasted={onlyWasted}
            onToggleWasted={setOnlyWasted}
          />
        </>
      )}

      <ChatPanel />
    </div>
  );
}
