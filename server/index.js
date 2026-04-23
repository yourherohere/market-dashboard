// server/index.js — Main Express application
import "dotenv/config";
import express     from "express";
import cors        from "cors";
import compression from "compression";
import helmet      from "helmet";
import path        from "path";
import { fileURLToPath } from "url";

import { PORT, RATE_LIMIT }    from "./config.js";

// Simple in-process rate limiter (no external dep required)
const rateLimits = new Map();
function rateLimit({ windowMs, max, keyFn }) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip;
    const now = Date.now();
    const entry = rateLimits.get(key) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
    entry.count++;
    rateLimits.set(key, entry);
    if (entry.count > max) {
      return res.status(429).json({
        error: "Too many requests",
        retryAfter: Math.ceil((entry.reset - now) / 1000),
      });
    }
    next();
  };
}
import { log }     from "./logger.js";
import { db, runMigrations } from "./db/index.js";
import { loadSICache, flushSICache } from "./data/enrichment.js";
import { loadUniverse, scheduleUniverseRefresh } from "./data/universe.js";
import { startScheduler } from "./jobs/scheduler.js";
import { cache }   from "./cache.js";
import { SCREEN_POOLS } from "./config.js";
import { runScreen } from "./data/yahoo.js";

// ── Route modules ─────────────────────────────────────────────────────────────
import { healthRouter }    from "./routes/health.js";
import { quotesRouter }    from "./routes/quotes.js";
import { scannerRouter }   from "./routes/scanner.js";
import { rrgRouter }       from "./routes/rrg.js";
import { premarketRouter } from "./routes/premarket.js";
import { newsRouter }      from "./routes/news.js";
import { sectorsRouter }   from "./routes/sectors.js";
import { themesRouter }    from "./routes/themes.js";
import { analyticsRouter } from "./routes/analytics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // allow Vite HMR
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

// Request logger
app.use((req, _, next) => {
  log.debug(`${req.method} ${req.url}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use(healthRouter);
app.use(quotesRouter);
app.use(scannerRouter);
app.use(rrgRouter);
app.use(premarketRouter);
app.use(newsRouter);
app.use(sectorsRouter);
app.use(themesRouter);
// Rate limit expensive endpoints — 30 req/min per IP
const scanLimit = rateLimit({ windowMs: 60_000, max: 30 });
app.use("/api/scan",        scanLimit);
app.use("/api/analytics",   rateLimit({ windowMs: 60_000, max: 60 }));
app.use("/api/bootstrap",   rateLimit({ windowMs: 60_000, max: 5 }));

app.use(analyticsRouter);

// ── Static frontend in production ─────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  const distDir = path.join(__dirname, "../dist");
  app.use(express.static(distDir));
  app.get("*", (_, res) => res.sendFile(path.join(distDir, "index.html")));
}

// ── Cache stats endpoint ──────────────────────────────────────────────────────
app.get("/api/cache/stats", (_, res) => {
  res.json({ size: cache.size(), keys: cache.keys().slice(0, 50) });
});
app.delete("/api/cache", (_, res) => {
  cache.clear();
  res.json({ ok: true, message: "Cache cleared" });
});

// Invalidate specific cache namespaces
app.delete("/api/cache/:namespace", (req, res) => {
  const ns = req.params.namespace;
  const keys = cache.keys().filter(k => k.startsWith(ns));
  keys.forEach(k => cache.del(k));
  res.json({ ok: true, cleared: keys.length, namespace: ns });
});

// ── 404 / Error handlers ─────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: `Unknown route: ${req.url}` }));
app.use((err, _, res, __) => {
  log.error(err.message);
  res.status(500).json({ error: err.message });
});

// ── Startup sequence ──────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log("\n" + "═".repeat(62));
  console.log("  🚀  Market Dashboard API v2.0");
  console.log(`  📡  http://localhost:${PORT}/api/health`);
  console.log("═".repeat(62) + "\n");

  // 1. DB migrations (synchronous, must complete before anything else)
  runMigrations();

  // 2. Load SI cache from DB (zero-network, instant)
  loadSICache();

  // 3. Load universe (async — screener works without it)
  loadUniverse().catch(e => log.warn(`Universe load: ${e.message}`));
  scheduleUniverseRefresh();

  // 3b. After universe loads, fill missing sector/industry in DB (background)
  setTimeout(async () => {
    try {
      const missing = db.prepare(
        "SELECT COUNT(*) n FROM universe WHERE is_active=1 AND sector IS NULL"
      ).get()?.n ?? 0;
      if (missing > 0) {
        log.info(`${missing} symbols missing sector — starting background enrichment…`);
        const { enrichSectorIndustryDB, computeEtfRS } = await import("./jobs/enrich-sectors.js");
        await enrichSectorIndustryDB({ batchSize: 40 });
        await computeEtfRS();
      } else {
        log.ok("All symbols have sector data ✓");
        // Still refresh RS vs ETF if needed
        const missingRS = db.prepare(
          "SELECT COUNT(*) n FROM eod_returns WHERE sector_etf IS NOT NULL AND rs_vs_sector IS NULL"
        ).get()?.n ?? 0;
        if (missingRS > 0) {
          const { computeEtfRS } = await import("./jobs/enrich-sectors.js");
          computeEtfRS().catch(() => {});
        }
      }
    } catch(e) { log.warn(`Background enrichment: ${e.message}`); }
  }, 15_000); // 15s delay to let universe finish loading first

  // 4. Start cron scheduler (EOD, universe refresh, SI flush)
  startScheduler();

  // 5. Warm screener cache — pulls all pools in parallel so first
  //    user request hits cache, not cold Yahoo calls
  log.info("Warming screener cache…");
  try {
    const warmResults = await Promise.allSettled(
      SCREEN_POOLS.map(id => runScreen(id, 200))
    );
    const total = warmResults.reduce((n, r) => n + (r.value?.length || 0), 0);
    log.ok(`Screener warmed: ${total} quotes, SI cache: ${
      [...(await import("./data/enrichment.js").then(m => m.siCache))].length
    } sectors cached`);
  } catch(e) {
    log.warn(`Screener warm failed: ${e.message}`);
  }

  log.ok("Server ready ✓\n");
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const shutdown = (signal) => {
  log.info(`${signal} received — flushing caches and closing DB…`);
  flushSICache();
  db.close();
  process.exit(0);
};
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
