// server/config.js — Central configuration for all server modules
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT       = process.env.PORT       || 3001;
export const NODE_ENV   = process.env.NODE_ENV   || "development";
export const LOG_LEVEL  = process.env.LOG_LEVEL  || "info";

// Database
export const DB_PATH = process.env.DB_PATH
  || path.join(__dirname, "../data/market.db");

// Cache TTLs (milliseconds)
export const CACHE = {
  QUOTE:   90_000,       // 1.5 min  — live quotes
  SCAN:    60_000,       // 1 min    — screener results
  CHART:   120_000,      // 2 min    — intraday chart
  SI:      24*3600_000,  // 24 h     — sector/industry (rarely changes)
  EOD:     6*3600_000,   // 6 h      — EOD computed returns
  NEWS:    5*60_000,     // 5 min    — news feed
  AD:      30*60_000,    // 30 min   — advance/decline
};

// Yahoo Finance
export const YF_TIMEOUT  = 20_000;   // ms per request
export const YF_RETRY    = 2;        // retries on timeout

// Universe
export const UNIVERSE_EXCHANGES = new Set([
  "Nasdaq", "NYSE", "NYSE Arca", "NYSE American", "NASDAQ",
]);
export const UNIVERSE_REFRESH_MS = 24 * 3600_000;

// EOD collection schedule (cron) — weekdays 4:35 PM ET
export const EOD_CRON = "35 16 * * 1-5";

// Screener pools — portfolio_anchors removed (schema validation fail)
export const SCREEN_POOLS = [
  "day_gainers",
  "day_losers",
  "most_actives",
  "small_cap_gainers",
  "aggressive_small_caps",
  "growth_technology_stocks",
  "undervalued_growth_stocks",
  "undervalued_large_caps",
];

// Batch sizes
export const BATCH = {
  QUOTE:   50,  // symbols per quote batch
  CHART:   10,  // symbols per chart batch (heavy)
  ENRICH:  40,  // symbols per sector-enrichment batch
  EOD:     50,  // symbols per EOD fetch batch
};
