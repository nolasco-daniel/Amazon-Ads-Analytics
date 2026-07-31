import { money, pct } from '../utils/format.js';

// Priority -> status dot color, matching the Insights panel.
const PRIORITY_DOT = { high: 'critical', medium: 'warning', low: 'good' };
const muted = { color: 'var(--text-2)', fontSize: 12 };

export default function PeriodicSummaries({ data }) {
  if (!data) return null;
  const cards = [data.daily, data.weekly, data.monthly].filter(Boolean);
  if (cards.length === 0) return null;

  return (
    <div className="card">
      <h2>Performance summaries</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
            <div style={{ fontWeight: 600 }}>{c.label}</div>
            <div style={muted}>{c.from}{c.from !== c.to && ` → ${c.to}`}</div>

            {!c.dataAvailable ? (
              <div style={{ ...muted, marginTop: 8 }}>No data for this period.</div>
            ) : (
              <>
                {c.netProfit != null && (
                  <div style={{ marginTop: 8, fontSize: 14 }}>
                    Net profit <strong>{money(c.netProfit)}</strong>
                    {c.margin != null && <span style={muted}> ({pct(c.margin)})</span>}
                  </div>
                )}
                {c.headline?.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 16, lineHeight: 1.6, fontSize: 13 }}>
                    {c.headline.map((n, i) => <li key={i}>{n}</li>)}
                  </ul>
                )}
                {c.topRecommendations?.length > 0 && (
                  <>
                    <div style={{ ...muted, marginTop: 8, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                      Top actions
                    </div>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 16, lineHeight: 1.6, fontSize: 13 }}>
                      {c.topRecommendations.map((r, i) => (
                        <li key={i}>
                          <span className="pill">
                            <span className={`dot ${PRIORITY_DOT[r.priority] || 'none'}`} />
                          </span>{' '}
                          {r.title}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
