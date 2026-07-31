import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { money } from '../utils/format.js';

// Spend and Sales are both dollars, so they share ONE y-axis (no dual-axis).
const SALES = 'var(--series-sales)';
const SPEND = 'var(--series-spend)';

function TooltipBox({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tt">
      <div style={{ color: 'var(--text-2)', marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div className="row" key={p.name}>
          <span className="swatch" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-2)' }}>{p.name}:</span>
          <strong style={{ color: 'var(--text-1)' }}>{money(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function SpendSalesChart({ data }) {
  return (
    <div className="card">
      <h2>Spend vs Sales over time</h2>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: 'var(--baseline)' }}
          />
          <YAxis
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => money(v)}
            width={70}
          />
          <Tooltip content={<TooltipBox />} />
          <Legend wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />
          <Line type="monotone" dataKey="sales" name="Sales" stroke={SALES}
                strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey="cost" name="Spend" stroke={SPEND}
                strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
