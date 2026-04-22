// server/routes/themes.js
// Endpoints: /api/themes/config, /api/themes/rotate, /api/themes/performance, /api/themes/stocks
import { Router } from "express";
import { cache }  from "../cache.js";
import { CACHE }  from "../config.js";
import { safeQuote, safeChart, normalise, runScreen } from "../data/yahoo.js";
import { enrichWithSectorIndustry } from "../data/enrichment.js";
import { log } from "../logger.js";

export const themesRouter = Router();

// ── Theme registry (58 themes across 11 groups) ────────────────────────────────
const THEME_REGISTRY = [
  // ── AI & Software ──────────────────────────────────────────────────────────
  { name:"AI Narratives",          group:"AI & Software",       color:"#00e5ff",
    seeds:["NVDA","MSFT","AMD","PLTR","AI","META","GOOGL","AMZN"],
    industries:["Software—Application","Internet Content & Information","Semiconductors"],
    sectors:["Technology","Communication Services"] },
  { name:"Cloud / SaaS",           group:"AI & Software",       color:"#4cc9f0",
    seeds:["SNOW","DDOG","NET","MDB","CRM","NOW","HUBS","WDAY"],
    industries:["Software—Application","Software—Infrastructure","Information Technology Services"],
    sectors:["Technology"] },
  { name:"Cybersecurity",          group:"AI & Software",       color:"#c77dff",
    seeds:["CRWD","PANW","FTNT","ZS","S","OKTA","CYBR","SAIL"],
    industries:["Software—Infrastructure","Software—Application"],
    sectors:["Technology"] },
  { name:"Workflow Automation",    group:"AI & Software",       color:"#7b2fff",
    seeds:["NOW","PATH","APPN","PEGA","MNDY","ASAN","TEAM","COUP"],
    industries:["Software—Application","Information Technology Services"],
    sectors:["Technology"] },
  { name:"Quantum Computing",      group:"AI & Software",       color:"#9b5de5",
    seeds:["IONQ","RGTI","QBTS","QUBT","IBM","MSFT","HON","GOOGL"],
    industries:["Semiconductors","Software—Application","Electronic Components"],
    sectors:["Technology"] },
  { name:"Digital Advertising",    group:"AI & Software",       color:"#f4e285",
    seeds:["META","SNAP","PINS","TTD","APP","MGNI","DV","IAS"],
    industries:["Internet Content & Information","Advertising Agencies","Broadcasting"],
    sectors:["Communication Services","Technology"] },
  { name:"E-Commerce & Internet",  group:"AI & Software",       color:"#f72585",
    seeds:["AMZN","SHOP","MELI","SE","PDD","ETSY","W","CART"],
    industries:["Internet Retail","Specialty Retail","Software—Application"],
    sectors:["Consumer Cyclical","Technology"] },
  { name:"China Tech ADRs",        group:"AI & Software",       color:"#ef233c",
    seeds:["BABA","JD","PDD","BIDU","NIO","XPEV","LI","TCOM"],
    industries:["Internet Retail","Internet Content & Information","Auto Manufacturers"],
    sectors:["Consumer Cyclical","Communication Services","Technology"] },
  // ── Semiconductors & Hardware ──────────────────────────────────────────────
  { name:"Semiconductors",         group:"Semiconductors",      color:"#ffd60a",
    seeds:["NVDA","AMD","AVGO","QCOM","TXN","MU","AMAT","LRCX"],
    industries:["Semiconductors","Semiconductor Equipment & Materials"],
    sectors:["Technology"] },
  { name:"GPUs & AI Chips",        group:"Semiconductors",      color:"#f4a261",
    seeds:["NVDA","AMD","INTC","ARM","QCOM","MRVL","AVGO","SMCI"],
    industries:["Semiconductors","Semiconductor Equipment & Materials"],
    sectors:["Technology"] },
  { name:"Networking Chips",       group:"Semiconductors",      color:"#e9c46a",
    seeds:["MRVL","ANET","CSCO","KEYS","CIEN","LITE","VIAV","INFN"],
    industries:["Communication Equipment","Semiconductors","Computer Hardware"],
    sectors:["Technology"] },
  { name:"Memory & Storage Chips", group:"Semiconductors",      color:"#2a9d8f",
    seeds:["MU","WDC","STX","NTAP","SNDK","FORM","RMBS","SIMO"],
    industries:["Semiconductors","Computer Hardware","Electronic Components"],
    sectors:["Technology"] },
  { name:"AI Data Centers",        group:"Semiconductors",      color:"#0077b6",
    seeds:["EQIX","DLR","SMCI","VRT","IREN","ARM","NTAP","DELL"],
    industries:["REIT—Specialty","REIT—Industrial","Computer Hardware","Semiconductors"],
    sectors:["Technology","Real Estate"] },
  // ── Biotech & Health ──────────────────────────────────────────────────────
  { name:"Biotech & Genomics",     group:"Biotech & Health",    color:"#7bed9f",
    seeds:["MRNA","BNTX","REGN","BIIB","GILD","INCY","EXAS","RARE"],
    industries:["Biotechnology","Drug Manufacturers—General","Diagnostics & Research"],
    sectors:["Healthcare"] },
  { name:"AI Drug Discovery",      group:"Biotech & Health",    color:"#2a9d8f",
    seeds:["RXRX","SDGR","CRSP","EDIT","BEAM","NTLA","VERV","ARCT"],
    industries:["Biotechnology","Drug Manufacturers—Specialty & Generic","Diagnostics & Research"],
    sectors:["Healthcare"] },
  { name:"GLP-1 / Obesity",        group:"Biotech & Health",    color:"#b8ff6e",
    seeds:["LLY","NVO","VKTX","HIMS","AMGN","RVNC","ALT","ZFOX"],
    industries:["Drug Manufacturers—General","Biotechnology","Drug Manufacturers—Specialty & Generic"],
    sectors:["Healthcare"] },
  { name:"Health Technology",      group:"Biotech & Health",    color:"#90be6d",
    seeds:["ISRG","DXCM","IRTC","NVCR","AXNX","SWAV","NVST","INSP"],
    industries:["Medical Devices","Medical Instruments & Supplies","Diagnostics & Research"],
    sectors:["Healthcare"] },
  { name:"Health Services",        group:"Biotech & Health",    color:"#43aa8b",
    seeds:["UNH","CVS","HUM","MOH","CNC","ELV","DVA","HCA"],
    industries:["Healthcare Plans","Medical Care Facilities","Medical Distribution"],
    sectors:["Healthcare"] },
  // ── Finance & Crypto ──────────────────────────────────────────────────────
  { name:"Fintech & Payments",     group:"Finance & Crypto",    color:"#f72585",
    seeds:["SQ","PYPL","AFRM","SOFI","HOOD","NU","UPST","ADYEY"],
    industries:["Credit Services","Financial Data & Stock Exchanges","Capital Markets"],
    sectors:["Financial Services","Technology"] },
  { name:"Bitcoin & Crypto Miners",group:"Finance & Crypto",    color:"#f7931a",
    seeds:["MSTR","MARA","CLSK","RIOT","COIN","SMLR","HUT","BTBT"],
    industries:["Capital Markets","Financial Data & Stock Exchanges","Asset Management"],
    sectors:["Financial Services","Technology"] },
  { name:"Corporate Crypto Treasury",group:"Finance & Crypto",  color:"#ff9f1c",
    seeds:["MSTR","TSLA","SQ","COIN","RIOT","MARA","CLSK","BTBT"],
    industries:["Capital Markets","Software—Application","Financial Data & Stock Exchanges"],
    sectors:["Financial Services","Technology"] },
  // ── Energy & Clean Tech ──────────────────────────────────────────────────
  { name:"EV / Clean Energy",      group:"Energy & Clean Tech", color:"#06d6a0",
    seeds:["TSLA","RIVN","NIO","ENPH","FSLR","NEE","PLUG","CHPT"],
    industries:["Auto Manufacturers","Utilities—Renewable","Auto Parts"],
    sectors:["Consumer Cyclical","Utilities","Energy"] },
  { name:"Solar / Photovoltaic",   group:"Energy & Clean Tech", color:"#ffe45e",
    seeds:["ENPH","FSLR","SEDG","ARRY","NOVA","MAXN","SHLS","CSIQ"],
    industries:["Solar","Utilities—Renewable","Semiconductor Equipment & Materials"],
    sectors:["Technology","Utilities","Energy"] },
  { name:"Nuclear Energy",         group:"Energy & Clean Tech", color:"#ff9f1c",
    seeds:["CEG","VST","CCJ","NNE","SMR","OKLO","BWX","ETR"],
    industries:["Uranium","Utilities—Regulated Electric","Utilities—Independent Power Producers"],
    sectors:["Utilities","Basic Materials"] },
  { name:"Smart Grid & Power",     group:"Energy & Clean Tech", color:"#4895ef",
    seeds:["GE","ETN","HUBB","PWR","POWL","ITRI","REZI","ARRY"],
    industries:["Specialty Industrial Machinery","Electrical Equipment & Parts","Building Products & Equipment"],
    sectors:["Industrials"] },
  // ── Precious Metals ──────────────────────────────────────────────────────
  { name:"Gold Producers",         group:"Precious Metals",     color:"#d4a017",
    seeds:["NEM","GOLD","AEM","KGC","AGI","EGO","OR","AU"],
    industries:["Gold"],
    sectors:["Basic Materials"] },
  { name:"Silver",                 group:"Precious Metals",     color:"#c0c0c0",
    seeds:["AG","PAAS","HL","CDE","MAG","SILV","WPM","SVM"],
    industries:["Silver","Gold"],
    sectors:["Basic Materials"] },
  { name:"Lithium & Battery Tech", group:"Industrial Metals",   color:"#4ade80",
    seeds:["ALB","SQM","LTHM","MP","LAC","NOVS","FREY","NXRT"],
    industries:["Specialty Chemicals","Other Industrial Metals & Mining"],
    sectors:["Basic Materials"] },
  { name:"Copper",                 group:"Industrial Metals",   color:"#b87333",
    seeds:["FCX","SCCO","HBM","TECK","NEXA","ERO","PLNG","COPX"],
    industries:["Copper"],
    sectors:["Basic Materials"] },
  { name:"Uranium Pure Play",      group:"Industrial Metals",   color:"#80b918",
    seeds:["CCJ","UEC","DNN","UUUU","NXE","URG","UROY","BWXT"],
    industries:["Uranium"],
    sectors:["Basic Materials","Utilities"] },
  // ── Energy Commodities ────────────────────────────────────────────────────
  { name:"Oil & Gas E&P",          group:"Energy Commodities",  color:"#f4a261",
    seeds:["XOM","COP","EOG","PXD","DVN","FANG","OXY","MRO"],
    industries:["Oil & Gas E&P"],
    sectors:["Energy"] },
  { name:"Oil Services & Equipment",group:"Energy Commodities", color:"#c1440e",
    seeds:["SLB","HAL","BKR","NOV","HP","RES","PTEN","ACDC"],
    industries:["Oil & Gas Equipment & Services"],
    sectors:["Energy"] },
  { name:"Natural Gas & LNG",      group:"Energy Commodities",  color:"#57cc99",
    seeds:["LNG","AR","EQT","RRC","CTRA","SWN","KMI","WMB"],
    industries:["Oil & Gas E&P","Oil & Gas Midstream"],
    sectors:["Energy"] },
  // ── Defense, Space & Transport ────────────────────────────────────────────
  { name:"Defense & Aerospace",    group:"Defense & Transport", color:"#ff6b6b",
    seeds:["LMT","RTX","NOC","GD","BA","LDOS","HII","AXON"],
    industries:["Aerospace & Defense","Security & Protection Services"],
    sectors:["Industrials","Technology"] },
  { name:"Space & Satellites",     group:"Defense & Transport", color:"#a8dadc",
    seeds:["RKLB","ASTS","PL","SPCE","KTOS","BWXT","HWM","TDG"],
    industries:["Aerospace & Defense","Communication Equipment"],
    sectors:["Industrials","Technology","Communication Services"] },
  { name:"Humanoid Robotics",      group:"Defense & Transport", color:"#ff4d6d",
    seeds:["TSLA","NVDA","PATH","TER","ISRG","ABB","ZBRA","GFAI"],
    industries:["Specialty Industrial Machinery","Scientific & Technical Instruments","Semiconductors"],
    sectors:["Industrials","Technology"] },
  { name:"Autonomous Vehicles",    group:"Defense & Transport", color:"#e9c46a",
    seeds:["TSLA","GOOGL","MBLY","LAZR","OUST","UBER","LYFT","TEM"],
    industries:["Auto Manufacturers","Auto Parts","Software—Application"],
    sectors:["Consumer Cyclical","Technology"] },
  { name:"Airlines & Travel",      group:"Defense & Transport", color:"#90caf9",
    seeds:["DAL","UAL","AAL","SAVE","JBLU","ALK","LUV","RYAAY"],
    industries:["Airlines","Hotels & Motels","Travel Services","Airports & Air Services"],
    sectors:["Industrials","Consumer Cyclical"] },
  { name:"Transportation & Logistics",group:"Defense & Transport",color:"#64b5f6",
    seeds:["UPS","FDX","CHRW","XPO","JBHT","CSX","UNP","NSC"],
    industries:["Trucking","Railroads","Integrated Freight & Logistics","Marine Shipping"],
    sectors:["Industrials"] },
  // ── Consumer & Lifestyle ──────────────────────────────────────────────────
  { name:"Beverages",              group:"Consumer & Lifestyle",color:"#f4a261",
    seeds:["KO","PEP","MNST","CELH","FIZZ","SAM","BUD","STZ"],
    industries:["Beverages—Non-Alcoholic","Beverages—Brewers","Beverages—Wineries & Distilleries"],
    sectors:["Consumer Defensive","Consumer Cyclical"] },
  { name:"EdTech",                 group:"Consumer & Lifestyle",color:"#f9c74f",
    seeds:["DUOL","COUR","CHGG","PRDO","LAUR","STRA","UTI","APEI"],
    industries:["Education & Training Services","Software—Application"],
    sectors:["Consumer Defensive","Technology"] },
  // ── Infrastructure & REITs ────────────────────────────────────────────────
  { name:"Data Center REITs",      group:"Infrastructure",      color:"#0077b6",
    seeds:["EQIX","DLR","AMT","CONE","CCI","SBAC","INDT","IRM"],
    industries:["REIT—Specialty","REIT—Industrial","REIT—Diversified"],
    sectors:["Real Estate"] },
  { name:"Specialty Chemicals",    group:"Agricultural",        color:"#e9c46a",
    seeds:["LIN","APD","DD","EMN","TROX","ASH","HUN","ASIX"],
    industries:["Specialty Chemicals","Agricultural Inputs","Chemicals"],
    sectors:["Basic Materials"] },
  { name:"Water & Environmental",  group:"Agricultural",        color:"#457b9d",
    seeds:["AWK","WTR","WTRG","MSEX","ARIS","ERII","PRMW","XYL"],
    industries:["Utilities—Regulated Water","Pollution & Treatment Controls"],
    sectors:["Utilities","Industrials"] },
];

// ── Helper functions ──────────────────────────────────────────────────────────
async function runAllScreensLocal() {
  const { SCREEN_POOLS } = await import("../config.js");
  const results = await Promise.allSettled(
    SCREEN_POOLS.map(id => runScreen(id, 150))
  );
  const seen = new Set();
  return results.flatMap(r => r.value || [])
    .filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
}

function calcPerf(closes, bars) {
  if (!closes?.length || closes.length < 2) return null;
  const now = closes[closes.length - 1];
  const from = closes[Math.max(0, closes.length - 1 - bars)];
  return from && from !== 0 ? +((now - from) / from * 100).toFixed(2) : null;
}

function calcPerfSince(closes, timestamps, targetTs) {
  if (!closes?.length || !timestamps?.length) return null;
  let idx = timestamps.findIndex(t => t >= targetTs);
  if (idx < 0) idx = 0;
  const from = closes[idx], now = closes[closes.length - 1];
  return from && from !== 0 ? +((now - from) / from * 100).toFixed(2) : null;
}

function calcThemePerf(chartDataArray) {
  const avg = arr => {
    const v = arr.filter(x => x != null);
    return v.length ? +(v.reduce((a,b)=>a+b,0)/v.length).toFixed(2) : null;
  };
  const yr = new Date().getFullYear(), mo = new Date().getMonth();
  const ytdTs = Math.floor(new Date(yr,0,1).getTime()/1000);
  const mtdTs = Math.floor(new Date(yr,mo,1).getTime()/1000);
  return {
    d1:   avg(chartDataArray.map(cd => calcPerf(cd.closes, 1))),
    d5:   avg(chartDataArray.map(cd => calcPerf(cd.closes, 5))),
    d21:  avg(chartDataArray.map(cd => calcPerf(cd.closes, 21))),
    d63:  avg(chartDataArray.map(cd => calcPerf(cd.closes, 63))),
    d126: avg(chartDataArray.map(cd => calcPerf(cd.closes, 126))),
    d252: avg(chartDataArray.map(cd => calcPerf(cd.closes, 252))),
    mtd:  avg(chartDataArray.map(cd => calcPerfSince(cd.closes, cd.timestamps, mtdTs))),
    ytd:  avg(chartDataArray.map(cd => calcPerfSince(cd.closes, cd.timestamps, ytdTs))),
  };
}

// ── GET /api/themes/config ────────────────────────────────────────────────────
themesRouter.get("/api/themes/config", (_, res) => {
  res.json({ themes: THEME_REGISTRY, count: THEME_REGISTRY.length });
});

// ── GET /api/themes/rotate ────────────────────────────────────────────────────
themesRouter.get("/api/themes/rotate", async (req, res) => {
  const minAdr    = parseFloat(req.query.minAdr)    || 2;
  const minRelVol = parseFloat(req.query.minRelVol) || 1.5;
  const minMcap   = parseFloat(req.query.minMcap)   || 50_000_000;
  const limit     = Math.min(parseInt(req.query.limit) || 8, 20);

  const ck  = `themes-rotate:${minAdr}:${minRelVol}:${minMcap}:${limit}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ ...hit, cached: true });

  log.info(`/api/themes/rotate minAdr=${minAdr} minRelVol=${minRelVol}`);
  try {
    const deduped = await runAllScreensLocal();
    let allTickers = deduped.map(normalise).filter(Boolean);
    allTickers = await enrichWithSectorIndustry(allTickers);

    const byIndustry = {};
    allTickers.forEach(t => {
      if (!t.industry) return;
      if (!byIndustry[t.industry]) byIndustry[t.industry] = [];
      byIndustry[t.industry].push(t);
    });

    const themeResults = {};
    for (const theme of THEME_REGISTRY) {
      const candidates = [], seen = new Set();
      theme.industries.forEach(ind => {
        (byIndustry[ind] || []).forEach(t => {
          if (!seen.has(t.symbol)) { seen.add(t.symbol); candidates.push(t); }
        });
      });
      const live = candidates
        .filter(t =>
          Math.abs(t.change||0) >= minAdr &&
          (t.relVol||0) >= minRelVol &&
          (t.marketCap||0) >= minMcap
        )
        .sort((a,b) => Math.abs(b.change||0) - Math.abs(a.change||0))
        .slice(0, limit);

      themeResults[theme.name] = {
        theme:       theme.name,
        group:       theme.group,
        color:       theme.color,
        tickers:     live,
        source:      live.length > 0 ? "live" : "seeds",
        liveCount:   live.length,
        seedSymbols: theme.seeds,
      };
    }

    const out = { themes: themeResults, ts: new Date(), params: { minAdr, minRelVol, minMcap, limit } };
    cache.set(ck, out);
    log.ok(`themes/rotate: ${Object.values(themeResults).filter(t=>t.source==="live").length}/${THEME_REGISTRY.length} live`);
    res.json(out);
  } catch(e) { log.error(e.message); res.status(500).json({ error: e.message }); }
});

// ── GET /api/themes/performance ───────────────────────────────────────────────
themesRouter.get("/api/themes/performance", async (req, res) => {
  const ck  = "themes-perf-all";
  const hit = cache.get(ck, 30 * 60_000);
  if (hit) return res.json({ ...hit, cached: true });

  log.info("/api/themes/performance fetching bellwether baskets…");
  try {
    // Top 3 seeds per theme as bellwethers
    const bellwethers = {};
    THEME_REGISTRY.forEach(t => { bellwethers[t.name] = t.seeds.slice(0, 3); });
    const allSyms = [...new Set(Object.values(bellwethers).flat())];

    // Batch fetch 1Y charts
    const chartMap = {};
    const CBATCH = 10;
    for (let i = 0; i < allSyms.length; i += CBATCH) {
      const batch = allSyms.slice(i, i + CBATCH);
      const results = await Promise.allSettled(batch.map(sym => safeChart(sym, 390)));
      results.forEach((r, j) => { if (r.value?.closes?.length) chartMap[batch[j]] = r.value; });
    }

    const themePerf = {};
    for (const theme of THEME_REGISTRY) {
      const charts = bellwethers[theme.name].map(s => chartMap[s]).filter(Boolean);
      themePerf[theme.name] = {
        ...(charts.length ? calcThemePerf(charts) : { d1:null, d5:null, mtd:null, d21:null, d63:null, d126:null, ytd:null, d252:null }),
        bellwethers: bellwethers[theme.name],
        group:       theme.group,
        color:       theme.color,
      };
    }

    const out = { themes: themePerf, ts: new Date(), symbolCount: allSyms.length };
    cache.set(ck, out);
    log.ok(`themes/performance: ${Object.keys(themePerf).length} themes`);
    res.json(out);
  } catch(e) { log.error(e.message); res.status(500).json({ error: e.message }); }
});

// ── GET /api/themes/stocks ────────────────────────────────────────────────────
themesRouter.get("/api/themes/stocks", async (req, res) => {
  const theme    = (req.query.theme || "").trim();
  const minCount = Math.min(parseInt(req.query.min) || 10, 30);
  const minAdr    = parseFloat(req.query.minAdr)    || 0;
  const minRelVol = parseFloat(req.query.minRelVol) || 0;

  if (!theme) return res.status(400).json({ error: "theme required" });
  const def = THEME_REGISTRY.find(t => t.name === theme);
  if (!def) return res.status(404).json({ error: `theme not found: ${theme}` });

  const ck  = `theme-stocks:${theme}:${minAdr}:${minRelVol}:${minCount}`;
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ ...hit, cached: true });

  try {
    const deduped  = await runAllScreensLocal();
    const enriched = await enrichWithSectorIndustry(deduped.map(normalise).filter(Boolean));

    const live = enriched.filter(t => {
      const match = def.industries.some(ind =>
        t.industry && (t.industry === ind || t.industry.startsWith(ind.split("—")[0]))
      );
      if (!match) return false;
      if (minAdr > 0 && Math.abs(t.change || 0) < minAdr) return false;
      if (minRelVol > 0 && (t.relVol || 0) < minRelVol) return false;
      return true;
    }).sort((a,b) => Math.abs(b.change||0) - Math.abs(a.change||0));

    // Fill with seed quotes if below minCount
    let stocks = live.map(t => ({ ...t, _source: "live" }));
    if (stocks.length < minCount) {
      const liveSyms = new Set(stocks.map(s => s.symbol));
      const needed = def.seeds.filter(s => !liveSyms.has(s)).slice(0, minCount - stocks.length);
      if (needed.length) {
        const seedQuotes = await Promise.allSettled(needed.map(safeQuote));
        const seedNorm = seedQuotes
          .map((r,i) => r.value ? { ...normalise(r.value), _source: "seed" } : null)
          .filter(Boolean);
        stocks = [...stocks, ...(await enrichWithSectorIndustry(seedNorm))];
      }
    }

    const out = {
      theme, stocks,
      liveCount: live.length,
      seedCount: stocks.length - live.length,
      total: stocks.length,
      def: { name:def.name, group:def.group, color:def.color, industries:def.industries, sectors:def.sectors },
    };
    cache.set(ck, out);
    res.json(out);
  } catch(e) { log.error(e.message); res.status(500).json({ error: e.message }); }
});

// ── GET /api/candles — OHLCV for LightweightCharts popup ──────────────────────
themesRouter.get("/api/candles", async (req, res) => {
  const sym  = (req.query.symbol || "").trim().toUpperCase();
  const days = Math.min(parseInt(req.query.days) || 365, 730);
  if (!sym) return res.status(400).json({ error: "symbol required" });

  const ck  = `candles:${sym}:${days}`;
  const hit = cache.get(ck, CACHE.CHART);
  if (hit) return res.json({ data: hit, symbol: sym, cached: true });

  try {
    const { yf, withTimeout } = await import("../data/yahoo.js");
    const period1 = new Date(Date.now() - days * 86_400_000);
    const r = await withTimeout(yf.chart(sym, { period1, interval: "1d" }), 18_000);
    const valid = (r?.quotes || []).filter(q => q.close > 0 && q.date);

    // Deduplicate by date
    const seen = new Set();
    const deduped = valid.filter(q => {
      const key = new Date(q.date).toISOString().slice(0,10);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    deduped.sort((a,b) => new Date(a.date) - new Date(b.date));

    const data = deduped.map(q => ({
      time:   Math.floor(new Date(q.date).getTime() / 1000),
      open:   +((q.open  || q.close)).toFixed(4),
      high:   +((q.high  || q.close)).toFixed(4),
      low:    +((q.low   || q.close)).toFixed(4),
      close:  +q.close.toFixed(4),
      volume: q.volume || 0,
    }));

    if (data.length > 0) cache.set(ck, data);
    res.json({ data, symbol: sym, days, cached: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
