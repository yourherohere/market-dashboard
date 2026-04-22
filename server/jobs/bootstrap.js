// server/jobs/bootstrap.js
// ─────────────────────────────────────────────────────────────────────────────
// Historical data bootstrap — downloads 1–2 years of OHLCV for every symbol
// in the universe and stores it in SQLite eod_prices.
//
// Design goals:
//   • Resumable   — tracks per-symbol status in bootstrap_status table
//   • Efficient   — parallel batches with concurrency limit, WAL writes
//   • Fault-tolerant — retries failed symbols up to 3 times
//   • Observable  — live progress bar + ETA to console + /api/bootstrap/status
//   • Non-blocking — server stays responsive during download
//
// Usage:
//   node server/jobs/bootstrap.js              # 2-year download
//   node server/jobs/bootstrap.js --years 1    # 1-year download
//   node server/jobs/bootstrap.js --retry      # retry failed symbols only
//   node server/jobs/bootstrap.js --reset      # wipe and restart from scratch
// ─────────────────────────────────────────────────────────────────────────────

import { runMigrations, db, eodQ, spyQ, bootQ, retQ, uniQ, eodLogQ } from "../db/index.js";
import { loadSICache }       from "../data/enrichment.js";
import { loadUniverse, universe } from "../data/universe.js";
import { yf, safeChart }     from "../data/yahoo.js";
import { log }               from "../logger.js";
import { BATCH }             from "../config.js";

// ── Configuration ─────────────────────────────────────────────────────────────
const ARGS         = process.argv.slice(2);
const YEARS        = parseFloat(ARGS.find((_, i) => ARGS[i-1] === "--years") || "2");
const RETRY_ONLY   = ARGS.includes("--retry");
const RESET        = ARGS.includes("--reset");
const BATCH_SIZE   = 12;   // concurrent Yahoo chart fetches per wave
const WAVE_DELAY   = 200;  // ms between waves — be kind to Yahoo
const WRITE_BATCH  = 500;  // rows per SQLite INSERT transaction
const DAYS         = Math.round(YEARS * 365) + 30; // extra buffer for weekends/holidays

// ── Global progress state (exported for API endpoint) ─────────────────────────
export const bootstrapState = {
  running:   false,
  total:     0,
  done:      0,
  ok:        0,
  err:       0,
  skip:      0,
  startedAt: null,
  eta:       null,
  phase:     "idle",    // idle | loading_universe | downloading | computing | done
  errors:    [],        // last 20 errors
};

// ── Technical indicator helpers ────────────────────────────────────────────────
function sma(closes, n) {
  if (!closes?.length || closes.length < n) return null;
  return closes.slice(-n).reduce((a, b) => a + b, 0) / n;
}

function ema(closes, n) {
  if (!closes?.length || closes.length < n) return null;
  const k = 2 / (n + 1);
  let e = closes.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return +e.toFixed(4);
}

function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 2) return null;
  let gains = 0, losses = 0;
  const start = closes.length - period;
  for (let i = start; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    d > 0 ? (gains += d) : (losses -= d);
  }
  if (!losses) return 100;
  const rs = (gains / period) / (losses / period);
  return +(100 - 100 / (1 + rs)).toFixed(2);
}

function adr(highs, lows, closes, period = 14) {
  const n = Math.min(period, closes.length);
  if (n < 2) return null;
  const ranges = [];
  for (let i = closes.length - n; i < closes.length; i++) {
    if (closes[i] > 0) ranges.push((highs[i] - lows[i]) / closes[i] * 100);
  }
  return ranges.length ? +(ranges.reduce((a,b)=>a+b,0)/ranges.length).toFixed(2) : null;
}

function calcRet(closes, n) {
  if (!closes?.length || closes.length <= n) return null;
  const now = closes[closes.length - 1], then = closes[closes.length - 1 - n];
  return then > 0 ? +((now - then) / then * 100).toFixed(2) : null;
}

function calcRetSince(closes, timestamps, targetUnix) {
  if (!closes?.length || !timestamps?.length) return null;
  let idx = timestamps.findIndex(t => t >= targetUnix);
  if (idx < 0) idx = 0;
  const from = closes[idx], now = closes[closes.length - 1];
  return from > 0 ? +((now - from) / from * 100).toFixed(2) : null;
}

function calcBeta(stockCloses, spyCloses) {
  if (!stockCloses?.length || !spyCloses?.length) return null;
  const n = Math.min(252, stockCloses.length, spyCloses.length);
  if (n < 30) return null;
  const sc = stockCloses.slice(-n), sp = spyCloses.slice(-n);
  const stockRets = sc.slice(1).map((v, i) => sc[i] > 0 ? (v - sc[i]) / sc[i] : 0);
  const spyRets   = sp.slice(1).map((v, i) => sp[i] > 0 ? (v - sp[i]) / sp[i] : 0);
  const meanS = stockRets.reduce((a,b)=>a+b,0)/stockRets.length;
  const meanP = spyRets.reduce((a,b)=>a+b,0)/spyRets.length;
  let cov = 0, varP = 0;
  for (let i = 0; i < stockRets.length; i++) {
    cov  += (stockRets[i]-meanS)*(spyRets[i]-meanP);
    varP += (spyRets[i]-meanP)**2;
  }
  return varP > 0 ? +(cov/varP).toFixed(3) : null;
}

function calcRS(closes, spyCloses, n) {
  const sr = calcRet(closes, n), pr = calcRet(spyCloses, n);
  if (sr == null || pr == null || pr === -100) return null;
  return +((1 + sr/100) / (1 + pr/100) * 100 - 100).toFixed(2);
}

// ── Compute full return row for one symbol ─────────────────────────────────────
function computeReturnRow(sym, history, spyHistory) {
  if (!history?.length) return null;
  const closes = history.map(r => r.close);
  const highs  = history.map(r => r.high  || r.close);
  const lows   = history.map(r => r.low   || r.close);
  const vols   = history.map(r => r.volume || 0);
  const timestamps = history.map(r => Math.floor(new Date(r.date).getTime() / 1000));
  const latest = history[history.length - 1];
  const price  = latest.close;

  const now = new Date();
  const ytdTs = Math.floor(new Date(now.getFullYear(), 0, 1).getTime() / 1000);
  const mtdTs = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
  const qtdMo = Math.floor(now.getMonth() / 3) * 3;
  const qtdTs = Math.floor(new Date(now.getFullYear(), qtdMo, 1).getTime() / 1000);

  const hi52 = closes.length >= 252 ? Math.max(...closes.slice(-252)) : Math.max(...closes);
  const lo52 = closes.length >= 252 ? Math.min(...closes.slice(-252)) : Math.min(...closes);

  const avg_vol10 = vols.length >= 10 ? Math.round(vols.slice(-10).reduce((a,b)=>a+b,0)/10) : null;
  const avg_vol30 = vols.length >= 30 ? Math.round(vols.slice(-30).reduce((a,b)=>a+b,0)/30) : null;

  const spyC = spyHistory?.map(r => r.close) || [];

  const e10val  = ema(closes, 10);
  const e20val  = ema(closes, 20);
  const e50val  = ema(closes, 50);
  const e100val = ema(closes, 100);
  const e200val = ema(closes, 200);
  const s150val = sma(closes, 150);
  const s200val = sma(closes, 200);

  return {
    symbol:       sym,
    date:         latest.date,
    close:        price,
    open:         latest.open || price,
    high:         latest.high || price,
    low:          latest.low  || price,
    volume:       latest.volume || 0,
    avg_vol10,
    avg_vol30,
    rel_vol:      avg_vol10 > 0 ? +(vols[vols.length-1] / avg_vol10).toFixed(2) : null,

    d1:    calcRet(closes, 1),
    d5:    calcRet(closes, 5),
    d10:   calcRet(closes, 10),
    d21:   calcRet(closes, 21),
    d42:   calcRet(closes, 42),
    d63:   calcRet(closes, 63),
    d126:  calcRet(closes, 126),
    d189:  calcRet(closes, 189),
    d252:  calcRet(closes, 252),
    d504:  calcRet(closes, 504),
    ytd:   calcRetSince(closes, timestamps, ytdTs),
    mtd:   calcRetSince(closes, timestamps, mtdTs),
    qtd:   calcRetSince(closes, timestamps, qtdTs),

    sma20:  sma(closes, 20),
    sma50:  sma(closes, 50),
    sma150: s150val,
    sma200: s200val,
    ema10:  e10val,
    ema20:  e20val,
    ema50:  e50val,
    ema100: e100val,
    ema200: e200val,

    above_ema10:  e10val  ? (price > e10val  ? 1 : 0) : null,
    above_ema20:  e20val  ? (price > e20val  ? 1 : 0) : null,
    above_ema50:  e50val  ? (price > e50val  ? 1 : 0) : null,
    above_ema100: e100val ? (price > e100val ? 1 : 0) : null,
    above_ema200: e200val ? (price > e200val ? 1 : 0) : null,
    above_sma150: s150val ? (price > s150val ? 1 : 0) : null,
    above_sma200: s200val ? (price > s200val ? 1 : 0) : null,

    hi52,  lo52,
    pct_hi52: hi52 > 0 ? +(price / hi52 * 100).toFixed(1) : null,
    pct_lo52: lo52 > 0 ? +(price / lo52 * 100).toFixed(1) : null,

    rsi14:  rsi(closes, 14),
    rsi2:   rsi(closes, 2),
    adr14:  adr(highs, lows, closes, 14),
    atr14:  adr(highs, lows, closes, 14) ? +(adr(highs, lows, closes, 14) * price / 100).toFixed(3) : null,
    beta252: calcBeta(closes, spyC),

    rs_1m:  calcRS(closes, spyC, 21),
    rs_3m:  calcRS(closes, spyC, 63),
    rs_6m:  calcRS(closes, spyC, 126),
    rs_12m: calcRS(closes, spyC, 252),

    trend_state: null, // can add Darvas later
    updated_at:  new Date().toISOString(),
  };
}

// ── Fetch + store one symbol ───────────────────────────────────────────────────
async function fetchAndStoreSymbol(sym, days) {
  const cd = await safeChart(sym, days);
  if (!cd?.closes?.length || cd.closes.length < 5) {
    return { status: "no_data", days: 0 };
  }

  const rows = [];
  for (let i = 0; i < cd.closes.length; i++) {
    if (!cd.timestamps[i] || !cd.closes[i]) continue;
    const date = new Date(cd.timestamps[i] * 1000).toISOString().split("T")[0];
    rows.push({
      symbol:    sym,
      date,
      open:      cd.closes[i],                    // Yahoo chart only returns close reliably
      high:      cd.highs[i]    || cd.closes[i],
      low:       cd.lows[i]     || cd.closes[i],
      close:     cd.closes[i],
      adj_close: cd.closes[i],
      volume:    cd.volumes?.[i] || 0,
    });
  }

  if (!rows.length) return { status: "no_data", days: 0 };

  // Write in chunks to avoid large transactions
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    eodQ.upsert(rows.slice(i, i + WRITE_BATCH));
  }

  return {
    status:    "ok",
    days:      rows.length,
    firstDate: rows[0].date,
    lastDate:  rows[rows.length - 1].date,
  };
}

// ── Progress bar renderer ──────────────────────────────────────────────────────
function renderProgress() {
  const { done, total, ok, err, skip, startedAt, phase } = bootstrapState;
  if (!total) return;
  const pct   = total > 0 ? Math.round(done / total * 100) : 0;
  const BAR   = 30;
  const filled = Math.round(pct / 100 * BAR);
  const bar   = "█".repeat(filled) + "░".repeat(BAR - filled);
  const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
  const rate  = elapsed > 0 ? done / elapsed : 0;
  const remaining = rate > 0 ? Math.round((total - done) / rate) : 0;
  const etaStr = remaining > 3600
    ? `${Math.round(remaining/3600)}h ${Math.round((remaining%3600)/60)}m`
    : remaining > 60
      ? `${Math.round(remaining/60)}m ${remaining%60}s`
      : `${remaining}s`;

  process.stdout.write(
    `\r  [${bar}] ${pct}%  ${done}/${total}  ` +
    `✓${ok} ✗${err} ↷${skip}  ETA:${etaStr}  ${phase}   `
  );
}

// ── Main bootstrap function ────────────────────────────────────────────────────
export async function runHistoricalBootstrap(options = {}) {
  const { years = YEARS, retryOnly = RETRY_ONLY, reset = RESET } = options;
  const days = Math.round(years * 365) + 30;

  if (bootstrapState.running) {
    log.warn("Bootstrap already running");
    return bootstrapState;
  }

  bootstrapState.running   = true;
  bootstrapState.startedAt = Date.now();
  bootstrapState.errors    = [];
  bootstrapState.phase     = "loading_universe";

  const logId = eodLogQ.start(new Date().toISOString().split("T")[0], "bootstrap");
  const t0    = Date.now();

  log.info(`\n${"═".repeat(62)}`);
  log.info(`  Historical Bootstrap — ${years} years (${days} trading days)`);
  log.info(`  Reset: ${reset} | Retry-only: ${retryOnly}`);
  log.info(`${"═".repeat(62)}\n`);

  // ── Step 1: Load SPY first (needed for beta + RS calculations) ────────────
  log.step("Fetching SPY price history...");
  const spyCD = await safeChart("SPY", days + 30);
  if (spyCD?.closes?.length) {
    const spyRows = spyCD.closes.map((close, i) => ({
      date:      new Date(spyCD.timestamps[i] * 1000).toISOString().split("T")[0],
      close,
      adj_close: close,
    })).filter(r => r.close > 0);
    spyQ.upsert(spyRows);
    log.ok(`SPY: ${spyRows.length} days stored (${spyRows[0]?.date} → ${spyRows[spyRows.length-1]?.date})`);
  } else {
    log.warn("SPY chart fetch failed — beta and RS calculations will be skipped");
  }

  // ── Step 2: Get symbol list ────────────────────────────────────────────────
  bootstrapState.phase = "loading_universe";
  if (!universe.size) {
    log.step("Universe not loaded yet — loading now...");
    await loadUniverse();
  }

  let allSyms = universe.size > 0 ? [...universe.keys()] : uniQ.allSymbols();
  log.ok(`Universe: ${allSyms.length} symbols`);

  // Reset bootstrap tracking if requested
  if (reset) {
    log.warn("--reset: clearing bootstrap_status and all eod_prices...");
    db.prepare("DELETE FROM bootstrap_status").run();
    db.prepare("DELETE FROM eod_prices WHERE symbol != 'SPY'").run();
    db.prepare("DELETE FROM eod_returns").run();
  }

  // Register all symbols in bootstrap_status if not already there
  const unregistered = bootQ.unregistered();
  if (unregistered.length) {
    bootQ.set(unregistered.map(sym => ({
      symbol: sym, status: "pending", days_loaded: 0,
      first_date: null, last_date: null, error_msg: null,
    })));
    log.step(`Registered ${unregistered.length} new symbols in bootstrap_status`);
  }

  // Select which symbols to process
  let targetSyms;
  if (retryOnly) {
    const errSyms = bootQ.errors();
    // Also include any symbols marked ok/pending but with zero eod_prices rows
    const emptySyms = db.prepare(`
      SELECT b.symbol FROM bootstrap_status b
      WHERE b.status IN ('ok','pending','no_data')
        AND NOT EXISTS (SELECT 1 FROM eod_prices e WHERE e.symbol=b.symbol LIMIT 1)
      ORDER BY b.symbol
    `).all().map(r => r.symbol);

    targetSyms = [...new Set([...errSyms, ...emptySyms])];
    log.info(`Retry mode: ${errSyms.length} failed + ${emptySyms.length} empty = ${targetSyms.length} symbols to re-download`);
  } else {
    const pending    = bootQ.pending();
    const withErrors = bootQ.errors();
    targetSyms = [...new Set([...pending, ...withErrors])];
    log.info(`To process: ${targetSyms.length} (${pending.length} pending + ${withErrors.length} retry)`);
  }

  if (!targetSyms.length) {
    log.ok("Nothing to download — all symbols already bootstrapped!");
    const summary = bootQ.summary();
    summary.forEach(s => log.step(`  ${s.status}: ${s.n}`));
    bootstrapState.running = false;
    bootstrapState.phase   = "done";
    return bootstrapState;
  }

  bootstrapState.total = targetSyms.length;
  bootstrapState.done  = 0;
  bootstrapState.ok    = 0;
  bootstrapState.err   = 0;
  bootstrapState.skip  = 0;
  bootstrapState.phase = "downloading";

  log.info(`\nStarting download: ${targetSyms.length} symbols, ${days} days, batch=${BATCH_SIZE}\n`);

  // ── Step 3: Download in parallel waves ────────────────────────────────────
  const retryQueue = [];

  for (let i = 0; i < targetSyms.length; i += BATCH_SIZE) {
    if (!bootstrapState.running) break; // allow cancellation

    const wave = targetSyms.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      wave.map(sym => fetchAndStoreSymbol(sym, days))
    );

    const statusRows = [];
    for (let j = 0; j < wave.length; j++) {
      const sym = wave[j];
      const r   = results[j];
      bootstrapState.done++;

      if (r.status === "fulfilled") {
        const v = r.value;
        if (v.status === "ok") {
          bootstrapState.ok++;
          statusRows.push({
            symbol: sym, status: "ok",
            days_loaded: v.days, first_date: v.firstDate, last_date: v.lastDate, error_msg: null,
          });
        } else {
          bootstrapState.skip++;
          statusRows.push({
            symbol: sym, status: "no_data",
            days_loaded: 0, first_date: null, last_date: null, error_msg: "no_data",
          });
        }
      } else {
        bootstrapState.err++;
        const errMsg = r.reason?.message?.substring(0, 120) || "unknown";
        statusRows.push({
          symbol: sym, status: "error",
          days_loaded: 0, first_date: null, last_date: null, error_msg: errMsg,
        });
        bootstrapState.errors.push({ sym, msg: errMsg });
        if (bootstrapState.errors.length > 20) bootstrapState.errors.shift();
        retryQueue.push(sym);
      }
    }

    // Batch-write bootstrap status
    bootQ.set(statusRows);
    renderProgress();

    // Rate-limiting pause between waves
    if (i + BATCH_SIZE < targetSyms.length) {
      await new Promise(r => setTimeout(r, WAVE_DELAY));
    }
  }

  // ── Step 4: Retry failures once (after a short pause) ─────────────────────
  if (retryQueue.length > 0 && !retryOnly) {
    process.stdout.write("\n");
    log.step(`\nRetrying ${retryQueue.length} failed symbols...`);
    await new Promise(r => setTimeout(r, 5000)); // 5 second pause

    for (let i = 0; i < retryQueue.length; i += BATCH_SIZE) {
      const wave = retryQueue.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(wave.map(sym => fetchAndStoreSymbol(sym, days)));
      const statusRows = [];
      for (let j = 0; j < wave.length; j++) {
        const sym = wave[j], r = results[j];
        if (r.status === "fulfilled" && r.value.status === "ok") {
          bootstrapState.ok++;  bootstrapState.err--;
          statusRows.push({ symbol: sym, status: "ok", days_loaded: r.value.days, first_date: r.value.firstDate, last_date: r.value.lastDate, error_msg: null });
        } else {
          statusRows.push({ symbol: sym, status: "error", days_loaded: 0, first_date: null, last_date: null, error_msg: r.reason?.message?.substring(0, 120) || "retry_failed" });
        }
      }
      bootQ.set(statusRows);
      await new Promise(r => setTimeout(r, WAVE_DELAY));
    }
  }

  process.stdout.write("\n\n");

  // ── Step 5: Compute returns for all successfully downloaded symbols ────────
  bootstrapState.phase = "computing";
  log.step("Computing returns, EMAs, RSI, beta for all symbols...");

  const spyHistory = spyQ.closes(520); // load SPY from DB for beta calc
  const okSyms     = bootQ.pending().length === 0
    ? eodQ.symbolsWithMinDays(5)
    : targetSyms.filter(s => bootQ.get(s)?.status === "ok");

  const COMPUTE_BATCH = 200;
  const retRows = [];
  let computed = 0;

  for (let i = 0; i < okSyms.length; i++) {
    const sym     = okSyms[i];
    const history = eodQ.closes(sym, 560); // 2y + buffer
    if (history.length < 5) continue;
    const row = computeReturnRow(sym, history, spyHistory);
    if (row) retRows.push(row);
    computed++;

    // Flush every COMPUTE_BATCH rows
    if (retRows.length >= COMPUTE_BATCH) {
      retQ.upsert(retRows.splice(0, COMPUTE_BATCH));
      process.stdout.write(`\r  Computing returns: ${computed}/${okSyms.length}   `);
    }
  }
  if (retRows.length) retQ.upsert(retRows);
  process.stdout.write("\n");

  // ── Step 6: Final report ────────────────────────────────────────────────────
  const duration = Date.now() - t0;
  eodLogQ.finish(logId, bootstrapState.ok, bootstrapState.err, bootstrapState.skip, duration);

  const summary = bootQ.summary();
  log.info(`\n${"═".repeat(62)}`);
  log.ok(`Bootstrap complete in ${(duration/1000/60).toFixed(1)} minutes`);
  log.info(`  ✓ Downloaded:  ${bootstrapState.ok}`);
  log.info(`  ✗ Errors:     ${bootstrapState.err}`);
  log.info(`  ↷ No data:    ${bootstrapState.skip}`);
  log.info(`  📊 Returns computed: ${computed}`);
  log.info(`  🗄  DB size: ${eodQ.countRows().toLocaleString()} rows`);
  log.info(`${"═".repeat(62)}\n`);

  bootstrapState.running = false;
  bootstrapState.phase   = "done";
  return bootstrapState;
}

// ── CLI entry point ────────────────────────────────────────────────────────────
if (process.argv[1].endsWith("bootstrap.js")) {
  runMigrations();
  loadSICache();
  runHistoricalBootstrap({ years: YEARS, retryOnly: RETRY_ONLY, reset: RESET })
    .then(() => process.exit(0))
    .catch(e => { log.error(e.message); process.exit(1); });
}
