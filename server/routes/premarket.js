// server/routes/premarket.js
import { Router } from "express";
import { cache }  from "../cache.js";
import { CACHE }  from "../config.js";
import { safeQuote, safeChart, normalise } from "../data/yahoo.js";
import { enrichWithSectorIndustry } from "../data/enrichment.js";
import { runScreen } from "../data/yahoo.js";
import { yf, withTimeout } from "../data/yahoo.js";
import { log } from "../logger.js";

export const premarketRouter = Router();

premarketRouter.get("/api/premarket", async (req, res) => {
  const minPMPct = parseFloat(req.query.minPMPct) || 2;
  const limit    = Math.min(parseInt(req.query.limit) || 30, 60);
  const ck = `premarket:${minPMPct}:${limit}`;
  const hit = cache.get(ck, 90_000);
  if (hit) return res.json({ ...hit, cached: true });

  log.info(`/api/premarket ≥${minPMPct}%`);
  try {
    const pools = await Promise.allSettled([
      runScreen("day_gainers",   200),
      runScreen("most_actives",  200),
      runScreen("small_cap_gainers", 150),
      runScreen("growth_technology_stocks", 100),
      runScreen("aggressive_small_caps", 100),
    ]);
    const seen = new Set();
    const candidates = pools.flatMap(r => r.value || [])
      .filter(q => { if (!q?.symbol || seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });

    // Fresh quotes for PM fields
    const BATCH = 15;
    const freshQuotes = {};
    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch   = candidates.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(q => safeQuote(q.symbol)));
      batch.forEach((q, j) => { if (results[j].value) freshQuotes[q.symbol] = results[j].value; });
    }

    const pmRows = Object.values(freshQuotes).map(q => {
      const pmPct   = q.preMarketChangePercent ?? q.postMarketChangePercent ?? 0;
      const pmVol   = q.preMarketVolume ?? 0;
      const pmPrice = q.preMarketPrice  ?? q.postMarketPrice ?? q.regularMarketPrice ?? 0;
      const avg10   = q.averageDailyVolume10Day || 1;
      return {
        symbol: q.symbol,
        name:   (q.shortName || q.longName || q.symbol).substring(0, 28),
        price:  q.regularMarketPrice ?? 0,
        pmPrice, pmPct: +pmPct.toFixed(2),
        pmVol,  pmRVol:    pmVol > 0 ? +(pmVol / (avg10 / 6.5)).toFixed(2) : 0,
        pmDolVol: +(pmPrice * pmVol / 1e6).toFixed(2),
        change:  q.regularMarketChangePercent ?? 0,
        volume:  q.regularMarketVolume ?? 0,
        avgVol10: avg10,
        relVol:  avg10 > 0 ? +((q.regularMarketVolume||0)/avg10).toFixed(2) : 0,
        avgDolVol: +((q.regularMarketPrice||0) * avg10 / 1e6).toFixed(1),
        marketCap: q.marketCap ?? null,
        sector:   q.sector   || null,
        industry: q.industry || null,
        float:    null, shortPct: null, adrPct: null,
        above50:  q.fiftyDayAverage       ? (q.regularMarketPrice??0) > q.fiftyDayAverage       : null,
        above200: q.twoHundredDayAverage  ? (q.regularMarketPrice??0) > q.twoHundredDayAverage  : null,
        _raw: q,
      };
    }).filter(r => Math.abs(r.pmPct) >= minPMPct)
      .sort((a, b) => b.pmPct - a.pmPct)
      .slice(0, limit + 10);

    if (!pmRows.length) return res.json({ results: [], ts: new Date() });

    // Enrich sector/industry
    let enriched = await enrichWithSectorIndustry(
      pmRows.map(r => ({ symbol: r.symbol, sector: r.sector, industry: r.industry }))
    );
    enriched.forEach((e, i) => { pmRows[i].sector = e.sector; pmRows[i].industry = e.industry; });

    // Float + short interest via quoteSummary (cached 24h)
    const C = 5;
    for (let i = 0; i < pmRows.length; i += C) {
      const batch = pmRows.slice(i, i + C);
      await Promise.allSettled(batch.map(async row => {
        const ck2 = `qs:${row.symbol}`;
        let qs = cache.get(ck2, CACHE.SI);
        if (!qs) {
          try {
            const r = await withTimeout(
              yf.quoteSummary(row.symbol, { modules: ["defaultKeyStatistics"] }), 12_000
            );
            qs = {
              floatShares:     r?.defaultKeyStatistics?.floatShares ?? null,
              shortPctOfFloat: r?.defaultKeyStatistics?.shortPercentOfFloat ?? null,
            };
            cache.set(ck2, qs);
          } catch { qs = {}; }
        }
        row.float    = qs.floatShares ?? null;
        row.shortPct = qs.shortPctOfFloat ? +(qs.shortPctOfFloat * 100).toFixed(2) : null;
      }));
    }

    // ADR% from 14-day chart
    for (let i = 0; i < pmRows.length; i += C) {
      const batch = pmRows.slice(i, i + C);
      await Promise.allSettled(batch.map(async row => {
        const cd = await safeChart(row.symbol, 20);
        if (!cd.closes.length) return;
        const n = Math.min(14, cd.closes.length);
        const ranges = cd.highs.slice(-n).map((h, i2) => {
          const l = cd.lows.slice(-n)[i2], c = cd.closes.slice(-n)[i2];
          return c > 0 ? (h - l) / c * 100 : 0;
        });
        row.adrPct = +(ranges.reduce((a,b)=>a+b,0) / ranges.length).toFixed(2);
      }));
    }

    const detectCategory = (row) => {
      if (row._raw.earningsTimestamp &&
          Math.abs(row._raw.earningsTimestamp * 1000 - Date.now()) < 7 * 86400_000)
        return "Earnings";
      if (Math.abs(row.pmPct) > 15 && row.shortPct && row.shortPct > 15) return "Short Squeeze";
      if (row.pmPct > 10) return "News / Catalyst";
      if (row.pmPct > 5)  return "Industry Move";
      return "Pre-Market Move";
    };

    const results = pmRows.slice(0, limit).map(row => ({ ...row, _raw: undefined, category: detectCategory(row) }));
    const out = { results, ts: new Date(), count: results.length };
    cache.set(ck, out);
    log.ok(`premarket: ${results.length} stocks ≥${minPMPct}%`);
    res.json(out);
  } catch(e) { log.error(e.message); res.status(500).json({ error: e.message }); }
});
