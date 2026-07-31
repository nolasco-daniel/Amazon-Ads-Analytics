import axios from 'axios';
import { config } from './config.js';
import { getAccessToken } from './auth.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Make an authenticated Amazon Ads API request with automatic token refresh
 * and retry-with-backoff on throttling (429) / server errors (5xx).
 */
export async function adsRequest(opts, { retries = 4 } = {}) {
  const {
    method = 'GET',
    path,
    data,
    headers = {},
    profileId = config.profileId,
    baseURL = config.apiHost,
  } = opts;

  let attempt = 0;
  while (true) {
    try {
      const token = await getAccessToken();
      const h = {
        'Amazon-Advertising-API-ClientId': config.clientId,
        Authorization: `Bearer ${token}`,
        ...headers,
      };
      // Scope header selects which advertising account/marketplace to act on.
      if (profileId) h['Amazon-Advertising-API-Scope'] = String(profileId);

      const res = await axios({ method, url: path, baseURL, data, headers: h });
      return res.data;
    } catch (err) {
      const status = err.response?.status;
      const retryable = status === 429 || (status >= 500 && status <= 599);
      if (retryable && attempt < retries) {
        const wait = Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
        console.warn(`⏳ ${status} from Amazon — retrying in ${wait}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(wait);
        attempt++;
        continue;
      }
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Ads API ${method} ${path} failed [${status}]: ${detail}`);
    }
  }
}
