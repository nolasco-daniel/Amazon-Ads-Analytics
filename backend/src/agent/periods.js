// Daily / weekly / monthly performance summaries. Reuses buildSummary() over
// three windows ending at `asOf`, returning a compact view (headline + top
// actions + net profit) suitable for at-a-glance cards.

import { buildSummary } from './analyze.js';
import { addDays } from './metrics.js';

function windows(asOf) {
  return {
    daily: { from: asOf, to: asOf },
    weekly: { from: addDays(asOf, -6), to: asOf },
    monthly: { from: addDays(asOf, -29), to: asOf },
  };
}

export function buildPeriodicSummaries(profileId, asOf) {
  const w = windows(asOf);

  const compact = (label, range) => {
    const s = buildSummary(profileId, range.from, range.to);
    return {
      label,
      from: range.from,
      to: range.to,
      dataAvailable: s.dataAvailable !== false,
      headline: s.headline?.notes || [],
      topRecommendations: (s.recommendations || []).slice(0, 3).map((r) => ({
        priority: r.priority, title: r.title,
      })),
      netProfit: s.profitability?.netProfit ?? null,
      margin: s.profitability?.margin ?? null,
    };
  };

  return {
    daily: compact('Daily', w.daily),
    weekly: compact('Weekly', w.weekly),
    monthly: compact('Monthly', w.monthly),
  };
}
