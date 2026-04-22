// server/db/index.js — SQLite connection + migrations + all query helpers
import Database from "better-sqlite3";
import path     from "path";
import fs       from "fs";
import { DB_PATH }                    from "../config.js";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema.js";
import { log }                        from "../logger.js";

// ── Connection ─────────────────────────────────────────────────────────────────
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("synchronous  = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("cache_size   = -65536");    // 64 MB page cache
db.pragma("temp_store   = MEMORY");
db.pragma("mmap_size    = 536870912"); // 512 MB mmap

// ── Migrations ─────────────────────────────────────────────────────────────────
export function runMigrations() {
  log.info("Running DB migrations...");
  for (const sql of MIGRATIONS) {
    try {
      const clean = sql.replace(/--[^\n]*/g, "").trim();
      if (clean) db.prepare(clean).run();
    } catch(e) {
      const msg = e.message || "";
      // Silently skip already-exists / duplicate-column — these are idempotent ALTERs
      const isIdempotent =
        msg.includes("already exists") ||
        msg.includes("duplicate column name") ||
        msg.includes("table") && msg.includes("already");
      if (!isIdempotent)
        log.warn("Migration: " + msg.substring(0, 120));
    }
  }
  try { db.prepare("INSERT OR REPLACE INTO schema_version(version) VALUES(?)").run(SCHEMA_VERSION); } catch {}
  const row = db.prepare("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").get();
  log.ok("DB ready — schema v" + (row?.version || 0) + " — " + DB_PATH);
}

// ── Universe queries ────────────────────────────────────────────────────────────
export const uniQ = {
  upsert: db.transaction((rows) => {
    const ins = db.prepare("INSERT OR REPLACE INTO universe (symbol,name,exchange,sector,industry,updated_at) VALUES (@symbol,@name,@exchange,@sector,@industry,datetime('now'))");
    for (const r of rows) ins.run(r);
  }),
  count:        ()    => db.prepare("SELECT COUNT(*) n FROM universe WHERE is_active=1").get()?.n ?? 0,
  all:          ()    => db.prepare("SELECT * FROM universe WHERE is_active=1 ORDER BY symbol").all(),
  allSymbols:   ()    => db.prepare("SELECT symbol FROM universe WHERE is_active=1").all().map(r=>r.symbol),
  get:          (sym) => db.prepare("SELECT * FROM universe WHERE symbol=?").get(sym),
  bySector:     (s)   => db.prepare("SELECT * FROM universe WHERE sector=? AND is_active=1").all(s),
  byExchange:   (ex)  => db.prepare("SELECT * FROM universe WHERE exchange=? AND is_active=1").all(ex),
  updateSector: (sym,sector,industry) => db.prepare("UPDATE universe SET sector=?,industry=?,updated_at=datetime('now') WHERE symbol=?").run(sector,industry,sym),
};

// ── EOD price queries ────────────────────────────────────────────────────────────
export const eodQ = {
  upsert: db.transaction((rows) => {
    const ins = db.prepare("INSERT OR REPLACE INTO eod_prices (symbol,date,open,high,low,close,adj_close,volume) VALUES (@symbol,@date,@open,@high,@low,@close,@adj_close,@volume)");
    for (const r of rows) ins.run(r);
  }),
  closes:         (sym,n=520)  => db.prepare("SELECT date,close,high,low,open,volume FROM eod_prices WHERE symbol=? ORDER BY date DESC LIMIT ?").all(sym,n).reverse(),
  closeBefore:    (sym,date)   => db.prepare("SELECT close FROM eod_prices WHERE symbol=? AND date<=? ORDER BY date DESC LIMIT 1").get(sym,date)?.close ?? null,
  dayCount:       (sym)        => db.prepare("SELECT COUNT(*) n FROM eod_prices WHERE symbol=?").get(sym)?.n ?? 0,
  lastDate:       (sym)        => db.prepare("SELECT date FROM eod_prices WHERE symbol=? ORDER BY date DESC LIMIT 1").get(sym)?.date ?? null,
  firstDate:      (sym)        => db.prepare("SELECT date FROM eod_prices WHERE symbol=? ORDER BY date ASC LIMIT 1").get(sym)?.date ?? null,
  allOnDate:      (date)       => db.prepare("SELECT symbol,close,volume FROM eod_prices WHERE date=?").all(date),
  range:          (sym,f,t)    => db.prepare("SELECT date,close,high,low,open,volume FROM eod_prices WHERE symbol=? AND date>=? AND date<=? ORDER BY date ASC").all(sym,f,t),
  countSymbols:   ()           => db.prepare("SELECT COUNT(DISTINCT symbol) n FROM eod_prices").get()?.n ?? 0,
  countRows:      ()           => db.prepare("SELECT COUNT(*) n FROM eod_prices").get()?.n ?? 0,
  oldestDate:     ()           => db.prepare("SELECT MIN(date) d FROM eod_prices").get()?.d ?? null,
  latestDate:     ()           => db.prepare("SELECT MAX(date) d FROM eod_prices").get()?.d ?? null,
  symbolsWithMinDays: (n)      => db.prepare("SELECT symbol FROM eod_prices GROUP BY symbol HAVING COUNT(*)>=? ORDER BY symbol").all(n).map(r=>r.symbol),
  symbolsMissingAfter: (date)  => db.prepare("SELECT DISTINCT u.symbol FROM universe u LEFT JOIN eod_prices p ON u.symbol=p.symbol AND p.date>=? WHERE u.is_active=1 AND p.symbol IS NULL").all(date).map(r=>r.symbol),
};

// ── SPY queries ──────────────────────────────────────────────────────────────────
export const spyQ = {
  upsert: db.transaction((rows) => {
    const ins = db.prepare("INSERT OR REPLACE INTO spy_prices(date,close,adj_close) VALUES(@date,@close,@adj_close)");
    for (const r of rows) ins.run(r);
  }),
  closes:  (n=520) => db.prepare("SELECT date,close FROM spy_prices ORDER BY date DESC LIMIT ?").all(n).reverse(),
  closeOn: (date)  => db.prepare("SELECT close FROM spy_prices WHERE date<=? ORDER BY date DESC LIMIT 1").get(date)?.close ?? null,
  count:   ()      => db.prepare("SELECT COUNT(*) n FROM spy_prices").get()?.n ?? 0,
};

// ── Returns queries ───────────────────────────────────────────────────────────────
export const retQ = {
  upsert: db.transaction((rows) => {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]).join(",");
    const vals = Object.keys(rows[0]).map(k=>"@"+k).join(",");
    const ins  = db.prepare("INSERT OR REPLACE INTO eod_returns (" + cols + ") VALUES (" + vals + ")");
    for (const r of rows) ins.run(r);
  }),
  get:    (sym) => db.prepare("SELECT * FROM eod_returns WHERE symbol=?").get(sym),
  count:  ()    => db.prepare("SELECT COUNT(*) n FROM eod_returns").get()?.n ?? 0,
  topGainers: (limit=100,minClose=1,minVol=50000) =>
    db.prepare("SELECT r.*,u.name,u.sector,u.industry FROM eod_returns r JOIN universe u ON r.symbol=u.symbol WHERE r.close>=? AND r.volume>=? AND u.is_active=1 AND r.d1 IS NOT NULL ORDER BY r.d1 DESC LIMIT ?").all(minClose,minVol,limit),
  topLosers: (limit=100,minClose=1,minVol=50000) =>
    db.prepare("SELECT r.*,u.name,u.sector,u.industry FROM eod_returns r JOIN universe u ON r.symbol=u.symbol WHERE r.close>=? AND r.volume>=? AND u.is_active=1 AND r.d1 IS NOT NULL ORDER BY r.d1 ASC LIMIT ?").all(minClose,minVol,limit),
  topByReturn: (period,limit=100,minClose=1) =>
    db.prepare("SELECT r.*,u.name,u.sector,u.industry FROM eod_returns r JOIN universe u ON r.symbol=u.symbol WHERE r.close>=? AND u.is_active=1 AND r." + period + " IS NOT NULL ORDER BY r." + period + " DESC LIMIT ?").all(minClose,limit),
  bySector: (sector,limit=200) =>
    db.prepare("SELECT r.*,u.name,u.industry FROM eod_returns r JOIN universe u ON r.symbol=u.symbol WHERE u.sector=? AND u.is_active=1 ORDER BY r.d1 DESC LIMIT ?").all(sector,limit),
};

// ── Bootstrap status queries ──────────────────────────────────────────────────────
export const bootQ = {
  get:   (sym) => db.prepare("SELECT * FROM bootstrap_status WHERE symbol=?").get(sym),
  set: db.transaction((rows) => {
    const ins = db.prepare("INSERT OR REPLACE INTO bootstrap_status (symbol,status,days_loaded,first_date,last_date,error_msg,attempts,updated_at) VALUES (@symbol,@status,@days_loaded,@first_date,@last_date,@error_msg,COALESCE((SELECT attempts+1 FROM bootstrap_status WHERE symbol=@symbol),1),datetime('now'))");
    for (const r of rows) ins.run(r);
  }),
  pending:   () => db.prepare("SELECT symbol FROM bootstrap_status WHERE status='pending' ORDER BY symbol").all().map(r=>r.symbol),
  errors:    () => db.prepare(`
    SELECT DISTINCT b.symbol FROM bootstrap_status b
    WHERE b.status = 'error'
      AND (
        b.attempts < 5                                    -- retry up to 5 times
        OR NOT EXISTS (                                   -- always retry if no price data
          SELECT 1 FROM eod_prices e WHERE e.symbol = b.symbol LIMIT 1
        )
      )
    ORDER BY b.attempts ASC                              -- fewer attempts first
  `).all().map(r=>r.symbol),
  errorsAll: () => db.prepare("SELECT symbol FROM bootstrap_status WHERE status='error' ORDER BY symbol").all().map(r=>r.symbol),
  completed: () => db.prepare("SELECT COUNT(*) n FROM bootstrap_status WHERE status='ok'").get()?.n ?? 0,
  total:     () => db.prepare("SELECT COUNT(*) n FROM bootstrap_status").get()?.n ?? 0,
  summary:   () => db.prepare("SELECT status,COUNT(*) n FROM bootstrap_status GROUP BY status").all(),
  unregistered: () => db.prepare("SELECT u.symbol FROM universe u LEFT JOIN bootstrap_status b ON u.symbol=b.symbol WHERE u.is_active=1 AND b.symbol IS NULL").all().map(r=>r.symbol),
};

// ── Sector cache queries ───────────────────────────────────────────────────────────
export const siQ = {
  get:  (sym) => db.prepare("SELECT sector,industry FROM sector_cache WHERE symbol=?").get(sym),
  set:  (sym,sector,industry,source="quote") => db.prepare("INSERT OR REPLACE INTO sector_cache(symbol,sector,industry,source,updated_at) VALUES(?,?,?,?,datetime('now'))").run(sym,sector||null,industry||null,source),
  bulkSet: db.transaction((rows) => {
    const ins = db.prepare("INSERT OR REPLACE INTO sector_cache(symbol,sector,industry,source,updated_at) VALUES(@symbol,@sector,@industry,@source,datetime('now'))");
    for (const r of rows) ins.run(r);
  }),
  loadAll: () => {
    const map = new Map();
    for (const r of db.prepare("SELECT symbol,sector,industry FROM sector_cache").all())
      map.set(r.symbol,{sector:r.sector,industry:r.industry});
    return map;
  },
};

// ── EOD log queries ───────────────────────────────────────────────────────────────
export const eodLogQ = {
  start:  (date,runType="daily") => db.prepare("INSERT INTO eod_log(run_date,run_type,status) VALUES(?,?,'running')").run(date,runType).lastInsertRowid,
  finish: (id,ok,err,skip,duration,error=null) => db.prepare("UPDATE eod_log SET status=?,symbols_ok=?,symbols_err=?,symbols_skip=?,duration_ms=?,error=? WHERE id=?").run(error?"error":"ok",ok,err,skip,duration,error,id),
  recent: (n=10) => db.prepare("SELECT * FROM eod_log ORDER BY created_at DESC LIMIT ?").all(n),
};
