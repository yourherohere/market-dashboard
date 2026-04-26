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
######
✅ Previously Identified Issues — Now Resolved
#	Issue	Status
1	T is not defined crash in Scanner/Rotation/Sectors tabs	FIXED — heat functions now use CSS custom properties (var(--clr-up), var(--clr-dn)) instead of theme object references. All tab components consistently access theme via useTheme() hook inside components
4	CORS allows all origins (*)	FIXED — Now configurable via CORS_ORIGINS env variable; allows all in dev, restricted in production
5	Content Security Policy disabled	FIXED — Helmet CSP now enabled in production with proper directives; disabled only in dev for Vite HMR compatibility
6	Rate limiter memory leak	FIXED — Added setInterval pruning every 10 minutes plus a .unref() call to prevent keeping the process alive
7	Unbounded cache memory growth	FIXED — Cache now capped at 500 entries with LRU eviction of the oldest entry when the limit is reached
8	Template literal in SQL statement	FIXED — ensureEmaColumns() now uses hardcoded ALTER TABLE strings in an array, never interpolating values into SQL
9	No input validation on API endpoints	IMPROVED — analytics.js now includes clampInt, clampFlt, validateEmaList, and VALID_SYMBOL regex helpers
12	No Vite proxy configured	FIXED — Vite config now proxies /api to http://localhost:3001
13	No API base URL env variable	PARTIALLY FIXED — Most tab components use const BASE = (typeof __API_BASE__ !== "undefined" && __API_BASE__) ? __API_BASE__ : ""; with Vite proxy support. See remaining issue below
14	.DS_Store committed	FIXED — .gitignore now includes .DS_Store
3	node_modules committed to repository	FIXED — .gitignore now includes node_modules/
15	Missing repo description/metadata	IMPROVED — README now includes comprehensive description, feature table, project structure, API documentation, and database schema
🔴 Remaining Critical Bug
1. App.jsx Still Uses Hardcoded localhost:3001
While all tab components (ScannerTab, RotationTab, SectorsTab, ConditionsTab, IntelligenceTab) have been updated to use the configurable BASE pattern with Vite proxy support, App.jsx still hardcodes:

javascript
const BASE = "http://localhost:3001";  // line 23
This is in the root component and used by apiFetch and loadAllData for initial health checks, quote loading, and chart history. In production, this hardcoded URL will cause all data fetching to fail. The file needs the same treatment:

javascript
const BASE = (typeof __API_BASE__ !== "undefined" && __API_BASE__) ? __API_BASE__ : "";
Impact: Production deployment breaks unless App.jsx is fixed.

🟡 Code Quality & Maintainability (Still Present)
2. Extensive Code Duplication Across Tab Components
Common utilities are still copy-pasted across multiple tab files:

Utility	Duplicated In
apiFetch	ScannerTab, RotationTab, SectorsTab, ConditionsTab, IntelligenceTab
heat	ScannerTab, RotationTab, SectorsTab
calcRS / calcCompositeRS	ScannerTab, RotationTab
calcEMASeries	RotationTab, SectorsTab
SigBadge	ScannerTab, RotationTab
Each file independently defines const BASE with the same __API_BASE__ pattern. A single utils/api.js module would eliminate ~150 lines of duplicated code and make maintenance significantly easier.

3. Theme Hook Usage Inconsistency
There's a naming pattern inconsistency across the codebase for the theme hook and object:

Some components use _tk (leading underscore): const _tk = useTheme(); const T = THEME[_tk] || THEME.night

Others use themeKey: const themeKey = useTheme(); const T = THEME[themeKey] || THEME.night

Others use _stk: const _stk = useTheme(); const T = THEME[_stk] || THEME.night

This is a code-style issue rather than a bug, but it makes the codebase less consistent for contributors.

🟡 Missing Environment Variable Documentation
4. VITE_API_BASE_URL / __API_BASE__ Not Documented
The tab components reference __API_BASE__ as a global variable for overriding the API base URL, but:

.env.example does not mention it

There's no define block in vite.config.js to inject it as a Vite global

The pattern typeof __API_BASE__ !== "undefined" suggests it should be defined via Vite's define config or a build-time replacement plugin

Recommendation: Add to vite.config.js:

javascript
define: { __API_BASE__: JSON.stringify(process.env.VITE_API_BASE_URL || "") }
And document in .env.example: # VITE_API_BASE_URL=https://your-server.com.

5. CORS_ORIGINS Not Documented in .env.example
The server supports CORS_ORIGINS for production origin restriction, but it's not listed in .env.example.

🟡 No Test Suite
6. Zero Tests Across the Entire Codebase
The repository still contains no test files, no testing framework, and no test scripts in package.json. With the growing complexity (328-line analytics route, 404-line scanner route, 369-line IntelligenceTab, sophisticated data pipeline), the absence of tests represents significant technical debt.

Risk areas with no test coverage:

Weinstein Stage computation (Stage 1-4 logic) in compute-analytics.js

EMA touch scanner (Pine Script port)

computeCompositeRS weighted scoring (critical for screener accuracy)

Rate limiter expiration logic

Cache LRU eviction

Database migration integrity

🔵 Minor / Documentation Issues
7. Unix-Specific Commands in Setup Guide
The SETUP_GUIDE.md troubleshooting section still references kill $(lsof -ti:3001), which is Unix-specific and won't work on Windows.

8. Hardcoded http://localhost:${PORT} in Startup Banner
server/index.js line 77 shows http://localhost:${PORT}/api/health in the console banner. If running on a remote host, this prints an incorrect URL.

9. Duplicate Variable Declarations in analytics.js
The file server/routes/analytics.js contains duplicate declarations of clampInt, clampFlt, validateEmaList, and VALID_SYMBOL — once at the topand again after an import statement. This is likely a merge artifact; the first set would be overridden by the second.

📊 Updated Summary Table
#	Severity	Status	Description
1	🔴 Critical	⚠️ Remaining	App.jsx still hardcodes localhost:3001 (tab components fixed)
2	🟡 Medium	⚠️ Remaining	Extensive utility code duplication across 5+ tab files
3	🟡 Low	⚠️ Remaining	No test suite (zero test files)
4	🔵 Low	⚠️ Remaining	__API_BASE__ and CORS_ORIGINS not in .env.example
5	🔵 Low	⚠️ Remaining	Theme variable naming inconsistency (_tk vs _stk vs themeKey)
6	🔵 Low	⚠️ Remaining	Duplicate declarations in analytics.js (merge artifact)
7	🔵 Low	⚠️ Remaining	Startup banner hardcodes localhost URL
8	🔵 Low	⚠️ Remaining	Unix-specific commands in setup docs
~~1~~	~~Crit~~	✅ Fixed	T is not defined — now uses CSS custom properties
~~2~~	~~Crit~~	✅ Fixed	node_modules committed — now gitignored
~~3~~	~~High~~	✅ Fixed	CORS wildcard — now configurable
~~4~~	~~High~~	✅ Fixed	CSP disabled — now conditional per environment
~~5~~	~~High~~	✅ Fixed	Rate limiter leak — 10-min prune interval
~~6~~	~~Med~~	✅ Fixed	Unbounded cache — 500-entry LRU cap
~~7~~	~~Med~~	✅ Fixed	SQL template literal — hardcoded statements
~~8~~	~~Med~~	✅ Fixed	No Vite proxy — now proxies /api
~~9~~	~~Low~~	✅ Fixed	.DS_Store — now gitignored
~~10~~	~~Low~~	✅ Fixed	Input validation — added to analytics route
Recommended Priority Actions
Fix App.jsx hardcoded BASE (line 23) to use the same __API_BASE__ pattern as all other components. This is the one remaining blocker for production deployment.

Extract shared utilities (apiFetch, heat, calcRS, calcCompositeRS, calcEMASeries) into src/utils/api.js and src/utils/analytics.js to eliminate ~150 lines of duplicated code and ensure consistent behavior.

Add VITE_API_BASE_URL support to vite.config.js via the define option and document it in .env.example.

Document CORS_ORIGINS in .env.example for production deployments.

Remove duplicate declarations in analytics.js (lines 5-10 and 22-29).

Add at least smoke tests for critical paths: Weinstein stage computation, RS rank calculation, EMA touch logic, and rate limiter behavior. A good first step would be vitest with a few unit tests on the pure computation functions.

####
