import 'dotenv/config';

function need(name) {
  const v = process.env[name];
  if (!v) console.warn(`⚠️  Missing env var ${name} — set it in backend/.env (copy from .env.example)`);
  return v || '';
}

export const config = {
  clientId: need('ADS_CLIENT_ID'),
  clientSecret: need('ADS_CLIENT_SECRET'),
  refreshToken: need('ADS_REFRESH_TOKEN'),
  profileId: process.env.ADS_PROFILE_ID || '',
  apiHost: process.env.ADS_API_HOST || 'https://advertising-api.amazon.com',
  tokenUrl: process.env.ADS_TOKEN_URL || 'https://api.amazon.com/auth/o2/token',
  port: Number(process.env.PORT || 4000),
  // How many recent days a "Refresh data" pull re-requests from Amazon.
  // Amazon keeps updating attribution for ~48–72h, so we re-pull a window.
  refreshDays: Number(process.env.REFRESH_DAYS || 14),
  // Daily auto-refresh time (cron expression, server timezone).
  refreshCron: process.env.REFRESH_CRON || '0 6 * * *',
};
