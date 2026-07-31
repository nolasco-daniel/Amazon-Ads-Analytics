import { config } from '../config.js';
import { adsRequest } from '../adsClient.js';
import {
  requestSpCampaignReport,
  requestSpSearchTermReport,
  downloadReport,
} from '../reports.js';
import {
  upsertCampaignRows,
  upsertSearchTermRows,
  addReportJob,
  getPendingJobs,
  markJob,
} from '../db.js';

const ymd = (d) => d.toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function window(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return { startDate: ymd(start), endDate: ymd(end) };
}

const REQUESTERS = {
  campaigns: requestSpCampaignReport,
  searchterms: requestSpSearchTermReport,
};
const STORERS = {
  campaigns: upsertCampaignRows,
  searchterms: upsertSearchTermRows,
};

function requireProfile(profileId) {
  if (!profileId) {
    throw new Error('No profile id. Set ADS_PROFILE_ID in backend/.env (find it via GET /api/profiles).');
  }
}

// Ask Amazon to generate a report and record the job. Does NOT wait for it.
export async function requestReport(kind, { days = 14, profileId = config.profileId } = {}) {
  requireProfile(profileId);
  const { startDate, endDate } = window(days);
  const reportId = await REQUESTERS[kind](startDate, endDate, profileId);
  addReportJob(reportId, kind, new Date().toISOString());
  console.log(`📝 Requested ${kind} report ${reportId} (${startDate} → ${endDate})`);
  return reportId;
}

// Check every pending report; download + store the ones Amazon has finished.
// Reports still generating are left PENDING for the next pass.
export async function collectPending({ profileId = config.profileId } = {}) {
  const jobs = getPendingJobs();
  let storedRows = 0;
  let stillPending = 0;
  for (const { report_id, kind } of jobs) {
    try {
      const info = await adsRequest({ path: `/reporting/reports/${report_id}`, profileId });
      if (info.status === 'COMPLETED') {
        const rows = await downloadReport(info.url);
        const n = STORERS[kind](rows, profileId);
        markJob(report_id, 'DONE');
        storedRows += n;
        console.log(`✅ Collected ${kind} ${report_id}: stored ${n} rows`);
      } else if (info.status === 'FAILED' || info.status === 'CANCELLED') {
        markJob(report_id, 'FAILED');
        console.log(`⚠️  Report ${report_id} ${info.status}: ${info.failureReason || ''}`);
      } else {
        stillPending++;
      }
    } catch (e) {
      console.error(`collect error for ${report_id}:`, e.message);
    }
  }
  if (stillPending) console.log(`   ${stillPending} report(s) still generating`);
  return { storedRows, stillPending };
}

// Request the given report kinds, then poll-collect until they all land (or we
// hit maxWaitMs). Because jobs are persisted, even if this exits early a later
// collectPending() — from the cron or `npm run fetch collect` — finishes them.
export async function fetchKinds(kinds, { days = 14, profileId = config.profileId, maxWaitMs = 45 * 60 * 1000 } = {}) {
  requireProfile(profileId);
  for (const kind of kinds) await requestReport(kind, { days, profileId });

  const start = Date.now();
  while (getPendingJobs().length > 0) {
    if (Date.now() - start > maxWaitMs) {
      console.log('⏱️  Stopped waiting — remaining reports will be picked up by the next collect.');
      break;
    }
    await sleep(30_000);
    await collectPending({ profileId });
  }
}

export const fetchAll = (opts) => fetchKinds(['campaigns', 'searchterms'], opts);

// CLI:
//   npm run fetch               -> both reports
//   npm run fetch campaigns     -> campaigns only
//   npm run fetch searchterms   -> search terms only
//   npm run fetch collect       -> just collect whatever has finished
if (process.argv[1] && process.argv[1].endsWith('fetchReports.js')) {
  const which = process.argv[2];
  const run =
    which === 'collect' ? () => collectPending()
    : which === 'campaigns' ? () => fetchKinds(['campaigns'])
    : which === 'searchterms' ? () => fetchKinds(['searchterms'])
    : () => fetchAll();
  run()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('❌', e.message);
      process.exit(1);
    });
}
