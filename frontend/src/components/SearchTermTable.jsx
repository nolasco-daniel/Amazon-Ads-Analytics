import { money, num, pct, acosStatus } from '../utils/format.js';

export default function SearchTermTable({ rows, onlyWasted, onToggleWasted }) {
  const wastedSpend = rows
    .filter((r) => r.sales === 0 && r.clicks > 0)
    .reduce((sum, r) => sum + (r.cost || 0), 0);

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Search terms</h2>
        <span className="sub" style={{ color: 'var(--text-2)', fontSize: 13 }}>
          the actual queries shoppers typed
        </span>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyWasted} onChange={(e) => onToggleWasted(e.target.checked)} />
          Only wasted spend (clicks, no sales)
        </label>
      </div>

      {onlyWasted && (
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--critical)' }}>
          💸 {money(wastedSpend)} spent on these terms with zero sales — candidates to negative-match.
        </p>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Search term</th>
              <th>Matched keyword</th>
              <th>Match</th>
              <th>Spend</th>
              <th>Sales</th>
              <th>ACoS</th>
              <th>Clicks</th>
              <th>Orders</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const status = acosStatus(r.acos);
              const wasted = r.sales === 0 && r.clicks > 0;
              return (
                <tr key={i}>
                  <td>{r.search_term || '—'}</td>
                  <td style={{ color: 'var(--text-2)' }}>{r.keyword || '(auto)'}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.match_type || '—'}</td>
                  <td>{money(r.cost)}</td>
                  <td>{money(r.sales)}</td>
                  <td>
                    {wasted ? (
                      <span className="pill"><span className="dot critical" />no sales</span>
                    ) : (
                      <span className="pill"><span className={`dot ${status}`} />{pct(r.acos)}</span>
                    )}
                  </td>
                  <td>{num(r.clicks)}</td>
                  <td>{num(r.purchases)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ color: 'var(--muted)', textAlign: 'center', padding: 20 }}>
                No search-term data for this range yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
