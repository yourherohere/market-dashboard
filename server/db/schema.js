// server/db/schema.js — SQLite schema v6
export const SCHEMA_VERSION = 6;

export const MIGRATIONS = [

  `CREATE TABLE IF NOT EXISTS schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS universe (
    symbol      TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    exchange    TEXT NOT NULL,
    sector      TEXT,
    industry    TEXT,
    sector_etf  TEXT,   -- e.g. "XLK" for Technology
    industry_etf TEXT,  -- e.g. "SOXX" for Semiconductors
    market_cap  REAL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_uni_sector    ON universe(sector)`,
  `CREATE INDEX IF NOT EXISTS idx_uni_exchange  ON universe(exchange)`,
  `CREATE INDEX IF NOT EXISTS idx_uni_active    ON universe(is_active)`,

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
  `CREATE INDEX IF NOT EXISTS idx_eod_date ON eod_prices(date DESC)`,

  `CREATE TABLE IF NOT EXISTS spy_prices (
    date      TEXT PRIMARY KEY,
    close     REAL NOT NULL,
    adj_close REAL
  )`,

  `CREATE TABLE IF NOT EXISTS eod_returns (
    symbol        TEXT PRIMARY KEY,
    date          TEXT NOT NULL,
    close         REAL NOT NULL,
    open          REAL,
    high          REAL,
    low           REAL,
    volume        INTEGER,
    avg_vol10     INTEGER,
    avg_vol30     INTEGER,
    rel_vol       REAL,

    d1    REAL, d5    REAL, d10   REAL,
    d21   REAL, d42   REAL, d63   REAL,
    d126  REAL, d189  REAL, d252  REAL,
    d504  REAL,
    mtd   REAL, qtd   REAL, ytd   REAL,

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

    -- ETF benchmarks (populated by enrichSectorEtf job)
    sector_etf      TEXT,  -- e.g. "XLK"
    industry_etf    TEXT,  -- e.g. "SOXX"
    rs_vs_sector    REAL,  -- 3M RS vs sector ETF
    rs_vs_industry  REAL,  -- 3M RS vs industry ETF

    trend_state TEXT,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ret_date    ON eod_returns(date)`,
  `CREATE INDEX IF NOT EXISTS idx_ret_sector  ON eod_returns(sector_etf)`,

  `CREATE TABLE IF NOT EXISTS sector_cache (
    symbol     TEXT PRIMARY KEY,
    sector     TEXT,
    industry   TEXT,
    source     TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

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

  // v6 upgrade migrations (ALTER TABLE — idempotent via try/catch in runner)
  `ALTER TABLE eod_returns ADD COLUMN sector_etf     TEXT`,
  `ALTER TABLE eod_returns ADD COLUMN industry_etf   TEXT`,
  `ALTER TABLE eod_returns ADD COLUMN rs_vs_sector   REAL`,
  `ALTER TABLE eod_returns ADD COLUMN rs_vs_industry REAL`,
  `ALTER TABLE universe    ADD COLUMN sector_etf     TEXT`,
  `ALTER TABLE universe    ADD COLUMN industry_etf   TEXT`,
  // v7 analytics — idempotent (migrate.js wraps each in try/catch)
  // v8 — EMA10, EMA100 + touch/cross flags for all 5 periods
  `ALTER TABLE eod_returns ADD COLUMN ema10         REAL`,
  `ALTER TABLE eod_returns ADD COLUMN ema100        REAL`,
  `ALTER TABLE eod_returns ADD COLUMN above_ema10   INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN above_ema100  INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN touch_ema10   INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN touch_ema20   INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN touch_ema50   INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN touch_ema100  INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN touch_ema200  INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN cross_ema10   INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN cross_ema20   INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN cross_ema50   INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN cross_ema100  INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN cross_ema200  INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN rs_rank       INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN rs_rank_3m    INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN stage         INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN stage_label   TEXT`,
  `ALTER TABLE eod_returns ADD COLUMN setup_score   INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN pocket_pivot  INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN tight_flag    INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN vcp_score     INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN earnings_date TEXT`,
  `ALTER TABLE eod_returns ADD COLUMN days_to_earn  INTEGER`,
  `ALTER TABLE eod_returns ADD COLUMN rs_line_hi    INTEGER`,
];
