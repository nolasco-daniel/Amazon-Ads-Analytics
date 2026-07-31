# Amazon Ads Analytics

A small full-stack dashboard for **Amazon Advertising API** (Sponsored Products).
It pulls campaign reports from Amazon, stores them in a local SQLite database, and
visualizes spend, sales, ACoS, ROAS and per-campaign performance.

```
backend/   Node + Express — auth, report fetching, SQLite storage, JSON API
frontend/  React + Vite + Recharts — the dashboard
```

## How the data flows

Amazon's Advertising API delivers reports asynchronously:

1. **Request** a report (`POST /reporting/reports`) → get a `reportId`
2. **Poll** (`GET /reporting/reports/{id}`) until status is `COMPLETED`
3. **Download** the gzipped JSON, parse, and store one row per campaign per day

The backend automates all three. Recent days are re-pulled on each run because
Amazon keeps updating attribution (sales credited to clicks) for ~48–72h.

---

## Setup

### 1. Credentials
```bash
cd backend
cp .env.example .env        # then edit .env
```

Fill in from your Amazon Advertising / Login-with-Amazon app:

| Var | Where it comes from |
|-----|--------------------|
| `ADS_CLIENT_ID` / `ADS_CLIENT_SECRET` | Your LWA security profile |
| `ADS_REFRESH_TOKEN` | The OAuth consent flow (see below) |
| `ADS_PROFILE_ID` | `GET /api/profiles` after auth works |
| `ADS_API_HOST` | Region: NA / EU / FE (default NA) |

### 2. Getting the refresh token (one time)
The refresh token is what lets the app pull data without you logging in each time.

1. In the Amazon Ads console, add an **Allowed Return URL** to your LWA app
   (e.g. `https://localhost`).
2. Open this URL in a browser (fill in your client id + return url), pick
   `scope=advertising::campaign_management`:
   ```
   https://www.amazon.com/ap/oa?client_id=YOUR_CLIENT_ID&scope=advertising::campaign_management&response_type=code&redirect_uri=https://localhost
   ```
3. Approve. You'll be redirected to `https://localhost/?code=XXXX`. Copy that `code`.
4. Exchange it for tokens (the `code` expires in ~5 min):
   ```bash
   curl -X POST https://api.amazon.com/auth/o2/token \
     -d grant_type=authorization_code \
     -d code=XXXX \
     -d redirect_uri=https://localhost \
     -d client_id=YOUR_CLIENT_ID \
     -d client_secret=YOUR_CLIENT_SECRET
   ```
5. Put the returned `refresh_token` into `.env` as `ADS_REFRESH_TOKEN`.

### 3. Find your profile id
```bash
cd backend && npm start          # starts the API
# in a browser or another terminal:
curl http://localhost:4000/api/profiles
```
Copy the `profileId` for the marketplace you want and set `ADS_PROFILE_ID` in `.env`.

---

## Running

Two terminals:

```bash
# terminal 1 — backend (http://localhost:4000)
cd backend && npm start

# terminal 2 — dashboard (http://localhost:5173)
cd frontend && npm run dev
```

Then in the dashboard click **Refresh data** to pull from Amazon. After that it
also auto-refreshes daily at 06:00 (backend cron). You can also pull manually:

```bash
cd backend && npm run fetch
```

## Notes
- Database file: `backend/data/ads.sqlite` (git-ignored).
- Currency is USD in the UI — change in `frontend/src/utils/format.js`.
- ACoS status thresholds (green/amber/red) are in the same file.
- To add Sponsored Brands/Display later, add report configs in `backend/src/reports.js`.
