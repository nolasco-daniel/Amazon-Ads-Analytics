import { money, num, pct, mult, acosStatus } from '../utils/format.js';

export default function CampaignTable({ rows }) {
  return (
    <div className="card">
      <h2>Campaigns (by spend)</h2>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Spend</th>
              <th>Sales</th>
              <th>ACoS</th>
              <th>ROAS</th>
              <th>Clicks</th>
              <th>Orders</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = acosStatus(r.acos);
              return (
                <tr key={r.campaign_id}>
                  <td>{r.campaign_name || r.campaign_id}</td>
                  <td>{money(r.cost)}</td>
                  <td>{money(r.sales)}</td>
                  <td>
                    {/* dot (icon) + value (label) → status never rides on color alone */}
                    <span className="pill">
                      <span className={`dot ${status}`} />
                      {pct(r.acos)}
                    </span>
                  </td>
                  <td>{mult(r.roas)}</td>
                  <td>{num(r.clicks)}</td>
                  <td>{num(r.purchases)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
