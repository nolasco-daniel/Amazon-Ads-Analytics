import { useState } from 'react';
import { asinImageUrl } from '../utils/productImage.js';

// Renders a product as a small thumbnail + label. The thumbnail is best-effort:
// Amazon's unofficial image URL doesn't resolve for every ASIN, so if the image
// fails to load we hide it and show the label alone — same as before this existed.
export default function ProductCell({ item }) {
  const [broken, setBroken] = useState(false);
  const asin = item?.asin;
  const label = item?.title || item?.sku || item?.asin || '—';
  const src = broken ? null : asinImageUrl(asin);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      {src && (
        <img
          src={src}
          alt=""
          width={28}
          height={28}
          loading="lazy"
          onError={() => setBroken(true)}
          // Amazon serves a 1x1 transparent GIF (HTTP 200, not 404) for ASINs
          // with no image, so onError never fires. Detect that placeholder by its
          // tiny natural size and fall back to text like a real load failure.
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth <= 1) setBroken(true);
          }}
          style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4, flexShrink: 0, background: 'var(--bg-2, #1a1a1a)' }}
        />
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>
        {label}
      </span>
    </div>
  );
}
