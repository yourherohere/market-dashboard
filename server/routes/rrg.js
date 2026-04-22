// server/routes/rrg.js — Relative Rotation Graph (JdK RS method)
import { Router } from "express";
import { cache }  from "../cache.js";
import { CACHE }  from "../config.js";
import { safeChart } from "../data/yahoo.js";
import { log } from "../logger.js";

export const rrgRouter = Router();

// ── ETF registries ─────────────────────────────────────────────────────────────
const ETF_SYMS_RRG  = ["XLK","XLV","XLF","XLY","XLP","XLE","XLB","XLI","XLU","XLRE","XLC"];
const SECTOR_FOR_ETF = {
  XLK:"Technology", XLV:"Healthcare",      XLF:"Financials",    XLY:"Consumer Discret.",
  XLP:"Consumer Staples", XLE:"Energy",   XLB:"Materials",      XLI:"Industrials",
  XLU:"Utilities",  XLRE:"Real Estate",   XLC:"Comm Services",
};
const ETF_COLORS = {
  XLK:"#00b4d8", XLV:"#90be6d", XLF:"#f9c74f", XLY:"#f94144",
  XLP:"#43aa8b", XLE:"#f8961e", XLB:"#8ecae6", XLI:"#4d908e",
  XLU:"#277da1", XLRE:"#f3722c", XLC:"#ff70a6",
};

const SUB_ETFS = {
  "Technology":        ["SOXX","SMH","XSD","IGV","CLOU","FDN","CIBR","BOTZ","ESPO"],
  "Healthcare":        ["IBB","XBI","IHI","IHF","XHE","XHS","PJP"],
  "Financials":        ["KBE","KRE","KCE","KIE","IAI"],
  "Consumer Discret.": ["XRT","XHB","ITB","PEJ"],
  "Energy":            ["XOP","OIH","AMLP","FCG","TAN","URA"],
  "Materials":         ["GDX","GDXJ","SIL","XME","COPX","LIT"],
  "Industrials":       ["ITA","JETS","IYT","PAVE"],
  "Real Estate":       ["VNQ","SCHH"],
  "Comm Services":     ["IYZ","ESPO"],
};
const SUB_ETF_LABELS = {
  SOXX:"Semiconductors", SMH:"Semiconductors", XSD:"Semis EW",
  IGV:"Software",        CLOU:"Cloud",          FDN:"Internet",
  CIBR:"Cybersecurity",  BOTZ:"Robotics/AI",    ESPO:"Gaming",
  IBB:"Biotech",         XBI:"Biotech EW",      IHI:"Med Devices",
  IHF:"Managed Care",    XHE:"HC Equip",        XHS:"HC Services", PJP:"Pharma",
  KBE:"Banks",           KRE:"Reg Banks",        KCE:"Cap Markets",
  KIE:"Insurance",       IAI:"Brokers",
  XRT:"Retail",          XHB:"Homebuilders",     ITB:"Home Const",  PEJ:"Leisure",
  XOP:"E&P",             OIH:"Oil Svcs",         AMLP:"Midstream",
  FCG:"Nat Gas",         TAN:"Solar",             URA:"Uranium",
  GDX:"Gold Miners",     GDXJ:"Jr Gold",          SIL:"Silver",
  XME:"Metals/Mining",   COPX:"Copper",           LIT:"Lithium",
  ITA:"Aerospace",       JETS:"Airlines",          IYT:"Transport", PAVE:"Infra",
  VNQ:"REITs",           SCHH:"REITs(Schwab)",
  IYZ:"Telecom",
};
const SUB_ETF_COLORS = {
  SOXX:"#00b4d8",SMH:"#0090c0",XSD:"#48cae4",IGV:"#4cc9f0",CLOU:"#90e0ef",FDN:"#023e8a",
  CIBR:"#a8dadc",BOTZ:"#0077b6",ESPO:"#00b4d8",
  IBB:"#90be6d",XBI:"#52b788",IHI:"#74c69d",XHE:"#b7e4c7",XHS:"#2d6a4f",PJP:"#40916c",IHF:"#1b4332",
  KBE:"#f9c74f",KRE:"#f4a261",KCE:"#e9c46a",KIE:"#f3722c",IAI:"#ffd166",
  XRT:"#ef233c",XHB:"#d62828",ITB:"#9d0208",PEJ:"#e85d04",
  XOP:"#f8961e",OIH:"#f3722c",AMLP:"#e07b39",FCG:"#fca311",TAN:"#f9844a",URA:"#ae2012",
  GDX:"#8ecae6",GDXJ:"#a8c8d8",SIL:"#c8e0f4",XME:"#457b9d",COPX:"#b5838d",LIT:"#6a994e",
  ITA:"#4d908e",JETS:"#577590",IYT:"#277da1",PAVE:"#1a759f",
  VNQ:"#f3722c",SCHH:"#e85d04",IYZ:"#ff70a6",
};

// ── JdK RS calculation ─────────────────────────────────────────────────────────
function ema(arr, period) {
  if (!arr.length) return [];
  const k = 2 / (period + 1);
  let e = arr[0]; const out = [e];
  for (let i = 1; i < arr.length; i++) { e = arr[i] * k + e * (1 - k); out.push(e); }
  return out;
}

function calcRRGSeries(etfCloses, spyCloses, barStep) {
  const len = Math.min(etfCloses.length, spyCloses.length);
  if (len < 30) return [];
  const ec = etfCloses.slice(-len), sc = spyCloses.slice(-len);
  const rs = ec.map((v, i) => sc[i] > 0 ? v / sc[i] : null);
  for (let i = 1; i < rs.length; i++) if (rs[i] === null) rs[i] = rs[i-1] || 1;
  if (rs[0] === null) rs[0] = 1;
  const sm1  = ema(rs, 10), sm2 = ema(sm1, 10);
  const base = sm2[0] || 1;
  const ratio = sm2.map(v => (v / base) * 100);
  const rocP  = 14;
  const mom   = ratio.map((v, i) => i < rocP ? 100 : ratio[i - rocP] > 0 ? (v / ratio[i - rocP]) * 100 : 100);
  const smoothMom = ema(mom, 5);
  const series = [];
  for (let i = barStep; i < ratio.length; i += barStep)
    series.push({ ratio: +ratio[i].toFixed(4), momentum: +smoothMom[i].toFixed(4) });
  const last = { ratio: +ratio[ratio.length-1].toFixed(4), momentum: +smoothMom[smoothMom.length-1].toFixed(4) };
  if (!series.length || series[series.length-1].ratio !== last.ratio) series.push(last);
  return series;
}

async function buildRRG(syms, labelMap, colorMap, identMap, spyCloses, barStep, trailLen) {
  const charts = {};
  const C = 8;
  for (let i = 0; i < syms.length; i += C) {
    const batch   = syms.slice(i, i + C);
    const results = await Promise.allSettled(batch.map(s => safeChart(s, 520)));
    batch.forEach((s, j) => { charts[s] = results[j].value; });
  }
  const rawSeries = {};
  for (const sym of syms) {
    const cl = charts[sym]?.closes || [];
    if (cl.length >= 30) rawSeries[sym] = calcRRGSeries(cl, spyCloses, barStep);
  }
  const valid = syms.filter(s => rawSeries[s]?.length);
  if (!valid.length) return {};
  const mean = arr => arr.reduce((a,b)=>a+b,0)/arr.length;
  const std  = arr => { const m=mean(arr); return Math.sqrt(arr.reduce((a,b)=>a+(b-m)**2,0)/arr.length)||1; };
  const lR = valid.map(s => rawSeries[s][rawSeries[s].length-1].ratio);
  const lM = valid.map(s => rawSeries[s][rawSeries[s].length-1].momentum);
  const rM=mean(lR),rS=std(lR), mM=mean(lM),mS=std(lM);
  const normR = v => +((v-rM)/rS*2+100).toFixed(3);
  const normM = v => +((v-mM)/mS*2+100).toFixed(3);
  const result = {};
  for (const sym of valid) {
    const trail = rawSeries[sym].slice(-(trailLen+1)).map(p=>({ ratio:normR(p.ratio), momentum:normM(p.momentum) }));
    if (trail.length < 2) continue;
    result[sym] = {
      sym, label: labelMap[sym]||sym, sector: identMap[sym]||sym, color: colorMap[sym]||"#7a9aaa",
      trail, current: trail[trail.length-1], prev: trail[trail.length-2],
      direction: trail[trail.length-1].ratio > trail[trail.length-2].ratio ? "right":"left",
    };
  }
  return result;
}

// ── GET /api/rrg ──────────────────────────────────────────────────────────────
rrgRouter.get("/api/rrg", async (req, res) => {
  const period   = (req.query.period   || "1m").toLowerCase();
  const trailLen = Math.min(parseInt(req.query.trail) || 7, 20);
  const mode     = (req.query.mode     || "sectors").toLowerCase();
  const sector   = req.query.sector    || null;

  const BAR_STEPS = { "1d":1,"1w":5,"mtd":5,"1m":21,"3m":21,"6m":42,"ytd":21,"1y":63 };
  const LOOKBACK  = { "1d":50,"1w":100,"mtd":100,"1m":200,"3m":300,"6m":400,"ytd":400,"1y":520 };
  const barStep  = BAR_STEPS[period] || 21;
  const lookback = LOOKBACK[period]  || 200;

  const ck  = `rrg:${mode}:${sector||"all"}:${period}:${trailLen}`;
  const hit = cache.get(ck, CACHE.CHART);
  if (hit) return res.json({ ...hit, cached: true });

  try {
    const spyChart  = await safeChart("SPY", lookback);
    const spyCloses = spyChart?.closes || [];
    if (!spyCloses.length) return res.status(500).json({ error: "SPY unavailable" });

    let syms, labelMap, colorMap, identMap;
    if (mode === "industry") {
      const srcSectors = sector ? [sector] : Object.keys(SUB_ETFS);
      syms = [...new Set(srcSectors.flatMap(s => SUB_ETFS[s] || []))];
      labelMap = SUB_ETF_LABELS;
      colorMap = SUB_ETF_COLORS;
      identMap = {};
      for (const [sec, etfs] of Object.entries(SUB_ETFS))
        etfs.forEach(e => { identMap[e] = sec; });
    } else {
      syms = ETF_SYMS_RRG;
      labelMap = SECTOR_FOR_ETF;
      colorMap = ETF_COLORS;
      identMap = SECTOR_FOR_ETF;
    }

    const etfs = await buildRRG(syms, labelMap, colorMap, identMap, spyCloses, barStep, trailLen);
    const allR = Object.values(etfs).flatMap(e => e.trail.map(p => p.ratio));
    const allM = Object.values(etfs).flatMap(e => e.trail.map(p => p.momentum));
    const pad  = 0.5;
    const out  = {
      etfs, mode, sector, period, trailLen,
      xMin: allR.length ? Math.min(Math.min(...allR)-pad, 97) : 97,
      xMax: allR.length ? Math.max(Math.max(...allR)+pad, 103): 103,
      yMin: allM.length ? Math.min(Math.min(...allM)-pad, 97) : 97,
      yMax: allM.length ? Math.max(Math.max(...allM)+pad, 103): 103,
      ts: new Date(),
    };
    cache.set(ck, out);
    res.json(out);
  } catch(e) { log.error(e.message); res.status(500).json({ error: e.message }); }
});
