// server/jobs/compute-ema-touch.js
// ─────────────────────────────────────────────────────────────────────────────
// Computes EMA touch/cross flags for all symbols using stored eod_prices.
// A "touch" = today's candle (open/high/low/close) intersected the EMA line.
// A "cross" = close moved from one side of EMA to the other vs previous close.
//
// Adds/updates columns in eod_returns:
//   ema10, ema20, ema50, ema100, ema200
//   above_ema10, above_ema20, above_ema50, above_ema100, above_ema200
//   touch_ema10, touch_ema20, touch_ema50, touch_ema100, touch_ema200  (1=touched today)
//   cross_ema10, cross_ema20, cross_ema50, cross_ema100, cross_ema200  (1=up cross, -1=down cross, 0=none)
// ─────────────────────────────────────────────────────────────────────────────

import { db }          from "../db/index.js";
import { runMigrations } from "../db/index.js";
import { log }         from "../logger.js";

const EMA_PERIODS = [10, 20, 50, 100, 200];

// ── Add columns if not exist ─────────────────────────────────────────────────
function ensureColumns() {
  const cols = [];
  for (const p of EMA_PERIODS) {
    cols.push(
      `ALTER TABLE eod_returns ADD COLUMN ema${p}       REAL`,
      `ALTER TABLE eod_returns ADD COLUMN above_ema${p} INTEGER`,
      `ALTER TABLE eod_returns ADD COLUMN touch_ema${p} INTEGER`,   // 1 = candle touched EMA today
      `ALTER TABLE eod_returns ADD COLUMN cross_ema${p} INTEGER`,   // 1=up cross, -1=down cross, 0=none
    );
  }
  for (const sql of cols) {
    try { db.prepare(sql).run(); } catch {}  // "duplicate column name" = already exists
  }
  log.step("EMA touch columns verified");
}

// ── EMA full series (returns array of EMA values, one per close) ─────────────
function calcEMASeries(closes, period) {
  if (!closes || closes.length < period) return [];
  const k      = 2 / (period + 1);
  const series = new Array(closes.length).fill(null);
  // Seed with SMA of first `period` bars
  let seed = 0;
  for (let i = 0; i < period; i++) seed += closes[i];
  seed /= period;
  series[period - 1] = +seed.toFixed(4);
  for (let i = period; i < closes.length; i++) {
    series[i] = +(closes[i] * k + series[i-1] * (1-k)).toFixed(4);
  }
  return series;
}

// ── Touch detection ───────────────────────────────────────────────────────────
// A candle "touches" the EMA if:
//   candleLow  <= emaValue AND candleHigh >= emaValue   (wick/body crossed the line)
// OR
//   close crosses EMA vs previous close (gap cross)
function detectTouch(high, low, open, close, emaVal, prevClose, prevEma) {
  if (!emaVal) return { touch: 0, cross: 0 };

  // Candle body or wick touched EMA line
  const touch = (low <= emaVal && high >= emaVal) ? 1 : 0;

  // Cross: previous close was on one side, today's close is on the other
  let cross = 0;
  if (prevClose != null && prevEma != null) {
    const wasAbove = prevClose > prevEma;
    const nowAbove = close     > emaVal;
    if (!wasAbove && nowAbove)  cross =  1;   // up cross (bullish)
    if ( wasAbove && !nowAbove) cross = -1;   // down cross (bearish)
  }

  return { touch: touch || (cross !== 0 ? 1 : 0), cross };
}

// ── Main computation ─────────────────────────────────────────────────────────
export async function computeEmaTouches(options = {}) {
  const { symbols: symFilter = null, batchSize = 500 } = options;
  const t0 = Date.now();

  ensureColumns();

  // Get target symbols
  const allSymbols = symFilter
    ? symFilter
    : db.prepare(
        `SELECT DISTINCT r.symbol FROM eod_returns r
         JOIN universe u ON r.symbol=u.symbol
         WHERE u.is_active=1 AND r.close>0`
      ).all().map(r => r.symbol);

  log.info(`EMA touch computation: ${allSymbols.length} symbols`);

  const updateStmt = db.prepare(`
    UPDATE eod_returns SET
      ema10=@ema10, ema20=@ema20, ema50=@ema50, ema100=@ema100, ema200=@ema200,
      above_ema10=@above_ema10, above_ema20=@above_ema20, above_ema50=@above_ema50,
      above_ema100=@above_ema100, above_ema200=@above_ema200,
      touch_ema10=@touch_ema10, touch_ema20=@touch_ema20, touch_ema50=@touch_ema50,
      touch_ema100=@touch_ema100, touch_ema200=@touch_ema200,
      cross_ema10=@cross_ema10, cross_ema20=@cross_ema20, cross_ema50=@cross_ema50,
      cross_ema100=@cross_ema100, cross_ema200=@cross_ema200
    WHERE symbol=@symbol
  `);

  const batchUpdate = db.transaction((rows) => {
    for (const r of rows) updateStmt.run(r);
  });

  let processed = 0, updated = 0, skipped = 0;
  const pending = [];

  for (let i = 0; i < allSymbols.length; i++) {
    const sym = allSymbols[i];
    try {
      // Get last 220 bars (enough for EMA200 seed + some history)
      const bars = db.prepare(`
        SELECT date, open, high, low, close
        FROM eod_prices
        WHERE symbol=? AND close>0
        ORDER BY date ASC
        LIMIT 260
      `).all(sym);

      if (bars.length < 12) { skipped++; continue; }

      const closes = bars.map(b => b.close);
      const highs  = bars.map(b => b.high  || b.close);
      const lows   = bars.map(b => b.low   || b.close);
      const opens  = bars.map(b => b.open  || b.close);

      const N   = bars.length;
      const row = { symbol: sym };

      // Compute full EMA series for each period
      for (const period of EMA_PERIODS) {
        const series = calcEMASeries(closes, period);
        const emaVal  = series[N-1];          // today's EMA
        const prevEma = series[N-2] ?? null;  // yesterday's EMA
        const prevClose = closes[N-2] ?? null;

        const today = bars[N-1];
        const { touch, cross } = detectTouch(
          highs[N-1], lows[N-1], opens[N-1], closes[N-1],
          emaVal, prevClose, prevEma
        );

        row[`ema${period}`]       = emaVal;
        row[`above_ema${period}`] = emaVal ? (closes[N-1] > emaVal ? 1 : 0) : null;
        row[`touch_ema${period}`] = emaVal ? touch : null;
        row[`cross_ema${period}`] = emaVal ? cross : null;
      }

      pending.push(row);
      processed++;

      // Flush in batches
      if (pending.length >= batchSize) {
        batchUpdate(pending.splice(0, batchSize));
        updated += batchSize;
        if (i % 2000 === 0)
          process.stdout.write(`\r  EMA touch: ${i}/${allSymbols.length} (${updated} updated)   `);
      }
    } catch(e) {
      log.debug(`EMA touch ${sym}: ${e.message}`);
      skipped++;
    }
  }

  // Final flush
  if (pending.length) {
    batchUpdate(pending);
    updated += pending.length;
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write("\n");
  log.ok(`EMA touches done: ${processed} computed, ${skipped} skipped, ${dur}s`);
  return { processed, skipped, duration: +dur };
}

// ── CLI entry ─────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("compute-ema-touch.js")) {
  process.env.YF_DISABLE_VERSION_CHECK = "1";
  runMigrations();
  await computeEmaTouches();
  process.exit(0);
}
