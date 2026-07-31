// Customer reviews analysis: surfaces products whose average rating is dragging,
// which hurts conversion and drives refunds. Recommendations point at the worst
// offenders so listing/quality fixes can be prioritized.

import { getLatestReviews } from '../ingest/reviewsReport.js';

const LOW_RATING = 4.0;      // below this is worth attention
const CRITICAL_RATING = 3.0; // below this is urgent
const MIN_REVIEWS = 3;       // ignore products with too few ratings to be meaningful

export function buildReviewHealth(profileId, asOf) {
  const rows = getLatestReviews(profileId, asOf);
  if (!rows.length) {
    return { hasReviews: false, items: [], lowRated: [], recommendations: [] };
  }

  const items = rows.map((r) => ({
    asin: r.asin, sku: r.sku, title: r.title,
    avgRating: r.avg_rating, numReviews: r.num_reviews,
  }));

  const lowRated = items
    .filter((i) => i.avgRating != null && i.avgRating < LOW_RATING && (i.numReviews || 0) >= MIN_REVIEWS)
    .sort((a, b) => a.avgRating - b.avgRating || (b.numReviews - a.numReviews));

  return { hasReviews: true, asOf, items, lowRated, recommendations: recommend(lowRated) };
}

function recommend(lowRated) {
  return lowRated.slice(0, 5).map((i) => {
    const id = i.sku || i.asin;
    const urgent = i.avgRating < CRITICAL_RATING;
    return {
      priority: urgent ? 'high' : 'medium',
      impact: i.numReviews || 0, // more reviews = more shoppers see the low rating
      area: 'reviews',
      title: `Improve rating on ${id} (${i.avgRating.toFixed(1)}★)`,
      why: `Average rating is ${i.avgRating.toFixed(1)}★ across ${i.numReviews} review(s) — low ratings cut conversion and raise refunds.`,
      action: 'Read recent negative reviews and fix the root cause (listing accuracy, quality, or packaging).',
    };
  });
}
