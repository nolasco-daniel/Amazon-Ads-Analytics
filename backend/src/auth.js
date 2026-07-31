import axios from 'axios';
import { config } from './config.js';

// Access tokens live ~60 min. We cache in memory and refresh ~1 min early.
let cached = { token: null, expiresAt: 0 };

export async function getAccessToken() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  try {
    const { data } = await axios.post(config.tokenUrl, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    cached = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return cached.token;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Token refresh failed: ${detail}`);
  }
}
