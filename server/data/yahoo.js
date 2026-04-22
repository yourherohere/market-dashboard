// server/data/yahoo.js — Yahoo Finance singleton with helpers
import YahooFinance from "yahoo-finance2";
import { YF_TIMEOUT, YF_RETRY } from "../config.js";
import { log } from "../logger.js";

process.env.YF_DISABLE_VERSION_CHECK = "1";
export const yf = new YahooFinance();

// ── withTimeout ───────────────────────────────────────────────────────────────
export const withTimeout = (p, ms = YF_TIMEOUT) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`timeout_${ms}ms`)), ms))]);

// ── safeQuote — single symbol with retry ─────────────────────────────────────
export async function safeQuote(sym) {
  for (let attempt = 0; attempt <= YF_RETRY; attempt++) {
    try {
      return await withTimeout(yf.quote(sym), YF_TIMEOUT);
    } catch(e) {
      if (attempt === YF_RETRY) { log.debug(`safeQuote(${sym}) failed: ${e.message}`); return null; }
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  return null;
}

// ── safeChart — price history ─────────────────────────────────────────────────
export async function safeChart(sym, days = 60) {
  try {
    const period1 = new Date(Date.now() - days * 86_400_000);
    const r = await withTimeout(yf.chart(sym, { period1, interval: "1d" }), 15_000);
    const valid = (r?.quotes || []).filter(q => q.close > 0 && q.date);
    return {
      closes:     valid.map(q => q.close),
      highs:      valid.map(q => q.high  || q.close),
      lows:       valid.map(q => q.low   || q.close),
      volumes:    valid.map(q => q.volume || 0),
      timestamps: valid.map(q => Math.floor(new Date(q.date).getTime() / 1000)),
    };
  } catch(e) {
    log.debug(`safeChart(${sym}) failed: ${e.message}`);
    return { closes: [], highs: [], lows: [], volumes: [], timestamps: [] };
  }
}

// ── normalise — raw Yahoo quote → clean ticker object ────────────────────────
export function normalise(v) {
  if (!v?.regularMarketPrice || !v.symbol) return null;
  const price = v.regularMarketPrice;
  const vol   = v.regularMarketVolume ?? 0;
  const avg10 = v.averageDailyVolume10Day || vol || 1;
  return {
    symbol:    v.symbol,
    name:      (v.shortName || v.longName || v.symbol).substring(0, 28),
    price,
    change:    v.regularMarketChangePercent ?? 0,
    changeDol: v.regularMarketChange ?? 0,
    volume:    vol,
    avgVol10:  avg10,
    relVol:    avg10 > 0 ? +(vol / avg10).toFixed(2) : 0,
    marketCap: v.marketCap ?? null,
    pe:        v.trailingPE ?? null,
    hi52:      v.fiftyTwoWeekHigh ?? null,
    lo52:      v.fiftyTwoWeekLow  ?? null,
    ema50:     v.fiftyDayAverage ?? null,
    ema200:    v.twoHundredDayAverage ?? null,
    above50:   v.fiftyDayAverage      ? price > v.fiftyDayAverage      : null,
    above200:  v.twoHundredDayAverage ? price > v.twoHundredDayAverage : null,
    sector:    v.sector   || null,
    industry:  v.industry || null,
    hi52Pct:   v.fiftyTwoWeekHigh ? +(price / v.fiftyTwoWeekHigh * 100).toFixed(1) : null,
    rsi:   null,
    macd:  null,
    adr:   null,
  };
}

// ── runScreen — single screener pool ─────────────────────────────────────────
import { siCache } from "./enrichment.js";

export async function runScreen(scrId, count = 100) {
  try {
    const r = await withTimeout(
      yf.screener({ scrIds: scrId, count }, { validateResult: false }),
      25_000
    );
    const quotes = (r?.quotes || []).filter(q =>
      q.symbol &&
      q.regularMarketPrice > 0 &&
      !q.symbol.includes(".") &&
      !q.symbol.includes("^") &&
      q.symbol.length <= 5
    );
    // Seed sector cache from screener results (free enrichment)
    for (const q of quotes) {
      if (q.sector && !siCache.has(q.symbol)) {
        siCache.set(q.symbol, { sector: q.sector, industry: q.industry || null, ts: Date.now() });
      }
    }
    return quotes;
  } catch(e) {
    log.warn(`screener [${scrId}]: ${e.message}`);
    return [];
  }
}
