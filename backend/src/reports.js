import zlib from 'node:zlib';
import axios from 'axios';
import { adsRequest } from './adsClient.js';

// Columns available for the Sponsored Products "spCampaigns" report (v3).
const SP_COLUMNS = [
  'date',
  'campaignId',
  'campaignName',
  'impressions',
  'clicks',
  'cost',
  'purchases7d',
  'sales7d',
];

// Step 1 — ask Amazon to generate an async report. Returns a reportId.
export async function requestSpCampaignReport(startDate, endDate, profileId) {
  const body = {
    name: `SP campaigns ${startDate}..${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: 'SPONSORED_PRODUCTS',
      groupBy: ['campaign'],
      columns: SP_COLUMNS,
      reportTypeId: 'spCampaigns',
      timeUnit: 'DAILY',
      format: 'GZIP_JSON',
    },
  };
  const data = await adsRequest({
    method: 'POST',
    path: '/reporting/reports',
    data: body,
    headers: { 'Content-Type': 'application/vnd.createasyncreportrequest.v3+json' },
    profileId,
  });
  return data.reportId;
}

// Columns for the SP "spSearchTerm" report — the actual customer queries that
// triggered your ads, plus which keyword/target they matched.
const SEARCHTERM_COLUMNS = [
  'date',
  'campaignId',
  'campaignName',
  'adGroupId',
  'keyword',      // the matched keyword/target ("*" for auto-targeting)
  'matchType',
  'searchTerm',   // what the shopper actually typed
  'impressions',
  'clicks',
  'cost',
  'purchases7d',
  'sales7d',
];

export async function requestSpSearchTermReport(startDate, endDate, profileId) {
  const body = {
    name: `SP search terms ${startDate}..${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: 'SPONSORED_PRODUCTS',
      groupBy: ['searchTerm'],
      columns: SEARCHTERM_COLUMNS,
      reportTypeId: 'spSearchTerm',
      timeUnit: 'DAILY',
      format: 'GZIP_JSON',
    },
  };
  const data = await adsRequest({
    method: 'POST',
    path: '/reporting/reports',
    data: body,
    headers: { 'Content-Type': 'application/vnd.createasyncreportrequest.v3+json' },
    profileId,
  });
  return data.reportId;
}

// Step 2 — download the gzipped JSON and parse it into an array of rows.
export async function downloadReport(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  const buf = Buffer.from(res.data);
  let text;
  try {
    text = zlib.gunzipSync(buf).toString('utf-8');
  } catch {
    text = buf.toString('utf-8'); // fall back if it wasn't gzipped
  }
  return JSON.parse(text);
}
