import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { config } from '../config.js';

// Where Amazon sends you back after you approve. Must EXACTLY match an
// "Allowed Return URL" registered on your Login-with-Amazon app.
const REDIRECT_URI = process.env.ADS_REDIRECT_URI || 'https://localhost';
// Scope must be ASSIGNED to your LWA app in the Amazon Ads console first,
// otherwise LWA rejects it as an "unknown scope". Override via ADS_SCOPE if needed.
const SCOPE = process.env.ADS_SCOPE || 'advertising::campaign_management';

// NA auth host. EU -> https://eu.account.amazon.com/ap/oa
//                FE -> https://apac.account.amazon.com/ap/oa
const AUTH_BASE = process.env.ADS_AUTH_URL || 'https://www.amazon.com/ap/oa';

const envPath = path.resolve(process.cwd(), '.env');

function buildAuthUrl() {
  const q = new URLSearchParams({
    client_id: config.clientId,
    scope: SCOPE,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
  });
  return `${AUTH_BASE}?${q.toString()}`;
}

// Accept either a raw code or the full redirected URL and pull the code out.
function extractCode(input) {
  const s = input.trim();
  if (s.includes('code=')) {
    try {
      const u = new URL(s);
      return u.searchParams.get('code');
    } catch {
      return new URLSearchParams(s.split('?').pop()).get('code');
    }
  }
  return s;
}

function writeRefreshToken(token) {
  let text = fs.readFileSync(envPath, 'utf-8');
  if (/^ADS_REFRESH_TOKEN=.*$/m.test(text)) {
    text = text.replace(/^ADS_REFRESH_TOKEN=.*$/m, `ADS_REFRESH_TOKEN=${token}`);
  } else {
    text += `\nADS_REFRESH_TOKEN=${token}\n`;
  }
  fs.writeFileSync(envPath, text);
}

async function exchange(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const { data } = await axios.post(config.tokenUrl, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return data.refresh_token;
}

const arg = process.argv[2];

if (!arg) {
  // Step 1: print the URL to open.
  console.log('\n1) Make sure this Return URL is registered on your LWA app:');
  console.log(`   ${REDIRECT_URI}\n`);
  console.log('2) Open this URL in your browser, sign in, and click Allow:\n');
  console.log('   ' + buildAuthUrl() + '\n');
  console.log('3) Your browser will redirect to a page that fails to load — that is FINE.');
  console.log('   Copy the WHOLE URL from the address bar (it contains ?code=...).\n');
  console.log('4) Run:  npm run auth -- "PASTE_THE_URL_OR_CODE_HERE"\n');
} else {
  // Step 2: exchange the code and save the refresh token.
  const code = extractCode(arg);
  if (!code) {
    console.error('❌ Could not find a code in what you pasted.');
    process.exit(1);
  }
  console.log('🔄 Exchanging code for a refresh token…');
  exchange(code)
    .then((token) => {
      writeRefreshToken(token);
      console.log('✅ Saved ADS_REFRESH_TOKEN to backend/.env');
      console.log('   Next:  npm run profiles   (to find your ADS_PROFILE_ID)\n');
    })
    .catch((e) => {
      const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
      console.error('❌ Exchange failed:', detail);
      console.error('   (The code expires ~5 min after you get it — if so, redo step 2.)');
      process.exit(1);
    });
}
