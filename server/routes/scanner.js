// server/routes/scanner.js — All scanner endpoints
// DATA STRATEGY:
//   • Custom scan  → DB-first (eod_returns + universe JOIN), instant SQL queries
//   • Gainers/Losers/Volume/Momentum → DB when available, Yahoo screener fallback
//   • EOD scan  → pure DB, multi-period returns (1W/1M/3M/6M/YTD/1Y)
//   • Universe stream → Yahoo live (6500 symbols, SSE)
//   • Shorted / 52W Highs → Yahoo screener only (no equivalent in DB)

import { Router } from "express";
import { cache }  from "../cache.js";
import { CACHE, SCREEN_POOLS } from "../config.js";
import { runScreen, normalise, safeQuote } from "../data/yahoo.js";
import { enrichWithSectorIndustry } from "../data/enrichment.js";
import { universe, universeStatus } from "../data/universe.js";
import { db, retQ, eodQ } from "../db/index.js";
import { log } from "../logger.js";

export const scannerRouter = Router();

// ── Shared helpers ────────────────────────────────────────────────────────────
async function runAllScreens(counts = {}) {
  const tasks   = SCREEN_POOLS.map(id => runScreen(id, counts[id] || 100));
  const results = await Promise.allSettled(tasks);
  const allRaw  = results.flatMap(r => r.value || []);
  const seen    = new Set();
  return allRaw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
}

// Convert a DB eod_returns+universe row → normalised ticker object
function dbRowToTicker(r) {
  if (!r?.symbol || !r?.close) return null;
  return {
    symbol:    r.symbol,
    name:      r.name   || r.symbol,
    sector:    r.sector || null,
    industry:  r.industry || null,
    price:     r.close,
    change:    r.d1     || 0,
    changeDol: r.close && r.d1 ? +(r.close * r.d1 / (100 + r.d1)).toFixed(2) : 0,
    volume:    r.volume || 0,
    avgVol10:  r.avg_vol10 || 0,
    avgVol30:  r.avg_vol30 || 0,
    relVol:    r.avg_vol10 > 0 ? +(r.volume / r.avg_vol10).toFixed(2) : 0,
    marketCap: null,
    // Multi-period returns from DB
    d1:   r.d1   || 0,
    d5:   r.d5   || null,
    d10:  r.d10  || null,
    d21:  r.d21  || null,
    d42:  r.d42  || null,
    d63:  r.d63  || null,
    d126: r.d126 || null,
    d189: r.d189 || null,
    d252: r.d252 || null,
    d504: r.d504 || null,
    ytd:  r.ytd  || null,
    mtd:  r.mtd  || null,
    qtd:  r.qtd  || null,
    // Technical indicators
    rsi:       r.rsi14  || null,
    rsi2:      r.rsi2   || null,
    adr:       r.adr14  || null,
    atr:       r.atr14  || null,
    beta:      r.beta252 || null,
    // EMA flags
    above50:   r.above_ema50  === 1 ? true : r.above_ema50  === 0 ? false : null,
    above200:  r.above_ema200 === 1 ? true : r.above_ema200 === 0 ? false : null,
    ema20:     r.ema20  || null,
    ema50:     r.ema50  || null,
    ema200:    r.ema200 || null,
    sma150:    r.sma150 || null,
    sma200:    r.sma200 || null,
    // 52W range
    hi52:      r.hi52   || null,
    lo52:      r.lo52   || null,
    hi52Pct:   r.pct_hi52 || null,
    // RS vs SPY
    rs_1m:     r.rs_1m  || null,
    rs_3m:     r.rs_3m  || null,
    rs_6m:     r.rs_6m  || null,
    rs_12m:    r.rs_12m || null,
    // Meta
    dataDate:  r.date   || null,
    source:    "eod_db",
  };
}

// Check if DB has enough data to be the primary source
function dbReady(minSymbols = 100) {
  return retQ.count() >= minSymbols;
}

// ── GET /api/scan/gainers ──────────────────────────────────────────────────────
scannerRouter.get("/api/scan/gainers", async (req, res) => {
  const { minPrice=1, minVol=50000, limit=150 } = req.query;
  const ck  = `gainers:${minPrice}:${minVol}:${limit}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });

  // DB-first: instant query, no network
  if (dbReady()) {
    try {
      const rows    = retQ.topGainers(+limit, +minPrice, +minVol);
      const results = rows.map(dbRowToTicker).filter(Boolean);
      if (results.length >= 20) {
        cache.set(ck, results);
        return res.json({ results, cached: false, source: "eod_db" });
      }
    } catch(e) { log.warn(`gainers DB fallback: ${e.message}`); }
  }

  // Yahoo fallback
  let raw = await Promise.allSettled([
    runScreen("day_gainers", 200),
    runScreen("small_cap_gainers", 100),
    runScreen("most_actives", 100),
  ]).then(r => r.flatMap(x => x.value || []));
  const seen = new Set();
  raw = raw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
  let results = raw.map(normalise).filter(Boolean)
    .filter(t => t.price >= +minPrice && t.volume >= +minVol)
    .sort((a,b) => (b.change||0) - (a.change||0)).slice(0, +limit);
  results = await enrichWithSectorIndustry(results);
  cache.set(ck, results);
  res.json({ results, cached: false, source: "yahoo" });
});

// ── GET /api/scan/losers ───────────────────────────────────────────────────────
scannerRouter.get("/api/scan/losers", async (req, res) => {
  const { minPrice=0.5, minVol=10000, limit=150 } = req.query;
  const ck  = `losers:${minPrice}:${minVol}:${limit}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });

  if (dbReady()) {
    try {
      const rows    = retQ.topLosers(+limit, +minPrice, +minVol);
      const results = rows.map(dbRowToTicker).filter(Boolean);
      if (results.length >= 20) {
        cache.set(ck, results);
        return res.json({ results, cached: false, source: "eod_db" });
      }
    } catch(e) { log.warn(`losers DB fallback: ${e.message}`); }
  }

  let raw = await Promise.allSettled([
    runScreen("day_losers", 200), runScreen("most_actives", 100),
  ]).then(r => r.flatMap(x => x.value || []));
  const seen = new Set();
  raw = raw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
  let results = raw.map(normalise).filter(Boolean)
    .filter(t => t.price >= +minPrice && t.volume >= +minVol)
    .sort((a,b) => (a.change||0) - (b.change||0)).slice(0, +limit);
  results = await enrichWithSectorIndustry(results);
  cache.set(ck, results);
  res.json({ results, cached: false, source: "yahoo" });
});

// ── GET /api/scan/volume ───────────────────────────────────────────────────────
scannerRouter.get("/api/scan/volume", async (req, res) => {
  const { minRelVol=1.5, minPrice=1, limit=150 } = req.query;
  const ck  = `volume:${minRelVol}:${minPrice}:${limit}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });

  if (dbReady()) {
    try {
      const rows = db.prepare(
        `SELECT r.*,u.name,u.sector,u.industry FROM eod_returns r
         JOIN universe u ON r.symbol=u.symbol
         WHERE r.close>=? AND u.is_active=1
           AND r.avg_vol10>0 AND r.volume>0
           AND CAST(r.volume AS REAL)/r.avg_vol10 >= ?
         ORDER BY CAST(r.volume AS REAL)/r.avg_vol10 DESC LIMIT ?`
      ).all(+minPrice, +minRelVol, +limit);
      const results = rows.map(dbRowToTicker).filter(Boolean);
      if (results.length >= 20) {
        cache.set(ck, results);
        return res.json({ results, cached: false, source: "eod_db" });
      }
    } catch(e) { log.warn(`volume DB fallback: ${e.message}`); }
  }

  let raw = await Promise.allSettled([
    runScreen("most_actives", 200), runScreen("day_gainers", 100),
  ]).then(r => r.flatMap(x => x.value || []));
  const seen = new Set();
  raw = raw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
  let results = raw.map(normalise).filter(Boolean)
    .filter(t => t.relVol >= +minRelVol && t.price >= +minPrice)
    .sort((a,b) => (b.relVol||0) - (a.relVol||0)).slice(0, +limit);
  results = await enrichWithSectorIndustry(results);
  cache.set(ck, results);
  res.json({ results, cached: false, source: "yahoo" });
});

// ── GET /api/scan/momentum ─────────────────────────────────────────────────────
scannerRouter.get("/api/scan/momentum", async (req, res) => {
  const { minPrice=3, limit=150 } = req.query;
  const ck  = `momentum:${minPrice}:${limit}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });

  if (dbReady()) {
    try {
      // Composite RS score: above EMA50 + above EMA200 + positive d21 + rs_3m
      const rows = db.prepare(
        `SELECT r.*,u.name,u.sector,u.industry FROM eod_returns r
         JOIN universe u ON r.symbol=u.symbol
         WHERE r.close>=? AND u.is_active=1
           AND r.above_ema50=1 AND r.d21 IS NOT NULL
         ORDER BY
           (COALESCE(r.rs_3m,0)*0.4 + COALESCE(r.d21,0)*0.3 +
            COALESCE(r.d63,0)*0.2  + COALESCE(r.d1,0)*0.1) DESC
         LIMIT ?`
      ).all(+minPrice, +limit);
      const results = rows.map(dbRowToTicker).filter(Boolean);
      if (results.length >= 20) {
        cache.set(ck, results);
        return res.json({ results, cached: false, source: "eod_db" });
      }
    } catch(e) { log.warn(`momentum DB fallback: ${e.message}`); }
  }

  let raw = await Promise.allSettled([
    runScreen("day_gainers", 150), runScreen("undervalued_growth_stocks", 100),
    runScreen("growth_technology_stocks", 100), runScreen("undervalued_large_caps", 80),
  ]).then(r => r.flatMap(x => x.value || []));
  const seen = new Set();
  raw = raw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
  let results = raw.map(normalise).filter(Boolean)
    .filter(t => t.price >= +minPrice && (t.above50 === true || t.above200 === true))
    .sort((a,b) => (b.change||0) - (a.change||0)).slice(0, +limit);
  results = await enrichWithSectorIndustry(results);
  cache.set(ck, results);
  res.json({ results, cached: false, source: "yahoo" });
});

// ── GET /api/scan/custom — DB-first custom screener ────────────────────────────
// When EOD DB is populated this runs entirely in SQLite (<5ms).
// Falls back to Yahoo screener when DB has < 100 symbols.
scannerRouter.get("/api/scan/custom", async (req, res) => {
  const {
    minPrice=1, maxPrice=99999, minMcap=0,
    minVol=0, minRelVol=0,
    minChange=-100, maxChange=100,
    sectors="", industries="",
    sortBy="change", limit=200,
    minRsi=0, maxRsi=100,
    minAdr=0, maxAdr=999,
    // Period return filters (new — DB only)
    minD5=null, minD21=null, minD63=null, minD126=null, minD252=null,
    minYtd=null, minRs3m=null,
    // EMA filter
    emaFilter="any",        // any | above50 | above200 | above_both
  } = req.query;

  const ck  = `custom:${JSON.stringify(req.query)}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true, source: hit[0]?.source || "cached" });

  // ── DB path ──────────────────────────────────────────────────────────────────
  if (dbReady()) {
    try {
      const sectorList   = sectors   ? sectors.split(",").map(s => s.trim()).filter(Boolean)   : [];
      const industryList = industries? industries.split(",").map(s => s.trim()).filter(Boolean) : [];

      let sql = `
        SELECT r.*,u.name,u.sector,u.industry FROM eod_returns r
        JOIN universe u ON r.symbol=u.symbol
        WHERE u.is_active=1
          AND r.close >= @minPrice AND r.close <= @maxPrice
          AND (@minVol=0 OR r.volume >= @minVol)
          AND (@minRelVol=0 OR (r.avg_vol10>0 AND CAST(r.volume AS REAL)/r.avg_vol10 >= @minRelVol))
          AND r.d1 >= @minChange AND r.d1 <= @maxChange
          AND (@minRsi=0  OR r.rsi14 >= @minRsi)
          AND (@maxRsi=100 OR r.rsi14 <= @maxRsi)
          AND (@minAdr=0  OR r.adr14 >= @minAdr)
          AND (@maxAdr=999 OR r.adr14 <= @maxAdr)
      `;

      const params = {
        minPrice: +minPrice, maxPrice: +maxPrice,
        minVol: +minVol,     minRelVol: +minRelVol,
        minChange: +minChange, maxChange: +maxChange,
        minRsi: +minRsi,     maxRsi: +maxRsi,
        minAdr: +minAdr,     maxAdr: +maxAdr,
      };

      // Optional period return filters
      if (minD5   != null) { sql += ` AND r.d5   >= @minD5`;   params.minD5   = +minD5;   }
      if (minD21  != null) { sql += ` AND r.d21  >= @minD21`;  params.minD21  = +minD21;  }
      if (minD63  != null) { sql += ` AND r.d63  >= @minD63`;  params.minD63  = +minD63;  }
      if (minD126 != null) { sql += ` AND r.d126 >= @minD126`; params.minD126 = +minD126; }
      if (minD252 != null) { sql += ` AND r.d252 >= @minD252`; params.minD252 = +minD252; }
      if (minYtd  != null) { sql += ` AND r.ytd  >= @minYtd`;  params.minYtd  = +minYtd;  }
      if (minRs3m != null) { sql += ` AND r.rs_3m >= @minRs3m`;params.minRs3m = +minRs3m; }

      // EMA flag filter
      if (emaFilter === "above50")   sql += ` AND r.above_ema50=1`;
      if (emaFilter === "above200")  sql += ` AND r.above_ema200=1`;
      if (emaFilter === "above_both")sql += ` AND r.above_ema50=1 AND r.above_ema200=1`;

      // Sector / industry filter (IN clause with interpolation — safe, from our own data)
      if (sectorList.length) {
        sql += ` AND u.sector IN (${sectorList.map(()=>"?").join(",")})`;
      }
      if (industryList.length) {
        sql += ` AND u.industry IN (${industryList.map(()=>"?").join(",")})`;
      }

      // Sort
      const SORT_MAP = {
        change:   "r.d1 DESC",
        d5:       "r.d5 DESC",     d21:  "r.d21 DESC",
        d63:      "r.d63 DESC",    d126: "r.d126 DESC",
        d252:     "r.d252 DESC",   ytd:  "r.ytd DESC",
        volume:   "r.volume DESC", relVol:"CAST(r.volume AS REAL)/MAX(r.avg_vol10,1) DESC",
        rsi:      "r.rsi14 DESC",  adr:  "r.adr14 DESC",
        rs3m:     "r.rs_3m DESC",  rs12m:"r.rs_12m DESC",
      };
      sql += ` ORDER BY ${SORT_MAP[sortBy] || "r.d1 DESC"} LIMIT ${Math.min(+limit, 500)}`;

      // Execute with positional params for sector/industry IN clauses
      const posParams = [...Object.values(params), ...sectorList, ...industryList];
      // Replace @named with ? for the IN-clause portion
      const finalSql = sql.replace(/@(\w+)/g, (_, k) => `@${k}`);

      const rows    = db.prepare(finalSql).all(params);
      const results = rows.map(dbRowToTicker).filter(Boolean);

      log.step(`custom scan DB: ${results.length} results (${Object.keys(req.query).length} filters)`);
      cache.set(ck, results);
      return res.json({ results, cached: false, total: results.length, source: "eod_db" });
    } catch(e) {
      log.warn(`custom scan DB error: ${e.message} — falling back to Yahoo`);
    }
  }

  // ── Yahoo fallback ────────────────────────────────────────────────────────────
  let deduped = await runAllScreens({
    day_gainers:250, day_losers:200, most_actives:250,
    small_cap_gainers:200, aggressive_small_caps:150,
    undervalued_growth_stocks:150, undervalued_large_caps:120,
    growth_technology_stocks:150,
  });

  let results = deduped.map(normalise).filter(Boolean);
  results = await enrichWithSectorIndustry(results);

  const sectorSet = sectors   ? new Set(sectors.split(",").map(s=>s.trim()))   : null;
  const indSet    = industries? new Set(industries.split(",").map(s=>s.trim())): null;
  const mc = +minMcap, p1 = +minPrice, p2 = +maxPrice;
  results = results.filter(t =>
    t.price >= p1 && t.price <= p2 &&
    (!mc || (t.marketCap && t.marketCap >= mc)) &&
    t.volume >= +minVol && t.relVol >= +minRelVol &&
    t.change >= +minChange && t.change <= +maxChange &&
    (!sectorSet?.size || sectorSet.has(t.sector)) &&
    (!indSet?.size    || indSet.has(t.industry))
  );

  const sortFns = {
    change:(a,b)=>(b.change||0)-(a.change||0), volume:(a,b)=>(b.volume||0)-(a.volume||0),
    relVol:(a,b)=>(b.relVol||0)-(a.relVol||0), marketCap:(a,b)=>(b.marketCap||0)-(a.marketCap||0),
  };
  results = results.sort(sortFns[sortBy]||sortFns.change).slice(0, +limit);
  cache.set(ck, results);
  res.json({ results, cached: false, total: results.length, source: "yahoo" });
});

// ── GET /api/scan/eod — pure DB scan, full ETF benchmark support ──────────────
scannerRouter.get("/api/scan/eod", async (req, res) => {
  const {
    period      = "d63",        // default 3M — most meaningful for trend traders
    minPrice    = 5,            // default $5 — eliminates most penny stocks
    maxPrice    = 99999,
    minVol      = 100000,       // default 100K — eliminates illiquid stocks
    minPeriodReturn = null,
    sectors     = "",
    sectorEtf   = "",
    industryEtf = "",
    emaFilter   = "any",
    minRsVsSector    = null,
    minRsVsIndustry  = null,
    limit    = 200,
    sortDir  = "desc",
    sortBy   = "period",
    // Quality guards — prevent anomalous micro-cap spikes from dominating
    maxAbsReturn = 500,         // cap at ±500% — filters reverse-split spikes
    minAvgVol    = 50000,       // require 50K avg daily volume (data quality)
  } = req.query;


  const VALID_PERIODS = new Set([
    "d1","d5","d10","d21","d42","d63","d126","d189","d252","d504",
    "ytd","mtd","qtd","rs_1m","rs_3m","rs_6m","rs_12m","rsi14","adr14",
    "rs_vs_sector","rs_vs_industry",
  ]);
  if (!VALID_PERIODS.has(period))
    return res.status(400).json({ error: `Invalid period: ${period}` });
  if (!dbReady(50))
    return res.status(503).json({ error: "EOD DB not populated. Run: npm run bootstrap:2y" });

  // RS period fields — apply outlier cap only to these (not to rsi14/adr14)
  const RS_PERIODS = new Set([
    "d1","d5","d10","d21","d42","d63","d126","d189","d252","d504",
    "ytd","mtd","qtd","rs_1m","rs_3m","rs_6m","rs_12m",
  ]);

  // ETF → sector/industry name fallback maps
  const ETF_TO_SECTOR = {
    XLK:"Technology", XLV:"Healthcare", XLF:"Financial Services",
    XLY:"Consumer Cyclical", XLP:"Consumer Defensive", XLC:"Communication Services",
    XLE:"Energy", XLB:"Basic Materials", XLI:"Industrials",
    XLU:"Utilities", XLRE:"Real Estate",
  };
  const ETF_TO_IND = {
    SOXX:["Semiconductors","Semiconductor Equipment & Materials"], SMH:["Semiconductors"],
    IGV:["Software—Application","Software—Infrastructure"],
    CLOU:["Software—Application","Information Technology Services"],
    FDN:["Internet Content & Information","Internet Retail"],
    CIBR:["Software—Infrastructure","Information Technology Services"],
    BOTZ:["Electronic Components","Specialty Industrial Machinery"],
    ESPO:["Electronic Gaming & Multimedia"],
    IBB:["Biotechnology"], XBI:["Biotechnology"],
    IHI:["Medical Devices","Medical Instruments & Supplies"],
    PJP:["Drug Manufacturers—General"],
    XHS:["Healthcare Plans","Medical Care Facilities"],
    KRE:["Banks—Regional"], KBE:["Banks—Regional","Banks—Diversified"],
    KCE:["Capital Markets","Asset Management"],
    KIE:["Insurance—Property & Casualty","Insurance—Life"],
    XRT:["Internet Retail","Specialty Retail","Department Stores"],
    XHB:["Homebuilding","Building Products & Equipment"],
    PEJ:["Hotels & Motels","Restaurants","Travel Services","Airlines"],
    XOP:["Oil & Gas E&P","Oil & Gas Refining & Marketing"],
    OIH:["Oil & Gas Equipment & Services"], AMLP:["Oil & Gas Midstream"],
    TAN:["Solar"], URA:["Uranium"],
    GDX:["Gold"], GDXJ:["Gold"], SIL:["Silver"],
    XME:["Steel","Aluminum","Other Industrial Metals & Mining"],
    COPX:["Copper"], LIT:["Specialty Chemicals","Other Industrial Metals & Mining"],
    ITA:["Aerospace & Defense"], JETS:["Airlines","Airports & Air Services"],
    IYT:["Trucking","Railroads","Integrated Freight & Logistics"],
    PAVE:["Engineering & Construction","Building Products & Equipment"],
    VNQ:["REIT—Diversified","REIT—Industrial","REIT—Retail","REIT—Residential","REIT—Office","REIT—Specialty"],
    IYZ:["Telecom Services"],
  };

  try {
    const sectorList    = sectors    ? sectors.split(",").map(s=>s.trim()).filter(Boolean) : [];
    const sectorEtfList = sectorEtf  ? sectorEtf.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean) : [];
    const indEtfList    = industryEtf? industryEtf.split(",").map(s=>s.trim().toUpperCase()).filter(Boolean) : [];
    const direction     = sortDir === "asc" ? "ASC" : "DESC";

    const SORT_COL = sortBy === "rs_vs_sector"   ? "r.rs_vs_sector"
                   : sortBy === "rs_vs_industry" ? "r.rs_vs_industry"
                   : `r.${period}`;

    const etfPopulated = (sectorEtfList.length || indEtfList.length)
      ? (db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE sector_etf IS NOT NULL").get()?.n ?? 0) > 0
      : false;

    let sql = `
      SELECT r.*, u.name, u.sector, u.industry, u.sector_etf, u.industry_etf
      FROM eod_returns r
      JOIN universe u ON r.symbol = u.symbol
      WHERE u.is_active = 1
        AND r.close  >= @minPrice
        AND r.close  <= @maxPrice
        AND r.volume >= @minVol
        AND (@minAvgVol = 0 OR r.avg_vol10 >= @minAvgVol)
        AND ${SORT_COL} IS NOT NULL
    `;
    const params = {
      minPrice:  +minPrice,
      maxPrice:  +maxPrice,
      minVol:    +minVol,
      minAvgVol: +minAvgVol,
    };
    const extra = [];

    // Outlier cap: exclude reverse-split / low-float spikes
    // Only applied to return-based periods, not technical indicators
    if (RS_PERIODS.has(period) && +maxAbsReturn < 9999) {
      sql += ` AND ABS(r.${period}) <= @maxAbsReturn`;
      params.maxAbsReturn = +maxAbsReturn;
    }

    // Period return minimum
    if (minPeriodReturn != null) {
      sql += ` AND r.${period} >= @minRet`;
      params.minRet = +minPeriodReturn;
    }

    // RS vs ETF minimums
    if (minRsVsSector != null && etfPopulated) {
      sql += ` AND r.rs_vs_sector >= @minRsS`;
      params.minRsS = +minRsVsSector;
    }
    if (minRsVsIndustry != null && etfPopulated) {
      sql += ` AND r.rs_vs_industry >= @minRsI`;
      params.minRsI = +minRsVsIndustry;
    }

    // EMA position
    if (emaFilter === "above50")    sql += ` AND r.above_ema50=1`;
    if (emaFilter === "above200")   sql += ` AND r.above_ema200=1`;
    if (emaFilter === "above_both") sql += ` AND r.above_ema50=1 AND r.above_ema200=1`;

    // Sector ETF filter
    const sectorNamesAll = [...sectorList];
    if (sectorEtfList.length) {
      if (etfPopulated) {
        sql += ` AND r.sector_etf IN (${sectorEtfList.map(()=>"?").join(",")})`;
        extra.push(...sectorEtfList);
      } else {
        const fromEtf = [...new Set(sectorEtfList.map(e => ETF_TO_SECTOR[e]).filter(Boolean))];
        sectorNamesAll.push(...fromEtf);
      }
    }
    if (sectorNamesAll.length) {
      sql += ` AND u.sector IN (${sectorNamesAll.map(()=>"?").join(",")})`;
      extra.push(...[...new Set(sectorNamesAll)]);
    }

    // Industry ETF filter
    if (indEtfList.length) {
      if (etfPopulated) {
        sql += ` AND r.industry_etf IN (${indEtfList.map(()=>"?").join(",")})`;
        extra.push(...indEtfList);
      } else {
        const indNames = [...new Set(indEtfList.flatMap(e => ETF_TO_IND[e] || []))];
        if (indNames.length) {
          sql += ` AND u.industry IN (${indNames.map(()=>"?").join(",")})`;
          extra.push(...indNames);
        }
      }
    }

    sql += ` ORDER BY ${SORT_COL} ${direction} LIMIT ${Math.min(+limit, 500)}`;

    const rows    = db.prepare(sql).all(params, ...extra);
    const results = rows.map(r => ({
      ...dbRowToTicker(r),
      sector_etf:     r.sector_etf     || null,
      industry_etf:   r.industry_etf   || null,
      rs_vs_sector:   r.rs_vs_sector   ?? null,
      rs_vs_industry: r.rs_vs_industry ?? null,
    })).filter(Boolean);

    cache.set(ck, results);

    const etfHint = !etfPopulated && (sectorEtfList.length || indEtfList.length) ? " [name-fallback]" : "";
    log.step(`eod scan: ${results.length} results period=${period} dir=${direction}` +
      `${sectorEtfList.length?" sEtf="+sectorEtfList.join(","):""}` +
      `${indEtfList.length?" iEtf="+indEtfList.slice(0,3).join(",")+(indEtfList.length>3?"…":""):""}` +
      etfHint);

    res.json({
      results, cached: false, total: results.length, period, source: "eod_db",
      etfDataReady: etfPopulated,
      etfFallback:  !etfPopulated && (sectorEtfList.length > 0 || indEtfList.length > 0),
    });
  } catch(e) {
    log.error(`eod scan: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/scan/symbols ─────────────────────────────────────────────────────
scannerRouter.get("/api/scan/symbols", async (req, res) => {
  const symbols = (req.query.symbols || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: "symbols required" });

  // Try DB first for each symbol, fall back to Yahoo for missing ones
  const results = [], missing = [];
  for (const sym of symbols) {
    const row = retQ.get(sym);
    if (row?.close) {
      const t = dbRowToTicker({ ...row, name: sym, sector: null, industry: null });
      // Enrich with universe data
      try {
        const uRow = db.prepare("SELECT name,sector,industry FROM universe WHERE symbol=?").get(sym);
        if (uRow) { t.name = uRow.name; t.sector = uRow.sector; t.industry = uRow.industry; }
      } catch {}
      if (t) results.push(t);
    } else {
      missing.push(sym);
    }
  }

  if (missing.length) {
    await Promise.allSettled(missing.map(async sym => {
      const q = await safeQuote(sym);
      if (q) { const t = normalise(q); if (t) results.push(t); }
    }));
  }

  const enriched = await enrichWithSectorIndustry(results);
  res.json({ results: enriched });
});

// ── GET /api/scan/sectors ─────────────────────────────────────────────────────
scannerRouter.get("/api/scan/sectors", async (req, res) => {
  const ck  = "scan-sectors";
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ sectors: hit, cached: true });
  try {
    let raw = await Promise.allSettled([
      runScreen("most_actives", 200), runScreen("day_gainers", 150),
    ]).then(r => r.flatMap(x => x.value || []));
    const seen = new Set();
    raw = raw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
    let tickers = raw.map(normalise).filter(Boolean);
    tickers = await enrichWithSectorIndustry(tickers);
    const byS = {};
    for (const t of tickers) {
      if (!t.sector) continue;
      if (!byS[t.sector]) byS[t.sector] = { name:t.sector, tickers:[], totalChg:0 };
      byS[t.sector].tickers.push(t);
      byS[t.sector].totalChg += (t.change || 0);
    }
    const sectors = Object.values(byS)
      .map(s => ({ ...s, avgChg: s.totalChg / s.tickers.length, count: s.tickers.length }))
      .sort((a,b) => Math.abs(b.avgChg) - Math.abs(a.avgChg));
    cache.set(ck, sectors);
    res.json({ sectors, cached: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/scan/full — full universe scan (Yahoo live) ──────────────────────
scannerRouter.get("/api/scan/full", async (req, res) => {
  const { minPrice=1, minMcap=0, minVol=0, minChange=2, maxChange=100,
          limit=300, sortBy="change", sectors="" } = req.query;
  const s = universeStatus();
  if (!s.loaded) return res.status(503).json({ error: "Universe not loaded yet", loading: true });

  const ck  = `scan-full:${minPrice}:${minMcap}:${minVol}:${minChange}:${maxChange}:${sortBy}:${sectors}`;
  const hit = cache.get(ck, 5 * 60_000);
  if (hit) return res.json({ ...hit, cached: true });

  const allSyms = [...universe.keys()];
  const results = [], sectorSet = sectors ? new Set(sectors.split(",").map(s=>s.trim())) : null;
  const BATCH_SIZE = 50;

  for (let i = 0; i < allSyms.length; i += BATCH_SIZE) {
    const batch  = allSyms.slice(i, i + BATCH_SIZE);
    const quotes = await Promise.allSettled(batch.map(safeQuote));
    for (let j = 0; j < batch.length; j++) {
      const q = quotes[j].value;
      if (!q?.regularMarketPrice) continue;
      if (q.regularMarketPrice < +minPrice) continue;
      if (+minVol && (q.regularMarketVolume||0) < +minVol) continue;
      if (+minMcap && q.marketCap && q.marketCap < +minMcap) continue;
      const chg = q.regularMarketChangePercent ?? 0;
      if (chg < +minChange || chg > +maxChange) continue;
      if (sectorSet?.size && !sectorSet.has(q.sector)) continue;
      const t = normalise(q); if (t) results.push(t);
    }
    if (i % 500 === 0 && i > 0) log.step(`full scan: ${i}/${allSyms.length}, ${results.length} passed`);
  }

  const sortFns = {
    change:(a,b)=>Math.abs(b.change||0)-Math.abs(a.change||0),
    volume:(a,b)=>(b.volume||0)-(a.volume||0),
    relVol:(a,b)=>(b.relVol||0)-(a.relVol||0),
    marketCap:(a,b)=>(b.marketCap||0)-(a.marketCap||0),
  };
  const sorted = results.sort(sortFns[sortBy]||sortFns.change).slice(0, +limit);
  const out = { results: sorted, total: results.length, processed: allSyms.length, ts: new Date() };
  cache.set(ck, out);
  res.json(out);
});

// ── GET /api/scan/full/stream — SSE streaming universe scan ──────────────────
scannerRouter.get("/api/scan/full/stream", async (req, res) => {
  const { minPrice=1, minChange=2, minVol=100000, minMcap=0, maxChange=100 } = req.query;
  const s = universeStatus();
  if (!s.loaded) {
    res.write(`data: ${JSON.stringify({ error:"Universe not loaded", loading:true })}\n\n`);
    return res.end();
  }
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();

  const allSyms = [...universe.keys()];
  const BATCH   = 40;
  let passed    = 0;

  for (let i = 0; i < allSyms.length; i += BATCH) {
    if (res.destroyed) break;
    const batch  = allSyms.slice(i, i + BATCH);
    const quotes = await Promise.allSettled(batch.map(safeQuote));
    const chunk  = [];
    for (let j = 0; j < batch.length; j++) {
      const q = quotes[j].value;
      if (!q?.regularMarketPrice) continue;
      if (q.regularMarketPrice < +minPrice) continue;
      if ((q.regularMarketVolume||0) < +minVol) continue;
      if (+minMcap && q.marketCap && q.marketCap < +minMcap) continue;
      const chg = q.regularMarketChangePercent ?? 0;
      if (Math.abs(chg) < +minChange || chg > +maxChange) continue;
      const t = normalise(q); if (t) chunk.push(t);
    }
    if (chunk.length) {
      passed += chunk.length;
      res.write(`data: ${JSON.stringify({ batch:chunk, progress:i+BATCH, total:allSyms.length, passed })}\n\n`);
    }
  }
  res.write(`data: ${JSON.stringify({ done:true, total:allSyms.length, passed })}\n\n`);
  res.end();
});

// ── GET /api/scan/shorted ─────────────────────────────────────────────────────
scannerRouter.get("/api/scan/shorted", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 150, 250);
  const ck    = `shorted:${limit}`;
  const hit   = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });
  try {
    let raw = await runScreen("most_shorted_stocks", limit + 50);
    if (raw.length < 20) {
      const supp = await Promise.allSettled([runScreen("day_gainers",80), runScreen("most_actives",80)]);
      const seen = new Set(raw.map(q=>q.symbol));
      raw = [...raw, ...supp.flatMap(r=>r.value||[]).filter(q=>!seen.has(q.symbol))];
    }
    let results = raw.map(normalise).filter(Boolean);
    results = await enrichWithSectorIndustry(results);

    const { yf, withTimeout } = await import("../data/yahoo.js");
    const BATCH = 8;
    for (let i = 0; i < Math.min(results.length, 80); i += BATCH) {
      const batch = results.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async t => {
        const ck2 = `si_short:${t.symbol}`;
        let si = cache.get(ck2, 6*3600_000);
        if (!si) {
          try {
            const r  = await withTimeout(yf.quoteSummary(t.symbol,{modules:["defaultKeyStatistics"]}),10_000);
            const dk = r?.defaultKeyStatistics;
            si = {
              shortPct:   dk?.shortPercentOfFloat!=null?+(dk.shortPercentOfFloat*100).toFixed(1):null,
              shortRatio: dk?.shortRatio!=null?+dk.shortRatio.toFixed(2):null,
              floatShares:dk?.floatShares??null,
            };
            cache.set(ck2, si);
          } catch { si = {}; }
        }
        t.shortPct=si.shortPct??null; t.shortRatio=si.shortRatio??null; t.floatShares=si.floatShares??null;
      }));
    }
    results = results.sort((a,b)=>(b.shortPct||0)-(a.shortPct||0)).slice(0, limit);
    cache.set(ck, results);
    res.json({ results, cached: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/scan/52wkhigh ─────────────────────────────────────────────────────
scannerRouter.get("/api/scan/52wkhigh", async (req, res) => {
  const { minPrice=1, limit=150 } = req.query;
  const ck  = `52wkhigh:${minPrice}:${limit}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });
  try {
    let raw = await runScreen("recent_52_week_highs", +limit + 50);
    if (raw.length < 20) {
      const supp = await Promise.allSettled([
        runScreen("undervalued_large_caps",80), runScreen("growth_technology_stocks",80), runScreen("day_gainers",80),
      ]);
      const seen = new Set(raw.map(q=>q.symbol));
      raw = [...raw, ...supp.flatMap(r=>r.value||[]).filter(q=>!seen.has(q.symbol))];
    }
    let results = raw.map(normalise).filter(Boolean).filter(t=>(t.price||0)>= +minPrice);
    results = await enrichWithSectorIndustry(results);
    results = results.map(t=>({...t,
      hi52Pct: t.hi52&&t.price?+(t.price/t.hi52*100).toFixed(1):null,
      lo52Pct: t.lo52&&t.price?+(t.price/t.lo52*100).toFixed(1):null,
      fromHi52:t.hi52&&t.price?+((t.price-t.hi52)/t.hi52*100).toFixed(1):null,
    })).sort((a,b)=>(b.hi52Pct||0)-(a.hi52Pct||0)).slice(0, +limit);
    cache.set(ck, results);
    res.json({ results, cached: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
