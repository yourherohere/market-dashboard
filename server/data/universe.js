// server/data/universe.js — Full US stock universe management
// Sources (tried in order):
//   1. SEC EDGAR company_tickers_exchange.json  (~6,500 symbols)
//   2. NASDAQ FTP CSV files  (nasdaq + nyse + amex)
//   3. Local DB cache (from previous successful load)
import { UNIVERSE_EXCHANGES, UNIVERSE_REFRESH_MS } from "../config.js";
import { uniQ } from "../db/index.js";
import { siCache } from "./enrichment.js";
import { log } from "../logger.js";

// In-memory universe map: symbol → { name, exchange, sector, industry }
export const universe = new Map();
let _loaded   = false;
let _loading  = false;
let _loadedAt = 0;

export const universeStatus = () => ({
  loaded:  _loaded,
  loading: _loading,
  count:   universe.size,
  age_ms:  _loaded ? Date.now() - _loadedAt : null,
});

// ── Load universe ─────────────────────────────────────────────────────────────
export async function loadUniverse(force = false) {
  if (_loading) return;
  if (_loaded && !force && Date.now() - _loadedAt < UNIVERSE_REFRESH_MS) return;

  _loading = true;
  log.info("Loading US stock universe…");

  // Try sources in priority order
  const loaded =
    await trySecEdgar()   ||
    await tryNasdaqAPI()  ||
    tryLocalDB();         // always works if we have DB data

  if (loaded) {
    _loaded   = true;
    _loadedAt = Date.now();
    // Persist to DB
    persistUniverseToDB();
    // Seed siCache from universe rows that already have sector
    for (const [sym, d] of universe) {
      if (d.sector && !siCache.has(sym)) {
        siCache.set(sym, { sector: d.sector, industry: d.industry, ts: Date.now() });
      }
    }
    log.ok(`Universe loaded: ${universe.size.toLocaleString()} symbols`);
  } else {
    log.warn("All universe sources failed — using empty universe");
    _loaded = true; // prevent infinite retry loop
  }
  _loading = false;
}

// Schedule daily refresh
export function scheduleUniverseRefresh() {
  setInterval(() => {
    loadUniverse(true).catch(e => log.warn(`Universe refresh failed: ${e.message}`));
  }, UNIVERSE_REFRESH_MS);
}

// ── Source 1: SEC EDGAR ───────────────────────────────────────────────────────
async function trySecEdgar() {
  try {
    log.step("Trying SEC EDGAR company_tickers_exchange.json…");
    const resp = await fetch(
      "https://www.sec.gov/files/company_tickers_exchange.json",
      {
        headers: { "User-Agent": "MarketDashboard/2.0 research@marketdashboard.local" },
        signal: AbortSignal.timeout(30_000),
      }
    );
    if (!resp.ok) throw new Error(`SEC HTTP ${resp.status}`);
    const data = await resp.json();

    // data.fields = ["cik","name","ticker","exchange"]
    // data.data   = [[cik, name, ticker, exchange], ...]
    const fields = data.fields;
    const ciIdx  = fields.indexOf("cik");
    const nmIdx  = fields.indexOf("name");
    const tkIdx  = fields.indexOf("ticker");
    const exIdx  = fields.indexOf("exchange");

    let added = 0;
    for (const row of data.data) {
      const ticker   = (row[tkIdx] || "").trim().toUpperCase();
      const exchange = row[exIdx] || "";
      if (!ticker || !UNIVERSE_EXCHANGES.has(exchange)) continue;
      if (/[W]$/.test(ticker) || /\d/.test(ticker))    continue; // warrants, units
      if (ticker.length > 5)                            continue;
      universe.set(ticker, {
        name:     (row[nmIdx] || ticker).substring(0, 40),
        exchange: exchange,
        sector:   null,
        industry: null,
      });
      added++;
    }
    log.ok(`SEC EDGAR: ${added} symbols loaded`);
    return added > 1000;
  } catch(e) {
    log.warn(`SEC EDGAR failed: ${e.message}`);
    return false;
  }
}

// ── Source 2: NASDAQ FTP CSV ──────────────────────────────────────────────────
async function tryNasdaqAPI() {
  // NASDAQ FTP has CSV files: nasdaqlisted.txt, otherlisted.txt
  const sources = [
    {
      url: "https://ftp.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
      exchange: "Nasdaq",
      parse: (lines) => lines.slice(1, -1).map(l => {
        const [symbol,,,,,,, status] = l.split("|");
        return status === "N" ? symbol?.trim() : null; // N=normal
      }).filter(Boolean),
    },
    {
      url: "https://ftp.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
      exchange: "NYSE",
      parse: (lines) => lines.slice(1, -1).map(l => {
        const [symbol,,, exchange,,,,, status] = l.split("|");
        return status === "N" && exchange ? symbol?.trim() : null;
      }).filter(Boolean),
    },
  ];

  let total = 0;
  for (const src of sources) {
    try {
      const resp = await fetch(src.url, {
        headers: { "User-Agent": "MarketDashboard/2.0" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!resp.ok) continue;
      const text  = await resp.text();
      const lines = text.split("\n").filter(l => l.trim());
      const syms  = src.parse(lines);
      for (const sym of syms) {
        if (!sym || sym.length > 5 || /[$+\/\.\d]/.test(sym)) continue;
        if (!universe.has(sym)) {
          universe.set(sym, { name: sym, exchange: src.exchange, sector: null, industry: null });
          total++;
        }
      }
      log.step(`NASDAQ FTP ${src.exchange}: ${syms.length} symbols`);
    } catch(e) {
      log.warn(`NASDAQ FTP ${src.exchange} failed: ${e.message}`);
    }
  }
  if (total > 500) { log.ok(`NASDAQ FTP: ${total} symbols loaded`); return true; }
  return false;
}

// ── Source 3: Local DB cache ──────────────────────────────────────────────────
function tryLocalDB() {
  try {
    const rows = uniQ.all();
    if (rows.length < 100) return false;
    for (const r of rows) {
      universe.set(r.symbol, {
        name:     r.name,
        exchange: r.exchange,
        sector:   r.sector || null,
        industry: r.industry || null,
      });
    }
    log.ok(`Universe from DB cache: ${rows.length} symbols`);
    return true;
  } catch(e) {
    log.warn(`DB cache failed: ${e.message}`);
    return false;
  }
}

// ── Persist to DB ─────────────────────────────────────────────────────────────
function persistUniverseToDB() {
  try {
    const rows = [...universe.entries()].map(([symbol, d]) => ({
      symbol, name: d.name, exchange: d.exchange,
      sector: d.sector || null, industry: d.industry || null,
    }));
    // Batch insert in chunks of 500 to avoid "too many parameters" error
    for (let i = 0; i < rows.length; i += 500) {
      uniQ.upsert(rows.slice(i, i + 500));
    }
    log.step(`Universe persisted to DB: ${rows.length} rows`);
  } catch(e) {
    log.warn(`Universe persist failed: ${e.message}`);
  }
}
