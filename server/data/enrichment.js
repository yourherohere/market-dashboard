// server/data/enrichment.js — Sector/Industry enrichment with 3-tier lookup
import { CACHE, BATCH } from "../config.js";
import { cache }        from "../cache.js";
import { siQ }          from "../db/index.js";
import { yf, withTimeout, safeQuote } from "./yahoo.js";
import { log }          from "../logger.js";

// In-memory SI cache — loaded from DB on startup, updated live
// Map: symbol → { sector, industry, ts }
export const siCache = new Map();

/** Load DB sector cache into memory on server start */
export function loadSICache() {
  try {
    const rows = siQ.loadAll();
    for (const [sym, d] of rows) {
      siCache.set(sym, { ...d, ts: Date.now() - CACHE.SI / 2 }); // half-age so DB rows are used
    }
    log.ok(`SI cache loaded: ${siCache.size} symbols from DB`);
  } catch(e) {
    log.warn(`SI cache load failed: ${e.message}`);
  }
}

/** Persist current in-memory SI cache to DB (called periodically) */
export function flushSICache() {
  try {
    const rows = [];
    for (const [symbol, d] of siCache) {
      if (d.sector) rows.push({ symbol, sector: d.sector, industry: d.industry || null });
    }
    if (rows.length) siQ.bulkSet(rows);
    log.debug(`SI cache flushed: ${rows.length} rows → DB`);
  } catch(e) {
    log.warn(`SI cache flush failed: ${e.message}`);
  }
}

/** Main enrichment function — fills sector/industry on a ticker array */
export async function enrichWithSectorIndustry(tickers) {
  const missing = tickers.filter(t => !t.sector || !t.industry);
  if (!missing.length) return tickers;

  // Tier 1: in-memory siCache (zero network cost)
  const needFetch = [];
  for (const t of missing) {
    const c = siCache.get(t.symbol);
    if (c && Date.now() - c.ts < CACHE.SI) {
      t.sector   = t.sector   || c.sector;
      t.industry = t.industry || c.industry;
    } else {
      needFetch.push(t);
    }
  }

  if (!needFetch.length) return tickers;

  // Tier 2: batch yf.quote() — 3 groups of BATCH.ENRICH symbols in parallel
  const G = 3; // parallel groups
  const B = BATCH.ENRICH;
  log.step(`Enriching ${needFetch.length} tickers (batch quote, ${Math.ceil(needFetch.length/B)} batches)…`);

  for (let i = 0; i < needFetch.length; i += B * G) {
    const groups = [];
    for (let g = 0; g < G; g++) {
      const slice = needFetch.slice(i + g * B, i + (g + 1) * B);
      if (!slice.length) break;
      groups.push(
        Promise.allSettled(slice.map(t =>
          safeQuote(t.symbol).then(q => ({ sym: t.symbol, q }))
        ))
      );
    }
    const settled = await Promise.allSettled(groups);
    for (const grpRes of settled) {
      if (grpRes.status !== "fulfilled") continue;
      for (const r of grpRes.value) {
        if (r.status !== "fulfilled") continue;
        const { sym, q } = r.value;
        if (q?.sector) {
          const d = { sector: q.sector, industry: q.industry || null, ts: Date.now() };
          siCache.set(sym, d);
          // Immediate DB write (fire-and-forget)
          try { siQ.set(sym, q.sector, q.industry || null); } catch {}
        } else {
          // Cache null to prevent repeated retries this session
          siCache.set(sym, { sector: null, industry: null, ts: Date.now() });
        }
      }
    }
  }

  // Tier 3: quoteSummary fallback for tickers still missing sector
  const tier3 = needFetch.filter(t => !siCache.get(t.symbol)?.sector);
  if (tier3.length > 0) {
    log.step(`quoteSummary fallback for ${tier3.length} tickers…`);
    const T3B = 5;
    for (let i = 0; i < tier3.length; i += T3B) {
      await Promise.allSettled(tier3.slice(i, i + T3B).map(async t => {
        try {
          const s  = await withTimeout(yf.quoteSummary(t.symbol, { modules: ["assetProfile"] }), 10_000);
          const ap = s?.assetProfile;
          const d  = { sector: ap?.sector || null, industry: ap?.industry || null, ts: Date.now() };
          siCache.set(t.symbol, d);
          siQ.set(t.symbol, d.sector, d.industry);
        } catch {
          siCache.set(t.symbol, { sector: null, industry: null, ts: Date.now() });
        }
      }));
    }
  }

  // Apply resolved data
  return tickers.map(t => {
    if (t.sector && t.industry) return t;
    const d = siCache.get(t.symbol) || {};
    return { ...t, sector: t.sector || d.sector || null, industry: t.industry || d.industry || null };
  });
}
