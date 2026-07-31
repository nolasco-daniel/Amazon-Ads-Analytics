// Demo data seeder — loads realistic SAMPLE data into the SQLite DB so the whole
// agent (ads, business, inventory, finance, reviews, pricing, search) lights up
// without needing real Amazon credentials or report exports.
//
// Run once from the backend folder:   node scripts/seed-demo.js
// Safe to delete this file anytime; it only writes sample rows.

import { upsertCampaignRows, upsertSearchTermRows } from '../src/db.js';
import { ingestBusinessReport } from '../src/ingest/businessReport.js';
import { ingestInventoryReport } from '../src/ingest/inventoryReport.js';
import { ingestFinanceReport } from '../src/ingest/financeReport.js';
import { ingestReviewsReport } from '../src/ingest/reviewsReport.js';
import { ingestPricingReport } from '../src/ingest/pricingReport.js';
import { ingestSearchQueryReport } from '../src/ingest/searchQueryReport.js';
import { ingestOrdersReport } from '../src/ingest/ordersReport.js';
import { ingestListingsReport } from '../src/ingest/listingsReport.js';

const PID = process.env.ADS_PROFILE_ID || ''; // must match the API's default profile
const ymd = (d) => d.toISOString().slice(0, 10);
const dayAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };

// --- 1) Sponsored Products campaign daily (46 days, with one injected anomaly) ---
const campaigns = [
  { id: '1001', name: 'SP - Best Seller', imp: 1200, clk: 60, cpc: 0.45, cvr: 0.12, aov: 35 },
  { id: '1002', name: 'Auto - Catch All', imp: 2000, clk: 80, cpc: 0.55, cvr: 0.02, aov: 20 }, // high ACoS
  { id: '1003', name: 'Brand Defense', imp: 800, clk: 40, cpc: 0.30, cvr: 0.20, aov: 40 },
];
const campRows = [];
for (let n = 46; n >= 0; n--) {
  const date = dayAgo(n);
  for (const c of campaigns) {
    const jitter = 0.85 + ((n * 7 + Number(c.id)) % 30) / 100; // deterministic wiggle
    let clicks = Math.round(c.clk * jitter);
    let purchases = Math.round(clicks * c.cvr);
    let cost = +(clicks * c.cpc).toFixed(2);
    let sales = +(purchases * c.aov).toFixed(2);
    // Inject a sudden sales drop 3 days ago on the best seller (anomaly detection demo).
    if (n === 3 && c.id === '1001') { sales = +(sales * 0.2).toFixed(2); purchases = Math.round(purchases * 0.2); }
    campRows.push({
      date, campaignId: c.id, campaignName: c.name,
      impressions: Math.round(c.imp * jitter), clicks, cost, purchases, sales,
    });
  }
}
upsertCampaignRows(campRows, PID);

// --- 2) Search terms (two wasted, one good) ---
upsertSearchTermRows([
  { date: dayAgo(1), campaignId: '1002', campaignName: 'Auto - Catch All', keyword: '*', matchType: 'AUTO', searchTerm: 'cheap gadget', impressions: 500, clicks: 25, cost: 12.5, purchases: 0, sales: 0 },
  { date: dayAgo(1), campaignId: '1002', campaignName: 'Auto - Catch All', keyword: '*', matchType: 'AUTO', searchTerm: 'free widget', impressions: 300, clicks: 15, cost: 8.0, purchases: 0, sales: 0 },
  { date: dayAgo(1), campaignId: '1001', campaignName: 'SP - Best Seller', keyword: 'best widget', matchType: 'PHRASE', searchTerm: 'best widget 2026', impressions: 400, clicks: 30, cost: 13.5, purchases: 6, sales: 210 },
], PID);

// --- 3) Business report (today + a prior snapshot for period-over-period) ---
const bizCsv = (m) => [
  '(Child) ASIN,Title,SKU,Sessions - Total,Page Views - Total,Buy Box Percentage,Units Ordered,Unit Session Percentage,Ordered Product Sales',
  `B0FAST01,Fast Widget,SKU-1,${Math.round(1500 * m)},${Math.round(2200 * m)},98%,${Math.round(300 * m)},20.0%,$${(300 * m * 25).toFixed(2)}`,
  `B0SLOW02,Slow Gadget,SKU-2,${Math.round(400 * m)},${Math.round(600 * m)},70%,${Math.round(30 * m)},7.5%,$${(30 * m * 25).toFixed(2)}`,
  `B0CONV03,Meh Product,SKU-3,${Math.round(1200 * m)},${Math.round(1500 * m)},92%,${Math.round(36 * m)},3.0%,$${(36 * m * 40).toFixed(2)}`,
].join('\n');
ingestBusinessReport(bizCsv(1), { profileId: PID, date: dayAgo(0) });
ingestBusinessReport(bizCsv(0.7), { profileId: PID, date: dayAgo(35) });

// --- 4) Inventory (fast+low = stockout risk, slow+huge = overstock) ---
ingestInventoryReport([
  'sku,asin,product-name,afn-fulfillable-quantity,afn-inbound-shipped-quantity,your-price',
  'SKU-1,B0FAST01,Fast Widget,60,0,25.00',
  'SKU-2,B0SLOW02,Slow Gadget,900,0,25.00',
  'SKU-3,B0CONV03,Meh Product,200,50,40.00',
].join('\n'), { profileId: PID, date: dayAgo(0) });

// --- 5) Settlement / finance (sales, fees, refunds, shipping) ---
ingestFinanceReport([
  'transaction-type\tposted-date\tamount-type\tamount-description\tamount',
  `Order\t${dayAgo(2)}\tItemPrice\tPrincipal\t9000.00`,
  `Order\t${dayAgo(2)}\tItemPrice\tShipping\t400.00`,
  `Order\t${dayAgo(2)}\tItemFees\tCommission\t-1350.00`,
  `Order\t${dayAgo(2)}\tItemFees\tFBAPerUnitFulfillmentFee\t-1600.00`,
  `Refund\t${dayAgo(2)}\tItemPrice\tPrincipal\t-950.00`,
].join('\n'), { profileId: PID, date: dayAgo(2) });

// --- 6) Reviews (one low-rated product) ---
ingestReviewsReport([
  'asin,sku,product-name,average-rating,review-count',
  'B0FAST01,SKU-1,Fast Widget,4.6,320',
  'B0CONV03,SKU-3,Meh Product,3.2,45',
].join('\n'), { profileId: PID, date: dayAgo(0) });

// --- 7) Pricing (one listing above the Buy Box) ---
ingestPricingReport([
  'seller-sku,asin,item-name,your-price,buy-box-price,lowest-price',
  'SKU-3,B0CONV03,Meh Product,42.00,39.00,38.50',
  'SKU-1,B0FAST01,Fast Widget,25.00,25.00,24.90',
].join('\n'), { profileId: PID, date: dayAgo(0) });

// --- 8) Search Query Performance (high-demand, low-share opportunity) ---
ingestSearchQueryReport([
  'Search Query,Search Query Volume,Impressions: Total Count,Impressions: ASIN Count,Clicks: Total Count,Clicks: ASIN Count,Purchases: Total Count,Purchases: ASIN Count',
  'widget,50000,120000,8000,9000,600,1200,60',
  'best gadget,20000,50000,6000,4000,500,700,120',
].join('\n'), { profileId: PID, date: dayAgo(0) });

// --- 9) Orders (a few days of orders) ---
ingestOrdersReport([
  'amazon-order-id,purchase-date,sku,quantity,item-price,order-status',
  `111-0000001,${dayAgo(1)},SKU-1,2,50.00,Shipped`,
  `111-0000002,${dayAgo(1)},SKU-3,1,40.00,Shipped`,
  `111-0000003,${dayAgo(2)},SKU-2,1,25.00,Shipped`,
  `111-0000004,${dayAgo(2)},SKU-1,3,75.00,Cancelled`,
].join('\n'), { profileId: PID, date: dayAgo(1) });

// --- 10) Product listings (one weak listing) ---
ingestListingsReport([
  'sku,asin,item-name,image-count,bullet-point-count,product-description',
  'SKU-1,B0FAST01,Fast Widget - Premium Stainless Steel Kitchen Tool with Ergonomic Grip and Lifetime Warranty,7,5,Great product',
  'SKU-3,B0CONV03,Meh Product,2,2,',
].join('\n'), { profileId: PID, date: dayAgo(0) });

console.log('✅ Seeded demo data:');
console.log(`   ${campRows.length} campaign-day rows, plus business/inventory/finance/reviews/pricing/search snapshots.`);
console.log('   Profile id used:', JSON.stringify(PID), '(matches the API default)');
console.log('   Refresh the dashboard to see the agent light up.');
