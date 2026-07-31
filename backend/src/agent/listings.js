// Product listing quality analysis: flags weak listings (short title, too few
// images, too few bullet points, missing description). Weak listings convert
// worse, so fixing them lifts both organic and paid performance.

import { getLatestListings } from '../ingest/listingsReport.js';

const MIN_TITLE = 80;   // characters
const MIN_IMAGES = 5;
const MIN_BULLETS = 5;

export function buildListingHealth(profileId, asOf) {
  const rows = getLatestListings(profileId, asOf);
  if (!rows.length) {
    return { hasListings: false, items: [], weak: [], recommendations: [] };
  }

  const items = rows.map((r) => {
    const issues = [];
    if (r.title_len != null && r.title_len < MIN_TITLE) issues.push(`short title (${r.title_len} chars)`);
    if (r.images != null && r.images < MIN_IMAGES) issues.push(`only ${r.images} image(s)`);
    if (r.bullets != null && r.bullets < MIN_BULLETS) issues.push(`only ${r.bullets} bullet(s)`);
    if (r.has_description === 0) issues.push('no description');
    return {
      sku: r.sku, asin: r.asin, title: r.title,
      titleLen: r.title_len, images: r.images, bullets: r.bullets,
      hasDescription: r.has_description, issues,
    };
  });

  const weak = items
    .filter((i) => i.issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length);

  return { hasListings: true, asOf, items, weak, recommendations: recommend(weak) };
}

function recommend(weak) {
  return weak.slice(0, 5).map((i) => ({
    priority: i.issues.length >= 3 ? 'high' : 'medium',
    impact: i.issues.length, // more gaps = more upside
    area: 'listing',
    title: `Improve listing ${i.sku || i.asin}`,
    why: `Listing quality gaps: ${i.issues.join(', ')}.`,
    action: 'Fill out the title, add more images, complete the bullet points and description to lift conversion.',
  }));
}
