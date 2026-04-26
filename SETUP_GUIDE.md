# Setup Guide — Market Dashboard v2.0

## Prerequisites
- **Node.js** 18+ (20 LTS recommended) · npm 9+
- ~500 MB disk for the SQLite database after full bootstrap

## Quick Start

```bash
git clone https://github.com/yourherohere/market-dashboard.git
cd market-dashboard
npm install
cp .env.example .env
npm run db:init
npm run dev
```

Open **http://localhost:5173**

## Data Pipeline (run once, in order)

```bash
npm run bootstrap:2y      # ~60–90 min — 2Y OHLCV for 6,500 symbols
npm run bootstrap:retry   # retry any errors + symbols with no price data
npm run enrich:sectors    # sector / industry / ETF mappings (~5 min)
npm run compute:analytics # RS ranks, stages, setup scores (~5 min)
npm run compute:ema       # EMA touch/cross flags (~3 min)
npm run compute:earnings  # upcoming earnings dates (~10 min)
```

After setup the server auto-runs nightly at **4:35 PM ET** on weekdays.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `development` | `production` enables static serving |
| `LOG_LEVEL` | `info` | `debug` for verbose output |
| `DB_PATH` | `data/market.db` | Override database path |
| `YF_DISABLE_VERSION_CHECK` | `1` | Suppress Yahoo Finance warnings |
| `VITE_API_BASE_URL` | *(empty)* | Remote API host for production deploys |
| `ALLOWED_ORIGINS` | localhost only | Comma-separated CORS whitelist |

## Deploying to a Remote Server

```bash
# 1. Build the frontend
VITE_API_BASE_URL=https://api.yourdomain.com npm run build

# 2. Serve the Express API on port 3001
NODE_ENV=production ALLOWED_ORIGINS=https://yourdomain.com npm run server:start

# 3. Serve the dist/ folder from nginx / Caddy pointing to yourdomain.com
```

## Troubleshooting

**App crashes with "T is not defined"**
Replace all tab files from the latest commit.

**Bootstrap shows 400+ errors**
These are Yahoo Finance rate limits. Run `npm run bootstrap:retry` — it retries up to 5 times per symbol. Expected final error rate for a stable connection: <100 symbols (OTC/delisted).

**EMA Cross returns 0 results**
Run `npm run compute:ema` first. The scanner computes EMA live but the touch flags must be initialized at least once.

**Port 3001 already in use (macOS/Linux)**
```bash
kill $(lsof -ti:3001)       # macOS/Linux
netstat -ano | findstr 3001 # Windows — get PID, then:
taskkill /PID <pid> /F      # Windows — kill it
```

**McClellan Oscillator shows "Needs 40+ days"**
Self-populates after 40 nightly EOD runs. No action needed.

## git rm node_modules (if committed by accident)

```bash
git rm -r --cached node_modules
git rm --cached .DS_Store 2>/dev/null || true
git add .gitignore
git commit -m "chore: untrack node_modules and .DS_Store"
```
