// server/jobs/scheduler.js — Cron-based scheduled jobs
import cron from "node-cron";
import { EOD_CRON } from "../config.js";
import { runEODCollection } from "../data/eod.js";
import { loadUniverse } from "../data/universe.js";
import { flushSICache } from "../data/enrichment.js";
import { enrichSectorIndustryDB, computeEtfRS } from "./enrich-sectors.js";
import { computeAnalytics } from "./compute-analytics.js";
import { log } from "../logger.js";

export function startScheduler() {
  // ── EOD + Enrichment + Analytics — weekdays 4:35 PM ET ────────────────────
  cron.schedule(EOD_CRON, async () => {
    log.info("⏰  EOD collection triggered");
    try {
      const eod = await runEODCollection();
      log.ok(`EOD done: ${eod.ok} ok, ${eod.err} err`);
      await enrichSectorIndustryDB({ forceRefetch: false });
      await computeEtfRS();
      await computeAnalytics({ maxEarnings: 400 });
      // Compute EMA touch/cross flags after analytics
      import("./compute-ema-touch.js").then(m =>
        m.computeEmaTouches().catch(e => log.error("ema-touch: " + e.message))
      );
    } catch(e) { log.error(`Scheduler: ${e.message}`); }
  }, { timezone: "America/New_York" });

  // ── Universe refresh — daily at 6:00 AM ET ───────────────────────────────
  cron.schedule("0 6 * * 1-5", async () => {
    log.info("⏰  Universe refresh triggered");
    try {
      await loadUniverse(true);
    } catch(e) {
      log.error(`Universe refresh failed: ${e.message}`);
    }
  }, { timezone: "America/New_York" });

  // ── Sector cache flush — every 30 minutes ────────────────────────────────
  cron.schedule("*/30 * * * *", () => {
    try { flushSICache(); } catch(e) { log.warn(`SI flush: ${e.message}`); }
  });

  log.ok("Scheduler started — EOD=" + EOD_CRON + " (America/New_York)");
}
