# 🚀 Market Dashboard — Complete Setup Guide
### For non-coders. Every step explained.

---

## What you need first (one-time installs)

Before anything else, you need two free programs installed on your Mac:

### 1. Install Node.js
- Go to **https://nodejs.org**
- Click the big green **"LTS"** button to download
- Open the downloaded file and click through the installer
- When done, open Terminal and type: `node --version`
- You should see something like `v20.11.0` — that means it worked ✅

### 2. Install Xcode Command Line Tools (needed for the database)
- Open Terminal (press Cmd+Space, type "Terminal", press Enter)
- Type this and press Enter:
```
xcode-select --install
```
- A popup will appear — click **Install**
- Wait for it to finish (takes 2-5 minutes)

---

## Step 1 — Copy your project files

Your project folder is called `market-dashboard`. Make sure it contains:
```
market-dashboard/
  package.json
  vite.config.js
  index.html
  server/
  src/
```

Open Terminal. Navigate to the folder:
```bash
cd ~/Documents/Claude/market-dashboard
```
*(Change the path if your folder is somewhere else)*

---

## Step 2 — Install all packages (do this ONCE)

```bash
npm install
```

This downloads all the code libraries the app needs.
- Takes 1-3 minutes
- You'll see lots of text scrolling — that's normal
- When it shows your cursor again, it's done ✅

---

## Step 3 — Set up the database (do this ONCE)

```bash
node server/db/migrate.js
```

This creates the database file (`data/market.db`) with all the tables.
You should see: `✅  DB ready — schema v5`

---

## Step 4 — Start the server (do this every time)

Open a **new Terminal window** (Cmd+T) and run:

```bash
cd ~/Documents/Claude/market-dashboard
node server/index.js
```

Wait until you see:
```
✅  DB ready
✅  Universe loaded: 6,XXX symbols
✅  Server ready ✓
```

**Keep this Terminal window open** — the server must stay running.

---

## Step 5 — Start the website (do this every time)

Open **another new Terminal window** (Cmd+T) and run:

```bash
cd ~/Documents/Claude/market-dashboard
npm run client:dev
```

Wait until you see:
```
  ➜  Local:   http://localhost:5173/
```

Then open your browser and go to: **http://localhost:5173**

You should see the Market Dashboard! ✅

---

## Step 6 — Download historical data (do this ONCE, takes ~90 min)

This downloads 2 years of price history for all ~6,500 US stocks.

Open **another new Terminal window** and run:

```bash
cd ~/Documents/Claude/market-dashboard
npm run bootstrap:2y
```

You'll see a progress bar:
```
  [████████░░░░░░░░░░░░░░░░░░░░░] 28%  1820/6500  ✓1790 ✗18  ETA:32m
```

- ✓ = successfully downloaded
- ✗ = failed (will be retried automatically)
- ETA = estimated time remaining

You can use the dashboard while this runs in the background.

---

## Every day after that

Just two commands in two Terminal windows:

**Window 1 (server):**
```bash
cd ~/Documents/Claude/market-dashboard
node server/index.js
```

**Window 2 (website):**
```bash
cd ~/Documents/Claude/market-dashboard
npm run client:dev
```

Then open **http://localhost:5173** in your browser.

The server automatically updates stock data at **4:35 PM ET on weekdays**.

---

## ❌ Troubleshooting — Common errors

### "Cannot find package 'dotenv'" or similar
**Fix:** You forgot to run `npm install`
```bash
npm install
```

### "Server not running" in the browser
**Fix:** You forgot to start the server. Open Terminal and run:
```bash
cd ~/Documents/Claude/market-dashboard
node server/index.js
```

### "Port 3001 already in use"
**Fix:** A server is already running. Either use it, or kill it:
```bash
lsof -ti:3001 | xargs kill -9
```

### "Port 5173 already in use"
**Fix:** Vite is already running. Either use it, or kill it:
```bash
lsof -ti:5173 | xargs kill -9
```

### Browser shows blank white page
**Fix 1:** Open browser DevTools (Cmd+Option+I → Console tab), read the red error.
**Fix 2:** Make sure BOTH server and Vite are running.
**Fix 3:** Hard-refresh the browser: Cmd+Shift+R

### "SqliteError: table X has no column Y"
**Fix:** The database schema is outdated. Reset it:
```bash
rm data/market.db
node server/db/migrate.js
```
*(Your downloaded price history will be lost — run bootstrap again)*

### Bootstrap failed / stopped halfway
**Fix:** Just resume it — it picks up where it left off:
```bash
npm run bootstrap:2y
```

### Bootstrap failed for some symbols — retry only failures
```bash
npm run bootstrap:retry
```

### Data looks stale / not updating
**Fix:** Manually trigger a data refresh:
```bash
curl -X POST http://localhost:3001/api/eod/collect
```

---

## 🔍 Check what's happening (diagnostic commands)

**Is the server healthy?**
Open in browser: http://localhost:3001/api/health

**How many stocks are downloaded?**
Open in browser: http://localhost:3001/api/bootstrap/status

**See recent EOD collection logs:**
Open in browser: http://localhost:3001/api/eod/log

**Test the scanner:**
Open in browser: http://localhost:3001/api/scan/gainers

---

## 📁 What each file does

```
market-dashboard/
├── server/index.js          ← The backend server (start this with node)
├── server/db/migrate.js     ← Creates the database (run once)
├── server/jobs/bootstrap.js ← Downloads 2yr history (run once)
├── src/App.jsx              ← The main website code
├── data/market.db           ← The database (auto-created)
├── package.json             ← List of packages needed
└── vite.config.js           ← Website build settings
```

---

## 🗓 Daily routine

| Time | What happens |
|------|-------------|
| When you start | Run `node server/index.js` + `npm run client:dev` |
| 4:35 PM ET     | Server automatically downloads today's prices |
| When you finish | Close the two Terminal windows |

---

## 💾 How much space does it use?

| Item | Size |
|------|------|
| `node_modules/` | ~200 MB (one-time install) |
| `data/market.db` (after bootstrap) | ~400 MB |
| Total | ~600 MB |
