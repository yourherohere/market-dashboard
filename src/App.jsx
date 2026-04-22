// src/App.jsx
import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { ThemeCtx, useThemeToggle, THEME } from "./hooks/useTheme.js";
import { ALL_ETF_SYMS, INDEX_SYMS, GICS }  from "./constants/gics.js";
import { calcRet, calcRetSince, soM, soY, gc, pct, fmt, fmtMcap, sparkPath } from "./utils/format.js";
import { Spark, McapBadge, ScoreDial, LoadingDots, UniverseStatus } from "./components/common/index.jsx";

// Lazy-loaded tabs (each is its own file)
const PremarketTab      = lazy(()=>import("./components/tabs/PremarketTab.jsx"));
const ScannerTab        = lazy(()=>import("./components/tabs/ScannerTab.jsx"));
const RotationTab       = lazy(()=>import("./components/tabs/RotationTab.jsx"));
const ConditionsTab     = lazy(()=>import("./components/tabs/ConditionsTab.jsx"));
const CockpitTab        = lazy(()=>import("./components/tabs/CockpitTab.jsx"));
const ThemesTab         = lazy(()=>import("./components/tabs/ThemesTab.jsx"));
const SectorsTab        = lazy(()=>import("./components/tabs/SectorsTab.jsx"));
const HeatmapTab        = lazy(()=>import("./components/tabs/HeatmapTab.jsx"));
const IntelligenceTab   = lazy(()=>import("./components/tabs/IntelligenceTab.jsx"));

const TABS = [
  { key:"premarket",     label:"🌅 PREMARKET"  },
  { key:"scanner",       label:"⚡ SCANNER"    },
  { key:"rotation",      label:"🔄 ROTATION"   },
  { key:"conditions",    label:"CONDITIONS"    },
  { key:"intelligence",  label:"🧠 INTEL"      },
  { key:"cockpit",       label:"COCKPIT V2"    },
  { key:"themes",        label:"THEMES"        },
  { key:"sectors",       label:"SECTORS"       },
  { key:"heatmap",       label:"HEATMAP"       },
];

const BASE = "http://localhost:3001";
async function apiFetch(path) {
  const res = await fetch(BASE + path, { headers: { "Content-Type":"application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status + " — " + path);
  return res.json();
}

const calcEMA = (c, n) => {
  if (!c?.length || c.length < n) return null;
  const k = 2/(n+1);
  let e = c.slice(0,n).reduce((a,b)=>a+b,0)/n;
  c.slice(n).forEach(v => { e = v*k + e*(1-k); });
  return e;
};

async function loadAllData(onProgress) {
  onProgress("Checking server…");
  await apiFetch("/api/health").catch(() => { throw new Error("Server not running — open Terminal and run: node server/index.js"); });

  const ALL_WATCH = [...new Set(Object.values(GICS).flatMap(g => g.syms))];
  const ALL_SYMS  = [...new Set([...ALL_WATCH, ...INDEX_SYMS, ...ALL_ETF_SYMS, "^VIX"])];

  onProgress(`Loading ${ALL_SYMS.length} quotes…`);
  const BATCH = 50;
  const quotes = {};
  for (let i = 0; i < ALL_SYMS.length; i += BATCH) {
    const syms = ALL_SYMS.slice(i, i + BATCH);
    try {
      const r = await apiFetch("/api/quotes?symbols=" + syms.join(","));
      if (r.data) Object.assign(quotes, r.data);
    } catch {}
  }

  onProgress("Loading chart history…");
  const [wc, ic, ec] = await Promise.all([
    apiFetch("/api/charts?symbols=" + [...ALL_WATCH, "SPY"].join(",") + "&range=1y"),
    apiFetch("/api/charts?symbols=" + INDEX_SYMS.join(",") + "&range=1y"),
    apiFetch("/api/charts?symbols=" + ALL_ETF_SYMS.join(",") + "&range=1y"),
  ]);
  const watchCharts = wc.data || {}, idxCharts = ic.data || {}, etfChartsData = ec.data || {};

  onProgress("Computing signals…");
  const buildTicker = (sym, gType, gName) => {
    const q = quotes[sym] || {}, cd = watchCharts[sym] || {};
    const cl = cd.closes || [], ts = cd.timestamps || [];
    const price = q.regularMarketPrice ?? 0;
    const d1    = q.regularMarketChangePercent ?? 0;
    const vol   = q.regularMarketVolume ?? 0;
    const avg   = q.averageDailyVolume10Day || vol || 1;
    const e20   = cl.length>=25 ? calcEMA(cl.slice(-100),20) : null;
    const e50   = cl.length>=55 ? calcEMA(cl.slice(-200),50) : null;
    const e200  = cl.length>=205? calcEMA(cl.slice(-400),200): null;
    return {
      sym, groupType:gType, groupName:gName,
      name:(q.shortName||sym).replace(/,?\s?(Inc\.?|Corp\.?|Ltd\.?)$/i,"").trim().substring(0,18),
      price, d1,
      d5:   calcRet(cl,5)??0,
      dMTD: calcRetSince(cl,ts,soM())??0,
      d1m:  calcRet(cl,21)??0,
      d3m:  calcRet(cl,63)??0,
      d6m:  calcRet(cl,126)??0,
      dYTD: calcRetSince(cl,ts,soY())??0,
      d1y:  calcRet(cl,252)??0,
      volRatio: +(vol/Math.max(avg,1)).toFixed(2),
      marketCap: q.marketCap??null,
      ema20s:  e20  ? (price>e20 ?"ABOVE":"BELOW"):"N/A",
      ema50s:  e50  ? (price>e50 ?"ABOVE":"BELOW"):"N/A",
      ema200s: e200 ? (price>e200?"ABOVE":"BELOW"):"N/A",
      closes: cl.slice(-30), hasData: price>0,
    };
  };

  const themeTickers=[], sectorTickers=[];
  for (const [nm,cfg] of Object.entries(GICS)) {
    for (const sym of cfg.syms) {
      themeTickers.push(buildTicker(sym,"theme",nm));
      sectorTickers.push(buildTicker(sym,"sector",nm));
    }
  }

  const indices = {};
  INDEX_SYMS.forEach(sym => {
    const q=quotes[sym]||{}, hd=idxCharts[sym]||{}, cl=hd.closes||[], ts=hd.timestamps||[];
    indices[sym]={
      price:q.regularMarketPrice??0, d1:q.regularMarketChangePercent??0,
      d5:calcRet(cl,5)??0, dMTD:calcRetSince(cl,ts,soM())??0,
      d1m:calcRet(cl,21)??0, d3m:calcRet(cl,63)??0,
      d6m:calcRet(cl,126)??0, dYTD:calcRetSince(cl,ts,soY())??0, d1y:calcRet(cl,252)??0,
      a50: q.fiftyDayAverage?(q.regularMarketPrice??0)>q.fiftyDayAverage:false,
      a200:q.twoHundredDayAverage?(q.regularMarketPrice??0)>q.twoHundredDayAverage:false,
      closes:cl.slice(-22),
    };
  });

  const etfQuotes = {};
  ALL_ETF_SYMS.forEach(sym => {
    const q=quotes[sym], cd=etfChartsData[sym]||{};
    if (!q?.regularMarketPrice) return;
    const cl=cd.closes||[], ts=cd.timestamps||[];
    etfQuotes[sym]={
      sym, price:q.regularMarketPrice??0, d1:q.regularMarketChangePercent??0,
      d5:calcRet(cl,5)??null, dMTD:calcRetSince(cl,ts,soM())??null,
      d1m:calcRet(cl,21)??null, d3m:calcRet(cl,63)??null,
      d6m:calcRet(cl,126)??null, dYTD:calcRetSince(cl,ts,soY())??null,
      d1y:calcRet(cl,252)??null,
      volume:q.regularMarketVolume??0, avgVol:q.averageDailyVolume10Day??0,
      a50: q.fiftyDayAverage?(q.regularMarketPrice??0)>q.fiftyDayAverage:null,
      a200:q.twoHundredDayAverage?(q.regularMarketPrice??0)>q.twoHundredDayAverage:null,
      shortName:q.shortName||sym,
    };
  });

  const vix = quotes["^VIX"]?.regularMarketPrice ?? 0;
  const n   = themeTickers.filter(t=>t.hasData).length || 1;
  const aboveEMA  = themeTickers.filter(t=>t.ema20s==="ABOVE").length;
  const above50c  = themeTickers.filter(t=>t.ema50s==="ABOVE").length;
  const bkCount   = 0;
  const vixS  = Math.round(Math.max(0,Math.min(100,(40-vix)/25*100)));
  const brdS  = Math.round(aboveEMA/n*100);
  const ma50S = Math.round(above50c/n*100);
  const momS  = Math.round(Math.max(0,Math.min(100,50+themeTickers.reduce((s,t)=>s+t.d1,0)/n*5)));
  const setS  = Math.round(bkCount/n*100);
  const score = Math.round((brdS+ma50S+vixS+momS+setS)/5);
  const subs  = [
    {label:"Breadth (EMA20)", score:brdS, desc:`${aboveEMA}/${n} above EMA20`},
    {label:"Trend (EMA50)",   score:ma50S, desc:`${above50c}/${n} above EMA50`},
    {label:"VIX",             score:vixS, desc:`VIX ${vix.toFixed(2)}`},
    {label:"1D Momentum",     score:momS, desc:`Avg ${(themeTickers.reduce((s,t)=>s+t.d1,0)/n).toFixed(2)}%`},
    {label:"Setups",          score:setS, desc:`${bkCount} breakout/buy-zone`},
  ];

  onProgress("Fetching live sector data…");
  const [lsRes, ltRes] = await Promise.allSettled([
    apiFetch("/api/live/sectors?limit=10"),
    apiFetch("/api/live/themes?limit=8"),
  ]);

  const themes  = Object.fromEntries(Object.entries(GICS).map(([nm,c])=>[nm,{...c, tickers:themeTickers.filter(t=>t.groupName===nm)}]));
  const sectors = Object.fromEntries(Object.entries(GICS).map(([nm,c])=>[nm,{...c, tickers:sectorTickers.filter(t=>t.groupName===nm)}]));
  const rankThemes  = Object.entries(themes).sort((a,b)=>b[1].tickers.reduce((s,t)=>s+t.d1,0)/(b[1].tickers.length||1)-a[1].tickers.reduce((s,t)=>s+t.d1,0)/(a[1].tickers.length||1));

  return {
    quotes, indices, etfQuotes, vix, score,
    label: score<30?"BEARISH":score<50?"CAUTION":score<70?"NEUTRAL":"BULLISH",
    subs, themes, sectors, rankThemes, themeTickers, sectorTickers,
    liveSectors: lsRes.value?.sectors || null,
    liveThemes:  ltRes.value?.themes  || null,
    fetchedCount: Object.values(quotes).filter(Boolean).length,
    totalSyms: ALL_SYMS.length,
    lastUpdated: new Date(),
  };
}

// Ticker tape component
function TickerTape({ quotes }) {
  const syms = Object.keys(quotes).filter(s => !s.includes("^")).slice(0,30);
  if (!syms.length) return null;
  return (
    <div style={{overflow:"hidden",background:"#020406",borderBottom:"1px solid #0e1f2b",height:28,display:"flex",alignItems:"center",paddingLeft:12}}>
      {syms.map(sym => {
        const q = quotes[sym]; if (!q) return null;
        const chg = q.regularMarketChangePercent ?? 0;
        const c   = chg>0?"#00e87a":chg<0?"#ff4560":"#7a9aaa";
        return <span key={sym} style={{marginRight:22,whiteSpace:"nowrap",fontFamily:"monospace",fontSize:10}}>
          <span style={{color:"#8090a0",marginRight:4}}>{sym}</span>
          <span style={{color:c,fontWeight:700}}>{chg>=0?"+":""}{chg.toFixed(2)}%</span>
        </span>;
      })}
    </div>
  );
}

// Error boundary component
function ErrorFallback({ error, retry }) {
  return (
    <div style={{background:"#06090d",border:"1px solid #ff4560",borderRadius:6,padding:32,maxWidth:560,margin:"40px auto",textAlign:"center"}}>
      <div style={{fontFamily:"monospace",fontSize:15,color:"#ff4560",marginBottom:12}}>❌ Something went wrong</div>
      <div style={{fontFamily:"monospace",fontSize:11,color:"#8090a0",marginBottom:8,fontWeight:700}}>{error?.message || "Unknown error"}</div>
      <div style={{fontFamily:"monospace",fontSize:10,color:"#506070",marginBottom:24,lineHeight:1.6}}>
        Make sure the server is running:<br/>
        <span style={{color:"#00e87a"}}>cd market-dashboard && node server/index.js</span>
      </div>
      <button onClick={retry} style={{fontFamily:"monospace",fontSize:11,padding:"8px 24px",
        background:"rgba(0,232,122,.1)",color:"#00e87a",border:"1px solid rgba(0,232,122,.3)",
        borderRadius:4,cursor:"pointer"}}>↺  TRY AGAIN</button>
    </div>
  );
}

export default function App() {
  const { mode, toggle, T, dark } = useThemeToggle();
  const [tab,      setTab]      = useState("scanner");
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [progress, setProgress] = useState("Starting…");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try   { setData(await loadAllData(setProgress)); }
    catch (e) { setError(e); }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, []);
  useEffect(() => { const t=setInterval(()=>{ if(!loading) load(); },90_000); return()=>clearInterval(t); }, [loading,load]);

  // Loading screen
  if (loading && !data) return (
    <ThemeCtx.Provider value={mode}>
      <div style={{background:"#040710",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20}}>
        <div style={{display:"flex",gap:6}}>
          {[0,1,2,3,4].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"#00e87a",animation:`bn 1s ${i*.15}s infinite`}}/>)}
        </div>
        <div style={{fontFamily:"monospace",fontSize:12,color:"#00e87a",letterSpacing:".1em"}}>{progress}</div>
        <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint}}>Market Dashboard is loading live data…</div>
      </div>
    </ThemeCtx.Provider>
  );

  // Error screen
  if (error) return (
    <ThemeCtx.Provider value={mode}>
      <div style={{background:"#040710",minHeight:"100vh"}}><ErrorFallback error={error} retry={load}/></div>
    </ThemeCtx.Provider>
  );

  const { quotes={}, indices={}, etfQuotes={}, liveSectors, liveThemes, themes={}, sectors={},
          rankThemes=[], themeTickers=[], sectorTickers=[], score=0, label="", subs=[],
          fetchedCount=0, totalSyms=0, lastUpdated, vix=0 } = data || {};

  const sc = score<30?"#ff4560":score<50?"#ff9f1c":score<70?"#ffe040":"#00e87a";
  const ts = lastUpdated?.toLocaleTimeString("en-US",{hour12:false}) || "";

  const tabProps = { indices, etfQuotes, liveSectors, liveThemes, themes, sectors,
    rankThemes, themeTickers, sectorTickers, score, subs, quotes, vix };

  return (
    <ThemeCtx.Provider value={mode}>
      <div data-theme={mode} style={{background:T.bg,color:T.text,minHeight:"100vh",
        fontFamily:"'JetBrains Mono','Fira Code',Consolas,monospace",
        transition:"background .2s,color .2s"}}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap');
          *, *::before, *::after { box-sizing: border-box; }
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: ${T.scrollThumb}; border-radius: 3px; }
          ::-webkit-scrollbar-thumb:hover { background: ${T.scrollHover}; }
          ::selection { background: ${T.accentBlue}30; color: ${T.text}; }
          input, select, textarea { background: ${T.inputBg}; color: ${T.inputText}; border-color: ${T.inputBorder}; }
          input::placeholder { color: ${T.placeholder} !important; }
          select option { background: ${T.surface}; color: ${T.text}; }
          input:focus, select:focus { outline: none; border-color: ${T.accentBlue} !important; box-shadow: 0 0 0 2px ${T.accentBlue}20; }
          input[type=range] { accent-color: ${T.accentPurple}; }
          input[type=checkbox] { accent-color: ${T.accentPurple}; }
          button:focus { outline: none; }
          @keyframes bn{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}
          @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
          @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}

          /* ── CSS custom properties from theme tokens ── */
          :root {
            --clr-up:      ${T.up};
            --clr-dn:      ${T.down};
            --clr-up-soft: ${dark ? "#4ddb9e" : "#1a9e4a"};
            --clr-dn-soft: ${dark ? "#ff7070" : "#e05050"};
            --clr-warn:    ${T.warn};
            --clr-info:    ${T.info};
            --clr-accent:  ${T.accent};
            --clr-blue:    ${T.accentBlue};
            --clr-purple:  ${T.accentPurple};
            --clr-cyan:    ${T.accentCyan};
            --clr-text:    ${T.text};
            --clr-mid:     ${T.textMid};
            --clr-dim:     ${T.textDim};
            --clr-faint:   ${T.textFaint};
            --clr-bg:      ${T.bg};
            --clr-surface: ${T.surface};
            --clr-surface2:${T.surface2};
            --clr-border:  ${T.border};
            --clr-border2: ${T.border2};
          }
        `}</style>

        {/* Header */}
        <div style={{background:T.header,borderBottom:`1px solid ${T.border}`,position:"sticky",top:0,zIndex:100}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
            padding:"0 18px",height:50,gap:8,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:22,height:22,background:T.accent,
                clipPath:"polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)",
                boxShadow:`0 0 14px ${T.accent}70`,flexShrink:0}}/>
              <span style={{fontSize:13,fontWeight:700,color:dark?"#fff":"#0a1525",letterSpacing:".04em"}}>MARKET DASHBOARD</span>
              <span style={{fontSize:9,color:T.textFaint,borderLeft:`1px solid ${T.border}`,paddingLeft:12}}>
                {fetchedCount}/{totalSyms} quotes
              </span>
              <UniverseStatus/>
              <span style={{fontSize:9,color:T.accent,fontWeight:600}}>{ts}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,background:`${sc}10`,
                border:`1px solid ${sc}30`,padding:"5px 14px",borderRadius:3}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:sc,animation:"pulse 1.4s infinite"}}/>
                <span style={{fontSize:12,fontWeight:700,color:sc,letterSpacing:".05em"}}>{label} ({score}/100)</span>
              </div>
              {Object.entries(indices).slice(0,4).map(([sym,d])=>(
                <div key={sym} style={{textAlign:"center",minWidth:46}}>
                  <div style={{fontSize:8,color:T.textFaint}}>{sym}</div>
                  <div style={{fontSize:11,color:gc(d.d1),fontWeight:700}}>{d.d1>=0?"+":""}{d.d1.toFixed(2)}%</div>
                </div>
              ))}
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:8,color:T.textFaint}}>VIX</div>
                <div style={{fontSize:11,color:vix>25?"#ff4560":vix>18?"#ff9f1c":"#00e87a",fontWeight:700}}>{vix.toFixed(2)}</div>
              </div>
              <button onClick={toggle} style={{
                fontFamily:"inherit",fontSize:11,fontWeight:600,
                padding:"6px 14px",borderRadius:20,cursor:"pointer",
                border:`1px solid ${T.border2}`,
                background: dark ? T.surface2 : "#1c2230",
                color: dark ? T.textMid : "#cdd9e5",
                display:"flex",alignItems:"center",gap:7,
                transition:"all .2s",letterSpacing:".03em",
              }}>
                <span style={{fontSize:14,lineHeight:1}}>{dark ? "☀️" : "🌙"}</span>
                <span>{dark ? "DAY" : "NIGHT"}</span>
              </button>
            </div>
          </div>

          <TickerTape quotes={quotes}/>

          {/* Tab bar */}
          <div style={{display:"flex",padding:"0 18px",borderTop:`1px solid ${T.border}`}}>
            {TABS.map(t=>(
              <button key={t.key} onClick={()=>setTab(t.key)}
                style={{fontFamily:"monospace",fontSize:10,padding:"10px 18px",border:"none",
                  borderBottom:tab===t.key?`2px solid ${T.accent}`:"2px solid transparent",
                  background:"transparent",color:tab===t.key?T.accent:T.textDim,
                  cursor:"pointer",fontWeight:tab===t.key?"700":"400",
                  letterSpacing:".05em",transition:"color .15s"}}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{padding:"16px 18px",maxWidth:1800,margin:"0 auto"}}>
          <Suspense fallback={<LoadingDots/>}>
            {tab==="premarket"     && <PremarketTab/>}
            {tab==="scanner"       && <ScannerTab/>}
            {tab==="rotation"      && <RotationTab etfQuotes={etfQuotes}/>}
            {tab==="conditions"    && <ConditionsTab score={score} subs={subs} indices={indices} vix={vix}/>}
            {tab==="intelligence"  && <IntelligenceTab/>}
            {tab==="cockpit"       && <CockpitTab themes={themes} sectors={sectors} liveThemes={liveThemes} liveSectors={liveSectors}/>}
            {tab==="themes"        && <ThemesTab staticThemes={themes} staticRankThemes={rankThemes} liveThemes={liveThemes}/>}
            {tab==="sectors"       && <SectorsTab sectors={sectors} spySrc={indices.SPY} etfQuotes={etfQuotes} liveSectors={liveSectors}/>}
            {tab==="heatmap"       && <HeatmapTab themes={themes} sectors={sectors}/>}
          </Suspense>
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}
