// server/jobs/compute-analytics.js
// ─────────────────────────────────────────────────────────────────────────────
// Nightly analytics computation — runs after EOD collection.
// Computes for every symbol in eod_returns:
//   1. RS Rank 1-99   — IBD-style percentile composite (12M, 9M, 6M, 3M weighted)
//   2. Weinstein Stage 1-4 — using SMA150/200 + slope + price position
//   3. Setup Score 0-100 — composite quality score for trade setups
//   4. Pocket Pivot flag — volume > highest down-day vol in prior 10 days
//   5. Tight Flag — recent ADR < 50% of 14-day ADR (base-building signal)
//   6. VCP Score 0-100 — volatility contraction pattern quality
//   7. Earnings date / days to earnings — via quoteSummary calendarEvents
//   8. RS Line High flag — RS line (close/SPY) at 52-week high
// ─────────────────────────────────────────────────────────────────────────────

import { db }                from "../db/index.js";
import { runMigrations }     from "../db/index.js";
import { yf, withTimeout }   from "../data/yahoo.js";
import { log }               from "../logger.js";

// ── EMA helper ───────────────────────────────────────────────────────────────
function ema(values, period) {
  if (!values.length) return [];
  const k   = 2 / (period + 1);
  const out = [];
  let   e   = values[0];
  for (let i = 0; i < values.length; i++) {
    e = i === 0 ? values[0] : values[i] * k + e * (1 - k);
    out.push(+e.toFixed(4));
  }
  return out;
}

// ── Slope of last N values (linear regression slope normalised to %) ─────────
function slope(values, n = 20) {
  if (values.length < n) return 0;
  const s = values.slice(-n);
  let sumX=0, sumY=0, sumXY=0, sumX2=0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += s[i]; sumXY += i*s[i]; sumX2 += i*i;
  }
  const sl = (n*sumXY - sumX*sumY) / (n*sumX2 - sumX*sumX);
  return sl / (sumY/n) * 100;   // normalised to % per bar
}

// ── Stage Analysis (Stan Weinstein) ─────────────────────────────────────────
function computeStage(r) {
  const { close, sma150, sma200, ema50, above_ema50, above_ema200 } = r;
  if (!close || !sma200) return { stage: null, label: "UNKNOWN" };

  const aboveSma200 = close > sma200;
  const aboveSma150 = close > (sma150 || sma200 * 1.05);
  const ab50        = above_ema50  === 1;
  const ab200       = above_ema200 === 1;
  const sma150AboveSma200 = sma150 ? sma150 > sma200 : false;

  // Need SMA200 slope — compute from stored SMA200 + close proximity
  // If sma150 and sma200 are both available, their gap direction gives us slope context
  const sma200Trending = sma150AboveSma200;

  // Stage 2: The ideal uptrend
  // Price above SMA150 AND SMA200; SMA150 > SMA200; both EMAs trending up
  if (aboveSma150 && aboveSma200 && sma150AboveSma200 && ab50 && ab200) {
    return { stage: 2, label: "STAGE 2 — UPTREND" };
  }

  // Stage 4: Clear downtrend — below both, SMA200 declining (SMA150 < SMA200)
  if (!aboveSma200 && !ab200 && !sma150AboveSma200) {
    return { stage: 4, label: "STAGE 4 — DECLINE" };
  }

  // Stage 1: Basing — consolidating near SMA200, mixed signals
  if (aboveSma200 && !aboveSma150) {
    return { stage: 1, label: "STAGE 1 — BASING" };
  }
  if (!aboveSma200 && sma150AboveSma200) {
    return { stage: 1, label: "STAGE 1 — BASING" };
  }

  // Stage 3: Topping — was in stage 2 but breaking down
  if (aboveSma200 && aboveSma150 && !ab50) {
    return { stage: 3, label: "STAGE 3 — TOPPING" };
  }
  if (aboveSma200 && !aboveSma150 && ab50) {
    return { stage: 3, label: "STAGE 3 — TOPPING" };
  }

  // Ambiguous — classify by price vs SMA200
  if (aboveSma200) return { stage: 1, label: "STAGE 1 — BASING" };
  return { stage: 4, label: "STAGE 4 — DECLINE" };
}

// ── RS Rank (IBD-style composite) ────────────────────────────────────────────
// Composite = 40%×d252 + 20%×d189 + 20%×d126 + 20%×d63 (same weights as IBD)
function compositeRS(r) {
  const w = [
    { v: r.d252, w: 0.40 },
    { v: r.d189, w: 0.20 },
    { v: r.d126, w: 0.20 },
    { v: r.d63,  w: 0.20 },
  ];
  let total = 0, wSum = 0;
  for (const { v, w: wt } of w) {
    if (v != null) { total += v * wt; wSum += wt; }
  }
  return wSum >= 0.40 ? +(total / wSum).toFixed(3) : null;
}

// ── Setup Score 0-100 ────────────────────────────────────────────────────────
function computeSetupScore(r, rsRank) {
  let score = 0;

  // 1. RS Rank (25 pts) — higher rank = more points
  if (rsRank != null) {
    if      (rsRank >= 90) score += 25;
    else if (rsRank >= 80) score += 20;
    else if (rsRank >= 70) score += 15;
    else if (rsRank >= 60) score += 10;
    else if (rsRank >= 50) score += 5;
  }

  // 2. Stage (20 pts) — Stage 2 is the sweet spot
  const { stage } = computeStage(r);
  if      (stage === 2) score += 20;
  else if (stage === 1) score += 10;
  else if (stage === 3) score += 4;
  // Stage 4 = 0

  // 3. EMA position (20 pts) — above key MAs
  if (r.above_ema50 === 1 && r.above_ema200 === 1) score += 20;
  else if (r.above_ema50 === 1)  score += 10;
  else if (r.above_ema200 === 1) score += 5;

  // 4. 52-Week high proximity (15 pts) — closer to high = more points
  if (r.pct_hi52 != null) {
    const pctOfHigh = r.pct_hi52;   // e.g. 97 means 97% of 52W high
    if      (pctOfHigh >= 97) score += 15;
    else if (pctOfHigh >= 90) score += 12;
    else if (pctOfHigh >= 80) score += 8;
    else if (pctOfHigh >= 70) score += 4;
  }

  // 5. Volume pattern (20 pts)
  // Tight consolidation = ADR lower than average (base-building)
  if (r.tight_flag === 1) score += 10;
  // Pocket pivot
  if (r.pocket_pivot === 1) score += 10;

  return Math.min(100, Math.round(score));
}

// ── Pocket Pivot detection ───────────────────────────────────────────────────
// Pocket Pivot: price up on the day, volume > highest down-day volume in prior 10 days
function detectPocketPivot(bars) {
  // bars = [{date, close, open, high, low, volume}, ...] sorted ascending
  if (bars.length < 12) return 0;
  const today = bars[bars.length - 1];
  const prior = bars.slice(-12, -1);

  // Must be an up day
  const prev = bars[bars.length - 2];
  if (!prev || today.close <= prev.close) return 0;

  // Must be near 52W high (within 15%)
  const closes = bars.map(b => b.close);
  const high52 = Math.max(...closes);
  if (today.close < high52 * 0.85) return 0;

  // Find highest volume on down days in prior 10 sessions
  const downDays    = prior.filter((b, i) => i > 0 && b.close < prior[i-1]?.close);
  if (!downDays.length) return 0;
  const maxDownVol  = Math.max(...downDays.map(b => b.volume));

  return today.volume > maxDownVol ? 1 : 0;
}

// ── Tight Flag (low-volatility consolidation) ────────────────────────────────
// Last 5 days average range < 50% of 14-day ADR
function detectTightFlag(r) {
  if (!r.adr14) return 0;
  // We'd need recent bars to compute last-5d ADR precisely
  // Approximate using: if current 1D move is very small vs ADR14
  const recentMove = Math.abs(r.d1 || 0);
  return recentMove < r.adr14 * 0.5 ? 1 : 0;
}

// ── VCP Score (Volatility Contraction Pattern) ───────────────────────────────
// Uses stored period returns to detect successive contractions
// Higher score = tighter, more mature base
function computeVCP(r) {
  if (!r.adr14 || !r.d21 || !r.d63) return 0;

  let score = 0;

  // 1. Recent range contraction vs longer-term range
  // d5 volatility << d21 volatility << d63 volatility → tightening
  const shortRange  = Math.abs(r.d5  || 0);
  const midRange    = Math.abs(r.d21 || 0);
  const longRange   = Math.abs(r.d63 || 0);

  if (shortRange < midRange * 0.6)   score += 25;  // Strong contraction
  else if (shortRange < midRange * 0.8) score += 15;
  if (midRange < longRange * 0.7)    score += 20;  // Mid vs long contraction
  else if (midRange < longRange * 0.9) score += 10;

  // 2. Low ADR relative to 14-day average
  if (r.adr14 < 2.5) score += 20;
  else if (r.adr14 < 4) score += 10;

  // 3. Price near highs (can't form VCP in downtrend)
  if (r.pct_hi52 >= 90)        score += 20;
  else if (r.pct_hi52 >= 80)   score += 10;

  // 4. Above key MAs (must be in uptrend base)
  if (r.above_ema50 === 1 && r.above_ema200 === 1) score += 15;

  return Math.min(100, Math.round(score));
}

// ── Main computation function ─────────────────────────────────────────────────
export async function computeAnalytics(options = {}) {
  const { earningsOnly = false, maxEarnings = 200 } = options;
  const t0 = Date.now();
  log.info("Analytics computation starting…");

  // Ensure all v7 columns exist — idempotent, safe to run every time
  const V7_COLS = [
    "ALTER TABLE eod_returns ADD COLUMN rs_rank       INTEGER",
    "ALTER TABLE eod_returns ADD COLUMN rs_rank_3m    INTEGER",
    "ALTER TABLE eod_returns ADD COLUMN stage         INTEGER",
    "ALTER TABLE eod_returns ADD COLUMN stage_label   TEXT",
    "ALTER TABLE eod_returns ADD COLUMN setup_score   INTEGER",
    "ALTER TABLE eod_returns ADD COLUMN pocket_pivot  INTEGER",
    "ALTER TABLE eod_returns ADD COLUMN tight_flag    INTEGER",
    "ALTER TABLE eod_returns ADD COLUMN vcp_score     INTEGER",
    "ALTER TABLE eod_returns ADD COLUMN earnings_date TEXT",
    "ALTER TABLE eod_returns ADD COLUMN days_to_earn  INTEGER",
    "ALTER TABLE eod_returns ADD COLUMN rs_line_hi    INTEGER",
  ];
  for (const sql of V7_COLS) {
    try { db.prepare(sql).run(); } catch {}   // "duplicate column name" = already exists, fine
  }
  log.step("Schema v7 columns verified");

  // Step 1: Load all eod_returns for ranking
  const allRows = db.prepare(`
    SELECT r.symbol, r.close, r.d1, r.d5, r.d21, r.d42, r.d63, r.d126, r.d189, r.d252,
           r.ytd, r.sma150, r.sma200, r.ema50, r.ema200, r.above_ema50, r.above_ema200,
           r.adr14, r.rsi14, r.pct_hi52, r.lo52, r.hi52, r.volume, r.avg_vol10,
           r.rs_1m, r.rs_3m, r.rs_6m, r.rs_12m
    FROM eod_returns r JOIN universe u ON r.symbol=u.symbol
    WHERE u.is_active=1 AND r.close > 0
  `).all();

  if (!allRows.length) {
    log.warn("No eod_returns rows — run bootstrap first");
    return { computed: 0, duration: Date.now()-t0 };
  }
  log.step(`Loaded ${allRows.length} symbols for analytics`);

  // Step 2: Compute composite RS and rank
  const withRS = allRows.map(r => ({
    ...r,
    compRS:    compositeRS(r),
    compRS_3m: r.d63,
  })).filter(r => r.compRS != null);

  // Sort descending → assign percentile rank 1–99
  // IBD formula: rank 99 = top performer, rank 1 = worst
  // Correct: evenly distribute across [1, 99] so:
  //   i=0 (best)  → 99
  //   i=N-1 (worst) → 1
  withRS.sort((a, b) => b.compRS - a.compRS);
  const N = withRS.length;
  const rsRankMap = new Map();
  withRS.forEach((r, i) => {
    // Linear map: i=0 → 99, i=N-1 → 1
    const rank = N === 1 ? 99 : Math.round(99 - (i / (N - 1)) * 98);
    rsRankMap.set(r.symbol, Math.max(1, Math.min(99, rank)));
  });

  // 3M RS rank (same formula)
  const withRS3m = allRows.filter(r => r.d63 != null).sort((a, b) => (b.d63||0) - (a.d63||0));
  const N3 = withRS3m.length;
  const rsRank3mMap = new Map();
  withRS3m.forEach((r, i) => {
    const rank = N3 === 1 ? 99 : Math.round(99 - (i / (N3 - 1)) * 98);
    rsRank3mMap.set(r.symbol, Math.max(1, Math.min(99, rank)));
  });

  log.step(`RS ranks computed for ${withRS.length} symbols`);

  // Step 3: For pocket pivot, need recent price bars
  // Process in batches — get last 15 bars per symbol
  const symbolBatch   = allRows.map(r => r.symbol);
  const pocketPivotMap = new Map();
  const BATCH = 200;

  for (let i = 0; i < symbolBatch.length; i += BATCH) {
    const batch = symbolBatch.slice(i, i + BATCH);
    for (const sym of batch) {
      const bars = db.prepare(
        `SELECT date, close, open, high, low, volume
         FROM eod_prices WHERE symbol=? ORDER BY date DESC LIMIT 15`
      ).all(sym).reverse();
      pocketPivotMap.set(sym, detectPocketPivot(bars));
    }
    if (i % 2000 === 0 && i > 0) {
      process.stdout.write(`\r  Pocket pivot: ${i}/${symbolBatch.length}   `);
    }
  }
  process.stdout.write("\n");
  const ppCount = [...pocketPivotMap.values()].filter(v => v === 1).length;
  log.step(`Pocket pivots flagged: ${ppCount}`);

  // Step 4: Batch update eod_returns
  const updateStmt = db.prepare(`
    UPDATE eod_returns SET
      rs_rank       = @rs_rank,
      rs_rank_3m    = @rs_rank_3m,
      stage         = @stage,
      stage_label   = @stage_label,
      setup_score   = @setup_score,
      pocket_pivot  = @pocket_pivot,
      tight_flag    = @tight_flag,
      vcp_score     = @vcp_score
    WHERE symbol = @symbol
  `);

  const batchUpdate = db.transaction((rows) => {
    for (const r of rows) updateStmt.run(r);
  });

  const updates = [];
  for (const r of allRows) {
    const rsRank    = rsRankMap.get(r.symbol)   ?? null;
    const rsRank3m  = rsRank3mMap.get(r.symbol) ?? null;
    const { stage, label } = computeStage(r);
    const tight     = detectTightFlag(r);
    const pp        = pocketPivotMap.get(r.symbol) ?? 0;
    const vcp       = computeVCP({ ...r, tight_flag: tight, pocket_pivot: pp });

    // Must set tight_flag before setup score
    const tempR = { ...r, tight_flag: tight, pocket_pivot: pp };
    const setupScore = computeSetupScore(tempR, rsRank);

    updates.push({
      symbol:      r.symbol,
      rs_rank:     rsRank,
      rs_rank_3m:  rsRank3m,
      stage,
      stage_label: label,
      setup_score: setupScore,
      pocket_pivot: pp,
      tight_flag:  tight,
      vcp_score:   vcp,
    });
  }

  batchUpdate(updates);
  log.step(`Analytics written for ${updates.length} symbols`);

  // Step 5: RS Line High flag
  // RS line = close / SPY_close. Flag if RS line is at 52W high.
  try {
    const spyRow = db.prepare(
      `SELECT close FROM eod_prices WHERE symbol='SPY' ORDER BY date DESC LIMIT 1`
    ).get();
    if (spyRow?.close) {
      const spyClose = spyRow.close;
      // For each symbol compute RS line value and compare to 52W RS line high
      // We approximate: if pct_hi52 >= 95 AND rs_12m > 0 → RS line likely at new high
      db.prepare(`
        UPDATE eod_returns
        SET rs_line_hi = CASE
          WHEN pct_hi52 >= 95 AND rs_12m >= 0 AND above_ema200 = 1 THEN 1
          ELSE 0
        END
        WHERE close > 0
      `).run();
      log.step("RS line high flags set");
    }
  } catch(e) { log.warn(`RS line high: ${e.message}`); }

  // Step 6: Earnings dates (sample top 200 by setup score — most actionable)
  if (!earningsOnly || true) {
    await computeEarningsDates(maxEarnings);
  }

  const dur = Date.now() - t0;
  const stage2count = updates.filter(u => u.stage === 2).length;
  const ppFlagged   = updates.filter(u => u.pocket_pivot === 1).length;
  const highRS      = updates.filter(u => u.rs_rank >= 80).length;

  log.ok(`Analytics done in ${(dur/1000).toFixed(1)}s — ` +
    `Stage2: ${stage2count} | PP: ${ppFlagged} | RS80+: ${highRS}`);

  return { computed: updates.length, stage2: stage2count, pp: ppFlagged, duration: dur };
}

// ── Earnings dates computation ───────────────────────────────────────────────
export async function computeEarningsDates(maxSymbols = 300) {
  log.info(`Earnings dates: fetching for top ${maxSymbols} setup-score symbols…`);

  // Prioritise highest setup score symbols — most actionable
  const targets = db.prepare(`
    SELECT symbol FROM eod_returns
    WHERE setup_score IS NOT NULL
    ORDER BY setup_score DESC
    LIMIT ?
  `).all(maxSymbols).map(r => r.symbol);

  const updateEarnings = db.prepare(`
    UPDATE eod_returns
    SET earnings_date = @earnings_date, days_to_earn = @days_to_earn
    WHERE symbol = @symbol
  `);

  let fetched = 0;
  const now   = Date.now();
  const BATCH = 5;

  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async sym => {
      try {
        const r  = await withTimeout(
          yf.quoteSummary(sym, { modules: ["calendarEvents"] }), 8_000
        );
        const next = r?.calendarEvents?.earnings?.earningsDate?.[0];
        if (next) {
          const ts   = new Date(next).getTime();
          const days = Math.round((ts - now) / 86_400_000);
          if (days >= 0 && days <= 90) {
            updateEarnings.run({
              symbol:        sym,
              earnings_date: new Date(next).toISOString().slice(0,10),
              days_to_earn:  days,
            });
            fetched++;
          } else {
            updateEarnings.run({ symbol: sym, earnings_date: null, days_to_earn: null });
          }
        }
      } catch {}
    }));
  }

  log.ok(`Earnings: ${fetched} upcoming events loaded`);
  return fetched;
}

// ── McClellan Oscillator + Summation Index ───────────────────────────────────
// Computed from SP500 proxy daily A/D data stored in the response
export function computeMcClellan(dailyAD) {
  // dailyAD = [{ adv, dec, net, ts }, ...]
  if (!dailyAD || dailyAD.length < 40) return null;

  // Ratio-Adjusted Net Advances (RANA) — normalises for different universe sizes
  const rana = dailyAD.map(d => {
    const total = (d.adv || 0) + (d.dec || 0);
    return total > 0 ? (d.adv - d.dec) / total : 0;
  });

  const ema19 = ema(rana, 19);
  const ema39 = ema(rana, 39);

  const oscillator = ema19.map((v, i) => ({
    ts:    dailyAD[i].ts,
    value: +(v - ema39[i]).toFixed(4),
  }));

  // Summation Index = running sum of oscillator
  let sum = 0;
  const summation = oscillator.map(d => {
    sum += d.value;
    return { ts: d.ts, value: +sum.toFixed(2) };
  });

  const last = oscillator[oscillator.length - 1];
  const prev = oscillator[oscillator.length - 2];
  const lastSum = summation[summation.length - 1];

  return {
    oscillator:       oscillator.slice(-63),    // 63 days for chart
    summation:        summation.slice(-63),
    current:          last?.value  ?? null,
    currentSum:       lastSum?.value ?? null,
    trend:            last && prev ? (last.value > prev.value ? "rising" : "falling") : null,
    signal: last?.value > 0 ? "BULLISH" : "BEARISH",
    oversold:         last?.value < -0.05,      // meaningful oversold
    overbought:       last?.value >  0.05,
  };
}

// ── Market Breadth Metrics (from stored eod_returns) ─────────────────────────
export function computeBreadthMetrics() {
  try {
    const total = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE close > 1").get()?.n ?? 0;
    if (!total) return null;

    const above20  = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE above_ema20=1  AND close>1").get()?.n ?? 0;
    const above50  = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE above_ema50=1  AND close>1").get()?.n ?? 0;
    const above200 = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE above_ema200=1 AND close>1").get()?.n ?? 0;
    const stage2   = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE stage=2").get()?.n ?? 0;
    const stage4   = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE stage=4").get()?.n ?? 0;
    const ppToday  = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE pocket_pivot=1").get()?.n ?? 0;
    const near52H  = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE pct_hi52>=95 AND close>1").get()?.n ?? 0;
    const near52L  = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE pct_lo52 IS NOT NULL AND pct_lo52<=105 AND close>1").get()?.n ?? 0;
    const rsLinHi  = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE rs_line_hi=1").get()?.n ?? 0;

    const pct = (n) => total > 0 ? +(n/total*100).toFixed(1) : 0;

    // Breadth score 0-100
    const breadthScore = Math.round(
      pct(above200) * 0.35 +
      pct(above50)  * 0.30 +
      pct(stage2)   * 0.25 +
      pct(near52H)  * 0.10
    );

    return {
      total,
      above20,   pctAbove20:  pct(above20),
      above50,   pctAbove50:  pct(above50),
      above200,  pctAbove200: pct(above200),
      stage2,    pctStage2:   pct(stage2),
      stage4,    pctStage4:   pct(stage4),
      ppToday,   pctPP:       pct(ppToday),
      near52H,   pctNear52H:  pct(near52H),
      near52L,   pctNear52L:  pct(near52L),
      rsLineHi:  rsLinHi,     pctRsLineHi: pct(rsLinHi),
      breadthScore,
      signal: breadthScore >= 65 ? "STRONG" : breadthScore >= 50 ? "NEUTRAL" : "WEAK",
    };
  } catch(e) {
    log.warn(`Breadth metrics: ${e.message}`);
    return null;
  }
}

// ── Sector Breadth (% stocks above EMA200 per sector) ────────────────────────
export function computeSectorBreadth() {
  try {
    const rows = db.prepare(`
      SELECT u.sector,
        COUNT(*) as total,
        SUM(CASE WHEN r.above_ema200=1 THEN 1 ELSE 0 END) as above200,
        SUM(CASE WHEN r.above_ema50=1  THEN 1 ELSE 0 END) as above50,
        SUM(CASE WHEN r.above_ema20=1  THEN 1 ELSE 0 END) as above20,
        SUM(CASE WHEN r.stage=2        THEN 1 ELSE 0 END) as stage2,
        AVG(r.d1)   as avg1d,
        AVG(r.d5)   as avg1w,
        AVG(r.d21)  as avg1m,
        AVG(r.d63)  as avg3m,
        AVG(r.d126) as avg6m,
        AVG(r.ytd)  as avgYtd,
        AVG(r.d252) as avg1y,
        AVG(r.rs_rank) as avgRS
      FROM eod_returns r
      JOIN universe u ON r.symbol=u.symbol
      WHERE u.sector IS NOT NULL AND u.is_active=1 AND r.close > 1
      GROUP BY u.sector
      ORDER BY above200 DESC
    `).all();

    const pct = (n, total) => total > 0 ? +(n/total*100).toFixed(1) : 0;
    const avg = (v) => v != null ? +v.toFixed(2) : null;

    return rows.map(r => ({
      sector:       r.sector,
      total:        r.total,
      pctAbove200:  pct(r.above200, r.total),
      pctAbove50:   pct(r.above50,  r.total),
      pctAbove20:   pct(r.above20,  r.total),
      pctStage2:    pct(r.stage2,   r.total),
      avg1d:        avg(r.avg1d),
      avg1w:        avg(r.avg1w),
      avg1m:        avg(r.avg1m),
      avg3m:        avg(r.avg3m),
      avg6m:        avg(r.avg6m),
      avgYtd:       avg(r.avgYtd),
      avg1y:        avg(r.avg1y),
      avgRS:        r.avgRS != null ? Math.round(r.avgRS) : null,
    }));
  } catch(e) { return []; }
}

// ── Industry Breadth (same structure but grouped by industry) ─────────────────
export function computeIndustryBreadth() {
  try {
    const rows = db.prepare(`
      SELECT u.industry, u.sector,
        COUNT(*) as total,
        SUM(CASE WHEN r.above_ema200=1 THEN 1 ELSE 0 END) as above200,
        SUM(CASE WHEN r.above_ema50=1  THEN 1 ELSE 0 END) as above50,
        SUM(CASE WHEN r.stage=2        THEN 1 ELSE 0 END) as stage2,
        AVG(r.d1)   as avg1d,
        AVG(r.d5)   as avg1w,
        AVG(r.d21)  as avg1m,
        AVG(r.d63)  as avg3m,
        AVG(r.d126) as avg6m,
        AVG(r.ytd)  as avgYtd,
        AVG(r.d252) as avg1y,
        AVG(r.rs_rank) as avgRS
      FROM eod_returns r
      JOIN universe u ON r.symbol=u.symbol
      WHERE u.industry IS NOT NULL AND u.sector IS NOT NULL
        AND u.is_active=1 AND r.close > 1
      GROUP BY u.industry
      HAVING COUNT(*) >= 3
      ORDER BY above200 DESC
    `).all();

    const pct = (n, total) => total > 0 ? +(n/total*100).toFixed(1) : 0;
    const avg = (v) => v != null ? +v.toFixed(2) : null;

    return rows.map(r => ({
      industry:     r.industry,
      sector:       r.sector,
      total:        r.total,
      pctAbove200:  pct(r.above200, r.total),
      pctAbove50:   pct(r.above50,  r.total),
      pctStage2:    pct(r.stage2,   r.total),
      avg1d:        avg(r.avg1d),
      avg1w:        avg(r.avg1w),
      avg1m:        avg(r.avg1m),
      avg3m:        avg(r.avg3m),
      avg6m:        avg(r.avg6m),
      avgYtd:       avg(r.avgYtd),
      avg1y:        avg(r.avg1y),
      avgRS:        r.avgRS != null ? Math.round(r.avgRS) : null,
    }));
  } catch(e) { return []; }
}

// ── New Highs / New Lows (from stored eod_returns) ────────────────────────────
export function computeNHNL() {
  try {
    const newHighs = db.prepare(
      "SELECT COUNT(*) n FROM eod_returns WHERE pct_hi52 >= 99 AND close > 1"
    ).get()?.n ?? 0;
    const newLows = db.prepare(
      "SELECT COUNT(*) n FROM eod_returns WHERE pct_lo52 IS NOT NULL AND pct_lo52 <= 101 AND close > 1"
    ).get()?.n ?? 0;
    const ratio = newLows > 0 ? +(newHighs/newLows).toFixed(2) : (newHighs > 0 ? 9.99 : null);
    return { newHighs, newLows, net: newHighs - newLows, ratio };
  } catch { return { newHighs: 0, newLows: 0, net: 0, ratio: null }; }
}

// ── CLI entry ─────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("compute-analytics.js")) {
  process.env.YF_DISABLE_VERSION_CHECK = "1";   // silence yahoo-finance2 Node version warning
  runMigrations();
  const earningsOnly = process.argv.includes("--earnings");
  await computeAnalytics({ earningsOnly, maxEarnings: 500 });
  process.exit(0);
}
