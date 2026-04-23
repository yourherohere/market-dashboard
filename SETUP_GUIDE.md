# Setup Guide — Market Dashboard v2.0

## Prerequisites

- **Node.js** 18+ (20 LTS recommended)
- **npm** 9+
- ~500 MB disk space for the database after full bootstrap

---

## Installation

```bash
git clone https://github.com/yourherohere/market-dashboard.git
cd market-dashboard
npm install
cp .env.example .env
npm run db:init
npm run dev
```

Open **http://localhost:5173** — the app loads immediately with live data from Yahoo Finance.

---

## Data Pipeline (run once, in order)

### 1 — Bootstrap historical prices

Downloads 2 years of daily OHLCV data for all ~6,500 US stocks from Yahoo Finance.
Takes **60–90 minutes** with a stable internet connection.

```bash
npm run bootstrap:2y
```

Monitor progress — the terminal shows `ok=N err=N` counts live. When done:

```bash
npm run bootstrap:status
# Expected: ok: 6200+, error: <400, pending: 0
```

If errors remain:

```bash
npm run bootstrap:retry     # retries all errors + symbols with no data
```

### 2 — Enrich sector/industry/ETF mappings

Maps each symbol to its GICS sector, industry, and corresponding ETF.

```bash
npm run enrich:sectors
# Takes ~5 minutes
```

### 3 — Compute analytics

Calculates RS ranks (1–99), Weinstein stages (1–4), setup scores (0–100),
pocket pivots, earnings dates, RS vs sector/industry ETF.

```bash
npm run compute:analytics
# Takes ~3–5 minutes
```

### 4 — Compute EMA touch flags

Calculates `touch_ema10/20/50/100/200` and `cross_ema*` flags from OHLC bars
for the EMA Touch Scanner in the Intel tab.

```bash
npm run compute:ema
# Takes ~3 minutes
```

### 5 — Fetch earnings dates

Pulls upcoming earnings dates for all symbols.

```bash
npm run compute:earnings
# Takes ~10 minutes
```

---

## Nightly Updates

After setup, the server auto-runs nightly at **4:35 PM ET** on weekdays:

1. Downloads today's EOD prices
2. Recomputes returns for updated symbols
3. Refreshes RS vs sector ETF
4. Recomputes analytics (RS ranks, stages, scores)
5. Recomputes EMA touch flags

No manual action needed.

---

## Validate Data Quality

The Intel tab → **✅ VALIDATE** shows a health check dashboard. Or via API:

```bash
curl http://localhost:3001/api/analytics/validate | python3 -m json.tool
```

---

## Troubleshooting

### "T is not defined" crash
Replace all tab files from the latest release — this was a theme token scope issue now fixed.

### Bootstrap shows 3000+ errors
Run `npm run bootstrap:retry` — most are transient Yahoo Finance rate limits.

### EMA Cross returns 0 results
Run `npm run compute:ema` first. The scanner computes EMA live from `eod_prices`
but the touch flag columns must be initialized.

### McClellan Oscillator shows "Needs 40+ days"
The oscillator needs 40+ trading days of A/D history. It self-populates over time
after each nightly EOD run.

### Port 3001 already in use
```bash
kill $(lsof -ti:3001)
npm run server:start
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `NODE_ENV` | `development` | `production` enables static file serving |
| `LOG_LEVEL` | `info` | `debug` for verbose request logging |
| `DB_PATH` | `data/market.db` | Override database location |
| `YF_DISABLE_VERSION_CHECK` | `1` | Suppress Yahoo Finance version warnings |

