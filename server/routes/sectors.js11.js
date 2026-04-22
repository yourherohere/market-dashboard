// server/routes/sectors.js — live sectors, themes, ETF drill-down, advance/decline
import { Router }   from "express";
import { cache }    from "../cache.js";
import { CACHE }    from "../config.js";
import { safeQuote, safeChart, normalise, runScreen } from "../data/yahoo.js";
import { enrichWithSectorIndustry, siCache } from "../data/enrichment.js";
import { yf, withTimeout } from "../data/yahoo.js";
import { log } from "../logger.js";

export const sectorsRouter = Router();

// ── GET /api/live/sectors ─────────────────────────────────────────────────────
sectorsRouter.get("/api/live/sectors", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 20);
  const ck    = `live-sectors:${limit}`;
  const hit   = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ sectors: hit, cached: true });
  try {
    let raw = await Promise.allSettled([
      runScreen("day_gainers",  200), runScreen("most_actives", 200),
      runScreen("day_losers",   100), runScreen("small_cap_gainers", 100),
    ]).then(r => r.flatMap(x => x.value || []));
    const seen = new Set();
    raw = raw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
    let tickers = raw.map(normalise).filter(Boolean);
    tickers = await enrichWithSectorIndustry(tickers);
    const byS = {};
    for (const t of tickers) {
      if (!t.sector) continue;
      if (!byS[t.sector]) byS[t.sector] = [];
      byS[t.sector].push(t);
    }
    const sectors = Object.entries(byS)
      .map(([name, stocks]) => ({
        name,
        stocks: stocks.sort((a,b)=>Math.abs(b.change||0)-Math.abs(a.change||0)).slice(0, limit),
        avgChg: stocks.reduce((s,t)=>s+(t.change||0),0)/stocks.length,
        count:  stocks.length,
      }))
      .sort((a,b) => Math.abs(b.avgChg) - Math.abs(a.avgChg));
    cache.set(ck, sectors);
    res.json({ sectors, cached: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/live/themes ──────────────────────────────────────────────────────
sectorsRouter.get("/api/live/themes", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 8, 20);
  const ck    = `live-themes:${limit}`;
  const hit   = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ themes: hit, cached: true });
  try {
    let raw = await Promise.allSettled([
      runScreen("day_gainers",  200), runScreen("most_actives", 150),
      runScreen("growth_technology_stocks", 100),
    ]).then(r => r.flatMap(x => x.value || []));
    const seen = new Set();
    raw = raw.filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; });
    let tickers = raw.map(normalise).filter(Boolean);
    tickers = await enrichWithSectorIndustry(tickers);
    const byI = {};
    for (const t of tickers) {
      if (!t.industry) continue;
      if (!byI[t.industry]) byI[t.industry] = [];
      byI[t.industry].push(t);
    }
    const themes = Object.entries(byI)
      .filter(([, stocks]) => stocks.length >= 2)
      .map(([name, stocks]) => ({
        name,
        stocks: stocks.sort((a,b)=>(b.change||0)-(a.change||0)).slice(0, 8),
        avgChg: stocks.reduce((s,t)=>s+(t.change||0),0)/stocks.length,
        count:  stocks.length,
      }))
      .sort((a,b)=>Math.abs(b.avgChg)-Math.abs(a.avgChg))
      .slice(0, limit);
    cache.set(ck, themes);
    res.json({ themes, cached: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/etf/stocks ───────────────────────────────────────────────────────
sectorsRouter.get("/api/etf/stocks", async (req, res) => {
  const etfSym    = (req.query.etf || "").toUpperCase();
  const industries = (req.query.industries || "").split(",").map(s=>s.trim()).filter(Boolean);
  const sector    = req.query.sector || null;
  const limit     = Math.min(parseInt(req.query.limit) || 12, 25);
  if (!etfSym) return res.status(400).json({ error: "etf required" });

  const ck  = `etf-stocks:${etfSym}:${industries.join("|")}`;
  const hit = cache.get(ck, 90_000);
  if (hit) return res.json({ ...hit, cached: true });

  log.info(`/api/etf/stocks [${etfSym}]`);
  try {
    const pools = await Promise.allSettled([
      runScreen("day_gainers", 150), runScreen("most_actives", 150),
      runScreen("day_losers",  100), runScreen("small_cap_gainers", 80),
      runScreen("growth_technology_stocks", 80),
    ]);
    const seen = new Set();
    let tickers = pools.flatMap(r => r.value || [])
      .filter(q => { if (seen.has(q.symbol)) return false; seen.add(q.symbol); return true; })
      .map(normalise).filter(Boolean);
    tickers = await enrichWithSectorIndustry(tickers);
    const indSet = new Set(industries.map(i => i.toLowerCase()));
    let filtered = tickers.filter(t => {
      if (!t.industry) return false;
      const ind = t.industry.toLowerCase();
      if (indSet.size > 0) {
        for (const ri of indSet) {
          if (ind.includes(ri.split("—")[0].toLowerCase()) || ri.includes(ind.split("—")[0].toLowerCase()))
            return true;
        }
      }
      return sector && t.sector === sector;
    });
    if (filtered.length < 5 && sector) filtered = tickers.filter(t => t.sector === sector);

    const candidates = [...filtered]
      .sort((a,b)=>Math.abs(b.change||0)-Math.abs(a.change||0))
      .slice(0, limit + 5);

    // Enrich with period returns from chart
    const C = 6;
    const chartMap = {};
    for (let i = 0; i < candidates.length; i += C) {
      const batch = candidates.slice(i, i + C);
      const r = await Promise.allSettled(batch.map(t => safeChart(t.symbol, 260)));
      batch.forEach((t, j) => { chartMap[t.symbol] = r[j].value || null; });
    }
    const yr = new Date().getFullYear(), mo = new Date().getMonth();
    const ytdTs = Math.floor(new Date(yr,0,1).getTime()/1000);
    const mtdTs = Math.floor(new Date(yr,mo,1).getTime()/1000);
    const calcR = (cl, n) => {
      if (!cl?.length || cl.length <= n) return null;
      const now=cl[cl.length-1], then=cl[cl.length-1-n];
      return then>0?+((now-then)/then*100).toFixed(2):null;
    };
    const calcSince = (cl, ts, tgt) => {
      if (!cl?.length||!ts?.length) return null;
      let idx=ts.findIndex(t=>t>=tgt); if(idx<0) idx=0;
      const from=cl[idx],now=cl[cl.length-1];
      return from>0?+((now-from)/from*100).toFixed(2):null;
    };

    const enriched = candidates.slice(0, limit).map(t => {
      const cd=chartMap[t.symbol];
      const cl=cd?.closes||[], ts=cd?.timestamps||[];
      return { ...t, d5:calcR(cl,5), dMTD:calcSince(cl,ts,mtdTs), d1m:calcR(cl,21),
        d3m:calcR(cl,63), d6m:calcR(cl,126), dYTD:calcSince(cl,ts,ytdTs), d1y:calcR(cl,252) };
    });

    const out = { stocks: enriched, etf: etfSym, industries, sector, ts: new Date() };
    cache.set(ck, out);
    res.json(out);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/advance-decline ─────────────────────────────────────────────────
sectorsRouter.get("/api/advance-decline", async (req, res) => {
  const days = parseInt(req.query.days) || 126;
  const ck   = `ad:${days}`;
  const hit  = cache.get(ck, CACHE.AD);
  if (hit) return res.json({ ...hit, cached: true });
  log.info("/api/advance-decline");
  try {
    const [advnChart, decnChart, addqChart, dclqChart, spyChart] = await Promise.allSettled([
      safeChart("^ADVN", days+30), safeChart("^DECN", days+30),
      safeChart("^ADDQ", days+30), safeChart("^DCLQ", days+30),
      safeChart("SPY",   days+30),
    ]);

    const buildADFromCounts = (advRes, decRes) => {
      const adv=advRes.value, dec=decRes.value;
      if (!adv?.closes?.length || !dec?.closes?.length) return null;
      const n=Math.min(days, adv.closes.length);
      const advS=adv.closes.slice(-n), tsS=adv.timestamps.slice(-n), decS=dec.closes.slice(-n);
      let cum=0; const raw=[], cumLine=[];
      for (let i=0;i<advS.length;i++) {
        const a=advS[i]||0, d=decS[i]||0, net=a-d;
        cum+=net;
        raw.push({ts:tsS[i],value:net,adv:a,dec:d});
        cumLine.push({ts:tsS[i],value:+cum.toFixed(0)});
      }
      return { raw, cumulative:cumLine, latest:raw[raw.length-1]?.value??0, latestCum:cum,
        latestAdv:advS[advS.length-1]??0, latestDec:decS[decS.length-1]??0 };
    };

    const nyseAD   = buildADFromCounts(advnChart, decnChart);
    const nasdaqAD = buildADFromCounts(addqChart, dclqChart);

    // SP500 proxy
    const SP500 = [
      "AAPL","MSFT","NVDA","AVGO","ORCL","TXN","QCOM","AMD","MU","AMAT",
      "UNH","JNJ","LLY","ABBV","MRK","TMO","ABT","DHR","ISRG","VRTX",
      "JPM","BAC","GS","MS","WFC","BLK","SCHW","AXP","V","MA",
      "AMZN","TSLA","HD","MCD","NKE","TGT","SBUX","LOW","BKNG","GM",
      "XOM","CVX","COP","SLB","PSX","EOG","MPC","VLO","OXY","HAL",
      "LIN","APD","FCX","NEM","NUE","VMC","MLM","ALB","STLD","CE",
      "GE","HON","CAT","DE","UPS","RTX","BA","LMT","NOC","FDX",
      "GOOGL","META","NFLX","DIS","CMCSA","T","VZ","SNAP","PINS","RBLX",
      "WMT","COST","PG","KO","PEP","PM","MO","CL","MDLZ","KHC",
      "NEE","DUK","SO","D","AEP","EXC","XEL","PCG","SRE","PPL",
      "PLD","AMT","EQIX","WELL","SPG","PSA","O","VICI","DLR","REG",
    ];
    const sp500Charts={};
    for (let i=0;i<SP500.length;i+=10) {
      const batch=SP500.slice(i,i+10);
      const r=await Promise.allSettled(batch.map(s=>safeChart(s,days+30)));
      batch.forEach((s,j)=>{sp500Charts[s]=r[j].value;});
    }
    const spyCloses=spyChart.value?.closes?.slice(-(days+30))||[];
    const spyTs=spyChart.value?.timestamps?.slice(-(days+30))||[];
    const spyN=Math.min(days,spyCloses.length);
    let sp500Cum=0;
    const sp500Daily=[], sp500Cum2=[];
    for (let di=0;di<spyN;di++) {
      const ts=spyTs[di]; let adv=0,dec=0,unch=0;
      for (const sym of SP500) {
        const cd=sp500Charts[sym]; if(!cd?.closes?.length||!cd?.timestamps?.length) continue;
        const idx=cd.timestamps.findIndex(t=>Math.abs(t-ts)<43200); if(idx<1) continue;
        const prev=cd.closes[idx-1],curr=cd.closes[idx]; if(!prev||!curr) continue;
        if(curr>prev*1.001)adv++; else if(curr<prev*0.999)dec++; else unch++;
      }
      if(adv+dec<10) continue;
      const net=adv-dec; sp500Cum+=net;
      sp500Daily.push({ts,adv,dec,unch,net,advPct:+(adv/(adv+dec+unch)*100).toFixed(1),ratio:dec>0?+(adv/dec).toFixed(2):9.99});
      sp500Cum2.push({ts,value:+sp500Cum.toFixed(0)});
    }

    const spySeries=spyTs.slice(-spyN).map((ts,i)=>({ts,value:spyCloses.slice(-spyN)[i]}));
    const out={nyseAD,nasdaqAD,sp500:{daily:sp500Daily,cumulative:sp500Cum2,symCount:SP500.length},spySeries,days,ts:new Date()};
    cache.set(ck,out);
    log.ok(`A/D: NYSE=${nyseAD?.raw?.length||0}d NASDAQ=${nasdaqAD?.raw?.length||0}d SP500=${sp500Daily.length}d`);
    res.json(out);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── GET /api/scan/sectors ─────────────────────────────────────────────────────
sectorsRouter.get("/api/scan/sectors", async (req, res) => {
  const ck  = "scan-sectors";
  const hit = cache.get(ck, CACHE.SCAN);
  if (hit) return res.json({ sectors: hit, cached: true });
  try {
    let raw = await Promise.allSettled([
      runScreen("most_actives",200), runScreen("day_gainers",150),
    ]).then(r => r.flatMap(x => x.value||[]));
    const seen=new Set();
    raw=raw.filter(q=>{if(seen.has(q.symbol))return false;seen.add(q.symbol);return true;});
    let tickers=raw.map(normalise).filter(Boolean);
    tickers=await enrichWithSectorIndustry(tickers);
    const byS={};
    for (const t of tickers) {
      if(!t.sector) continue;
      if(!byS[t.sector]) byS[t.sector]={name:t.sector,tickers:[],totalChg:0};
      byS[t.sector].tickers.push(t);
      byS[t.sector].totalChg+=(t.change||0);
    }
    const sectors=Object.values(byS)
      .map(s=>({...s,avgChg:s.totalChg/s.tickers.length,count:s.tickers.length}))
      .sort((a,b)=>Math.abs(b.avgChg)-Math.abs(a.avgChg));
    cache.set(ck,sectors);
    res.json({sectors,cached:false});
  } catch(e){res.status(500).json({error:e.message});}
});
