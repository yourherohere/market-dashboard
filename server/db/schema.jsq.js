// server/db/schema.js — SQLite schema with full historical support (v5)
export const SCHEMA_VERSION = 5;

export const MIGRATIONS = [

  // ── Core metadata ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Universe: all US-listed symbols ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS universe (
    symbol     TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    exchange   TEXT NOT NULL,
    sector     TEXT,
    industry   TEXT,
    market_cap REAL,
    is_active  INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_uni_sector   ON universe(sector)`,
  `CREATE INDEX IF NOT EXISTS idx_uni_exchange ON universe(exchange)`,
  `CREATE INDEX IF NOT EXISTS idx_uni_active   ON universe(is_active)`,

  // ── EOD prices: OHLCV per symbol per day ──────────────────────────────────
  // WITHOUT ROWID: no 8-byte rowid overhead, faster composite PK access.
  // Primary lookup pattern: WHERE symbol=? ORDER BY date DESC
  `CREATE TABLE IF NOT EXISTS eod_prices (
    symbol    TEXT NOT NULL,
    date      TEXT NOT NULL,
    open      REAL,
    high      REAL,
    low       REAL,
    close     REAL NOT NULL,
    adj_close REAL,
    volume    INTEGER,
    PRIMARY KEY (symbol, date)
  ) WITHOUT ROWID`,
  // Secondary index for cross-sectional date queries (market breadth etc.)
  `CREATE INDEX IF NOT EXISTS idx_eod_date ON eod_prices(date DESC)`,

  // ── SPY stored separately for fast RS ratio calculations ──────────────────
  `CREATE TABLE IF NOT EXISTS spy_prices (
    date      TEXT PRIMARY KEY,
    close     REAL NOT NULL,
    adj_close REAL
  )`,

  // ── Computed returns: rebuilt nightly after EOD collection ────────────────
  `CREATE TABLE IF NOT EXISTS eod_returns (
    symbol       TEXT PRIMARY KEY,
    date         TEXT NOT NULL,
    close        REAL NOT NULL,
    open         REAL,
    high         REAL,
    low          REAL,
    volume       INTEGER,
    avg_vol10    INTEGER,
    avg_vol30    INTEGER,
    rel_vol      REAL,

    d1    REAL,  d5    REAL,  d10   REAL,
    d21   REAL,  d42   REAL,  d63   REAL,
    d126  REAL,  d189  REAL,  d252  REAL,
    d504  REAL,
    mtd   REAL,  qtd   REAL,  ytd   REAL,

    sma20  REAL, sma50  REAL, sma150 REAL, sma200 REAL,
    ema20  REAL, ema50  REAL, ema200 REAL,

    above_ema20  INTEGER, above_ema50  INTEGER, above_ema200 INTEGER,
    above_sma150 INTEGER, above_sma200 INTEGER,

    hi52     REAL, lo52     REAL,
    pct_hi52 REAL, pct_lo52 REAL,

    rsi14 REAL, rsi2  REAL,
    adr14 REAL, atr14 REAL,
    beta252 REAL,

    rs_1m  REAL, rs_3m  REAL,
    rs_6m  REAL, rs_12m REAL,

    trend_state TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ret_date ON eod_returns(date)`,

  // ── Sector/industry cache (survives restarts) ─────────────────────────────
  `CREATE TABLE IF NOT EXISTS sector_cache (
    symbol     TEXT PRIMARY KEY,
    sector     TEXT,
    industry   TEXT,
    source     TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Bootstrap tracking: which symbols have 2y of history ─────────────────
  `CREATE TABLE IF NOT EXISTS bootstrap_status (
    symbol      TEXT PRIMARY KEY,
    status      TEXT NOT NULL DEFAULT 'pending',
    days_loaded INTEGER DEFAULT 0,
    first_date  TEXT,
    last_date   TEXT,
    error_msg   TEXT,
    attempts    INTEGER DEFAULT 0,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_boot_status ON bootstrap_status(status)`,

  // ── EOD run log ───────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS eod_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    run_type     TEXT NOT NULL DEFAULT 'daily',
    run_date     TEXT NOT NULL,
    symbols_ok   INTEGER DEFAULT 0,
    symbols_err  INTEGER DEFAULT 0,
    symbols_skip INTEGER DEFAULT 0,
    duration_ms  INTEGER,
    status       TEXT DEFAULT 'running',
    error        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];
