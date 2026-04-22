import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTheme, THEME } from "../../hooks/useTheme.js";
import { Spark, McapBadge, EmaBadge, PctCell, LoadingDots, ScoreDial } from "../common/index.jsx";
import { pct, fmt, gc, fmtMcap, fmtVol, calcRet, calcRetSince, soM, soY, sparkPath } from "../../utils/format.js";
import { GICS, ALL_ETF_SYMS, SECTOR_ETF_SYMS, SUB_ETF_SYMS, secCol, INDEX_SYMS } from "../../constants/gics.js";

const BASE = "http://localhost:3001";
async function apiFetch(path, opts={}) {
  const url = path.startsWith("http") ? path : BASE + path;
  const res = await fetch(url, { headers:{"Content-Type":"application/json"}, ...opts });
  if (!res.ok) { const e=await res.json().catch(()=>({error:res.statusText})); throw new Error(e.error||"HTTP "+res.status); }
  return res.json();
}

const heat = v => {
  if(v>=5)  return{bg:"rgba(0,232,122,.25)",fg:T.accent};
  if(v>=2)  return{bg:"rgba(0,232,122,.12)",fg:T.accent};
  if(v>=0)  return{bg:"rgba(0,232,122,.05)",fg:"#7ab89a"};
  if(v>=-2) return{bg:"rgba(255,69,96,.05)",fg:"#d08080"};
  if(v>=-5) return{bg:"rgba(255,69,96,.12)",fg:"#ff6060"};
  return      {bg:"rgba(255,69,96,.25)",fg:T.down};
};

const calcRS = (secRet, spyRet) => {
  if (secRet==null||spyRet==null||spyRet===0) return null;
  return +(((1+secRet/100)/(1+spyRet/100))*100-100).toFixed(2);
};
const calcCompositeRS = (s, spy) => {
  const w1m=calcRS(s.d1m,spy.d1m), w3m=calcRS(s.d3m,spy.d3m), w6m=calcRS(s.d6m,spy.d6m);
  if(w1m==null&&w3m==null&&w6m==null) return null;
  return +((w1m||0)*0.25+(w3m||0)*0.35+(w6m||0)*0.40).toFixed(2);
};

function SigBadge({ sig }) {
  const colors = { BREAKOUT:T.accent, "BUY ZONE":T.accent, PULLBACK:"#ff9f1c", BREAKDOWN:T.down };
  const c = colors[sig] || T.textDim;
  if (!sig) return null;
  return <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,color:c,
    background:`${c}18`,border:`1px solid ${c}30`,padding:"1px 5px",borderRadius:2}}>{sig}</span>;
}

function calcEMASeries(candles, period) {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((a, b) => a + b.close, 0) / period;
  const out = [];
  candles.forEach((c, i) => {
    if (i < period - 1) return;
    if (i === period - 1) { out.push({ time: c.time, value: +ema.toFixed(4) }); return; }
    ema = c.close * k + ema * (1 - k);
    out.push({ time: c.time, value: +ema.toFixed(4) });
  });
  return out;
}

function TVChartPopup({ symbol, onClose }) {
  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState(null);
  const [info,    setInfo]    = useState(null);
  const themeKey = useTheme();
  const T = THEME[themeKey] || THEME.night;

  const W = Math.max(480, Math.floor(window.innerWidth * 0.50));

  function destroyChart() {
    if (chartRef.current) {
      try { chartRef.current.remove(); } catch(e) {}
      chartRef.current = null;
    }
  }

  async function buildChart() {
    if (!containerRef.current) return;
    setLoading(true); setErr(null); setInfo(null);
    try {
      const res = await fetch("http://localhost:3001/api/candles?symbol=" + encodeURIComponent(symbol) + "&days=365");
      if (!res.ok) throw new Error("API error " + res.status);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      const data = json.data;
      if (!data || data.length === 0) throw new Error("No candle data returned");

      if (!containerRef.current) return;
      destroyChart();

      const LC = window.LightweightCharts;
      const chartH = containerRef.current.clientHeight;
      // Read current theme from body background to auto-detect day/night
      // Use CSS variable values (read from :root after applyTheme has run)
      const rootStyle = getComputedStyle(document.documentElement);
      const cBg   = rootStyle.getPropertyValue("--chartBg").trim()   || T.chartBg;
      const cGrid = rootStyle.getPropertyValue("--chartGrid").trim() || T.chartGrid;
      const cBdr  = rootStyle.getPropertyValue("--chartBorder").trim()|| T.chartBorder;
      const cTxt  = rootStyle.getPropertyValue("--chartText").trim() || T.chartText;

      const chart = LC.createChart(containerRef.current, {
        width:  containerRef.current.clientWidth,
        height: chartH,
        layout: { background: { color: cBg }, textColor: cTxt },
        grid:   { vertLines: { color: cGrid }, horzLines: { color: cGrid } },
        crosshair: { mode: LC.CrosshairMode.Normal },
        rightPriceScale: { borderColor: cBdr, scaleMargins: { top: 0.08, bottom: 0.28 } },
        timeScale: { borderColor: cBdr, timeVisible: true, secondsVisible: false },
        handleScroll: true, handleScale: true,
      });
      chartRef.current = chart;

      const candles = chart.addCandlestickSeries({
        upColor: T.accent, downColor: T.down,
        borderUpColor: T.accent, borderDownColor: T.down,
        wickUpColor: "#00e87a88", wickDownColor: "#ff456088",
      });
      candles.setData(data);

      const vol = chart.addHistogramSeries({
        color: T.textGhost, priceFormat: { type: "volume" },
        priceScaleId: "vol",
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.76, bottom: 0 } });
      vol.setData(data.map(function(d) {
        return {
          time:  d.time,
          value: d.volume,
          color: d.close >= d.open ? "rgba(0,232,122,0.28)" : "rgba(255,69,96,0.28)",
        };
      }));

      var emaStyles = [
        { period: 20,  color: "#00e5ff", width: 0.8 },
        { period: 50,  color: "#ffe040", width: 1   },
        { period: 200, color: "#ff6b6b", width: 1.2 },
      ];
      emaStyles.forEach(function(e) {
        var emaData = calcEMASeries(data, e.period);
        if (emaData.length === 0) return;
        var line = chart.addLineSeries({
          color: e.color, lineWidth: e.width,
          priceLineVisible: false, lastValueVisible: true,
          crosshairMarkerVisible: false,
        });
        line.setData(emaData);
      });

      chart.timeScale().fitContent();

      var last = data[data.length - 1];
      var prev = data[data.length - 2];
      var chg  = prev ? +((last.close - prev.close) / prev.close * 100).toFixed(2) : 0;
      var chgD = prev ? +(last.close - prev.close).toFixed(2) : 0;
      setInfo({ price: last.close, change: chg, changeDol: chgD });

      if (window.ResizeObserver) {
        var ro = new ResizeObserver(function() {
          if (containerRef.current && chartRef.current) {
            chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
          }
        });
        ro.observe(containerRef.current);
      }
    } catch(e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(function() {
    if (!symbol) return;
    destroyChart();
    if (window.LightweightCharts) {
      buildChart();
    } else {
      var script = document.createElement("script");
      script.src = "https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js";
      script.onload  = buildChart;
      script.onerror = function() { setErr("Failed to load chart library"); setLoading(false); };
      document.head.appendChild(script);
    }
    return function() { destroyChart(); };
  }, [symbol, themeKey]);

  if (!symbol) return null;

  var changeColor = info && info.change > 0 ? T.accent : info && info.change < 0 ? T.down : T.textMid;

  return (
    <div style={{
      position:"fixed", top:48, right:0,
      width:"50vw", minWidth:480, height:"calc(100vh - 48px)",
      zIndex:9999, background:T.chartBg,
      borderLeft:`1px solid ${T.border2}`,
      boxShadow:"-14px 0 48px rgba(0,0,0,.7)",
      display:"flex", flexDirection:"column",
      animation:"tvFadeIn .18s ease",
    }}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"10px 14px",background:T.header,borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
          <span style={{fontFamily:"monospace",fontSize:16,color:T.text,fontWeight:700,letterSpacing:".04em"}}>
            {symbol}
          </span>
          {info&&(
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontFamily:"monospace",fontSize:14,color:T.text,fontWeight:600}}>
                ${info.price&&info.price.toFixed(2)}
              </span>
              <span style={{fontFamily:"monospace",fontSize:10,color:changeColor,fontWeight:700}}>
                {info.change>=0?"+":""}{info.change}% ({info.changeDol>=0?"+":""}{info.changeDol})
              </span>
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
          <a href={"https://www.tradingview.com/chart/?symbol="+symbol} target="_blank" rel="noreferrer"
            style={{fontFamily:"monospace",fontSize:8,color:T.accent,textDecoration:"none",
              border:"1px solid #00e87a33",padding:"4px 8px",borderRadius:3,letterSpacing:".06em",whiteSpace:"nowrap"}}>
            TV ↗
          </a>
          <span onClick={onClose}
            style={{cursor:"pointer",color:T.textDim,fontSize:20,lineHeight:1,padding:"2px 6px"}}>×</span>
        </div>
      </div>

      {/* EMA legend */}
      <div style={{display:"flex",gap:14,padding:"5px 14px",background:T.surface2,
        borderBottom:`1px solid ${T.border}`,flexShrink:0,alignItems:"center"}}>
        {[["20 EMA","#00e5ff"],["50 EMA","#ffe040"],["200 EMA","#ff6b6b"],["Volume","rgba(0,232,122,0.3)"]].map(function(item) {
          return (
            <div key={item[0]} style={{display:"flex",alignItems:"center",gap:5}}>
              <div style={{width:18,height:2,background:item[1],borderRadius:2}}/>
              <span style={{fontFamily:"monospace",fontSize:8,color:T.textDim}}>{item[0]}</span>
            </div>
          );
        })}
        <span style={{fontFamily:"monospace",fontSize:7.5,color:T.border2,marginLeft:"auto"}}>
          DAILY · scroll to zoom
        </span>
      </div>

      {/* Chart */}
      <div ref={containerRef} style={{flex:1,minHeight:0,position:"relative",overflow:"hidden"}}>
        {loading&&(
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
            alignItems:"center",justifyContent:"center",background:"inherit",zIndex:2,gap:12}}>
            <div style={{display:"flex",gap:5}}>
              {[0,1,2,3,4].map(function(i){
                return <div key={i} style={{width:7,height:7,borderRadius:"50%",background:T.accent,
                  animation:"bn 1s "+(i*0.15)+"s infinite"}}/>;
              })}
            </div>
            <span style={{fontFamily:"monospace",fontSize:9,color:T.textDim}}>Loading {symbol}…</span>
          </div>
        )}
        {err&&!loading&&(
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",
            alignItems:"center",justifyContent:"center",background:T.bg,zIndex:2,gap:12}}>
            <span style={{fontFamily:"monospace",fontSize:10,color:T.down}}>⚠ {err}</span>
            <a href={"https://www.tradingview.com/chart/?symbol="+symbol} target="_blank" rel="noreferrer"
              style={{fontFamily:"monospace",fontSize:9,color:T.accent,padding:"5px 12px",
                border:"1px solid #00e87a33",borderRadius:3,textDecoration:"none"}}>
              Open on TradingView ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SECTOR → INDUSTRY MAP ────────────────────────────────────────────────────
const SECTOR_INDUSTRY_MAP = {
  "Technology": ["Semiconductors","Software—Application","Software—Infrastructure","Computer Hardware","Consumer Electronics","Electronic Components","Electronics & Computer Distribution","Information Technology Services","Scientific & Technical Instruments","Communication Equipment","Solar"],
  "Healthcare": ["Biotechnology","Drug Manufacturers—General","Drug Manufacturers—Specialty & Generic","Medical Devices","Medical Instruments & Supplies","Health Information Services","Healthcare Plans","Medical Care Facilities","Diagnostics & Research","Medical Distribution","Pharmaceutical Retailers"],
  "Financial Services": ["Banks—Regional","Banks—Diversified","Asset Management","Capital Markets","Insurance—Life","Insurance—Property & Casualty","Insurance—Diversified","Insurance Brokers","Financial Data & Stock Exchanges","Credit Services","Mortgage Finance","Shell Companies"],
  "Consumer Cyclical": ["Retail—Apparel","Retail—Specialty","Auto Manufacturers","Auto Parts","Internet Retail","Luxury Goods","Residential Construction","Restaurants","Gambling","Hotels & Motels","Department Stores","Furnishings, Fixtures & Appliances","Home Improvement Retail","Footwear & Accessories","Personal Services","Recreational Vehicles","Travel Services"],
  "Consumer Defensive": ["Grocery Stores","Beverages—Non-Alcoholic","Beverages—Brewers","Beverages—Wineries & Distilleries","Discount Stores","Drug Stores","Food Distribution","Packaged Foods","Tobacco","Household & Personal Products","Education & Training Services","Food Confectioners"],
  "Communication Services": ["Telecom Services","Entertainment","Internet Content & Information","Broadcasting","Electronic Gaming & Multimedia","Advertising Agencies","Publishing"],
  "Energy": ["Oil & Gas E&P","Oil & Gas Integrated","Oil & Gas Refining & Marketing","Oil & Gas Midstream","Oil & Gas Equipment & Services","Coal","Uranium"],
  "Basic Materials": ["Specialty Chemicals","Agricultural Inputs","Chemicals","Gold","Silver","Copper","Steel","Aluminum","Building Materials","Coking Coal","Other Industrial Metals & Mining","Other Precious Metals & Mining","Paper & Paper Products","Lumber & Wood Production"],
  "Industrials": ["Aerospace & Defense","Airlines","Airports & Air Services","Building Products & Equipment","Business Equipment & Supplies","Engineering & Construction","Farm & Construction Equipment","Industrial Distribution","Integrated Freight & Logistics","Marine Shipping","Metal Fabrication","Pollution & Treatment Controls","Railroads","Rental & Leasing Services","Security & Protection Services","Specialty Industrial Machinery","Staffing & Employment Services","Tools & Accessories","Trucking","Waste Management","Conglomerates"],
  "Real Estate": ["REIT—Diversified","REIT—Healthcare Facilities","REIT—Hotel & Motel","REIT—Industrial","REIT—Mortgage","REIT—Office","REIT—Residential","REIT—Retail","REIT—Specialty","Real Estate Services","Real Estate—Development"],
  "Utilities": ["Utilities—Diversified","Utilities—Independent Power Producers","Utilities—Regulated Electric","Utilities—Regulated Gas","Utilities—Regulated Water","Utilities—Renewable"],
};
const ALL_SECTORS = Object.keys(SECTOR_INDUSTRY_MAP);

// ─── MULTI-SELECT DROPDOWN ────────────────────────────────────────────────────
function MultiSelectDropdown({ label, options, selected, onChange, _color, width=200 }) {
  const _pmtk = useTheme();
  const T3    = THEME[_pmtk] || THEME.night;
  const _color = _color || T3.accent;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = v => onChange(selected.includes(v) ? selected.filter(x=>x!==v) : [...selected, v]);
  const clearAll = e => { e.stopPropagation(); onChange([]); };
  const selCount = selected.length;
  return (
    <div ref={ref} style={{position:"relative",display:"inline-block",userSelect:"none"}}>
      <div onClick={()=>setOpen(o=>!o)}
        style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",background:T.inputBg,
          border:`1px solid ${selCount>0?_color+"44":T.border2}`,borderRadius:4,padding:"6px 10px",
          width,boxSizing:"border-box",boxShadow:selCount>0?`0 0 8px ${color}18`:"none"}}>
        <span style={{fontFamily:"monospace",fontSize:9,color:selCount>0?color:T.textDim,flex:1,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",letterSpacing:".04em"}}>
          {selCount===0?`ALL ${label.toUpperCase()}S`:selCount===1?selected[0]:`${selCount} ${label}s`}
        </span>
        {selCount>0&&<span onClick={clearAll} style={{color:T.textDim,fontSize:12,cursor:"pointer"}}>×</span>}
        <span style={{color:T.textFaint,fontSize:9}}>{open?"▲":"▼"}</span>
      </div>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,zIndex:1000,background:T.bg,
          border:`1px solid ${T.border2}`,borderRadius:5,width:Math.max(width,240),maxHeight:260,
          overflowY:"auto",boxShadow:"0 8px 32px rgba(0,0,0,.7)"}}>
          <div style={{padding:"6px 10px",borderBottom:"1px solid #0d1a26",display:"flex",gap:8}}>
            <span onClick={()=>onChange(options)} style={{fontFamily:"monospace",fontSize:8,color,cursor:"pointer"}}>ALL</span>
            <span style={{color:T.border2}}>|</span>
            <span onClick={()=>onChange([])} style={{fontFamily:"monospace",fontSize:8,color:T.textDim,cursor:"pointer"}}>NONE</span>
          </div>
          {options.map(opt=>(
            <div key={opt} onClick={()=>toggle(opt)}
              style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",cursor:"pointer",
                background:selected.includes(opt)?`${color}0e`:"transparent",borderBottom:`1px solid ${T.border}`}}
              onMouseEnter={e=>{ if(!selected.includes(opt)) e.currentTarget.style.background=T.border; }}
              onMouseLeave={e=>{ e.currentTarget.style.background=selected.includes(opt)?`${color}0e`:"transparent"; }}>
              <div style={{width:12,height:12,borderRadius:2,flexShrink:0,background:selected.includes(opt)?color:"transparent",
                border:`1.5px solid ${selected.includes(opt)?color:T.border2}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {selected.includes(opt)&&<span style={{color:"#000",fontSize:9,fontWeight:900,lineHeight:1}}>✓</span>}
              </div>
              <span style={{fontFamily:"monospace",fontSize:9,color:selected.includes(opt)?T.text:T.textDim,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{opt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SCANNER TAB ──────────────────────────────────────────────────────────────

// ─── PREMARKET TAB ────────────────────────────────────────────────────────────
// Bloomberg-style premarket scanner with AI analysis via Claude API
// Columns: PM% · PM Vol · PM RVol · PM$Vol · ATR% · ADR% · Short% · Float ·
//          MktCap · AvgDolVol · Daily% · RVol · Category · Grade · Analysis

const CATEGORY_COLORS = {
  "Earnings":         { bg:"rgba(255,159,28,.15)", border:"rgba(255,159,28,.4)", text:"#ff9f1c" },
  "Short Squeeze":    { bg:"rgba(255,69,96,.15)",  border:"rgba(255,69,96,.4)",  text:T.down },
  "News / Catalyst":  { bg:"rgba(0,212,255,.13)",  border:"rgba(0,212,255,.35)", text:"#00d4ff" },
  "Industry Move":    { bg:"rgba(77,219,158,.13)",  border:"rgba(77,219,158,.35)",text:T.accent },
  "Pre-Market Move":  { bg:"rgba(90,122,138,.12)",  border:"rgba(90,122,138,.3)", text:T.textMid },
  "New Product":      { bg:"rgba(138,43,226,.15)",  border:"rgba(138,43,226,.4)", text:"#c77dff" },
  "New Contracts":    { bg:"rgba(0,232,122,.15)",   border:"rgba(0,232,122,.4)",  text:T.accent },
  "Themes/Narratives":{ bg:"rgba(249,199,79,.12)",  border:"rgba(249,199,79,.35)","text":"#f9c74f" },
};

const GRADE_STYLE = {
  A: { bg:"rgba(0,232,122,.18)", border:"rgba(0,232,122,.5)", text:T.accent },
  B: { bg:"rgba(77,219,158,.15)",border:"rgba(77,219,158,.4)", text:T.accent },
  C: { bg:"rgba(255,159,28,.15)",border:"rgba(255,159,28,.4)", text:"#ff9f1c" },
  D: { bg:"rgba(255,69,96,.15)", border:"rgba(255,69,96,.4)",  text:T.down },
};

function fmtFloat(n) {
  if (!n) return "—";
  if (n >= 1e9) return (n/1e9).toFixed(1)+"B";
  if (n >= 1e6) return (n/1e6).toFixed(1)+"M";
  if (n >= 1e3) return (n/1e3).toFixed(0)+"K";
  return n.toString();
}

function PMCell({ v, suffix="%" , big, colorize=true }) {
  if (v == null) return <span style={{fontFamily:"monospace",fontSize:9,color:T.textGhost}}>—</span>;
  const c = !colorize ? T.text
    : v > 10 ? T.accent : v > 5 ? T.accent : v > 0 ? "#8ac8b0"
    : v > -5 ? "#e85050" : "#ff2040";
  return (
    <span style={{fontFamily:"monospace",fontSize:big?13:11,fontWeight:big?"700":"600",color:c}}>
      {v >= 0 ? "+" : ""}{v.toFixed(2)}{suffix}
    </span>
  );
}

function PremarketTab() {
  const themeKey = useTheme();
  const T = THEME[themeKey] || THEME.night;
  const dark = themeKey === "night";
  const cardBg = dark ? T.surface : T.surface;
  const rowBg  = dark ? T.row : T.row;

  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [minPMPct,  setMinPMPct]  = useState(2);
  const [sortKey,   setSortKey]   = useState("pmPct");
  const [sortDir,   setSortDir]   = useState(-1);
  const [selRow,    setSelRow]    = useState(null);
  const [analyses,  setAnalyses]  = useState({});
  const [newsData,  setNewsData]  = useState({});   // { symbol -> { news, fundamentals, loading } }
  const [catFilter, setCatFilter] = useState(null);
  const [showCols,  setShowCols]  = useState({
    pmPct:true, pmVol:true, pmRVol:true, pmDolVol:true,
    adrPct:true, shortPct:true, float:true, marketCap:true,
    avgDolVol:true, change:true, relVol:true, category:true,
    above50:true, above200:true,
  });

  const loadData = useCallback(async (silent=false) => {
    if (!silent) setLoading(true);
    try {
      const r = await apiFetch(`/api/premarket?minPMPct=${minPMPct}&limit=30`);
      setData(r);
    } catch(e) { console.warn(e); }
    finally { setLoading(false); }
  }, [minPMPct]);

  useEffect(() => { loadData(); }, [minPMPct]);

  // Load Finviz + SEC news for a symbol
  const loadNews = useCallback(async (symbol) => {
    if (newsData[symbol]?.news || newsData[symbol]?.loading) return;
    setNewsData(prev => ({...prev, [symbol]: {loading:true, news:[], fundamentals:{}}}));
    try {
      const r = await apiFetch(`/api/news/${symbol}`);
      setNewsData(prev => ({...prev, [symbol]: {
        news:         r.news || [],
        fundamentals: r.fundamentals || {},
        sources:      r.sources || {},
        loading:      false,
        ts:           new Date(),
      }}));
    } catch(e) {
      setNewsData(prev => ({...prev, [symbol]: {loading:false, news:[], fundamentals:{}}}));
    }
  }, [newsData]);

  // ── Professional multi-step AI analysis ────────────────────────────────────
  // Step 1: Web search for actual catalyst news (Claude + web_search tool)
  // Step 2: Structured scoring across 4 pro dimensions (0-25 each = 0-100)
  //         Impact · Quality · Explosiveness · Longevity
  // Step 3: Grade derived from total score with specific thresholds
  // Based on LoneStockTrader framework + traderwillhu EMA trend alignment
  const analyzeStock = useCallback(async (row) => {
    if (analyses[row.symbol]?.grade) return;
    setAnalyses(prev => ({...prev, [row.symbol]: {loading:true, step:"Searching for catalyst news…"}}));

    // ── Technical trend alignment (traderwillhu method) ──────────────────────
    // Grade modifier based on EMA positioning:
    //   BULLISH  (A factor): above50 AND above200 (EMA10 > EMA20 > SMA50 uptrend)
    //   MIXED    (B factor): above50 XOR above200
    //   BEARISH  (C/D factor): below50 AND below200
    const trendGrade = (row.above50 === true && row.above200 === true) ? "BULLISH"
      : (row.above50 === true || row.above200 === true) ? "MIXED"
      : (row.above50 === false && row.above200 === false) ? "BEARISH" : "UNKNOWN";

    // ── Float tier classification ────────────────────────────────────────────
    const floatTier = !row.float ? "UNKNOWN"
      : row.float < 5e6  ? "MICRO (<5M)"
      : row.float < 20e6 ? "SMALL (5-20M)"
      : row.float < 50e6 ? "LOW-MID (20-50M)"
      : row.float < 200e6? "MID (50-200M)"
      : "LARGE (>200M)";

    // ── Step 1: Search for actual catalyst ──────────────────────────────────
    const searchPrompt = `Search for the most recent news and catalyst driving ${row.symbol} (${row.name}) 
premarket move of ${row.pmPct >= 0 ? "+" : ""}${row.pmPct}% today ${new Date().toDateString()}.
Look for: earnings reports, revenue/EPS beats or misses, FDA decisions, contract wins, 
partnership announcements, analyst upgrades/downgrades, short squeeze activity, 
industry/sector news, product launches.
Return the key catalyst found in 2-3 sentences.`;

    let catalystNews = `No specific news found. Moving ${row.pmPct > 0 ? "up" : "down"} ${Math.abs(row.pmPct)}% premarket on ${row.category || "general market activity"}.`;

    try {
      const searchResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 400,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: searchPrompt }]
        })
      });
      const searchJson = await searchResp.json();
      // Extract text response from web search result
      const textBlocks = (searchJson.content || []).filter(b => b.type === "text");
      if (textBlocks.length) catalystNews = textBlocks.map(b => b.text).join(" ").substring(0, 500);
    } catch(e) { /* use default */ }

    setAnalyses(prev => ({...prev, [row.symbol]: {loading:true, step:"Scoring setup quality…"}}));

    // ── Step 2: Full structured scoring prompt ───────────────────────────────
    // Scoring dimensions (each 0-25, total 0-100):
    //
    // IMPACT (0-25): Catalyst significance
    //   25 = Tier-1 catalyst (earnings beat >15%, FDA approval, major contract)
    //   20 = Strong catalyst (earnings beat 5-15%, analyst upgrade, partnership)
    //   15 = Moderate catalyst (small earnings beat, industry news)
    //   10 = Weak catalyst (general market/sector move)
    //    5 = Speculative/no clear catalyst
    //
    // QUALITY (0-25): Setup quality & counterparty
    //   25 = Clean technical break, confirmed volume, above all EMAs, respectable float
    //   20 = Good setup with minor concerns
    //   15 = Mixed signals
    //   10 = Thin float <5M or below major EMAs
    //    5 = Below all EMAs, declining trend, thin & illiquid
    //
    // EXPLOSIVENESS (0-25): Potential for continued large move
    //   25 = ADR>7% + short>15% + float<20M + PM vol >2M shares
    //   20 = ADR>5% + some short interest or thin float
    //   15 = ADR>3% with moderate setup
    //   10 = Low ADR, large float, limited explosive potential
    //    5 = ADR<2%, massive float, slow mover
    //
    // LONGEVITY (0-25): Multi-day sustainability
    //   25 = Strong fundamental catalyst + BULLISH EMA trend + institutional quality
    //   20 = Good catalyst with mixed technicals
    //   15 = One-day catalyst likely, some follow-through potential
    //   10 = One-day pop, likely to fade
    //    5 = Gap-and-trap risk, likely reversal
    //
    // Grade from total score:
    //   85-100 = A (exceptional, high conviction)
    //   70-84  = B (good setup, worth trading)
    //   50-69  = C (marginal, trade with caution)
    //   <50    = D (avoid)

    const analysisPrompt = `You are a professional day trader using the LoneStockTrader scoring framework.
Analyze this premarket mover using the EXACT scoring rubric below. Return ONLY valid JSON.

═══ STOCK DATA ═══
Symbol: ${row.symbol} | Name: ${row.name}
PM Move: ${row.pmPct >= 0 ? "+" : ""}${row.pmPct}% | PM Vol: ${fmtFloat(row.pmVol)} | PM RVol: ${row.pmRVol}x
Price: $${(row.price||0).toFixed(2)} | PM Price: $${(row.pmPrice||0).toFixed(2)}
Market Cap: ${row.marketCap ? fmtFloat(row.marketCap) : "unknown"}
Sector: ${row.sector||"unknown"} | Industry: ${row.industry||"unknown"}
ADR%: ${row.adrPct != null ? row.adrPct.toFixed(1)+"%" : "unknown"}
Short Interest: ${row.shortPct != null ? row.shortPct.toFixed(1)+"%" : "unknown"}
Float: ${fmtFloat(row.float)||"unknown"} (${floatTier})
Avg Daily $ Vol: $${row.avgDolVol||0}M
Daily%: ${(row.change||0).toFixed(2)}% | RVol: ${row.relVol||0}x
EMA Trend: ${trendGrade} (50D: ${row.above50==true?"ABOVE":row.above50==false?"BELOW":"?"}, 200D: ${row.above200==true?"ABOVE":row.above200==false?"BELOW":"?"})
Category: ${row.category}

═══ CATALYST NEWS (from live web search) ═══
${catalystNews}

═══ SCORING RUBRIC ═══
Score each dimension 0-25:

IMPACT (catalyst significance):
  25 = Tier-1 catalyst: earnings beat >15% vs consensus, FDA approval, major contract announce
  20 = Strong catalyst: earnings beat 5-15%, analyst upgrade, key partnership
  15 = Moderate catalyst: small beat, industry tailwind, product news
  10 = Weak: general sector/market move, vague press release
   5 = Speculative, no clear catalyst, rumor

QUALITY (setup quality):
  25 = Clean breakout, volume confirmation, BULLISH EMA trend, float >20M (tradeable)
  20 = Good setup, one minor concern (float thin OR below one EMA)
  15 = Mixed: below one major EMA OR float <10M with news
  10 = Below 50D + 200D or float <5M (hard to trade at scale)
   5 = Below all EMAs, no trend, illiquid

EXPLOSIVENESS (single-day move potential):
  25 = ADR>7% + short>15% + float<20M — massive squeeze/gap potential
  20 = ADR>5% + short>10% OR float<10M — strong explosive setup
  15 = ADR>3% with moderate float — decent range
  10 = ADR 2-3%, large float — limited explosiveness
   5 = ADR<2%, massive float, institutional slow-mover

LONGEVITY (multi-day sustainability):
  25 = Strong fundamental catalyst + BULLISH EMA trend + no resistance overhead
  20 = Good fundamental catalyst, mixed technicals — likely 1-2 day follow-through
  15 = One-day catalyst event, limited sustained buying expected
  10 = One-day pop, high reversion probability after open
   5 = Likely gap-and-trap, bearish continuation risk

Grade from TOTAL (sum of 4 scores, max 100):
  85-100 → "A"  (exceptional, high conviction, trade full size)
  70-84  → "B"  (good setup, trade normal size)
  50-69  → "C"  (marginal, reduce size, tight stops)
  <50    → "D"  (avoid or short-side only)

Return ONLY this JSON (no markdown, no backticks, no other text):
{
  "scores": {
    "impact": <number 0-25>,
    "quality": <number 0-25>,
    "explosiveness": <number 0-25>,
    "longevity": <number 0-25>
  },
  "total": <sum of all 4 scores>,
  "grade": "<A|B|C|D>",
  "reasoning": "<3 sentences: what is the catalyst, why this grade, key trade consideration>",
  "details": {
    "Impact": "<1-2 sentences: catalyst significance and revenue/financial impact if known>",
    "Quality": "<1-2 sentences: technical setup quality, EMA positioning, float assessment>",
    "Explosiveness": "<1-2 sentences: ADR, short interest, float-based move potential>",
    "Longevity": "<1-2 sentences: multi-day sustainability and risk of fade>"
  },
  "catalyst": "<one sentence: the specific catalyst driving this move>",
  "risks": "<one sentence: primary risk to the trade>"
}`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1200,
          messages: [{ role: "user", content: analysisPrompt }]
        })
      });
      const json = await response.json();
      const text = (json.content?.find(b => b.type === "text")?.text || "").trim();
      const clean = text.replace(/^```json\n?|\n?```$/g, "").trim();
      const parsed = JSON.parse(clean);
      // Validate and clamp scores
      const s = parsed.scores || {};
      const clamped = {
        impact:       Math.min(25, Math.max(0, s.impact || 0)),
        quality:      Math.min(25, Math.max(0, s.quality || 0)),
        explosiveness:Math.min(25, Math.max(0, s.explosiveness || 0)),
        longevity:    Math.min(25, Math.max(0, s.longevity || 0)),
      };
      const total = clamped.impact + clamped.quality + clamped.explosiveness + clamped.longevity;
      const derivedGrade = total >= 85 ? "A" : total >= 70 ? "B" : total >= 50 ? "C" : "D";
      setAnalyses(prev => ({...prev, [row.symbol]: {
        ...parsed,
        scores: clamped,
        total,
        grade: derivedGrade, // use computed grade from scores, not LLM's
        trendGrade,
        floatTier,
        catalystNews: catalystNews.substring(0, 300),
        loading: false,
        step: null,
      }}));
    } catch(e) {
      setAnalyses(prev => ({...prev, [row.symbol]: {
        grade:"?", loading:false, step:null,
        reasoning:"Analysis failed — check console.",
        details:{}, scores:{impact:0,quality:0,explosiveness:0,longevity:0}, total:0,
      }}));
    }
  }, [analyses]);

  const sortedRows = useMemo(() => {
    if (!data?.results) return [];
    let rows = data.results;
    if (catFilter) rows = rows.filter(r => r.category === catFilter);
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? -9999, bv = b[sortKey] ?? -9999;
      return sortDir * (bv - av);
    });
  }, [data, sortKey, sortDir, catFilter]);

  const categories = useMemo(() => {
    if (!data?.results) return [];
    return [...new Set(data.results.map(r => r.category))];
  }, [data]);

  function SortBtn({ label, k, wide }) {
    const active = sortKey === k;
    return (
      <div onClick={() => { if (active) setSortDir(d => -d); else { setSortKey(k); setSortDir(-1); } }}
        style={{fontFamily:"monospace",fontSize:8,color:active?T.accent:T.textFaint,
          letterSpacing:".05em",cursor:"pointer",userSelect:"none",textAlign:"center",
          whiteSpace:"nowrap",display:"flex",alignItems:"center",justifyContent:"center",gap:2}}>
        {label}{active ? (sortDir < 0 ? "↓" : "↑") : ""}
      </div>
    );
  }

  if (loading && !data) return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:80,gap:16}}>
      <div style={{display:"flex",gap:6}}>
        {[0,1,2,3,4].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:T.accent,animation:`bn 1s ${i*.15}s infinite`}}/>)}
      </div>
      <span style={{fontFamily:"monospace",fontSize:11,color:T.accent,letterSpacing:".1em"}}>SCANNING PREMARKET…</span>
    </div>
  );

  const COLS = [
    {k:"symbol",   l:"TICKER",   w:"72px",  fixed:true},
    {k:"pmPct",    l:"PM %",     w:"70px"},
    {k:"pmVol",    l:"PM VOL",   w:"74px"},
    {k:"pmRVol",   l:"PM RVOL",  w:"66px"},
    {k:"pmDolVol", l:"PM $VOL",  w:"70px"},
    {k:"change",   l:"DAILY %",  w:"68px"},
    {k:"relVol",   l:"RVOL",     w:"58px"},
    {k:"adrPct",   l:"ADR%",     w:"58px"},
    {k:"shortPct", l:"SHORT%",   w:"64px"},
    {k:"float",    l:"FLOAT",    w:"64px"},
    {k:"avgDolVol",l:"AVG$VOL",  w:"72px"},
    {k:"marketCap",l:"MCAP",     w:"72px"},
    {k:"sector",   l:"SECTOR",   w:"100px"},
    {k:"industry", l:"INDUSTRY", w:"130px"},
    {k:"category", l:"CATALYST", w:"130px"},
    {k:"above50",  l:"50D",      w:"48px"},
    {k:"above200", l:"200D",     w:"50px"},
  ];

  const gridTemplate = COLS.map(c=>c.w).join(" ") + " 1fr";

  return (
    <div>
      {/* ── Toolbar ── */}
      <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        {/* Min PM% filter */}
        <div style={{display:"flex",gap:0,background:cardBg,border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden"}}>
          <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,padding:"7px 10px",
            borderRight:`1px solid ${T.border}`,display:"flex",alignItems:"center",whiteSpace:"nowrap"}}>
            MIN PM%
          </span>
          {[1,2,3,5,7,10].map(v=>(
            <button key={v} onClick={()=>setMinPMPct(v)}
              style={{fontFamily:"monospace",fontSize:9,padding:"7px 12px",border:"none",
                borderRight:`1px solid ${T.border}`,cursor:"pointer",
                background:minPMPct===v?"rgba(0,232,122,.14)":cardBg,
                color:minPMPct===v?T.accent:T.textDim,
                fontWeight:minPMPct===v?"700":"400"}}>
              {v}%
            </button>
          ))}
        </div>

        {/* Catalyst filters */}
        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          <button onClick={()=>setCatFilter(null)}
            style={{fontFamily:"monospace",fontSize:8,padding:"5px 10px",border:"none",
              borderRadius:4,cursor:"pointer",
              background:!catFilter?"rgba(0,232,122,.12)":cardBg,
              color:!catFilter?T.accent:T.textDim,
              outline:!catFilter?"1px solid rgba(0,232,122,.3)":`1px solid ${T.border}`}}>
            ALL
          </button>
          {categories.map(cat=>{
            const cs = CATEGORY_COLORS[cat]||CATEGORY_COLORS["Pre-Market Move"];
            const active = catFilter === cat;
            return(
              <button key={cat} onClick={()=>setCatFilter(active?null:cat)}
                style={{fontFamily:"monospace",fontSize:8,padding:"5px 10px",border:"none",
                  borderRadius:4,cursor:"pointer",
                  background:active?cs.bg:cardBg,
                  color:active?cs.text:T.textDim,
                  outline:active?`1px solid ${cs.border}`:`1px solid ${T.border}`}}>
                {cat}
              </button>
            );
          })}
        </div>

        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          {data&&<span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>
            {sortedRows.length} stocks · {new Date(data.ts).toLocaleTimeString()}
          </span>}
          <button onClick={()=>loadData()}
            style={{fontFamily:"monospace",fontSize:9,padding:"5px 12px",
              background:"rgba(0,232,122,.1)",color:T.accent,
              border:"1px solid rgba(0,232,122,.25)",borderRadius:3,cursor:"pointer"}}>
            ↺ REFRESH
          </button>
        </div>
      </div>

      {/* ── Main Table ── */}
      <div style={{background:cardBg,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
        {/* Column headers */}
        <div style={{display:"grid", gridTemplateColumns:gridTemplate,
          padding:"7px 14px",background:rowBg,
          borderBottom:`2px solid ${T.border2||T.border}`,gap:4,alignItems:"center",
          position:"sticky",top:0,zIndex:5}}>
          {COLS.map(c=>(
            <SortBtn key={c.k} label={c.l} k={c.k}/>
          ))}
          <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".05em"}}>
            GRADE / ANALYSIS
          </span>
        </div>

        {/* Rows */}
        {sortedRows.length === 0 && !loading && (
          <div style={{padding:40,textAlign:"center",fontFamily:"monospace",fontSize:11,color:T.textFaint}}>
            No premarket movers ≥{minPMPct}% found. Markets may not be open yet.
          </div>
        )}

        {sortedRows.map((row, ri) => {
          const isOpen = selRow === row.symbol;
          const analysis = analyses[row.symbol];
          const cs = CATEGORY_COLORS[row.category] || CATEGORY_COLORS["Pre-Market Move"];
          const gs = analysis?.grade ? GRADE_STYLE[analysis.grade] || GRADE_STYLE.C : null;
          const pmColor = row.pmPct > 10 ? T.accent : row.pmPct > 5 ? T.accent
            : row.pmPct > 0 ? "#8ac8b0" : row.pmPct > -5 ? "#e85050" : "#ff2040";

          return (
            <div key={row.symbol}>
              {/* Main data row */}
              <div
                onClick={() => {
                  setSelRow(isOpen ? null : row.symbol);
                  if (!isOpen) {
                    if (!analysis) analyzeStock(row);
                    loadNews(row.symbol);
                  }
                }}
                style={{display:"grid", gridTemplateColumns:gridTemplate,
                  padding:"8px 14px",gap:4,alignItems:"center",cursor:"pointer",
                  borderBottom:`1px solid ${T.border}`,
                  borderLeft:`3px solid ${pmColor}`,
                  background:isOpen?`rgba(0,232,122,.04)`:"transparent",
                  transition:"background .12s"}}
                onMouseEnter={e=>{ if(!isOpen) e.currentTarget.style.background=`rgba(0,232,122,.025)`; }}
                onMouseLeave={e=>{ if(!isOpen) e.currentTarget.style.background="transparent"; }}>

                {/* Ticker */}
                <div>
                  <div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:"#fff"}}>{row.symbol}</div>
                  <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,marginTop:1}}>{row.name?.substring(0,14)}</div>
                </div>

                {/* PM% */}
                <div style={{textAlign:"center"}}>
                  <PMCell v={row.pmPct} big/>
                  {row.pmPrice&&<div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>
                    ${row.pmPrice.toFixed(2)}
                  </div>}
                </div>

                {/* PM Vol */}
                <div style={{textAlign:"center",fontFamily:"monospace",fontSize:10,color:T.text}}>
                  {fmtFloat(row.pmVol)||"—"}
                </div>

                {/* PM RVol */}
                <div style={{textAlign:"center"}}>
                  <span style={{fontFamily:"monospace",fontSize:10,fontWeight:700,
                    color:row.pmRVol>=3?"#ff9f1c":row.pmRVol>=2?"#ffe040":T.textMid}}>
                    {row.pmRVol>0?row.pmRVol.toFixed(1)+"×":"—"}
                  </span>
                </div>

                {/* PM$ Vol */}
                <div style={{textAlign:"center",fontFamily:"monospace",fontSize:10,color:T.textMid||T.text}}>
                  {row.pmDolVol>0?"$"+row.pmDolVol.toFixed(1)+"M":"—"}
                </div>

                {/* Daily% */}
                <div style={{textAlign:"center"}}>
                  <PMCell v={row.change}/>
                </div>

                {/* RVol */}
                <div style={{textAlign:"center"}}>
                  <span style={{fontFamily:"monospace",fontSize:10,fontWeight:600,
                    color:row.relVol>=2?"#ff9f1c":T.textMid}}>
                    {row.relVol>0?row.relVol.toFixed(1)+"×":"—"}
                  </span>
                </div>

                {/* ADR% */}
                <div style={{textAlign:"center",fontFamily:"monospace",fontSize:10,
                  color:row.adrPct>5?T.accent:row.adrPct>2?T.accent:T.textMid}}>
                  {row.adrPct!=null?row.adrPct.toFixed(1)+"%":"—"}
                </div>

                {/* Short% */}
                <div style={{textAlign:"center"}}>
                  <span style={{fontFamily:"monospace",fontSize:10,fontWeight:600,
                    color:row.shortPct>20?T.down:row.shortPct>10?"#ff9f1c":T.textMid}}>
                    {row.shortPct!=null?row.shortPct.toFixed(1)+"%":"—"}
                  </span>
                </div>

                {/* Float */}
                <div style={{textAlign:"center",fontFamily:"monospace",fontSize:10,color:T.text}}>
                  {fmtFloat(row.float)||"—"}
                </div>

                {/* Avg$Vol */}
                <div style={{textAlign:"center",fontFamily:"monospace",fontSize:10,color:T.textMid||T.text}}>
                  {row.avgDolVol>0?"$"+row.avgDolVol+"M":"—"}
                </div>

                {/* MktCap */}
                <div style={{textAlign:"center"}}>
                  <McapBadge v={row.marketCap}/>
                </div>

                {/* Sector */}
                <div style={{minWidth:0}}>
                  {row.sector&&<span style={{fontFamily:"monospace",fontSize:8,color:secCol(row.sector)||T.textMid,
                    background:`${secCol(row.sector)||T.textMid}15`,
                    padding:"1px 5px",borderRadius:2,display:"inline-block",
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%"}}>
                    {row.sector}
                  </span>}
                </div>

                {/* Industry */}
                <div style={{minWidth:0,fontFamily:"monospace",fontSize:8,color:T.textDim,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {row.industry||"—"}
                </div>

                {/* Category badge */}
                <div>
                  <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
                    color:cs.text,background:cs.bg,
                    border:`1px solid ${cs.border}`,
                    padding:"2px 7px",borderRadius:10,whiteSpace:"nowrap"}}>
                    {row.category}
                  </span>
                </div>

                {/* 50D */}
                <div style={{textAlign:"center"}}>
                  {row.above50!=null&&<span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
                    color:row.above50?T.accent:T.down,
                    background:row.above50?"rgba(0,232,122,.1)":"rgba(255,69,96,.1)",
                    padding:"2px 4px",borderRadius:2,
                    border:`1px solid ${row.above50?"rgba(0,232,122,.25)":"rgba(255,69,96,.25)"}`}}>
                    {row.above50?"▲":"▼"}
                  </span>}
                </div>

                {/* 200D */}
                <div style={{textAlign:"center"}}>
                  {row.above200!=null&&<span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
                    color:row.above200?T.accent:T.down,
                    background:row.above200?"rgba(0,232,122,.1)":"rgba(255,69,96,.1)",
                    padding:"2px 4px",borderRadius:2,
                    border:`1px solid ${row.above200?"rgba(0,232,122,.25)":"rgba(255,69,96,.25)"}`}}>
                    {row.above200?"▲":"▼"}
                  </span>}
                </div>

                {/* Grade / Analyze button */}
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {!analysis&&(
                    <button onClick={e=>{e.stopPropagation();analyzeStock(row);}}
                      style={{fontFamily:"monospace",fontSize:8,padding:"3px 8px",border:"none",
                        borderRadius:3,cursor:"pointer",
                        background:"rgba(0,212,255,.12)",color:"#00d4ff",
                        outline:"1px solid rgba(0,212,255,.3)"}}>
                      ✦ ANALYZE
                    </button>
                  )}
                  {analysis?.loading&&(
                    <span style={{fontFamily:"monospace",fontSize:8,color:"#00d4ff"}}>analyzing…</span>
                  )}
                  {analysis?.grade&&gs&&(
                    <span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,
                      color:gs.text,background:gs.bg,
                      border:`1px solid ${gs.border}`,
                      padding:"2px 10px",borderRadius:3}}>
                      {analysis.grade}
                    </span>
                  )}
                </div>
              </div>

              {/* Expanded analysis panel */}
              {isOpen&&(
                <div style={{borderBottom:`1px solid ${T.border}`,
                  background:dark?T.inputBg:"#f8fafc",
                  borderLeft:"3px solid rgba(0,212,255,.4)"}}>

                  {/* Analysis loading */}
                  {analysis?.loading&&(
                    <div style={{padding:"14px 18px",fontFamily:"monospace",fontSize:10,
                      color:"#00d4ff",letterSpacing:".08em",display:"flex",alignItems:"center",gap:10}}>
                      <div style={{display:"flex",gap:4}}>
                        {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",
                          background:"#00d4ff",animation:`bn 1s ${i*.2}s infinite`}}/>)}
                      </div>
                      {analysis.step || "Analyzing…"}
                    </div>
                  )}

                  {/* Analysis result */}
                  {analysis&&!analysis.loading&&(
                    <div style={{padding:"14px 18px"}}>

                      {/* Top row: Grade + total score + trend + catalyst */}
                      <div style={{display:"flex",gap:12,marginBottom:14,flexWrap:"wrap",alignItems:"flex-start"}}>

                        {/* Grade circle */}
                        {analysis.grade&&(()=>{
                          const gs2 = GRADE_STYLE[analysis.grade] || GRADE_STYLE.C;
                          return(
                            <div style={{background:gs2.bg,border:`1px solid ${gs2.border}`,
                              borderRadius:8,padding:"10px 16px",textAlign:"center",flexShrink:0,minWidth:70}}>
                              <div style={{fontFamily:"monospace",fontSize:32,fontWeight:700,
                                color:gs2.text,lineHeight:1}}>{analysis.grade}</div>
                              <div style={{fontFamily:"monospace",fontSize:7,color:gs2.text,opacity:.7,marginTop:2}}>GRADE</div>
                              {analysis.total!=null&&(
                                <div style={{fontFamily:"monospace",fontSize:11,color:gs2.text,
                                  marginTop:4,fontWeight:700}}>{analysis.total}/100</div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Score bars */}
                        {analysis.scores&&(
                          <div style={{flex:"0 0 220px"}}>
                            <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,
                              letterSpacing:".08em",marginBottom:6}}>SCORE BREAKDOWN</div>
                            {[
                              ["Impact",       analysis.scores.impact,       "#00d4ff"],
                              ["Quality",      analysis.scores.quality,      T.accent],
                              ["Explosiveness",analysis.scores.explosiveness,"#ff9f1c"],
                              ["Longevity",    analysis.scores.longevity,    "#c77dff"],
                            ].map(([label,score,color])=>(
                              <div key={label} style={{marginBottom:5}}>
                                <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                                  <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>{label}</span>
                                  <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,color}}>{score}/25</span>
                                </div>
                                <div style={{height:6,background:dark?T.border:"#e8edf2",borderRadius:3,overflow:"hidden"}}>
                                  <div style={{width:`${(score/25)*100}%`,height:"100%",
                                    background:color,borderRadius:3,
                                    transition:"width .8s",
                                    boxShadow:`0 0 6px ${color}50`}}/>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Trend + float + catalyst strip */}
                        <div style={{flex:1,minWidth:200}}>
                          {/* Trend badge */}
                          {analysis.trendGrade&&(
                            <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                              <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
                                color:analysis.trendGrade==="BULLISH"?T.accent:
                                      analysis.trendGrade==="MIXED"?"#ff9f1c":T.down,
                                background:analysis.trendGrade==="BULLISH"?"rgba(0,232,122,.1)":
                                           analysis.trendGrade==="MIXED"?"rgba(255,159,28,.1)":"rgba(255,69,96,.1)",
                                border:`1px solid ${analysis.trendGrade==="BULLISH"?"rgba(0,232,122,.3)":
                                                    analysis.trendGrade==="MIXED"?"rgba(255,159,28,.3)":"rgba(255,69,96,.3)"}`,
                                padding:"2px 8px",borderRadius:3}}>
                                {analysis.trendGrade==="BULLISH"?"▲ EMA BULLISH":
                                 analysis.trendGrade==="MIXED"?"~ EMA MIXED":"▼ EMA BEARISH"}
                              </span>
                              {analysis.floatTier&&(
                                <span style={{fontFamily:"monospace",fontSize:8,
                                  color:T.textFaint,background:rowBg,
                                  border:`1px solid ${T.border}`,
                                  padding:"2px 8px",borderRadius:3}}>
                                  FLOAT: {analysis.floatTier}
                                </span>
                              )}
                            </div>
                          )}
                          {/* Catalyst found */}
                          {analysis.catalyst&&(
                            <div style={{fontFamily:"monospace",fontSize:9,color:T.text,
                              lineHeight:1.5,marginBottom:6,
                              padding:"6px 10px",background:cardBg,
                              borderLeft:"3px solid #00d4ff",borderRadius:"0 4px 4px 0"}}>
                              <span style={{fontSize:7.5,color:"#00d4ff",display:"block",marginBottom:2}}>CATALYST</span>
                              {analysis.catalyst}
                            </div>
                          )}
                          {/* Risk */}
                          {analysis.risks&&(
                            <div style={{fontFamily:"monospace",fontSize:8.5,color:"#ff9f1c",
                              lineHeight:1.5,padding:"5px 10px",background:"rgba(255,159,28,.07)",
                              borderLeft:"3px solid rgba(255,159,28,.4)",borderRadius:"0 4px 4px 0"}}>
                              <span style={{fontSize:7,display:"block",marginBottom:2}}>RISK</span>
                              {analysis.risks}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Reasoning */}
                      <div style={{fontFamily:"monospace",fontSize:10,color:T.text,
                        lineHeight:1.6,marginBottom:12,padding:"8px 12px",
                        background:cardBg,borderRadius:4,
                        border:`1px solid ${T.border}`}}>
                        <span style={{fontSize:7.5,color:T.textFaint,display:"block",
                          marginBottom:4,letterSpacing:".08em"}}>REASONING</span>
                        {analysis.reasoning}
                      </div>

                      {/* Detail cards */}
                      {analysis.details&&(
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                          {[
                            ["Impact",       "#00d4ff", analysis.details.Impact],
                            ["Quality",      T.accent, analysis.details.Quality],
                            ["Explosiveness","#ff9f1c", analysis.details.Explosiveness],
                            ["Longevity",    "#c77dff", analysis.details.Longevity],
                          ].filter(([,, v]) => v).map(([label, color, val]) => (
                            <div key={label} style={{background:cardBg,
                              border:`1px solid ${color}22`,
                              borderTop:`2px solid ${color}`,
                              borderRadius:4,padding:"8px 10px"}}>
                              <div style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
                                color,letterSpacing:".06em",marginBottom:4}}>
                                ✦ {label.toUpperCase()}
                              </div>
                              <div style={{fontFamily:"monospace",fontSize:9,color:T.text,lineHeight:1.5}}>
                                {val}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Catalyst news source */}
                      {analysis.catalystNews&&(
                        <div style={{marginTop:8,padding:"6px 10px",background:dark?"#020405":"#f0f4f8",
                          borderRadius:4,border:`1px solid ${T.border}`}}>
                          <span style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,
                            letterSpacing:".06em",display:"block",marginBottom:3}}>
                            WEB SEARCH · CATALYST SOURCE
                          </span>
                          <span style={{fontFamily:"monospace",fontSize:8.5,color:T.textDim,lineHeight:1.5}}>
                            {analysis.catalystNews}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* No analysis yet prompt */}
                  {!analysis&&(
                    <div style={{padding:"12px 18px",display:"flex",alignItems:"center",gap:12}}>
                      <span style={{fontFamily:"monospace",fontSize:9,color:T.textFaint}}>
                        Click ✦ ANALYZE to get Claude's AI-powered grade and trade analysis for {row.symbol}
                      </span>
                      <button onClick={()=>analyzeStock(row)}
                        style={{fontFamily:"monospace",fontSize:9,padding:"5px 14px",border:"none",
                          borderRadius:4,cursor:"pointer",background:"rgba(0,212,255,.15)",
                          color:"#00d4ff",outline:"1px solid rgba(0,212,255,.35)"}}>
                        ✦ ANALYZE NOW
                      </button>
                    </div>
                  )}

                  {/* ── NEWS + FUNDAMENTALS PANEL ── */}
                  {(()=>{
                    const nd = newsData[row.symbol];
                    const SEC_FORM_COLORS = {
                      "8-K":"#ff9f1c", "SC 13G":"#c77dff","SC 13D":T.down,
                      "4":T.accent,"S-1":"#00d4ff","S-3":"#00d4ff",
                    };
                    return(
                      <div style={{borderTop:`1px solid ${T.border}`,
                        display:"grid",gridTemplateColumns:"1fr 300px",
                        gap:0}}>

                        {/* News feed */}
                        <div style={{borderRight:`1px solid ${T.border}`,padding:"10px 14px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,
                              letterSpacing:".08em"}}>
                              NEWS FEED · FINVIZ + SEC EDGAR
                            </span>
                            <div style={{display:"flex",gap:6,alignItems:"center"}}>
                              {nd?.sources&&(
                                <span style={{fontFamily:"monospace",fontSize:7,color:T.textGhost}}>
                                  {nd.sources.finvizCount||0} Finviz · {nd.sources.secCount||0} SEC
                                </span>
                              )}
                              <button onClick={e=>{e.stopPropagation();
                                setNewsData(p=>({...p,[row.symbol]:undefined}));
                                setTimeout(()=>loadNews(row.symbol),100);
                              }}
                                style={{fontFamily:"monospace",fontSize:8,padding:"2px 7px",border:"none",
                                  borderRadius:3,cursor:"pointer",
                                  background:"rgba(0,232,122,.1)",color:T.accent}}>↺</button>
                            </div>
                          </div>

                          {nd?.loading&&(
                            <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,padding:"8px 0"}}>
                              Loading news from Finviz + SEC…
                            </div>
                          )}
                          {!nd&&!nd?.loading&&(
                            <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,padding:"4px 0"}}>
                              News loading…
                            </div>
                          )}
                          {nd?.news?.length>0&&(
                            <div style={{display:"flex",flexDirection:"column",gap:4,maxHeight:280,overflowY:"auto"}}>
                              {nd.news.map((item,ni)=>{
                                const isSec = item.type==="sec";
                                const secColor = SEC_FORM_COLORS[item.formType] || "#ff9f1c";
                                return(
                                  <div key={ni} style={{display:"flex",gap:8,alignItems:"flex-start",
                                    padding:"5px 8px",borderRadius:4,
                                    background:isSec?"rgba(255,159,28,.05)":"transparent",
                                    border:isSec?`1px solid rgba(255,159,28,.15)`:`1px solid transparent`,
                                    transition:"background .1s"}}
                                    onMouseEnter={e=>e.currentTarget.style.background=isSec?"rgba(255,159,28,.08)":"rgba(255,255,255,.03)"}
                                    onMouseLeave={e=>e.currentTarget.style.background=isSec?"rgba(255,159,28,.05)":"transparent"}>
                                    {/* Source badge */}
                                    <div style={{flexShrink:0,paddingTop:1}}>
                                      {isSec
                                        ?<span style={{fontFamily:"monospace",fontSize:7,fontWeight:700,
                                          color:secColor,background:`${secColor}18`,
                                          border:`1px solid ${secColor}30`,
                                          padding:"1px 4px",borderRadius:2,whiteSpace:"nowrap"}}>
                                          SEC {item.formType}
                                        </span>
                                        :<span style={{fontFamily:"monospace",fontSize:7,
                                          color:T.textGhost,background:rowBg,
                                          border:`1px solid ${T.border}`,
                                          padding:"1px 4px",borderRadius:2,whiteSpace:"nowrap",maxWidth:60,
                                          display:"inline-block",overflow:"hidden",textOverflow:"ellipsis"}}>
                                          {item.source?.substring(0,12)||"News"}
                                        </span>}
                                    </div>
                                    {/* Headline + date */}
                                    <div style={{flex:1,minWidth:0}}>
                                      {item.url
                                        ?<a href={item.url} target="_blank" rel="noopener noreferrer"
                                          style={{fontFamily:"monospace",fontSize:9,
                                            color:isSec?secColor:T.text,
                                            textDecoration:"none",lineHeight:1.4,display:"block"}}
                                          onClick={e=>e.stopPropagation()}>
                                          {item.headline}
                                        </a>
                                        :<span style={{fontFamily:"monospace",fontSize:9,color:T.text,lineHeight:1.4}}>
                                          {item.headline}
                                        </span>}
                                      {item.date&&(
                                        <span style={{fontFamily:"monospace",fontSize:7,color:T.textGhost,marginTop:1,display:"block"}}>
                                          {item.date}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {nd&&!nd.loading&&nd.news.length===0&&(
                            <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,padding:"4px 0"}}>
                              No recent news found for {row.symbol}
                            </div>
                          )}
                        </div>

                        {/* Finviz fundamentals sidebar */}
                        <div style={{padding:"10px 14px"}}>
                          <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,
                            letterSpacing:".08em",marginBottom:8}}>
                            FINVIZ FUNDAMENTALS
                          </div>
                          {nd?.fundamentals&&Object.keys(nd.fundamentals).length>0
                            ?(()=>{
                              const f = nd.fundamentals;
                              const rows = [
                                ["Target Price", f.targetPrice, f.targetPrice&&row.price?(parseFloat(f.targetPrice)>row.price?T.accent:T.down):T.textMid],
                                ["Analyst Rec",  f.analystRec,  f.analystRec?.includes("Buy")?T.accent:f.analystRec?.includes("Sell")?T.down:"#ff9f1c"],
                                ["Earnings",     f.earnings,    "#c77dff"],
                                ["Short Float",  f.shortFloat,  f.shortFloat&&parseFloat(f.shortFloat)>20?T.down:f.shortFloat&&parseFloat(f.shortFloat)>10?"#ff9f1c":T.textMid],
                                ["Short Ratio",  f.shortRatio,  T.textMid],
                                ["P/E Ratio",    f.peRatio,     T.textMid],
                                ["EPS (ttm)",    f.eps,         f.eps&&parseFloat(f.eps)>0?T.accent:T.down],
                                ["Insider Own",  f.insiderOwn,  T.textMid],
                                ["Inst Own",     f.instOwn,     T.textMid],
                                ["Perf Week",    f.perfWeek,    f.perfWeek?.startsWith("-")?T.down:T.accent],
                                ["Perf Month",   f.perfMonth,   f.perfMonth?.startsWith("-")?T.down:T.accent],
                                ["Perf YTD",     f.perfYTD,     f.perfYTD?.startsWith("-")?T.down:T.accent],
                                ["Beta",         f.beta,        T.textMid],
                                ["Avg Volume",   f.avgVolume,   T.textMid],
                              ].filter(([,v])=>v&&v!=="N/A"&&v!=="-");
                              return(
                                <div style={{display:"flex",flexDirection:"column",gap:3}}>
                                  {rows.map(([label,val,color])=>(
                                    <div key={label} style={{display:"flex",justifyContent:"space-between",
                                      alignItems:"center",padding:"3px 0",
                                      borderBottom:`1px solid ${T.border}`}}>
                                      <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>{label}</span>
                                      <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,color}}>{val}</span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()
                            :<div style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>
                              {nd?.loading?"Loading…":"No data"}
                            </div>}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary stats bar */}
      {data&&sortedRows.length>0&&(
        <div style={{display:"flex",gap:16,padding:"10px 14px",background:cardBg,
          border:`1px solid ${T.border}`,borderRadius:6,marginTop:8,flexWrap:"wrap",alignItems:"center"}}>
          {[
            ["Total PM Movers", sortedRows.length],
            ["Avg PM%", "+"+(sortedRows.reduce((s,r)=>s+(r.pmPct||0),0)/sortedRows.length).toFixed(1)+"%"],
            ["Earnings", sortedRows.filter(r=>r.category==="Earnings").length],
            ["Industry Move", sortedRows.filter(r=>r.category==="Industry Move").length],
            ["Short Squeeze", sortedRows.filter(r=>r.category==="Short Squeeze").length],
            ["High ADR(>5%)", sortedRows.filter(r=>(r.adrPct||0)>5).length],
            ["High Short(>15%)", sortedRows.filter(r=>(r.shortPct||0)>15).length],
          ].map(([l,v])=>(
            <div key={l} style={{textAlign:"center"}}>
              <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,marginBottom:2}}>{l}</div>
              <div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:T.accent}}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}



export default PremarketTab;
