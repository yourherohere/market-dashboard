// server/jobs/enrich-sectors.js
// ─────────────────────────────────────────────────────────────────────────────
// Fills sector + industry + sector_etf + industry_etf for every symbol in the
// universe table and eod_returns table.
//
// Strategy (3 tiers, same as enrichment.js but writes to DB):
//   1. sector_cache table (instant, no network)
//   2. yf.quote() batch — 40 symbols per call
//   3. yf.quoteSummary(assetProfile) fallback for stragglers
//
// Run manually: node server/jobs/enrich-sectors.js
// Also called automatically after EOD collection completes.
// ─────────────────────────────────────────────────────────────────────────────

import { db, uniQ, siQ, retQ } from "../db/index.js";
import { runMigrations }        from "../db/index.js";
import { loadUniverse, universe } from "../data/universe.js";
import { loadSICache, siCache }   from "../data/enrichment.js";
import { yf, withTimeout }        from "../data/yahoo.js";
import { log }                    from "../logger.js";

// ── GICS sector → sector ETF map ─────────────────────────────────────────────
const SECTOR_ETF = {
  "Technology":           "XLK",
  "Healthcare":           "XLV",
  "Financial Services":   "XLF",
  "Financials":           "XLF",
  "Consumer Cyclical":    "XLY",
  "Consumer Discret.":    "XLY",
  "Consumer Defensive":   "XLP",
  "Consumer Staples":     "XLP",
  "Communication Services":"XLC",
  "Comm Services":        "XLC",
  "Energy":               "XLE",
  "Basic Materials":      "XLB",
  "Materials":            "XLB",
  "Industrials":          "XLI",
  "Utilities":            "XLU",
  "Real Estate":          "XLRE",
};

// ── Industry → industry ETF map ───────────────────────────────────────────────
// Maps Yahoo-returned industry strings to their best-matching sub-sector ETF
const INDUSTRY_ETF = {
  // Technology
  "Semiconductors":                     "SOXX",
  "Semiconductor Equipment & Materials":"SOXX",
  "Software—Application":               "IGV",
  "Software—Infrastructure":            "IGV",
  "Information Technology Services":    "CLOU",
  "Internet Content & Information":     "FDN",
  "Computer Hardware":                  "XLK",
  "Communication Equipment":            "XLK",
  "Electronic Components":              "XLK",
  "Electronic Gaming & Multimedia":     "ESPO",
  // Healthcare
  "Biotechnology":                      "IBB",
  "Drug Manufacturers—General":         "PJP",
  "Drug Manufacturers—Specialty & Generic":"IBB",
  "Medical Devices":                    "IHI",
  "Medical Instruments & Supplies":     "IHI",
  "Healthcare Plans":                   "XHS",
  "Medical Care Facilities":            "XHS",
  "Diagnostics & Research":             "IHI",
  // Financials
  "Banks—Regional":                     "KRE",
  "Banks—Diversified":                  "KBE",
  "Asset Management":                   "KCE",
  "Capital Markets":                    "KCE",
  "Insurance—Property & Casualty":      "KIE",
  "Insurance—Life":                     "KIE",
  "Insurance—Diversified":              "KIE",
  "Credit Services":                    "XLF",
  "Financial Data & Stock Exchanges":   "KCE",
  // Consumer Cyclical
  "Internet Retail":                    "XRT",
  "Specialty Retail":                   "XRT",
  "Department Stores":                  "XRT",
  "Homebuilding":                       "XHB",
  "Building Products & Equipment":      "XHB",
  "Restaurants":                        "PEJ",
  "Hotels & Motels":                    "PEJ",
  "Travel Services":                    "PEJ",
  "Auto Manufacturers":                 "XLY",
  // Energy
  "Oil & Gas E&P":                      "XOP",
  "Oil & Gas Integrated":               "XLE",
  "Oil & Gas Refining & Marketing":     "XOP",
  "Oil & Gas Midstream":                "AMLP",
  "Oil & Gas Equipment & Services":     "OIH",
  "Solar":                              "TAN",
  "Uranium":                            "URA",
  // Materials
  "Gold":                               "GDX",
  "Silver":                             "SIL",
  "Copper":                             "COPX",
  "Steel":                              "XME",
  "Aluminum":                           "XME",
  "Other Industrial Metals & Mining":   "XME",
  "Specialty Chemicals":                "XLB",
  "Lithium":                            "LIT",
  // Industrials
  "Aerospace & Defense":                "ITA",
  "Airlines":                           "JETS",
  "Airports & Air Services":            "JETS",
  "Trucking":                           "IYT",
  "Railroads":                          "IYT",
  "Integrated Freight & Logistics":     "IYT",
  "Engineering & Construction":         "PAVE",
  "Specialty Industrial Machinery":     "XLI",
  // Real Estate
  "REIT—Diversified":                   "VNQ",
  "REIT—Industrial":                    "VNQ",
  "REIT—Retail":                        "VNQ",
  "REIT—Residential":                   "VNQ",
  "REIT—Office":                        "VNQ",
  "REIT—Specialty":                     "VNQ",
  // Comm Services
  "Telecom Services":                   "IYZ",
  "Entertainment":                      "XLC",
  // Utilities
  "Utilities—Regulated Electric":       "XLU",
  "Utilities—Renewable":                "XLU",
  "Utilities—Regulated Gas":            "XLU",
};

export function getSectorEtf(sector)    { return SECTOR_ETF[sector]   || null; }
export function getIndustryEtf(industry){ return INDUSTRY_ETF[industry]|| null; }

// ── Main enrichment function ───────────────────────────────────────────────────
export async function enrichSectorIndustryDB(options = {}) {
  const { forceRefetch = false, batchSize = 40, maxSymbols = null } = options;
  const t0 = Date.now();

  log.info("Sector/Industry DB enrichment starting…");

  // Get symbols that need sector data
  let allSymbols;
  if (forceRefetch) {
    allSymbols = uniQ.allSymbols();
  } else {
    // Only symbols missing sector in universe table
    const rows = db.prepare(
      `SELECT symbol FROM universe WHERE is_active=1 AND (sector IS NULL OR sector='') ORDER BY symbol`
    ).all();
    allSymbols = rows.map(r => r.symbol);
  }

  if (maxSymbols) allSymbols = allSymbols.slice(0, maxSymbols);
  log.step(`Symbols needing enrichment: ${allSymbols.length}`);

  if (!allSymbols.length) {
    log.ok("All symbols already have sector data");
    return { enriched: 0, duration: Date.now() - t0 };
  }

  // ── Tier 1: Load from sector_cache table (no network) ────────────────────
  const stillMissing = [];
  let fromCache = 0;

  for (const sym of allSymbols) {
    const cached = siCache.get(sym) || siQ.get(sym);
    if (cached?.sector) {
      const sEtf = getSectorEtf(cached.sector);
      const iEtf = getIndustryEtf(cached.industry);
      db.prepare(
        `UPDATE universe SET sector=?,industry=?,sector_etf=?,industry_etf=?,updated_at=datetime('now') WHERE symbol=?`
      ).run(cached.sector, cached.industry||null, sEtf, iEtf, sym);
      fromCache++;
    } else {
      stillMissing.push(sym);
    }
  }
  log.step(`From cache: ${fromCache} | Still missing: ${stillMissing.length}`);

  // ── Tier 2: Batch yf.quote() — 40 symbols at a time ─────────────────────
  const PARALLEL = 3;
  let fromQuote = 0, tier3List = [];

  for (let i = 0; i < stillMissing.length; i += batchSize * PARALLEL) {
    const groups = [];
    for (let g = 0; g < PARALLEL; g++) {
      const slice = stillMissing.slice(i + g * batchSize, i + (g + 1) * batchSize);
      if (slice.length) groups.push(
        Promise.allSettled(slice.map(sym =>
          withTimeout(yf.quote(sym), 10_000)
            .then(q => ({ sym, q }))
            .catch(() => ({ sym, q: null }))
        ))
      );
    }
    const groupResults = await Promise.allSettled(groups);
    for (const gRes of groupResults) {
      if (gRes.status !== "fulfilled") continue;
      for (const r of gRes.value) {
        if (r.status !== "fulfilled") continue;
        const { sym, q } = r.value;
        if (q?.sector) {
          const sEtf = getSectorEtf(q.sector);
          const iEtf = getIndustryEtf(q.industry);
          // Update universe
          db.prepare(
            `UPDATE universe SET sector=?,industry=?,sector_etf=?,industry_etf=?,updated_at=datetime('now') WHERE symbol=?`
          ).run(q.sector, q.industry||null, sEtf, iEtf, sym);
          // Update sector_cache
          siQ.set(sym, q.sector, q.industry||null, "quote");
          siCache.set(sym, { sector: q.sector, industry: q.industry||null, ts: Date.now() });
          fromQuote++;
        } else {
          tier3List.push(sym);
        }
      }
    }

    if ((i / batchSize) % 10 === 0) {
      process.stdout.write(`\r  Quote batch: ${Math.min(i + batchSize*PARALLEL, stillMissing.length)}/${stillMissing.length} (${fromQuote} resolved)   `);
    }
  }
  process.stdout.write("\n");
  log.step(`From yf.quote: ${fromQuote} | Tier 3 fallback needed: ${tier3List.length}`);

  // ── Tier 3: quoteSummary(assetProfile) for stragglers ────────────────────
  let fromSummary = 0;
  const T3_BATCH = 5;
  for (let i = 0; i < tier3List.length; i += T3_BATCH) {
    const batch = tier3List.slice(i, i + T3_BATCH);
    await Promise.allSettled(batch.map(async sym => {
      try {
        const r  = await withTimeout(yf.quoteSummary(sym, { modules: ["assetProfile"] }), 12_000);
        const ap = r?.assetProfile;
        if (ap?.sector) {
          const sEtf = getSectorEtf(ap.sector);
          const iEtf = getIndustryEtf(ap.industry);
          db.prepare(
            `UPDATE universe SET sector=?,industry=?,sector_etf=?,industry_etf=?,updated_at=datetime('now') WHERE symbol=?`
          ).run(ap.sector, ap.industry||null, sEtf, iEtf, sym);
          siQ.set(sym, ap.sector, ap.industry||null, "quoteSummary");
          siCache.set(sym, { sector: ap.sector, industry: ap.industry||null, ts: Date.now() });
          fromSummary++;
        }
      } catch {}
    }));
  }

  // ── Update eod_returns with sector_etf / industry_etf ────────────────────
  log.step("Syncing sector/industry ETFs to eod_returns…");
  try {
    db.prepare(`
      UPDATE eod_returns SET
        sector_etf   = (SELECT sector_etf   FROM universe WHERE universe.symbol = eod_returns.symbol),
        industry_etf = (SELECT industry_etf FROM universe WHERE universe.symbol = eod_returns.symbol)
      WHERE symbol IN (SELECT symbol FROM universe WHERE sector_etf IS NOT NULL)
    `).run();
    log.step("eod_returns ETF sync complete");
  } catch(e) { log.warn(`eod_returns ETF sync: ${e.message}`); }

  const duration = Date.now() - t0;
  const total = fromCache + fromQuote + fromSummary;
  log.ok(`Sector enrichment done: ${total} symbols enriched in ${(duration/1000).toFixed(1)}s`);
  log.step(`  Cache: ${fromCache}  Quote: ${fromQuote}  Summary: ${fromSummary}  Failed: ${stillMissing.length - fromQuote - fromSummary}`);

  return { enriched: total, fromCache, fromQuote, fromSummary, duration };
}

// ── Compute RS vs ETF benchmarks ─────────────────────────────────────────────
// After sector enrichment, compute 3M relative strength of each stock
// vs its sector ETF and industry ETF using stored eod_prices
export async function computeEtfRS() {
  log.step("Computing RS vs sector/industry ETFs…");

  // Get all unique ETF symbols needed — combine DB ETFs + all known GICS ETFs
  const etfRows = db.prepare(
    `SELECT DISTINCT sector_etf, industry_etf FROM eod_returns
     WHERE sector_etf IS NOT NULL OR industry_etf IS NOT NULL`
  ).all();

  const allEtfs = [...new Set(
    etfRows.flatMap(r => [r.sector_etf, r.industry_etf].filter(Boolean))
  )];

  log.step(`Loading price history for ${allEtfs.length} ETFs…`);

  // Fetch EOD prices for each ETF from our DB (they should be bootstrapped)
  const etfCloses = {};
  for (const etf of allEtfs) {
    const rows = db.prepare(
      `SELECT date, close FROM eod_prices WHERE symbol=? ORDER BY date DESC LIMIT 70`
    ).all(etf).reverse();
    if (rows.length >= 5) {
      etfCloses[etf] = rows.map(r => r.close);
    }
  }

  // For ETFs not in DB — fetch live from Yahoo Finance and cache in eod_prices
  const missingEtfs = allEtfs.filter(e => !etfCloses[e]);
  if (missingEtfs.length) {
    log.warn(`ETFs missing from DB — fetching live: ${missingEtfs.join(", ")}`);
    const yf = (await import("yahoo-finance2")).default;
    const insertPrice = db.prepare(
      `INSERT OR REPLACE INTO eod_prices (symbol, date, open, high, low, close, volume)
       VALUES (@symbol,@date,@open,@high,@low,@close,@volume)`
    );
    const insertUniverse = db.prepare(
      `INSERT OR IGNORE INTO universe (symbol, name, exchange, is_active)
       VALUES (@symbol, @name, 'NYSE', 1)`
    );
    const batchInsert = db.transaction((rows) => { for (const r of rows) insertPrice.run(r); });

    for (const etf of missingEtfs) {
      try {
        const from = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0,10);
        const result = await yf.historical(etf, { period1: from, interval: "1d" }).catch(()=>null);
        if (!result?.length) { log.debug(`ETF ${etf}: no data`); continue; }
        // Insert into universe so it's registered
        insertUniverse.run({ symbol: etf, name: `${etf} ETF` });
        const priceRows = result.map(r => ({
          symbol: etf, date: r.date.toISOString().slice(0,10),
          open: r.open||r.close, high: r.high||r.close,
          low: r.low||r.close, close: r.close, volume: r.volume||0,
        }));
        batchInsert(priceRows);
        etfCloses[etf] = priceRows.map(r => r.close);
        log.ok(`  ${etf}: fetched ${priceRows.length} bars`);
      } catch(e) {
        log.debug(`ETF ${etf} fetch failed: ${e.message}`);
      }
    }
  }

  function calcRS63(closes, etfCloses63) {
    if (!closes?.length || !etfCloses63?.length) return null;
    const n   = Math.min(63, closes.length, etfCloses63.length);
    const sr  = closes.length > n ? (closes[closes.length-1] / closes[closes.length-1-n] - 1) * 100 : null;
    const er  = etfCloses63.length > n ? (etfCloses63[etfCloses63.length-1] / etfCloses63[etfCloses63.length-1-n] - 1) * 100 : null;
    if (sr == null || er == null || er === -100) return null;
    return +((1 + sr/100) / (1 + er/100) * 100 - 100).toFixed(2);
  }

  // Batch update
  const stmt = db.prepare(
    `UPDATE eod_returns SET rs_vs_sector=?, rs_vs_industry=? WHERE symbol=?`
  );
  const updateAll = db.transaction((rows) => {
    for (const r of rows) stmt.run(r.rs_sector, r.rs_industry, r.symbol);
  });

  const rows = db.prepare(
    `SELECT r.symbol, r.sector_etf, r.industry_etf FROM eod_returns r
     WHERE r.sector_etf IS NOT NULL OR r.industry_etf IS NOT NULL`
  ).all();

  const updates = [];
  for (const row of rows) {
    const stockRows = db.prepare(
      `SELECT close FROM eod_prices WHERE symbol=? ORDER BY date DESC LIMIT 70`
    ).all(row.symbol).reverse().map(r => r.close);
    if (!stockRows.length) continue;

    const rsS = row.sector_etf   ? calcRS63(stockRows, etfCloses[row.sector_etf])   : null;
    const rsI = row.industry_etf ? calcRS63(stockRows, etfCloses[row.industry_etf]) : null;
    updates.push({ symbol: row.symbol, rs_sector: rsS, rs_industry: rsI });
  }

  updateAll(updates);
  log.ok(`RS vs ETF computed for ${updates.length} symbols`);
  return updates.length;
}

// ── CLI entry point ────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("enrich-sectors.js")) {
  process.env.YF_DISABLE_VERSION_CHECK = "1";
  runMigrations();
  loadSICache();
  await loadUniverse();
  await enrichSectorIndustryDB();
  await computeEtfRS();
  process.exit(0);
}
