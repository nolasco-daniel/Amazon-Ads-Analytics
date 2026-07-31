// Build a product thumbnail URL from an ASIN.
//
// NOTE: This uses Amazon's public, unofficial image-CDN URL pattern — no API
// key or Associate account needed. It works for many ASINs but not all (some
// products won't resolve), so callers MUST handle the image failing to load
// (see ProductCell's onError, which falls back to plain text). For guaranteed
// coverage you'd switch to the official Product Advertising API instead.
//
// `size` maps to Amazon's `_SLxx_` sizing suffix (max pixel dimension).
export function asinImageUrl(asin, size = 80) {
  if (!asin || typeof asin !== 'string') return null;
  const clean = asin.trim().toUpperCase();
  // ASINs are 10 chars (B0... or a 10-digit ISBN). Guard against SKUs sneaking in.
  if (!/^[A-Z0-9]{10}$/.test(clean)) return null;
  return `https://images-na.ssl-images-amazon.com/images/P/${clean}.01._SCLZZZZZZZ_SL${size}_.jpg`;
}
