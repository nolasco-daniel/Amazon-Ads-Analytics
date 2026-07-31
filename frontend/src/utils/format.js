// Small formatting helpers. Currency defaults to USD — change here if needed.
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const int = new Intl.NumberFormat('en-US');

export const money = (v) => (v == null ? '—' : usd.format(v));
export const num = (v) => (v == null ? '—' : int.format(Math.round(v)));
export const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
export const mult = (v) => (v == null ? '—' : `${v.toFixed(2)}×`);

// ACoS health bucket (ad spend / sales). Thresholds are opinionated defaults —
// tune them to your margins.
export function acosStatus(acos) {
  if (acos == null) return 'none';
  if (acos <= 0.25) return 'good';
  if (acos <= 0.4) return 'warning';
  return 'critical';
}
