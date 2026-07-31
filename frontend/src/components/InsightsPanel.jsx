import { money, num, pct, acosStatus } from '../utils/format.js';
import ProductCell from './ProductCell.jsx';

// Map recommendation priority onto the existing status-dot colors
// (high = red/critical, medium = amber/warning, low = green/good).
const PRIORITY_DOT = { high: 'critical', medium: 'warning', low: 'good' };

const muted = { color: 'var(--text-2)', fontSize: 13 };
const sectionTitle = {
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.4px', color: 'var(--muted)', margin: '18px 0 8px',
};

export default function InsightsPanel({ summary }) {
  if (!summary) return null;

  // Behavior: surface missing-data warnings instead of analyzing empty numbers.
  if (summary.dataAvailable === false) {
    return (
      <div className="card">
        <h2>AI Insights</h2>
        {(summary.warnings || []).map((w, i) => (
          <p key={i} style={{ ...muted, margin: '4px 0' }}>⚠️ {w}</p>
        ))}
      </div>
    );
  }

  const {
    headline, recommendations = [], topCampaigns = [], underperformers = [],
    wastedSpend, anomalies = [], warnings = [], period, comparison, inventory, profitability, reviews, pricing, search, listings,
  } = summary;

  // Margin health bucket, reusing the status-dot colors.
  const marginDot = (m) => (m == null ? 'none' : m < 0.05 ? 'critical' : m < 0.15 ? 'warning' : 'good');

  return (
    <div className="card">
      <h2>
        AI Insights{' '}
        <span style={{ ...muted, fontWeight: 400 }}>
          {period?.from} → {period?.to}
          {comparison && ` (vs ${comparison.from} → ${comparison.to})`}
        </span>
      </h2>

      {warnings.map((w, i) => (
        <p key={i} style={{ ...muted, margin: '4px 0' }}>⚠️ {w}</p>
      ))}

      {/* Executive headline */}
      {headline?.notes?.length > 0 && (
        <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.7, fontSize: 14 }}>
          {headline.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}

      {/* Profitability P&L */}
      {profitability && (
        <>
          <div style={sectionTitle}>Profitability</div>
          <table>
            <tbody>
              <tr><td>Net sales (after refunds)</td><td>{money(profitability.netSales)}</td></tr>
              <tr><td>Amazon fees</td><td>−{money(profitability.fees)}</td></tr>
              <tr><td>Refunds</td><td>−{money(profitability.refunds)}</td></tr>
              <tr><td>Shipping</td><td>{money(profitability.shipping)}</td></tr>
              <tr><td>Ad spend</td><td>−{money(profitability.adSpend)}</td></tr>
              <tr style={{ fontWeight: 600 }}>
                <td>Net profit</td>
                <td>
                  <span className="pill">
                    <span className={`dot ${marginDot(profitability.margin)}`} />
                    {money(profitability.netProfit)} ({pct(profitability.margin)})
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {/* Prioritized recommendations */}
      {recommendations.length > 0 && (
        <>
          <div style={sectionTitle}>Recommendations (by impact)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {recommendations.map((r, i) => (
              <div key={i} style={{
                border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="pill">
                    <span className={`dot ${PRIORITY_DOT[r.priority] || 'none'}`} />
                    {r.priority}
                  </span>
                  <strong style={{ fontSize: 14 }}>{r.title}</strong>
                </div>
                <div style={{ ...muted, marginTop: 4 }}>Why: {r.why}</div>
                <div style={{ ...muted, marginTop: 2 }}>Do: {r.action}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Best & worst performers side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
        {topCampaigns.length > 0 && (
          <div>
            <div style={sectionTitle}>Best performers</div>
            <PerfList rows={topCampaigns} />
          </div>
        )}
        {underperformers.length > 0 && (
          <div>
            <div style={sectionTitle}>Worst performers</div>
            <PerfList rows={underperformers} showReason />
          </div>
        )}
      </div>

      {/* Wasted spend */}
      {wastedSpend?.total > 0 && (
        <>
          <div style={sectionTitle}>
            Wasted spend — {money(wastedSpend.total)} across {wastedSpend.count} search term(s)
          </div>
          <table>
            <thead>
              <tr><th>Search term</th><th>Matched keyword</th><th>Clicks</th><th>Spent</th></tr>
            </thead>
            <tbody>
              {wastedSpend.terms.map((t, i) => (
                <tr key={i}>
                  <td>{t.search_term || '—'}</td>
                  <td>{t.keyword || '—'}</td>
                  <td>{num(t.clicks)}</td>
                  <td>{money(t.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Inventory health */}
      {inventory && (inventory.stockoutRisk?.length > 0 || inventory.overstock?.length > 0) && (
        <>
          <div style={sectionTitle}>Inventory health — as of {inventory.asOf}</div>
          {inventory.stockoutRisk?.length > 0 && (
            <>
              <div style={{ ...muted, margin: '2px 0 6px' }}>Stockout risk</div>
              <table>
                <thead>
                  <tr><th>Product</th><th>In stock</th><th>Inbound</th><th>Units/day</th><th>Days cover</th></tr>
                </thead>
                <tbody>
                  {inventory.stockoutRisk.slice(0, 10).map((i, idx) => (
                    <tr key={idx}>
                      <td><ProductCell item={i} /></td>
                      <td>
                        <span className="pill">
                          <span className={`dot ${i.available === 0 || i.daysOfCover < 7 ? 'critical' : 'warning'}`} />
                          {num(i.available)}
                        </span>
                      </td>
                      <td>{num(i.inbound)}</td>
                      <td>{i.velocity?.toFixed(1)}</td>
                      <td>{i.daysOfCover == null ? '—' : Math.round(i.daysOfCover)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {inventory.overstock?.length > 0 && (
            <>
              <div style={{ ...muted, margin: '10px 0 6px' }}>Overstock</div>
              <table>
                <thead>
                  <tr><th>Product</th><th>In stock</th><th>Days cover</th><th>Capital tied up</th></tr>
                </thead>
                <tbody>
                  {inventory.overstock.slice(0, 10).map((i, idx) => (
                    <tr key={idx}>
                      <td><ProductCell item={i} /></td>
                      <td>{num(i.available)}</td>
                      <td>{i.daysOfCover == null ? '—' : Math.round(i.daysOfCover)}</td>
                      <td>{money(i.available * (i.price || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {/* Search-query growth opportunities */}
      {search?.opportunities?.length > 0 && (
        <>
          <div style={sectionTitle}>Search opportunities — as of {search.asOf}</div>
          <table>
            <thead>
              <tr><th>Search query</th><th>Volume</th><th>Query purchases</th><th>Your share</th></tr>
            </thead>
            <tbody>
              {search.opportunities.slice(0, 10).map((o, idx) => (
                <tr key={idx}>
                  <td>{o.query}</td>
                  <td>{num(o.volume)}</td>
                  <td>{num(o.purchasesTotal)}</td>
                  <td>
                    <span className="pill">
                      <span className={`dot ${o.purchaseShare != null && o.purchaseShare < 0.15 ? 'critical' : 'warning'}`} />
                      {pct(o.purchaseShare)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Priced above Buy Box */}
      {pricing?.aboveBuyBox?.length > 0 && (
        <>
          <div style={sectionTitle}>Priced above Buy Box — as of {pricing.asOf}</div>
          <table>
            <thead>
              <tr><th>Product</th><th>Your price</th><th>Buy Box</th><th>Gap</th></tr>
            </thead>
            <tbody>
              {pricing.aboveBuyBox.slice(0, 10).map((i, idx) => (
                <tr key={idx}>
                  <td><ProductCell item={i} /></td>
                  <td>{money(i.yourPrice)}</td>
                  <td>{money(i.buyBoxPrice)}</td>
                  <td>
                    <span className="pill">
                      <span className={`dot ${i.gapPct > 0.05 ? 'critical' : 'warning'}`} />
                      {money(i.gap)} ({pct(i.gapPct)})
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Weak listings */}
      {listings?.weak?.length > 0 && (
        <>
          <div style={sectionTitle}>Listing quality — as of {listings.asOf}</div>
          <table>
            <thead>
              <tr><th>Product</th><th>Title</th><th>Images</th><th>Bullets</th><th>Issues</th></tr>
            </thead>
            <tbody>
              {listings.weak.slice(0, 10).map((i, idx) => (
                <tr key={idx}>
                  <td><ProductCell item={i} /></td>
                  <td>{i.titleLen == null ? '—' : `${i.titleLen} chars`}</td>
                  <td>{i.images == null ? '—' : num(i.images)}</td>
                  <td>{i.bullets == null ? '—' : num(i.bullets)}</td>
                  <td>
                    <span className="pill">
                      <span className={`dot ${i.issues.length >= 3 ? 'critical' : 'warning'}`} />
                      {i.issues.length}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Low-rated products */}
      {reviews?.lowRated?.length > 0 && (
        <>
          <div style={sectionTitle}>Low-rated products — as of {reviews.asOf}</div>
          <table>
            <thead>
              <tr><th>Product</th><th>Rating</th><th>Reviews</th></tr>
            </thead>
            <tbody>
              {reviews.lowRated.slice(0, 10).map((i, idx) => (
                <tr key={idx}>
                  <td><ProductCell item={i} /></td>
                  <td>
                    <span className="pill">
                      <span className={`dot ${i.avgRating < 3 ? 'critical' : 'warning'}`} />
                      {i.avgRating?.toFixed(1)}★
                    </span>
                  </td>
                  <td>{num(i.numReviews)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <>
          <div style={sectionTitle}>Anomalies detected</div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, ...muted }}>
            {anomalies.map((a, i) => (
              <li key={i}>
                <span className="pill">
                  <span className={`dot ${a.direction === 'drop' ? 'critical' : 'warning'}`} />
                </span>{' '}
                {a.note}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// Compact list of campaigns with an ACoS status dot; optional reason line.
function PerfList({ rows, showReason = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map((c) => (
        <div key={c.campaign_id} style={{
          display: 'flex', justifyContent: 'space-between', gap: 10,
          borderBottom: '1px solid var(--grid)', paddingBottom: 6, fontSize: 13,
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.campaign_name || c.campaign_id}
            </div>
            {showReason && <div style={{ ...muted, fontSize: 12 }}>{c.reason}</div>}
          </div>
          <div style={{ textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            <span className="pill">
              <span className={`dot ${acosStatus(c.acos)}`} />
              {pct(c.acos)}
            </span>
            <div style={{ ...muted, fontSize: 12 }}>{money(c.sales)} sales · {money(c.cost)} spend</div>
          </div>
        </div>
      ))}
    </div>
  );
}
