# Market Dashboard v2.0 — Enterprise Setup

## Project Structure

```
market-dashboard/
├── package.json                # All deps (express, better-sqlite3, node-cron, vite)
├── vite.config.js              # Vite + proxy to :3001
├── index.html
├── data/                       # SQLite database (auto-created)
│   └── market.db
├── server/                     # Node.js backend (ES modules)
│   ├── index.js                # Main Express app — START HERE
│   ├── config.js               # All config: ports, TTLs, batch sizes
│   ├── logger.js               # Structured logger
│   ├── cache.js                # In-memory TTL cache
│   ├── db/
│   │   ├── schema.js           # SQLite schema v4 (5 tables)
│   │   └── index.js            # DB connection + prepared statements
│   ├── data/
│   │   ├── yahoo.js            # yf singleton, safeQuote/safeChart/normalise
│   │   ├── enrichment.js       # 3-tier sector/industry enrichment + DB persistence
│   │   ├── universe.js         # SEC EDGAR + NASDAQ FTP + DB fallback
│   │   └── eod.js              # EOD collector + EMA/RSI/return computation
│   ├── jobs/
│   │   ├── scheduler.js        # node-cron: EOD @ 4:35PM ET
│   │   └── eod-manual.js       # Manual EOD run script
│   └── routes/
│       ├── health.js           # /api/health, /api/universe, /api/eod/*
│       ├── quotes.js           # /api/quotes, /api/charts, /api/search
│       ├── scanner.js          # All /api/scan/* endpoints + streaming
│       ├── rrg.js              # /api/rrg (JdK RS method)
│       ├── premarket.js        # /api/premarket
│       ├── news.js             # /api/news/:symbol (Finviz + SEC EDGAR)
│       └── sectors.js          # /api/live/*, /api/etf/*, /api/advance-decline
└── src/                        # React frontend (Vite)
    ├── main.jsx                # React entry point
    ├── App.jsx                 # Root: loads data, tab router, header
    ├── api/client.js           # Typed API client (all endpoints)
    ├── constants/gics.js       # GICS sector/ETF registry (11 sectors, 41 sub-ETFs)
    ├── hooks/useTheme.js       # Dark/light theme context
    ├── utils/format.js         # pct, fmtMcap, calcRet, sparkPath, etc.
    └── components/
        ├── common/index.jsx    # Spark, McapBadge, ScoreDial, LoadingDots, UniverseStatus
        └── tabs/               # One file per tab (lazy-loaded)
            ├── ScannerTab.jsx
            ├── PremarketTab.jsx
            ├── SectorsTab.jsx
            ├── ConditionsTab.jsx
            ├── RotationTab.jsx
            ├── ThemesTab.jsx
            ├── CockpitTab.jsx
            └── HeatmapTab.jsx
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Initialize database (creates data/market.db with schema)
npm run db:init

# 3. Start everything (server + Vite dev server)
npm run dev
```

## EOD Data Collection

```bash
# Runs automatically at 4:35 PM ET on weekdays via node-cron

# Manual run (collect today's prices for all ~6500 symbols)
npm run eod:collect

# Force re-collect even if today already done
node server/jobs/eod-manual.js --force

# Collect for specific symbols only
node server/jobs/eod-manual.js --symbols AAPL,MSFT,NVDA

# Trigger via API (POST)
curl -X POST http://localhost:3001/api/eod/collect -H "Content-Type: application/json" -d '{"force":false}'
```

## Database Schema

| Table | Description |
|-------|-------------|
| `universe` | 6,500 US stocks (symbol, name, exchange, sector, industry) |
| `eod_prices` | Daily OHLCV for all symbols — indexed by (symbol, date) |
| `eod_returns` | Computed returns: 1D/1W/1M/3M/6M/YTD/1Y + EMA20/50/200 + RSI |
| `sector_cache` | Persisted sector/industry lookups — survives server restarts |
| `eod_log` | Collection run history (date, ok count, error count, duration) |

## Universe Loading

The US universe loads from 3 sources in priority order:
1. **SEC EDGAR** `company_tickers_exchange.json` — ~6,500 symbols
2. **NASDAQ FTP** `nasdaqlisted.txt` + `otherlisted.txt` — fallback
3. **Local DB cache** — always works after first successful load

## Key API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Status, universe count, EOD stats |
| `GET /api/universe` | Universe metadata |
| `POST /api/eod/collect` | Trigger manual EOD collection |
| `GET /api/eod/returns/:sym` | DB-backed historical returns for a symbol |
| `GET /api/eod/log` | Recent collection run history |
| `GET /api/scan/full/stream` | SSE streaming universe scan |
| `GET /api/advance-decline` | NYSE/NASDAQ/SP500 A/D breadth |
| `DELETE /api/cache` | Clear in-memory cache |

---

## Historical Data Bootstrap

### First-time setup (recommended order)

```bash
# 1. Install all dependencies
npm install

# 2. Initialize database schema
npm run db:init

# 3. Start server (keeps running, loads universe, warms cache)
npm run server:start
# Wait until you see: "✅ Universe loaded: 6,XXX symbols"

# 4. In a new terminal — download 2 years of history for ALL ~6,500 symbols
npm run bootstrap:2y
```

### Bootstrap options

```bash
# Download 2 years (default ~520 trading days per symbol)
npm run bootstrap:2y

# Download 1 year only (~252 trading days)
npm run bootstrap:1y

# Retry only symbols that failed on previous run (exit code 1 / timeout)
npm run bootstrap:retry

# Wipe all existing price data and re-download from scratch
npm run bootstrap:reset
```

### Performance expectations

| Universe size | Batch size | Estimated time |
|--------------|-----------|----------------|
| 6,500 symbols | 12 concurrent | 60–90 minutes |
| With retries  | 12 concurrent | +5–10 minutes |
| Returns computation | SQLite-only | 2–4 minutes |

**Database size after 2-year bootstrap:**
- `eod_prices` table: ~6,500 × 520 = ~3.4M rows ≈ 250–400 MB
- `eod_returns` table: 6,500 rows ≈ 2 MB
- `spy_prices` table: 520 rows ≈ negligible
- Total DB: 300–500 MB (WAL + indexes)

### Bootstrap API (control from browser/curl)

```bash
# Start bootstrap via API (non-blocking, runs in background)
curl -X POST http://localhost:3001/api/bootstrap/start \
  -H "Content-Type: application/json" \
  -d '{"years":2,"retryOnly":false,"reset":false}'

# Check progress
curl http://localhost:3001/api/bootstrap/status

# Stop in-progress bootstrap
curl -X POST http://localhost:3001/api/bootstrap/stop
```

### What gets computed per symbol

After downloading raw OHLCV data, `computeReturnRow()` calculates and stores:

**Period returns:** 1D, 1W, 2W, 1M, 2M, 3M, 6M, 9M, 1Y, 2Y, MTD, QTD, YTD

**Moving averages:** SMA20, SMA50, SMA150, SMA200, EMA20, EMA50, EMA200

**EMA positioning flags:** above_ema20, above_ema50, above_ema200, above_sma150, above_sma200

**52-week range:** hi52, lo52, pct_hi52 (price as % of 52W high), pct_lo52

**Technical indicators:** RSI(14), RSI(2), ADR%(14), ATR(14), Beta(252)

**Relative strength vs SPY:** RS_1M, RS_3M, RS_6M, RS_12M (IBD-style)

### EOD nightly update

After bootstrap, the nightly EOD job (4:35 PM ET weekdays) only needs to download 1–5 days of data per symbol (much faster). It then recomputes all returns from the stored history.

```bash
# Manual daily EOD update (only downloads missing dates)
npm run eod:collect

# Force re-download today's prices even if already stored
node server/jobs/eod-manual.js --force
```

### Schema

```sql
-- Fast time-series reads (WITHOUT ROWID = no extra rowid column)
SELECT date, close, volume FROM eod_prices
WHERE symbol = 'AAPL' ORDER BY date DESC LIMIT 260;

-- Cross-sectional (all symbols on a date, for breadth)
SELECT symbol, close FROM eod_prices WHERE date = '2024-03-15';

-- Screener from returns table (instant, no Yahoo needed)
SELECT r.*, u.sector FROM eod_returns r
JOIN universe u ON r.symbol = u.symbol
WHERE r.d1 > 3 AND r.volume > 500000
ORDER BY r.d1 DESC LIMIT 50;
```
