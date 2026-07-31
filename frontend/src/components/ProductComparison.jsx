import { money } from '../utils/format.js';
import ProductCell from './ProductCell.jsx';

const muted = { color: 'var(--text-2)', fontSize: 12 };
const sectionTitle = {
  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '0.4px', color: 'var(--muted)', margin: '14px 0 8px',
};

// Signed percent with a leading sign, e.g. +42.0% / −18.5%.
const signed = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}%`);

export default function ProductComparison({ data }) {
  if (!data || !data.hasData) return null;
  if (!data.risers?.length && !data.fallers?.length) return null;

  return (
    <div className="card">
      <h2>
        Product movers{' '}
        <span style={{ ...muted, fontWeight: 400 }}>
          {data.period?.from} → {data.period?.to} vs {data.comparison?.from} → {data.comparison?.to}
        </span>
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }}>
        {data.risers?.length > 0 && (
          <div>
            <div style={sectionTitle}>Top risers</div>
            <MoversTable rows={data.risers} />
          </div>
        )}
        {data.fallers?.length > 0 && (
          <div>
            <div style={sectionTitle}>Top fallers</div>
            <MoversTable rows={data.fallers} />
          </div>
        )}
      </div>
    </div>
  );
}

function MoversTable({ rows }) {
  return (
    <table>
      <thead>
        <tr><th>Product</th><th>Sales</th><th>Prior</th><th>Change</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><ProductCell item={r} /></td>
            <td>{money(r.sales)}</td>
            <td>{money(r.priorSales)}</td>
            <td>
              <span className="pill">
                <span className={`dot ${r.salesDelta >= 0 ? 'good' : 'critical'}`} />
                {r.salesChange == null ? money(r.salesDelta) : signed(r.salesChange)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
