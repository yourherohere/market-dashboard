// server/routes/quotes.js
import { Router }  from "express";
import { cache }   from "../cache.js";
import { CACHE, BATCH } from "../config.js";
import { safeQuote, safeChart, normalise } from "../data/yahoo.js";
import { enrichWithSectorIndustry } from "../data/enrichment.js";
import { getEODEnrichedTicker } from "../data/eod.js";
import { retQ } from "../db/index.js";

export const quotesRouter = Router();

// ── GET /api/quotes?symbols=AAPL,MSFT ────────────────────────────────────────
quotesRouter.get("/api/quotes", async (req, res) => {
  const symbols = (req.query.symbols || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: "No symbols" });

  const ck  = `q:${[...symbols].sort().join(",")}`;
  const hit = cache.get(ck, CACHE.QUOTE);
  if (hit) return res.json({ data: hit, cached: true });

  const data = {};
  for (let i = 0; i < symbols.length; i += BATCH.QUOTE) {
    const batch   = symbols.slice(i, i + BATCH.QUOTE);
    const results = await Promise.allSettled(batch.map(safeQuote));
    batch.forEach((sym, j) => {
      const v = results[j].value;
      if (v?.regularMarketPrice) {
        data[sym] = {
          symbol:                    v.symbol,
          shortName:                 v.shortName || v.longName || sym,
          regularMarketPrice:        v.regularMarketPrice,
          regularMarketChangePercent:v.regularMarketChangePercent ?? 0,
          regularMarketChange:       v.regularMarketChange ?? 0,
          regularMarketVolume:       v.regularMarketVolume ?? 0,
          averageDailyVolume10Day:   v.averageDailyVolume10Day ?? 0,
          marketCap:                 v.marketCap ?? null,
          fiftyDayAverage:           v.fiftyDayAverage ?? null,
          twoHundredDayAverage:      v.twoHundredDayAverage ?? null,
          fiftyTwoWeekHigh:          v.fiftyTwoWeekHigh ?? null,
          fiftyTwoWeekLow:           v.fiftyTwoWeekLow  ?? null,
          sector:                    v.sector   || null,
          industry:                  v.industry || null,
          trailingPE:                v.trailingPE ?? null,
          preMarketChangePercent:    v.preMarketChangePercent ?? null,
          preMarketPrice:            v.preMarketPrice ?? null,
        };
      }
    });
  }
  cache.set(ck, data);
  res.json({ data, cached: false });
});

// ── GET /api/charts?symbols=AAPL,SPY&range=1y ────────────────────────────────
quotesRouter.get("/api/charts", async (req, res) => {
  const symbols = (req.query.symbols || "").split(",").map(s => s.trim()).filter(Boolean);
  const range   = req.query.range || "1y";
  const DAYS    = { "1d":2,"1w":10,"1m":35,"3m":95,"6m":190,"1y":270,"2y":540 };
  const days    = DAYS[range] || 270;
  if (!symbols.length) return res.status(400).json({ error: "No symbols" });

  const ck  = `charts:${[...symbols].sort().join(",")}:${range}`;
  const hit = cache.get(ck, CACHE.CHART);
  if (hit) return res.json({ data: hit, cached: true });

  const data = {};
  for (let i = 0; i < symbols.length; i += BATCH.CHART) {
    const batch   = symbols.slice(i, i + BATCH.CHART);
    const results = await Promise.allSettled(batch.map(s => safeChart(s, days)));
    batch.forEach((sym, j) => { if (results[j].value) data[sym] = results[j].value; });
  }
  cache.set(ck, data);
  res.json({ data, cached: false });
});

// ── GET /api/sector-info?symbols=AAPL,MSFT ───────────────────────────────────
quotesRouter.get("/api/sector-info", async (req, res) => {
  const symbols = (req.query.symbols || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!symbols.length) return res.status(400).json({ error: "No symbols" });
  const stubs  = symbols.map(sym => ({ symbol: sym, sector: null, industry: null }));
  const filled = await enrichWithSectorIndustry(stubs);
  const data   = {};
  filled.forEach(t => { data[t.symbol] = { sector: t.sector, industry: t.industry }; });
  res.json({ data });
});

// ── GET /api/eod/returns/:symbol — DB-backed historical returns ───────────────
quotesRouter.get("/api/eod/returns/:symbol", (req, res) => {
  const sym = req.params.symbol?.toUpperCase();
  if (!sym) return res.status(400).json({ error: "symbol required" });
  const r = getEODEnrichedTicker(sym);
  if (!r) return res.status(404).json({ error: `No EOD data for ${sym}` });
  res.json(r);
});

// ── GET /api/search?q=nvid&limit=8 ───────────────────────────────────────────
quotesRouter.get("/api/search", async (req, res) => {
  const q   = (req.query.q || "").trim().toUpperCase();
  const lim = Math.min(parseInt(req.query.limit) || 8, 20);
  if (!q) return res.json({ results: [] });

  const ck  = `search:${q}:${lim}`;
  const hit = cache.get(ck, 30_000);
  if (hit) return res.json({ results: hit, cached: true });

  try {
    // Use Yahoo search (quoteSummary returns by prefix)
    const syms  = [q, q+"A", q+"B"].filter((_, i) => i === 0 || q.length > 2);
    const results = [];
    const seen  = new Set();
    await Promise.allSettled(syms.map(async sym => {
      const quote = await safeQuote(sym);
      if (!quote?.regularMarketPrice || seen.has(quote.symbol)) return;
      seen.add(quote.symbol);
      results.push(normalise(quote));
    }));
    cache.set(ck, results);
    res.json({ results });
  } catch(e) {
    res.json({ results: [] });
  }
});
