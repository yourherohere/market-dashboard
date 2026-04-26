// server/routes/analytics.js
import { Router }  from "express";
import { cache }   from "../cache.js";
import { CACHE }   from "../config.js";
import { db }      from "../db/index.js";
import { log }     from "../logger.js";
// Input validation helpers
const clampInt = (v,mn,mx,def) => { const n=parseInt(v,10); return isNaN(n)?def:Math.max(mn,Math.min(mx,n)); };
const clampFlt = (v,mn,mx,def) => { const n=parseFloat(v); return isNaN(n)?def:Math.max(mn,Math.min(mx,n)); };
function validateEmaList(e) { const V=new Set(["10","20","50","100","200"]); return String(e||"50").split(",").map(x=>x.trim()).filter(x=>V.has(x)); }

// ── Input validation helpers (inline — no external middleware dep) ────────────
const VALID_SYMBOL    = /^[A-Z0-9.\-^]{1,10}$/i;
const VALID_SORT_CHARS = /^[a-z0-9_]{1,30}$/;
const clampInt = (v,mn,mx,def) => { const n=parseInt(v,10);  return isNaN(n)?def:Math.max(mn,Math.min(mx,n)); };
const clampFlt = (v,mn,mx,def) => { const n=parseFloat(v);  return isNaN(n)?def:Math.max(mn,Math.min(mx,n)); };
function validateEmaList(emas) {
  const VALID = new Set(["10","20","50","100","200"]);
  return String(emas||"50").split(",").map(e=>e.trim()).filter(e=>VALID.has(e));
}
import {
  computeAnalytics, computeBreadthMetrics,
  computeSectorBreadth, computeIndustryBreadth,
  computeNHNL, computeMcClellan,
} from "../jobs/compute-analytics.js";

export const analyticsRouter = Router();

// ── Input validation helpers ─────────────────────────────────────────────────
const VALID_SYMBOL = /^[A-Z0-9.\-^]{1,10}$/i;
const VALID_SECTOR = /^[A-Za-z0-9 &/_\-]{1,60}$/;
const VALID_SORT_CHARS = /^[a-z0-9_]{1,30}$/;
const clampInt  = (v, min, max, def) => { const n = parseInt(v,10); return isNaN(n)?def:Math.max(min,Math.min(max,n)); };
const clampFlt  = (v, min, max, def) => { const n = parseFloat(v);  return isNaN(n)?def:Math.max(min,Math.min(max,n)); };

function validateEmaList(emas) {
  const VALID = new Set(["10","20","50","100","200"]);
  return String(emas||"50").split(",").map(e=>e.trim()).filter(e=>VALID.has(e));
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: ensure v8 EMA columns exist before any query uses them
// ─────────────────────────────────────────────────────────────────────────────
function ensureEmaColumns() {
  // Hardcoded ALTER TABLE statements — never interpolate column names into SQL
  const stmts = [
    "ALTER TABLE eod_returns ADD COLUMN ema10        REAL",
    "ALTER TABLE eod_returns ADD COLUMN ema100       REAL",
    "ALTER TABLE eod_returns ADD COLUMN above_ema10  INTEGER",
    "ALTER TABLE eod_returns ADD COLUMN above_ema100 INTEGER",
  ];
  for (const sql of stmts) {
    try { db.prepare(sql).run(); } catch {}  // duplicate column = already exists
  }
}

// ── GET /api/analytics/sectors-list ──────────────────────────────────────────
analyticsRouter.get("/api/analytics/sectors-list", (_req, res) => {
  try {
    const rows = db.prepare(
      `SELECT DISTINCT sector FROM universe
       WHERE sector IS NOT NULL AND is_active=1
       ORDER BY sector`
    ).all().map(r => r.sector);
    res.json({ sectors: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/analytics/industries-list ───────────────────────────────────────
analyticsRouter.get("/api/analytics/industries-list", (req, res) => {
  try {
    const { sector="" } = req.query;
    let sql = `SELECT DISTINCT industry FROM universe
               WHERE industry IS NOT NULL AND is_active=1`;
    const params = [];
    if (sector) { sql += " AND sector=?"; params.push(sector); }
    sql += " ORDER BY industry";
    const rows = db.prepare(sql).all(...params).map(r => r.industry);
    res.json({ industries: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/analytics/internals ─────────────────────────────────────────────
analyticsRouter.get("/api/analytics/internals", async (req, res) => {
  const ck  = "analytics:internals";
  const hit = cache.get(ck, 5 * 60_000);
  if (hit) return res.json({ ...hit, cached: true });
  try {
    const breadth   = computeBreadthMetrics();
    const sectors   = computeSectorBreadth();
    const industries = computeIndustryBreadth();
    const nhnl      = computeNHNL();
    let mcClellan = null;
    try {
      const adRows = db.prepare(`
        SELECT r.date,
          SUM(CASE WHEN r.d1 > 0.1  THEN 1 ELSE 0 END) as adv,
          SUM(CASE WHEN r.d1 < -0.1 THEN 1 ELSE 0 END) as dec_
        FROM eod_returns r JOIN universe u ON r.symbol=u.symbol
        WHERE u.is_active=1 AND r.close>1 AND r.d1 IS NOT NULL
        GROUP BY r.date ORDER BY r.date DESC LIMIT 126
      `).all().reverse();
      if (adRows.length >= 40) {
        mcClellan = computeMcClellan(adRows.map(r => ({
          ts: Math.floor(new Date(r.date).getTime()/1000),
          adv: r.adv, dec: r.dec_, net: r.adv - r.dec_,
        })));
      }
    } catch(e) { log.warn(`McClellan: ${e.message}`); }
    const out = { breadth, sectors, industries, nhnl, mcClellan, ts: new Date() };
    cache.set(ck, out);
    res.json(out);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/analytics/setup ──────────────────────────────────────────────────
// Returns ALL symbols from universe (LEFT JOIN) + optional filter params
analyticsRouter.get("/api/analytics/setup", validateQuery(SCAN_SCHEMA), async (req, res) => {
  const q = req.query;
  const minScore  = clampFlt(q.minScore,  0,   100, 0);
  const maxScore  = clampFlt(q.maxScore,  0,   100, 100);
  const minRS     = clampFlt(q.minRS,     0,   99,  0);
  const maxRS     = clampFlt(q.maxRS,     0,   99,  99);
  const minPrice  = clampFlt(q.minPrice,  0,   99999, 1);
  const maxPrice  = clampFlt(q.maxPrice,  0,   9999999, 99999);
  const minVol    = clampInt(q.minVol,    0,   1e9, 0);
  const minDolVol = clampInt(q.minDolVol, 0,   1e12, 0);
  const stage     = clampInt(q.stage,     0,   4,  0);
  const vcpMin    = clampFlt(q.vcpMin,    0,   100, 0);
  const maxEarn   = clampInt(q.maxEarn,   0,   365, 0);
  const limit     = clampInt(q.limit,     1,   99999, 9999);
  const ppOnly    = q.ppOnly === "1" ? "1" : "0";
  const rsLineHi  = q.rsLineHi === "1" ? "1" : "0";
  const sortDir   = q.sortDir === "asc" ? "asc" : "desc";
  const sortBy    = VALID_SORT_CHARS.test(q.sortBy||"") ? q.sortBy : "setup_score";
  const emaFilter = ["any","above50","above200","above_both"].includes(q.emaFilter)
    ? q.emaFilter : "any";
  // Validate sector/industry: split and filter against safe pattern
  const sectors    = q.sectors    || "";
  const industries = q.industries || "";

  const ck  = `analytics:setup:${JSON.stringify(req.query)}`;
  const hit = cache.get(ck, 5 * 60_000);
  if (hit) return res.json({ results: hit, cached: true });

  const VALID_SORT = new Set(["setup_score","rs_rank","rs_rank_3m","d63","d126",
    "d252","ytd","vcp_score","adr14","rsi14","close","volume","dol_vol","market_cap"]);
  const sortCol = sortBy === "dol_vol"
    ? "CAST(r.close * r.volume AS INTEGER)"
    : VALID_SORT.has(sortBy) ? `r.${sortBy}` : "r.setup_score";
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  const effectiveLimit = +limit > 0 ? +limit : 99999;

  try {
    const sectorList   = sectors    ? sectors.split(",").map(s=>s.trim()).filter(Boolean)    : [];
    const industryList = industries ? industries.split(",").map(s=>s.trim()).filter(Boolean) : [];

    // LEFT JOIN from universe → eod_returns ensures ALL active symbols appear
    let sql = `
      SELECT u.symbol, u.name, u.sector, u.industry, u.market_cap,
             u.sector_etf, u.industry_etf,
             r.close, r.volume, r.d1, r.d5, r.d21, r.d42, r.d63,
             r.d126, r.d252, r.ytd, r.rs_rank, r.rs_rank_3m,
             r.stage, r.stage_label, r.setup_score,
             r.pocket_pivot, r.tight_flag, r.vcp_score, r.rs_line_hi,
             r.earnings_date, r.days_to_earn,
             r.rs_vs_sector, r.rs_vs_industry,
             r.above_ema20, r.above_ema50, r.above_ema200,
             r.rsi14, r.adr14, r.hi52, r.lo52, r.pct_hi52,
             CAST(r.close * r.volume AS INTEGER) AS dol_vol
      FROM universe u
      LEFT JOIN eod_returns r ON u.symbol = r.symbol
      WHERE u.is_active = 1
    `;
    const params = {};
    const extra  = [];

    // Price / volume guards (only apply when data exists)
    if (+minPrice > 0) { sql += ` AND (r.close IS NULL OR r.close >= @minPrice)`;   params.minPrice  = +minPrice; }
    if (+maxPrice < 99999){ sql += ` AND (r.close IS NULL OR r.close <= @maxPrice)`; params.maxPrice = +maxPrice; }
    if (+minVol > 0)   { sql += ` AND (r.volume IS NULL OR r.volume >= @minVol)`;   params.minVol    = +minVol; }
    if (+minDolVol > 0){ sql += ` AND (r.close IS NULL OR (r.close * r.volume) >= @minDolVol)`; params.minDolVol = +minDolVol; }

    // Analytics score filters (only apply to rows that have scores)
    if (+minScore > 0){ sql += ` AND (r.setup_score IS NULL OR r.setup_score >= @minScore)`; params.minScore = +minScore; }
    if (+maxScore < 100){ sql += ` AND (r.setup_score IS NULL OR r.setup_score <= @maxScore)`; params.maxScore = +maxScore; }
    if (+minRS > 0)   { sql += ` AND (r.rs_rank IS NULL OR r.rs_rank >= @minRS)`;   params.minRS = +minRS; }
    if (+maxRS < 99)  { sql += ` AND (r.rs_rank IS NULL OR r.rs_rank <= @maxRS)`;   params.maxRS = +maxRS; }

    if (+stage > 0)       { sql += ` AND r.stage = @stage`;                params.stage  = +stage; }
    if (+vcpMin > 0)      { sql += ` AND r.vcp_score >= @vcpMin`;          params.vcpMin = +vcpMin; }
    if (ppOnly  === "1")  { sql += ` AND r.pocket_pivot = 1`; }
    if (rsLineHi=== "1")  { sql += ` AND r.rs_line_hi  = 1`; }
    if (+maxEarn > 0)     { sql += ` AND (r.days_to_earn IS NULL OR r.days_to_earn > @maxEarn)`; params.maxEarn = +maxEarn; }
    if (emaFilter === "above50")    sql += ` AND r.above_ema50=1`;
    if (emaFilter === "above200")   sql += ` AND r.above_ema200=1`;
    if (emaFilter === "above_both") sql += ` AND r.above_ema50=1 AND r.above_ema200=1`;

    if (sectorList.length) {
      sql += ` AND u.sector IN (${sectorList.map(()=>"?").join(",")})`;
      extra.push(...sectorList);
    }
    if (industryList.length) {
      sql += ` AND u.industry IN (${industryList.map(()=>"?").join(",")})`;
      extra.push(...industryList);
    }

    sql += ` ORDER BY ${sortCol} ${dir} NULLS LAST LIMIT ${effectiveLimit}`;

    const rows = db.prepare(sql).all(params, ...extra);
    cache.set(ck, rows);
    res.json({ results: rows, total: rows.length, cached: false });
  } catch(e) { log.error(`setup scan: ${e.message}`); res.status(500).json({ error: e.message }); }
});

// ── GET /api/analytics/ema-cross ─────────────────────────────────────────────
// Exact PineScript port:
//   touch(period) = low <= EMA(period) <= high
//   touchedCount  = number of selected EMAs touched today
//   signal = (touchMode=="min" ? touchedCount>=minTouches : touchedCount==selectedCount)
//
// EMA always computed LIVE from eod_prices — never from stale stored columns.
analyticsRouter.get("/api/analytics/ema-cross",
  validateQuery({ ...SCAN_SCHEMA, minTouches: { type:"int", min:1, max:5, default:1 }}),
  async (req, res) => {
  const {
    emas       = "10,20",  // selected EMA periods, comma-separated
    touchMode  = "min",    // "min" = Min touches(>=) | "all" = All selected must touch
    minTouches = "1",      // min number of EMAs that must be touched (for "min" mode)
    minPrice   = 5,
    minVol     = 100000,
    minDolVol  = 0,
    sectors    = "",
    industries = "",
    limit      = 300,
  } = req.query;

  const VALID_EMA = new Set(["10","20","50","100","200"]);
  const emaList = emas.split(",").map(e=>e.trim()).filter(e=>VALID_EMA.has(e));
  if (!emaList.length)
    return res.status(400).json({ error:"No valid EMAs. Use 10,20,50,100,200." });

  const selectedCount = emaList.length;
  const minT          = Math.max(1, Math.min(+minTouches || 1, selectedCount));

  const ck  = `ema_cross_ps:${JSON.stringify(req.query)}`;
  const hit = cache.get(ck, 5*60_000);
  if (hit) return res.json({ results: hit, cached: true });

  // ── EMA computation (matches Pine: ta.ema = Wilder/EMA with SMA seed) ──────
  function calcEMASeries(closes, period) {
    if (!closes || closes.length < period) return [];
    const k   = 2 / (period + 1);
    const out = new Array(closes.length).fill(null);
    // Seed: SMA of first `period` values (identical to Pine Script)
    let seed = 0;
    for (let i = 0; i < period; i++) seed += closes[i];
    seed /= period;
    out[period - 1] = seed;
    for (let i = period; i < closes.length; i++)
      out[i] = closes[i] * k + out[i-1] * (1 - k);
    return out;
  }

  try {
    const sectorList   = sectors   ? sectors.split(",").map(s=>s.trim()).filter(Boolean)   : [];
    const industryList = industries? industries.split(",").map(s=>s.trim()).filter(Boolean): [];

    // Step 1: fetch all candidates meeting basic filters
    const maxPeriod  = Math.max(...emaList.map(Number));
    const barsNeeded = maxPeriod + 30;  // warmup bars for EMA accuracy

    let filterSql = `
      SELECT u.symbol, u.name, u.sector, u.industry, u.market_cap,
             r.close, r.open, r.high, r.low, r.volume, r.date,
             r.d1, r.d5, r.d21, r.d63, r.d126, r.ytd,
             r.rs_rank, r.rs_rank_3m, r.setup_score,
             r.stage, r.stage_label,
             r.pocket_pivot, r.tight_flag, r.rs_line_hi,
             r.adr14, r.rsi14, r.hi52, r.pct_hi52,
             CAST(r.close * r.volume AS INTEGER) AS dol_vol
      FROM universe u
      JOIN eod_returns r ON u.symbol = r.symbol
      WHERE u.is_active = 1
        AND r.close  >= ?
        AND r.volume >= ?
        AND r.high   IS NOT NULL
        AND r.low    IS NOT NULL
    `;
    const filterParams = [+minPrice, +minVol];

    if (+minDolVol > 0) {
      filterSql += ` AND (r.close * r.volume) >= ?`;
      filterParams.push(+minDolVol);
    }
    if (sectorList.length) {
      filterSql += ` AND u.sector IN (${sectorList.map(()=>"?").join(",")})`;
      filterParams.push(...sectorList);
    }
    if (industryList.length) {
      filterSql += ` AND u.industry IN (${industryList.map(()=>"?").join(",")})`;
      filterParams.push(...industryList);
    }

    const candidates = db.prepare(filterSql).all(...filterParams);
    log.step(`ema-cross: scanning ${candidates.length} candidates, EMAs=[${emaList}] mode=${touchMode} min=${minT}`);

    // Step 2: live EMA + Pine-exact touch logic per candidate
    const priceStmt = db.prepare(
      `SELECT close, high, low FROM eod_prices
       WHERE symbol=? AND close>0 AND high>0 AND low>0
       ORDER BY date DESC LIMIT ?`
    );

    const results = [];

    for (const cand of candidates) {
      // Load bars oldest→newest (DESC then reverse)
      const bars = priceStmt.all(cand.symbol, barsNeeded).reverse();
      if (bars.length < Math.max(10, maxPeriod)) continue;

      const closes = bars.map(b => b.close);
      const N      = bars.length;
      const today  = bars[N - 1];

      // ── Pine Script logic ─────────────────────────────────────────────────
      // For each selected EMA: touch = low <= ema <= high (today's candle)
      let touchedCount = 0;
      const touchedPeriods = [];
      const emaValues      = {};

      for (const emaN of emaList) {
        const period = +emaN;
        const series = calcEMASeries(closes, period);
        const emaVal = series[N - 1];
        if (!emaVal || emaVal <= 0) continue;

        emaValues[period] = +emaVal.toFixed(4);

        // Exact Pine: touch = low <= ema10 and ema10 <= high
        const touch = today.low <= emaVal && emaVal <= today.high;
        if (touch) {
          touchedCount++;
          touchedPeriods.push(period);
        }
      }

      // ── Signal condition (Pine exact) ────────────────────────────────────
      let signalCondition = false;
      if (touchMode === "min") {
        signalCondition = touchedCount >= minT;
      } else {
        // "all" mode: all selected EMAs must be touched
        signalCondition = selectedCount > 0 && touchedCount === selectedCount;
      }

      if (!signalCondition) continue;

      // ── Signal strength color (Pine exact) ───────────────────────────────
      // 2=yellow, 3=orange, 4=red, 5=purple, 1=green
      const strengthColor =
        touchedCount === 1 ? "#00e87a"   // green  (1 touch)
        : touchedCount === 2 ? "#ffe040" // yellow (Pine: color.yellow)
        : touchedCount === 3 ? "#ff9f1c" // orange (Pine: color.orange)
        : touchedCount === 4 ? "#ff4560" // red    (Pine: color.red)
        : "#a78bfa";                     // purple (Pine: color.purple, 5 touches)

      // Closest EMA to close (for display)
      let closestPeriod = touchedPeriods[0];
      let closestDist   = Infinity;
      for (const p of touchedPeriods) {
        const d = Math.abs(today.close - emaValues[p]);
        if (d < closestDist) { closestDist = d; closestPeriod = p; }
      }
      const closestEmaVal = emaValues[closestPeriod];
      const distPct = closestEmaVal > 0
        ? +((today.close - closestEmaVal) / closestEmaVal * 100).toFixed(2)
        : null;

      results.push({
        ...cand,
        // EMA touch data
        touch_count:    touchedCount,     // Pine: touchedCount
        touched_emas:   touchedPeriods,   // which EMAs were touched
        ema_values:     emaValues,        // { 10: 123.4, 20: 118.2, ... }
        ema_period:     closestPeriod,    // closest matched EMA (for display)
        ema_val:        closestEmaVal,    // its value
        cross_dist_pct: distPct,          // % distance close→EMA
        above_ema:      today.close > (closestEmaVal||0) ? 1 : 0,
        touch_type:     "touch",          // always touch in Pine mode
        strength_color: strengthColor,
        // Convenience flags
        touch_ema10:  touchedPeriods.includes(10) ? 1 : 0,
        touch_ema20:  touchedPeriods.includes(20) ? 1 : 0,
        touch_ema50:  touchedPeriods.includes(50) ? 1 : 0,
        touch_ema100: touchedPeriods.includes(100)? 1 : 0,
        touch_ema200: touchedPeriods.includes(200)? 1 : 0,
      });
    }

    // Sort: most touches first (strongest signal), then by RS rank
    results.sort((a,b) =>
      b.touch_count !== a.touch_count
        ? b.touch_count - a.touch_count
        : (b.rs_rank??0) - (a.rs_rank??0)
    );
    const sliced = results.slice(0, Math.min(+limit, 500));

    cache.set(ck, sliced);
    log.step(`ema-cross result: ${sliced.length} stocks (${results.length} total matches)`);
    res.json({
      results: sliced,
      total:   sliced.length,
      scanned: candidates.length,
      emas:    emaList,
      touchMode, minTouches: minT,
      cached:  false,
    });
  } catch(e) {
    log.error(`ema-cross: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/analytics/validate ──────────────────────────────────────────────
// Data quality validation — tells the user what's populated and what's missing
analyticsRouter.get("/api/analytics/validate", (_req, res) => {
  try {
    const total   = db.prepare("SELECT COUNT(*) n FROM universe WHERE is_active=1").get()?.n ?? 0;
    const inEOD   = db.prepare("SELECT COUNT(DISTINCT r.symbol) n FROM eod_returns r JOIN universe u ON r.symbol=u.symbol WHERE u.is_active=1").get()?.n ?? 0;
    const withRS  = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE rs_rank IS NOT NULL").get()?.n ?? 0;
    const withStage= db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE stage IS NOT NULL").get()?.n ?? 0;
    const withScore= db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE setup_score IS NOT NULL").get()?.n ?? 0;
    const withSector= db.prepare("SELECT COUNT(*) n FROM universe WHERE sector IS NOT NULL AND is_active=1").get()?.n ?? 0;
    const withETF = db.prepare("SELECT COUNT(*) n FROM universe WHERE sector_etf IS NOT NULL AND is_active=1").get()?.n ?? 0;
    const withEarn= db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE earnings_date IS NOT NULL").get()?.n ?? 0;
    const withEMA10    = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE ema10 IS NOT NULL").get()?.n ?? 0;
    const withEMA100   = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE ema100 IS NOT NULL").get()?.n ?? 0;
    const withEmaTouch = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE touch_ema50 IS NOT NULL").get()?.n ?? 0;
    const noEOD   = total - inEOD;

    const pct = (n) => total > 0 ? Math.round(n/total*100) : 0;
    const checks = [
      { key:"universe",    label:"Universe loaded",        n:total,     pct:100,      ok: total>1000,    cmd:null },
      { key:"eod_prices",  label:"EOD prices (bootstrap)", n:inEOD,     pct:pct(inEOD), ok: inEOD>total*0.8, cmd:"npm run bootstrap:2y" },
      { key:"missing_eod", label:"Missing EOD data",       n:noEOD,     pct:pct(noEOD), ok: noEOD<total*0.1, cmd: noEOD>0?"npm run bootstrap:retry":null },
      { key:"sectors",     label:"Sector/industry labels", n:withSector,pct:pct(withSector), ok: withSector>total*0.7, cmd:"npm run enrich:sectors" },
      { key:"etf_map",     label:"ETF mappings",           n:withETF,   pct:pct(withETF),   ok: withETF>total*0.5,   cmd:"npm run enrich:sectors" },
      { key:"rs_rank",     label:"RS Ranks computed",      n:withRS,    pct:pct(withRS),     ok: withRS>inEOD*0.8,    cmd:"npm run compute:analytics" },
      { key:"stage",       label:"Weinstein Stages",       n:withStage, pct:pct(withStage),  ok: withStage>inEOD*0.8, cmd:"npm run compute:analytics" },
      { key:"setup_score", label:"Setup Scores",           n:withScore, pct:pct(withScore),  ok: withScore>inEOD*0.8, cmd:"npm run compute:analytics" },
      { key:"earnings",    label:"Earnings dates",         n:withEarn,  pct:pct(withEarn),   ok: withEarn>100,        cmd:"npm run compute:earnings" },
      { key:"ema10",       label:"EMA10 populated",        n:withEMA10, pct:pct(withEMA10),  ok: withEMA10>inEOD*0.8, cmd:"npm run compute:ema" },
      { key:"ema100",      label:"EMA100 populated",       n:withEMA100,pct:pct(withEMA100), ok: withEMA100>inEOD*0.8,cmd:"npm run compute:ema" },
      { key:"ema_touch",   label:"EMA touch flags",        n:withEmaTouch,pct:pct(withEmaTouch),ok:withEmaTouch>inEOD*0.7,cmd:"npm run compute:ema" },
    ];

    const allGood = checks.every(c => c.ok);
    res.json({ total, inEOD, checks, allGood });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/analytics/earnings ───────────────────────────────────────────────
analyticsRouter.get("/api/analytics/earnings", async (req, res) => {
  const { days=14, minRS=0, limit=200 } = req.query;
  const ck  = `analytics:earnings:${days}:${minRS}`;
  const hit = cache.get(ck, 30*60_000);
  if (hit) return res.json({ results: hit, cached: true });
  try {
    const rows = db.prepare(`
      SELECT r.symbol, r.close, r.d1, r.d63, r.ytd, r.rs_rank, r.setup_score,
             r.stage, r.adr14, r.earnings_date, r.days_to_earn,
             u.name, u.sector, u.industry
      FROM eod_returns r JOIN universe u ON r.symbol=u.symbol
      WHERE u.is_active=1 AND r.days_to_earn IS NOT NULL
        AND r.days_to_earn BETWEEN 0 AND @days AND r.close>1
        AND (@minRS=0 OR r.rs_rank>=@minRS)
      ORDER BY r.days_to_earn ASC, r.setup_score DESC LIMIT @limit
    `).all({ days:+days, minRS:+minRS, limit:+limit });
    cache.set(ck, rows);
    res.json({ results: rows, total: rows.length, cached: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/analytics/compute ───────────────────────────────────────────────
analyticsRouter.post("/api/analytics/compute", async (req, res) => {
  const { earningsOnly=false, maxEarnings=300 } = req.body || {};
  log.info("Manual analytics computation triggered");
  computeAnalytics({ earningsOnly, maxEarnings })
    .catch(e => log.error("compute-analytics: " + e.message));
  res.json({ ok:true, message:"Analytics computation started in background" });
});

// ── GET /api/analytics/symbol/:sym ───────────────────────────────────────────
analyticsRouter.get("/api/analytics/symbol/:sym", async (req, res) => {
  const sym = (req.params.sym||"").trim().toUpperCase();
  if (!sym) return res.status(400).json({ error:"symbol required" });
  try {
    const row = db.prepare(`
      SELECT r.*, u.name, u.sector, u.industry, u.exchange,
             u.sector_etf, u.industry_etf, u.market_cap
      FROM eod_returns r JOIN universe u ON r.symbol=u.symbol
      WHERE r.symbol=?
    `).get(sym);
    if (!row) return res.status(404).json({ error:`${sym} not found` });
    const bars = db.prepare(
      `SELECT date,close,volume FROM eod_prices WHERE symbol=? ORDER BY date DESC LIMIT 63`
    ).all(sym).reverse();
    const totalSyms  = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE close>0").get()?.n ?? 0;
    const betterRS   = row.rs_rank  != null ? db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE rs_rank  > ?").get(row.rs_rank )?.n ?? 0 : null;
    const betterSetup= row.setup_score!=null? db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE setup_score > ?").get(row.setup_score)?.n ?? 0: null;
    res.json({ symbol:sym, data:row, bars,
      context:{ totalSyms,
        rsRankPct:  betterRS   !=null? +(betterRS/totalSyms*100).toFixed(1)   :null,
        setupPct:   betterSetup!=null? +(betterSetup/totalSyms*100).toFixed(1):null,
      }
    });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ── GET /api/analytics/status ─────────────────────────────────────────────────
analyticsRouter.get("/api/analytics/status", (_req, res) => {
  try {
    const total     = db.prepare("SELECT COUNT(*) n FROM universe WHERE is_active=1").get()?.n ?? 0;
    const withRS    = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE rs_rank IS NOT NULL").get()?.n ?? 0;
    const withStage = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE stage IS NOT NULL").get()?.n ?? 0;
    const withScore = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE setup_score IS NOT NULL").get()?.n ?? 0;
    const withEarn  = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE earnings_date IS NOT NULL").get()?.n ?? 0;
    const pp        = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE pocket_pivot=1").get()?.n ?? 0;
    const stage2    = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE stage=2").get()?.n ?? 0;
    res.json({ total, withRS, withStage, withScore, withEarn,
      pocketPivots:pp, stage2,
      rsRankPct:  total>0?Math.round(withRS/total*100)   :0,
      stagePct:   total>0?Math.round(withStage/total*100):0,
      scorePct:   total>0?Math.round(withScore/total*100):0,
    });
  } catch(e) { res.status(500).json({ error:e.message }); }
});
