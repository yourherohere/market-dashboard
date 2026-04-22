// server/data/eod.js — End-of-Day data collector and return calculator
// Runs at market close (4:35 PM ET weekdays) via node-cron.
// Also exposes runEODCollection() for manual runs.
import { BATCH } from "../config.js";
import { db, eodQ, retQ, eodLogQ, uniQ } from "../db/index.js";
import { safeChart, safeQuote } from "./yahoo.js";
import { universe } from "./universe.js";
import { flushSICache } from "./enrichment.js";
import { log } from "../logger.js";

// ── Technical indicator helpers ────────────────────────────────────────────────
function calcEMA(closes, period) {
  if (!closes?.length || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return +ema.toFixed(4);
}

function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 2) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  if (!losses) return 100;
  const rs = (gains / period) / (losses / period);
  return +(100 - 100 / (1 + rs)).toFixed(2);
}

function calcADR(highs, lows, closes, period = 14) {
  const n = Math.min(period, closes.length);
  if (n < 2) return null;
  const ranges = [];
  for (let i = closes.length - n; i < closes.length; i++) {
    if (closes[i] > 0) ranges.push((highs[i] - lows[i]) / closes[i] * 100);
  }
  return ranges.length ? +(ranges.reduce((a, b) => a + b, 0) / ranges.length).toFixed(2) : null;
}

function calcReturn(closes, n) {
  if (!closes?.length || closes.length <= n) return null;
  const now  = closes[closes.length - 1];
  const then = closes[closes.length - 1 - n];
  return then > 0 ? +((now - then) / then * 100).toFixed(2) : null;
}

function calcReturnSince(closes, timestamps, targetTs) {
  if (!closes?.length || !timestamps?.length) return null;
  let idx = timestamps.findIndex(t => t >= targetTs);
  if (idx < 0) idx = 0;
  const from = closes[idx], now = closes[closes.length - 1];
  return from > 0 ? +((now - from) / from * 100).toFixed(2) : null;
}

// ── Main EOD collection run ───────────────────────────────────────────────────
export async function runEODCollection(options = {}) {
  const { force = false, symbols = null } = options;
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const logId = eodLogQ.start(today);
  const t0    = Date.now();

  log.info(`EOD collection starting — ${today} (logId=${logId})`);

  // Get symbol list — from arg, DB universe, or in-memory universe
  let syms = symbols ||
    (universe.size > 0 ? [...universe.keys()] : uniQ.allSymbols());

  if (!syms.length) {
    log.warn("EOD: no symbols to collect");
    eodLogQ.finish(logId, 0, 0, Date.now() - t0, "no symbols in universe");
    return { ok: 0, err: 0, skipped: 0 };
  }

  // Skip symbols that already have today's data (unless forced)
  if (!force) {
    syms = syms.filter(sym => eodQ.lastDate(sym) !== today);
    log.step(`Skipping already-collected symbols — ${syms.length} remaining`);
  }

  if (!syms.length) {
    log.ok("EOD: all symbols already collected for today");
    eodLogQ.finish(logId, 0, 0, Date.now() - t0);
    return { ok: 0, err: 0, skipped: 0 };
  }

  log.info(`Collecting EOD for ${syms.length} symbols…`);

  let ok = 0, noData = 0, errCount = 0;
  const DAYS = 5; // fetch last 5 days to catch missed days
  const updatedSyms = [];  // track which symbols actually got new data

  // Process in batches
  for (let i = 0; i < syms.length; i += BATCH.EOD) {
    const batch = syms.slice(i, i + BATCH.EOD);
    const results = await Promise.allSettled(
      batch.map(sym => fetchAndStoreEOD(sym, DAYS))
    );
    results.forEach((r, j) => {
      const sym = batch[j];
      if (r.status === "fulfilled" && r.value > 0) {
        ok++;
        updatedSyms.push(sym);
        // Update bootstrap_status to ok if it was previously errored
        try {
          const bs = db.prepare("SELECT status FROM bootstrap_status WHERE symbol=?").get(sym);
          if (bs && bs.status === "error") {
            db.prepare("UPDATE bootstrap_status SET status='ok', error_msg=NULL WHERE symbol=?").run(sym);
          }
        } catch {}
      } else if (r.status === "fulfilled") {
        // No rows returned — weekend/holiday/delisted — not a real error
        noData++;
        log.debug(`EOD no-data: ${sym}`);
      } else {
        // Actual network/parse error — write back to bootstrap_status for retry
        errCount++;
        const errMsg = (r.reason?.message || "eod_fetch_failed").substring(0, 120);
        log.debug(`EOD error: ${sym} — ${errMsg}`);
        try {
          // Only mark as error if symbol has no EOD history at all
          // (if it has history, this is a transient today-only failure)
          const hasHistory = db.prepare(
            "SELECT COUNT(*) n FROM eod_prices WHERE symbol=? LIMIT 1"
          ).get(sym)?.n ?? 0;
          if (!hasHistory) {
            db.prepare(`INSERT OR REPLACE INTO bootstrap_status
              (symbol, status, days_loaded, first_date, last_date, error_msg, attempts, updated_at)
              VALUES (?, 'error', 0, NULL, NULL, ?,
                COALESCE((SELECT attempts+1 FROM bootstrap_status WHERE symbol=?), 1),
                datetime('now'))`
            ).run(sym, errMsg, sym);
          }
        } catch {}
      }
    });

    if ((i + BATCH.EOD) % 500 === 0 || i + BATCH.EOD >= syms.length) {
      log.step(`EOD progress: ${Math.min(i + BATCH.EOD, syms.length)}/${syms.length} (ok=${ok} no-data=${noData} err=${errCount})`);
    }
  }

  // Recompute returns for ALL symbols that got new data (no 2000 cap)
  if (updatedSyms.length > 0) {
    log.step(`Computing returns for ${updatedSyms.length} updated symbols…`);
    await computeReturns(updatedSyms);
  }

  // Flush sector cache to DB
  flushSICache();

  const duration = Date.now() - t0;
  eodLogQ.finish(logId, ok, errCount, duration);
  log.ok(`EOD done: ok=${ok} no-data=${noData} err=${errCount} updated=${updatedSyms.length} (${(duration/1000).toFixed(1)}s)`);
  return { ok, noData, err: errCount, updated: updatedSyms.length, skipped: syms.length - ok - noData - errCount, duration };
}

// ── Fetch + store EOD for a single symbol ────────────────────────────────────
async function fetchAndStoreEOD(sym, days = 5) {
  const cd = await safeChart(sym, days + 5);
  if (!cd.closes.length) return 0;

  const rows = [];
  for (let i = 0; i < cd.closes.length; i++) {
    if (!cd.timestamps[i] || !cd.closes[i]) continue;
    const date = new Date(cd.timestamps[i] * 1000).toISOString().split("T")[0];
    rows.push({
      symbol:    sym,
      date,
      open:      cd.closes[i],   // chart API doesn't always return OHLC — use close as fallback
      high:      cd.highs[i]  || cd.closes[i],
      low:       cd.lows[i]   || cd.closes[i],
      close:     cd.closes[i],
      volume:    cd.volumes[i] || 0,
      adj_close: cd.closes[i],
    });
  }

  if (rows.length) {
    eodQ.upsert(rows);
    return rows.length;
  }
  return 0;
}

// ── Compute returns from stored EOD data ─────────────────────────────────────
async function computeReturns(symbols) {
  const now     = new Date();
  const ytdTs   = Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
  const mtdTs   = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  const rows    = [];

  for (const sym of symbols) {
    try {
      const history = eodQ.closes(sym, 280); // ~1 year + buffer
      if (history.length < 5) continue;

      const closes     = history.map(r => r.close);
      const highs      = history.map(r => r.high || r.close);
      const lows       = history.map(r => r.low  || r.close);
      const volumes    = history.map(r => r.volume || 0);
      const timestamps = history.map(r => Math.floor(new Date(r.date).getTime() / 1000));
      const latest     = history[history.length - 1];

      const avg_vol10 = volumes.length >= 10
        ? Math.round(volumes.slice(-10).reduce((a,b)=>a+b,0) / 10) : null;
      const avg_vol30 = volumes.length >= 30
        ? Math.round(volumes.slice(-30).reduce((a,b)=>a+b,0) / 30) : null;

      rows.push({
        symbol: sym,
        date:   latest.date,
        close:  latest.close,
        d1:     calcReturn(closes, 1),
        d5:     calcReturn(closes, 5),
        d21:    calcReturn(closes, 21),
        d63:    calcReturn(closes, 63),
        d126:   calcReturn(closes, 126),
        d252:   calcReturn(closes, 252),
        ytd:    calcReturnSince(closes, timestamps, ytdTs),
        mtd:    calcReturnSince(closes, timestamps, mtdTs),
      });

      // Compute EMAs once, then derive above_ema flags
      const last = rows[rows.length - 1];
      const e10  = calcEMA(closes, 10);
      const e20  = calcEMA(closes, 20);
      const e50  = calcEMA(closes, 50);
      const e100 = calcEMA(closes, 100);
      const e200 = calcEMA(closes, 200);
      const p    = latest.close;
      Object.assign(last, {
        ema10:  e10,  ema20:  e20,  ema50:  e50,  ema100: e100, ema200: e200,
        above_ema10:  e10  ? (p > e10  ? 1 : 0) : null,
        above_ema20:  e20  ? (p > e20  ? 1 : 0) : null,
        above_ema50:  e50  ? (p > e50  ? 1 : 0) : null,
        above_ema100: e100 ? (p > e100 ? 1 : 0) : null,
        above_ema200: e200 ? (p > e200 ? 1 : 0) : null,
        rsi14:  calcRSI(closes, 14),
        adr14:  calcADR(highs, lows, closes, 14),
        volume:   latest.volume || 0,
        avg_vol10,
        avg_vol30,
      });

      // Batch insert every 200 rows
      if (rows.length >= 200) {
        retQ.upsert(rows.splice(0, 200));
      }
    } catch(e) {
      log.debug(`computeReturns(${sym}): ${e.message}`);
    }
  }

  if (rows.length) retQ.upsert(rows);
  log.step(`Returns computed for ${symbols.length} symbols`);
}

// ── Get EOD-based enriched ticker (used by routes) ────────────────────────────
export function getEODEnrichedTicker(sym) {
  const ret = retQ.get(sym);
  const uni = db.prepare(`SELECT * FROM universe WHERE symbol=?`).get(sym);
  if (!ret) return null;
  return {
    symbol:    sym,
    name:      uni?.name || sym,
    sector:    uni?.sector || null,
    industry:  uni?.industry || null,
    exchange:  uni?.exchange || null,
    price:     ret.close,
    d1:        ret.d1,
    d5:        ret.d5,
    d21:       ret.d21,
    d63:       ret.d63,
    d126:      ret.d126,
    d252:      ret.d252,
    ytd:       ret.ytd,
    mtd:       ret.mtd,
    ema20:     ret.ema20,
    ema50:     ret.ema50,
    ema200:    ret.ema200,
    rsi:       ret.rsi14,
    adr:       ret.adr14,
    volume:    ret.volume,
    avgVol:    ret.avg_vol10,
    above50:   ret.ema50  ? ret.close > ret.ema50  : null,
    above200:  ret.ema200 ? ret.close > ret.ema200 : null,
    dataDate:  ret.date,
    source:    "eod_db",
  };
}
