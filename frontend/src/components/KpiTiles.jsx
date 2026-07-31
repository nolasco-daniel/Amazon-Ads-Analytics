import { money, num, pct, mult } from '../utils/format.js';

export default function KpiTiles({ kpis }) {
  if (!kpis) return null;
  const tiles = [
    { label: 'Spend', value: money(kpis.cost) },
    { label: 'Sales', value: money(kpis.sales) },
    { label: 'ACoS', value: pct(kpis.acos) },
    { label: 'ROAS', value: mult(kpis.roas) },
    { label: 'Clicks', value: num(kpis.clicks) },
    { label: 'Impressions', value: num(kpis.impressions) },
    { label: 'Orders', value: num(kpis.purchases) },
    { label: 'CPC', value: money(kpis.cpc) },
  ];
  return (
    <div className="kpis">
      {tiles.map((t) => (
        <div className="kpi" key={t.label}>
          <div className="label">{t.label}</div>
          <div className="value">{t.value}</div>
        </div>
      ))}
    </div>
  );
}
