# 📈 Market Dashboard v2.0

A full-stack enterprise market intelligence platform for US equities — live screener, EOD historical database, sector breadth, EMA scanner, earnings tracker, and Weinstein stage analysis across 6,500+ stocks.

![Stack](https://img.shields.io/badge/stack-React%2BExpress%2BSQLite-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

| Tab | What it does |
|-----|-------------|
| **Scanner** | Real-time screener — Top Gainers, RS Leaders, EOD Database, 52W Highs, custom filters |
| **Intel** | RS Ranks, Weinstein Stages, Setup Scores, Sector/Industry Breadth (all 7 periods), EMA Touch Scanner, Earnings Calendar |
| **Conditions** | Market breadth — NYSE/NASDAQ A/D, McClellan Oscillator, Breadth Score |
| **Premarket** | Pre-market movers with gap analysis |
| **Rotation** | Relative Rotation Graph (JdK RS method) |
| **Sectors** | Sector performance and ETF tracking |
| **Themes** | Thematic ETF baskets |
| **Heatmap** | Visual sector/industry heatmap |

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/yourherohere/market-dashboard.git
cd market-dashboard
npm install

# 2. Configure environment
cp .env.example .env

# 3. Initialize database
npm run db:init

# 4. Start server + frontend
npm run dev
# Server: http://localhost:3001
# Frontend: http://localhost:5173
```

---

## Data Setup (First Run)

Run these commands **in order** after the first `npm run dev`:

```bash
# Step 1: Download 2 years of OHLCV history (~60–90 min)
npm run bootstrap:2y

# Step 2: Enrich with sector/industry/ETF mappings
npm run enrich:sectors

# Step 3: Compute RS ranks, Weinstein stages, setup scores
npm run compute:analytics

# Step 4: Compute EMA touch/cross flags for EMA scanner
npm run compute:ema

# Step 5: Fetch upcoming earnings dates
npm run compute:earnings
```

After bootstrap, nightly EOD runs automatically at **4:35 PM ET** on weekdays.

---

## Project Structure

```
market-dashboard/
├── server/
│   ├── index.js                 # Express app, middleware, startup
│   ├── config.js                # All config (ports, TTLs, batch sizes)
│   ├── db/
│   │   ├── schema.js            # SQLite schema v8 + migrations
│   │   └── index.js             # DB connection + prepared statements
│   ├── data/
│   │   ├── eod.js               # EOD price collection + EMA computation
│   │   ├── yahoo.js             # Yahoo Finance wrapper
│   │   ├── enrichment.js        # Sector/industry enrichment
│   │   └── universe.js          # SEC EDGAR universe loader
│   ├── jobs/
│   │   ├── bootstrap.js         # Historical data download (2Y)
│   │   ├── compute-analytics.js # RS ranks, stages, setup scores
│   │   ├── compute-ema-touch.js # EMA touch/cross flags from OHLC
│   │   ├── enrich-sectors.js    # Sector/ETF enrichment job
│   │   └── scheduler.js         # Cron: EOD @ 4:35PM ET
│   └── routes/
│       ├── analytics.js         # /api/analytics/* (Intel tab backend)
│       ├── scanner.js           # /api/scan/* (screener endpoints)
│       ├── quotes.js            # /api/quotes, /api/charts
│       ├── sectors.js           # /api/live/*, /api/etf/*
│       └── health.js            # /api/health, /api/universe
└── src/
    ├── App.jsx                  # Root — theme, tabs, header
    ├── hooks/useTheme.js        # Day/Night theme context + CSS vars
    ├── utils/theme.js           # Semantic color helpers (gc, rsColor)
    └── components/tabs/         # One file per tab (lazy-loaded)
```

---

## Database Schema

| Table | Rows | Description |
|-------|------|-------------|
| `universe` | ~6,600 | US stocks — symbol, name, exchange, sector, industry, ETF mappings |
| `eod_prices` | ~3.4M | Daily OHLCV — indexed by (symbol, date) |
| `eod_returns` | ~6,600 | Computed analytics — returns, EMAs, RS ranks, stages, scores |
| `bootstrap_status` | ~6,600 | Per-symbol download state for retry logic |
| `spy_prices` | ~520 | SPY daily closes for RS computation |

---

## API Endpoints

### Analytics (Intel Tab)
| Endpoint | Description |
|----------|-------------|
| `GET /api/analytics/setup` | Top setups with RS rank, stage, score filters |
| `GET /api/analytics/ema-cross` | EMA touch scanner (Pine Script logic) |
| `GET /api/analytics/internals` | Breadth metrics, sector/industry breadth |
| `GET /api/analytics/earnings` | Upcoming earnings with analytics |
| `GET /api/analytics/validate` | Data quality health check |
| `GET /api/analytics/symbol/:sym` | Full symbol detail |

### Scanner
| Endpoint | Description |
|----------|-------------|
| `GET /api/scan/eod` | EOD database scan with full filter set |
| `GET /api/scan/stream` | Server-sent events streaming scan |

### Utility
| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Server status, universe count, EOD stats |
| `DELETE /api/cache` | Clear all in-memory cache |
| `DELETE /api/cache/:namespace` | Clear specific cache namespace |
| `POST /api/bootstrap/start` | Trigger data download via API |
| `GET /api/bootstrap/status` | Download progress |

---

## EMA Touch Scanner

Exact port of Pine Script `ta.ema()` logic:

```
touch(period) = candle.low ≤ EMA(period) ≤ candle.high
```

Supports:
- **Multi-select EMA periods**: 10, 20, 50, 100, 200
- **Touch modes**: Min touches (≥N) or All selected EMAs
- **Signal strength**: 1=green, 2=yellow, 3=orange, 4=red, 5=purple
- Always computed live from `eod_prices` — never stale stored values

---

## Bootstrap Commands

```bash
npm run bootstrap:2y        # Download 2 years history (all 6,500 symbols)
npm run bootstrap:retry     # Retry failed + symbols with no price data
npm run bootstrap:status    # Show download status breakdown
npm run bootstrap:reset     # Wipe and re-download everything
```

---

## Theme System

Day/Night mode via CSS custom properties. Toggle with the button in the header.

All color tokens are injected into `:root` on toggle:

```css
var(--clr-up)       /* gains green */
var(--clr-dn)       /* losses red  */
var(--clr-surface)  /* card background */
var(--clr-border)   /* standard border */
var(--clr-text)     /* primary text */
```

---

## Tech Stack

- **Frontend**: React 18, Vite 5, JetBrains Mono, Lightweight Charts
- **Backend**: Node.js (ES modules), Express 4, Better-SQLite3
- **Data**: Yahoo Finance 2 (via `yahoo-finance2`), SEC EDGAR, NASDAQ FTP
- **Scheduler**: node-cron (4:35 PM ET weekday EOD)
- **No external auth / no cloud deps** — fully self-hosted

---

## License

MIT — see [LICENSE](LICENSE)
