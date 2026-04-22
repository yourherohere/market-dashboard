// server/routes/health.js
import { Router } from "express";
import { cache }  from "../cache.js";
import { db, eodQ, retQ, eodLogQ, bootQ, spyQ } from "../db/index.js";
import { universe, universeStatus, loadUniverse } from "../data/universe.js";
import { runEODCollection } from "../data/eod.js";
import { bootstrapState, runHistoricalBootstrap } from "../jobs/bootstrap.js";
import { log } from "../logger.js";

export const healthRouter = Router();

// GET /api/health
healthRouter.get("/api/health", (_req, res) => {
  res.json({
    ok:         true,
    ts:         new Date().toISOString(),
    cache_size: cache.size(),
    universe:   universeStatus(),
    eod: {
      symbols:  eodQ.countSymbols(),
      rows:     eodQ.countRows(),
      returns:  retQ.count(),
    },
    recent_eod: eodLogQ.recent(3),
  });
});

// GET /api/universe
healthRouter.get("/api/universe", (req, res) => {
  const s           = universeStatus();
  const withSymbols = req.query.symbols === "1";
  res.json({
    ...s,
    symbols: withSymbols && s.loaded
      ? [...universe.entries()].map(([sym, d]) => ({
          symbol:   sym,
          name:     d.name,
          exchange: d.exchange,
          sector:   d.sector   || null,
          industry: d.industry || null,
        }))
      : undefined,
  });
});

// POST /api/eod/collect
healthRouter.post("/api/eod/collect", (req, res) => {
  const { force = false, symbols = null } = req.body || {};
  log.info("Manual EOD collect (force=" + force + ")");
  runEODCollection({ force, symbols }).catch(e => log.error(e.message));
  res.json({ ok: true, message: "EOD collection started" });
});

// POST /api/universe/reload
healthRouter.post("/api/universe/reload", (_req, res) => {
  loadUniverse(true).catch(e => log.warn(e.message));
  res.json({ ok: true, message: "Universe reload started" });
});

// GET /api/eod/log
healthRouter.get("/api/eod/log", (_req, res) => {
  res.json({ logs: eodLogQ.recent(20) });
});

// GET /api/bootstrap/status
healthRouter.get("/api/bootstrap/status", (_req, res) => {
  res.json({
    ...bootstrapState,
    db: {
      eod_rows:    eodQ.countRows(),
      eod_symbols: eodQ.countSymbols(),
      oldest_date: eodQ.oldestDate(),
      latest_date: eodQ.latestDate(),
      returns:     retQ.count(),
      spy_days:    spyQ.count(),
    },
    summary: bootQ.summary(),
  });
});

// POST /api/bootstrap/start
healthRouter.post("/api/bootstrap/start", (req, res) => {
  if (bootstrapState.running) {
    return res.json({ ok: false, message: "Already running", state: bootstrapState });
  }
  const { years = 2, retryOnly = false, reset = false } = req.body || {};
  runHistoricalBootstrap({ years, retryOnly, reset })
    .catch(e => log.error("Bootstrap: " + e.message));
  res.json({ ok: true, message: "Bootstrap started (" + years + "y)", state: bootstrapState });
});

// POST /api/bootstrap/stop
healthRouter.post("/api/bootstrap/stop", (_req, res) => {
  bootstrapState.running = false;
  res.json({ ok: true, message: "Bootstrap stop requested" });
});

// DELETE /api/cache
healthRouter.delete("/api/cache", (_req, res) => {
  cache.clear();
  res.json({ ok: true, message: "Cache cleared" });
});

// GET /api/cache/stats
healthRouter.get("/api/cache/stats", (_req, res) => {
  res.json({ size: cache.size(), keys: cache.keys().slice(0, 50) });
});

// POST /api/sectors/enrich — trigger sector/industry DB fill
healthRouter.post("/api/sectors/enrich", async (req, res) => {
  const { force = false } = req.body || {};
  const { enrichSectorIndustryDB, computeEtfRS } = await import("../jobs/enrich-sectors.js");
  log.info("Manual sector enrichment triggered");
  enrichSectorIndustryDB({ forceRefetch: force })
    .then(() => computeEtfRS())
    .catch(e => log.error("Enrichment: " + e.message));
  res.json({ ok: true, message: "Sector enrichment started" });
});

// GET /api/sectors/status — how many symbols have sector populated
healthRouter.get("/api/sectors/status", (_req, res) => {
  try {
    const total    = db.prepare("SELECT COUNT(*) n FROM universe WHERE is_active=1").get()?.n ?? 0;
    const withSec  = db.prepare("SELECT COUNT(*) n FROM universe WHERE sector IS NOT NULL AND is_active=1").get()?.n ?? 0;
    const withEtf  = db.prepare("SELECT COUNT(*) n FROM universe WHERE sector_etf IS NOT NULL AND is_active=1").get()?.n ?? 0;
    const inRet    = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE sector_etf IS NOT NULL").get()?.n ?? 0;
    const withRS   = db.prepare("SELECT COUNT(*) n FROM eod_returns WHERE rs_vs_sector IS NOT NULL").get()?.n ?? 0;
    res.json({ total, withSector: withSec, withEtf, inReturns: inRet, withRsVsEtf: withRS,
      sectorPct: total > 0 ? Math.round(withSec/total*100) : 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
