// server/routes/scanner.js — All scanner endpoints
import { Router } from "express";
import { cache }  from "../cache.js";
import { CACHE, SCREEN_POOLS } from "../config.js";
import { runScreen, normalise, safeQuote } from "../data/yahoo.js";
import { enrichWithSectorIndustry } from "../data/enrichment.js";
import { universe, universeStatus } from "../data/universe.js";
import { retQ } from "../db/index.js";
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

function applyCommonFilters(results, { minPrice=0, minVol=0, minRelVol=0 } = {}) {
  return results.filter(t =>
    t.price   >= minPrice &&
    t.volume  >= minVol   &&
    t.relVol  >= minRelVol
  );
}

// ── GET /api/scan/gainers ─────────────────────────────────────────────────────
scannerRouter.get("/api/scan/gainers", async (req, res) => {
  const { minPrice=1, minVol=50000, limit=150 } = req.query;
  const ck  = `gainers:${minPrice}:${minVol}:${limit}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });

  let raw = await Promise.allSettled([
    runScreen("day_gainers", 200),
    runScreen("small_cap_gainers", 100),
    runScreen("most_actives", 100),
  ]).then(r => r.flatMap(x => x.value || []));

  const seen = new Set();
  raw = raw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
  let results = raw.map(normalise).filter(Boolean);
  results = applyCommonFilters(results, { minPrice: +minPrice, minVol: +minVol });
  results = await enrichWithSectorIndustry(results);
  results = results.sort((a, b) => (b.change || 0) - (a.change || 0)).slice(0, +limit);

  cache.set(ck, results);
  res.json({ results, cached: false });
});

// ── GET /api/scan/losers ──────────────────────────────────────────────────────
scannerRouter.get("/api/scan/losers", async (req, res) => {
  const { minPrice=0.5, minVol=10000, limit=150 } = req.query;
  const ck  = `losers:${minPrice}:${minVol}:${limit}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });

  let raw = await Promise.allSettled([
    runScreen("day_losers", 200),
    runScreen("most_actives", 100),
    runScreen("aggressive_small_caps", 80),
  ]).then(r => r.flatMap(x => x.value || []));

  const seen = new Set();
  raw = raw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
  let results = raw.map(normalise).filter(Boolean);
  results = applyCommonFilters(results, { minPrice: +minPrice, minVol: +minVol });
  results = await enrichWithSectorIndustry(results);
  results = results.sort((a, b) => (a.change || 0) - (b.change || 0)).slice(0, +limit);

  cache.set(ck, results);
  res.json({ results, cached: false });
});

// ── GET /api/scan/volume ──────────────────────────────────────────────────────
scannerRouter.get("/api/scan/volume", async (req, res) => {
  const { minRelVol=1.5, minPrice=1, limit=150 } = req.query;
  const ck  = `volume:${minRelVol}:${minPrice}:${limit}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });

  let raw = await Promise.allSettled([
    runScreen("most_actives", 200),
    runScreen("day_gainers", 100),
    runScreen("small_cap_gainers", 100),
  ]).then(r => r.flatMap(x => x.value || []));

  const seen = new Set();
  raw = raw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
  let results = raw.map(normalise).filter(Boolean);
  results = applyCommonFilters(results, { minRelVol: +minRelVol, minPrice: +minPrice });
  results = await enrichWithSectorIndustry(results);
  results = results.sort((a, b) => (b.relVol || 0) - (a.relVol || 0)).slice(0, +limit);

  cache.set(ck, results);
  res.json({ results, cached: false });
});

// ── GET /api/scan/momentum ────────────────────────────────────────────────────
scannerRouter.get("/api/scan/momentum", async (req, res) => {
  const { minPrice=3, limit=150 } = req.query;
  const ck  = `momentum:${minPrice}:${limit}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });

  let raw = await Promise.allSettled([
    runScreen("day_gainers", 150),
    runScreen("undervalued_growth_stocks", 100),
    runScreen("growth_technology_stocks", 100),
    runScreen("undervalued_large_caps", 80),
  ]).then(r => r.flatMap(x => x.value || []));

  const seen = new Set();
  raw = raw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
  let results = raw.map(normalise).filter(Boolean);
  results = applyCommonFilters(results, { minPrice: +minPrice });
  results = await enrichWithSectorIndustry(results);
  results = results
    .filter(t => t.above50 === true || t.above200 === true)
    .sort((a, b) => (b.change||0) - (a.change||0))
    .slice(0, +limit);

  cache.set(ck, results);
  res.json({ results, cached: false });
});

// ── GET /api/scan/custom — full custom screener ───────────────────────────────
scannerRouter.get("/api/scan/custom", async (req, res) => {
  const {
    minPrice=1, maxPrice=99999, minMcap=0, minVol=0, minRelVol=0,
    minChange=-100, maxChange=100, sectors="", industries="",
    sortBy="change", limit=200, minRsi=0, maxRsi=100,
    macdFilter="any", minAdr=0, maxAdr=999,
    quietCandles="0", quietPct=2,
  } = req.query;

  const ck  = `custom:${JSON.stringify(req.query)}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });

  let deduped = await runAllScreens({
    day_gainers:250, day_losers:200, most_actives:250,
    small_cap_gainers:200, aggressive_small_caps:150,
    undervalued_growth_stocks:150, undervalued_large_caps:120,
    growth_technology_stocks:150,
  });

  let results = deduped.map(normalise).filter(Boolean);
  results = await enrichWithSectorIndustry(results);

  const sectorSet = sectors ? new Set(sectors.split(",").map(s => s.trim())) : null;
  const indSet    = industries ? new Set(industries.split(",").map(s => s.trim())) : null;
  const mc        = +minMcap, p1 = +minPrice, p2 = +maxPrice;
  const vc        = +minVol, rv = +minRelVol;
  const ch1 = +minChange, ch2 = +maxChange;

  results = results.filter(t =>
    t.price  >= p1 && t.price  <= p2 &&
    (!mc || (t.marketCap && t.marketCap >= mc)) &&
    t.volume >= vc && t.relVol >= rv &&
    t.change >= ch1 && t.change <= ch2 &&
    (!sectorSet?.size || sectorSet.has(t.sector)) &&
    (!indSet?.size    || indSet.has(t.industry))
  );

  const sortFn = {
    change:    (a,b) => (b.change||0)    - (a.change||0),
    volume:    (a,b) => (b.volume||0)    - (a.volume||0),
    relVol:    (a,b) => (b.relVol||0)    - (a.relVol||0),
    marketCap: (a,b) => (b.marketCap||0) - (a.marketCap||0),
  };
  results = results.sort(sortFn[sortBy] || sortFn.change).slice(0, +limit);

  cache.set(ck, results);
  res.json({ results, cached: false, total: results.length });
});

// ── GET /api/scan/symbols?symbols=AAPL,NVDA — fetch specific symbols ──────────
scannerRouter.get("/api/scan/symbols", async (req, res) => {
  const symbols = (req.query.symbols || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: "symbols required" });

  const results = [];
  await Promise.allSettled(symbols.map(async sym => {
    const q = await safeQuote(sym);
    if (q) {
      const t = normalise(q);
      if (t) results.push(t);
    }
  }));
  let enriched = await enrichWithSectorIndustry(results);
  res.json({ results: enriched });
});

// ── GET /api/scan/full — full universe scan (cached) ─────────────────────────
scannerRouter.get("/api/scan/full", async (req, res) => {
  const { minPrice=1, minMcap=0, minVol=0, minChange=2, maxChange=100,
          limit=300, sortBy="change", sectors="" } = req.query;

  const s = universeStatus();
  if (!s.loaded) return res.status(503).json({ error: "Universe not loaded yet", loading: true });

  const ck  = `scan-full:${minPrice}:${minMcap}:${minVol}:${minChange}:${maxChange}:${sortBy}:${sectors}`;
  const hit = cache.get(ck, 5 * 60_000);
  if (hit) return res.json({ ...hit, cached: true });

  const allSyms = [...universe.keys()];
  const results = [];
  const sectorSet = sectors ? new Set(sectors.split(",").map(s => s.trim())) : null;
  const BATCH_SIZE = 50;

  for (let i = 0; i < allSyms.length; i += BATCH_SIZE) {
    const batch   = allSyms.slice(i, i + BATCH_SIZE);
    const quotes  = await Promise.allSettled(batch.map(safeQuote));
    for (let j = 0; j < batch.length; j++) {
      const q = quotes[j].value;
      if (!q?.regularMarketPrice) continue;
      if (q.regularMarketPrice < +minPrice) continue;
      if (+minVol && (q.regularMarketVolume||0) < +minVol) continue;
      if (+minMcap && q.marketCap && q.marketCap < +minMcap) continue;
      const chg = q.regularMarketChangePercent ?? 0;
      if (chg < +minChange || chg > +maxChange) continue;
      if (sectorSet?.size && !sectorSet.has(q.sector)) continue;
      const t = normalise(q);
      if (t) results.push(t);
    }
    if (i % 500 === 0 && i > 0) log.step(`full scan: ${i}/${allSyms.length} scanned, ${results.length} passed`);
  }

  const sortFns = {
    change:    (a,b) => Math.abs(b.change||0) - Math.abs(a.change||0),
    volume:    (a,b) => (b.volume||0)  - (a.volume||0),
    relVol:    (a,b) => (b.relVol||0)  - (a.relVol||0),
    marketCap: (a,b) => (b.marketCap||0)-(a.marketCap||0),
  };
  const sorted = results.sort(sortFns[sortBy] || sortFns.change).slice(0, +limit);
  const out = { results: sorted, total: results.length, processed: allSyms.length, ts: new Date() };
  cache.set(ck, out);
  res.json(out);
});

// ── GET /api/scan/full/stream — SSE streaming universe scan ──────────────────
scannerRouter.get("/api/scan/full/stream", async (req, res) => {
  const { minPrice=1, minChange=2, minVol=100000, minMcap=0, maxChange=100 } = req.query;
  const s = universeStatus();
  if (!s.loaded) {
    res.write(`data: ${JSON.stringify({ error: "Universe not loaded", loading: true })}\n\n`);
    return res.end();
  }

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();

  const allSyms = [...universe.keys()];
  const BATCH_SIZE = 40;
  let passed = 0;

  for (let i = 0; i < allSyms.length; i += BATCH_SIZE) {
    if (res.destroyed) break;
    const batch  = allSyms.slice(i, i + BATCH_SIZE);
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
      const t = normalise(q);
      if (t) chunk.push(t);
    }
    if (chunk.length) {
      passed += chunk.length;
      res.write(`data: ${JSON.stringify({ batch: chunk, progress: i + BATCH_SIZE, total: allSyms.length, passed })}\n\n`);
    }
  }
  res.write(`data: ${JSON.stringify({ done: true, total: allSyms.length, passed })}\n\n`);
  res.end();
});

// ── GET /api/scan/shorted — Most Shorted Stocks ───────────────────────────────
scannerRouter.get("/api/scan/shorted", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 150, 250);
  const ck    = `shorted:${limit}`;
  const hit   = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });

  try {
    // Yahoo screener ID for most-shorted
    let raw = await runScreen("most_shorted_stocks", limit + 50);

    // Supplement with custom high-short-interest tickers if screener returns few
    if (raw.length < 20) {
      const supplements = await Promise.allSettled([
        runScreen("day_gainers",  80),
        runScreen("most_actives", 80),
      ]);
      const extra = supplements.flatMap(r => r.value || []);
      const seen  = new Set(raw.map(q => q.symbol));
      raw = [...raw, ...extra.filter(q => !seen.has(q.symbol))];
    }

    let results = raw.map(normalise).filter(Boolean);
    results = await enrichWithSectorIndustry(results);

    // Enrich with short interest data via quoteSummary
    const { yf, withTimeout } = await import("../data/yahoo.js");
    const BATCH = 8;
    for (let i = 0; i < Math.min(results.length, 80); i += BATCH) {
      const batch = results.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(async t => {
        const ck2 = `si_short:${t.symbol}`;
        let si = cache.get(ck2, 6 * 3600_000);
        if (!si) {
          try {
            const r  = await withTimeout(
              yf.quoteSummary(t.symbol, { modules: ["defaultKeyStatistics"] }), 10_000
            );
            const dk = r?.defaultKeyStatistics;
            si = {
              shortPct:   dk?.shortPercentOfFloat != null ? +(dk.shortPercentOfFloat * 100).toFixed(1) : null,
              shortRatio: dk?.shortRatio           != null ? +dk.shortRatio.toFixed(2) : null,
              floatShares:dk?.floatShares           ?? null,
            };
            cache.set(ck2, si);
          } catch { si = {}; }
        }
        t.shortPct   = si.shortPct   ?? null;
        t.shortRatio = si.shortRatio ?? null;
        t.floatShares= si.floatShares?? null;
      }));
    }

    // Sort: highest short% first
    results = results
      .filter(t => t.shortPct != null || t.symbol)
      .sort((a,b) => (b.shortPct||0) - (a.shortPct||0))
      .slice(0, limit);

    cache.set(ck, results);
    res.json({ results, cached: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/scan/52wkhigh — Recent 52-Week Highs ──────────────────────────
scannerRouter.get("/api/scan/52wkhigh", async (req, res) => {
  const { minPrice = 1, limit = 150 } = req.query;
  const ck  = `52wkhigh:${minPrice}:${limit}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ results: hit, cached: true });

  try {
    // Yahoo screener ID for 52-week highs
    let raw = await runScreen("recent_52_week_highs", +limit + 50);

    // Supplement with momentum + gainers if sparse
    if (raw.length < 20) {
      const supp = await Promise.allSettled([
        runScreen("undervalued_large_caps",   80),
        runScreen("growth_technology_stocks", 80),
        runScreen("day_gainers",              80),
      ]);
      const extra = supp.flatMap(r => r.value || []);
      const seen  = new Set(raw.map(q => q.symbol));
      raw = [...raw, ...extra.filter(q => !seen.has(q.symbol))];
    }

    let results = raw.map(normalise).filter(Boolean);
    results = results.filter(t => (t.price || 0) >= +minPrice);
    results = await enrichWithSectorIndustry(results);

    // Calculate distance from 52W high
    results = results.map(t => ({
      ...t,
      hi52Pct: t.hi52 && t.price ? +(t.price / t.hi52 * 100).toFixed(1) : null,
      lo52Pct: t.lo52 && t.price ? +(t.price / t.lo52 * 100).toFixed(1) : null,
      fromHi52: t.hi52 && t.price ? +((t.price - t.hi52) / t.hi52 * 100).toFixed(1) : null,
    }));

    // Sort: closest to 52W high first (highest hi52Pct)
    results = results
      .sort((a, b) => (b.hi52Pct || 0) - (a.hi52Pct || 0))
      .slice(0, +limit);

    cache.set(ck, results);
    res.json({ results, cached: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
