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
  if(v>=5)  return{bg:"rgba(0,232,122,.25)", fg:"var(--clr-up)"};
  if(v>=2)  return{bg:"rgba(0,232,122,.12)", fg:"var(--clr-up-soft)"};
  if(v>=0)  return{bg:"rgba(0,232,122,.05)", fg:"#7ab89a"};
  if(v>=-2) return{bg:"rgba(255,69,96,.05)",  fg:"#d08080"};
  if(v>=-5) return{bg:"rgba(255,69,96,.12)",  fg:"#ff6060"};
  return      {bg:"rgba(255,69,96,.25)",      fg:"var(--clr-dn)"};
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
  const _stk = useTheme();
  const T    = THEME[_stk] || THEME.night;
  const colors = { BREAKOUT:T.accent, "BUY ZONE":T.accent, PULLBACK:"#ff9f1c", BREAKDOWN:T.down };
  const c = colors[sig] || T.textDim;
  if (!sig) return null;
  return <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,color:c,
    background:`${c}18`,border:`1px solid ${c}30`,padding:"1px 5px",borderRadius:2}}>{sig}</span>;
}

// ─── RVBar – relative volume bar ─────────────────────────────────────────────
function RVBar({ rv }) {
  const width = Math.min(100, (rv / 5) * 100);
  const color = rv >= 3 ? "#ff9f1c" : rv >= 2 ? "#ffe040" : "var(--clr-mid)";
  return (
    <div style={{ width: 40, height: 6, background: "var(--clr-faint)", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: `${width}%`, height: "100%", background: color, borderRadius: 3 }} />
    </div>
  );
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
  const _tk2 = useTheme();
  const T2   = THEME[_tk2] || THEME.night;
  const _color = _color || T2.accent;
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
const TF_DEFS = [
  { key:"d1",   label:"1D",   bars:1   },
  { key:"d5",   label:"1W",   bars:5   },
  { key:"mtd",  label:"MTD",  bars:null },
  { key:"d21",  label:"1M",   bars:21  },
  { key:"d63",  label:"3M",   bars:63  },
  { key:"d126", label:"6M",   bars:126 },
  { key:"ytd",  label:"YTD",  bars:null },
  { key:"d252", label:"1Y",   bars:252 },
];

function PerfCell({ v, bold }) {
  const _ptk = useTheme();
  const T    = THEME[_ptk] || THEME.night;
  if (v == null) return <span style={{fontFamily:"monospace",fontSize:10,color:T.textGhost}}>—</span>;
  const c = v > 5 ? T.accent : v > 0 ? T.accent : v > -5 ? "#ff9f1c" : T.down;
  const bg = v > 5 ? "rgba(0,232,122,.12)" : v > 0 ? "rgba(77,219,158,.1)" : v > -5 ? "rgba(255,159,28,.1)" : "rgba(255,69,96,.1)";
  return (
    <span style={{fontFamily:"monospace",fontSize:bold?12:10,fontWeight:bold?"700":"500",
      color:c,background:bg,padding:"2px 5px",borderRadius:3,whiteSpace:"nowrap"}}>
      {v>=0?"+":""}{v.toFixed(1)}%
    </span>
  );
}

function ThemeRotationTab({ staticThemes, staticRankThemes, liveThemes = null }) {
  const themeKey = useTheme();
  const T = THEME[themeKey] || THEME.night;
  const dark = themeKey === "night";

  const [minAdr,    setMinAdr]    = useState(2);
  const [minRelVol, setMinRelVol] = useState(1.5);
  const [minMcap,   setMinMcap]   = useState(50);
  const [activeTf,  setActiveTf]  = useState("d1");
  const [groupFil,  setGroupFil]  = useState(null);
  const [expanded,  setExpanded]  = useState(null);
  const [fullView,  setFullView]  = useState(null);
  const [autoRef,   setAutoRef]   = useState(true);

  const [registry,  setRegistry]  = useState([]);
  const [regLoaded, setRegLoaded] = useState(false);

  const [perfData,  setPerfData]  = useState(null);
  const [perfLoading,setPerfLoading] = useState(false);

  const [rotData,   setRotData]   = useState(null);
  const [rotLoading,setRotLoading]= useState(false);

  const [stockData, setStockData] = useState({});
  const [stockLoading,setStockLoading] = useState({});

  const [histData,  setHistData]  = useState({});
  const [histLoading,setHistLoading] = useState(false);

  const [lastFetch, setLastFetch] = useState(null);
  const timerRef = useRef(null);

  const loadPerf = useCallback(async () => {
    setPerfLoading(true);
    try {
      const r = await apiFetch("/api/themes/performance");
      setPerfData(r.themes || {});
    } catch(e) { console.warn("perf error", e.message); }
    finally { setPerfLoading(false); }
  }, []);

  const loadRotate = useCallback(async (silent=false) => {
    if (!silent) setRotLoading(true);
    try {
      const r = await apiFetch(`/api/themes/rotate?minAdr=${minAdr}&minRelVol=${minRelVol}&minMcap=${minMcap*1e6}&limit=5`);
      setRotData(r.themes || {});
      setLastFetch(new Date());
    } catch(e) { console.warn("rotate error", e.message); }
    finally { setRotLoading(false); }
  }, [minAdr, minRelVol, minMcap]);

  useEffect(() => {
    apiFetch("/api/themes/config")
      .then(r => {
        setRegistry(r.themes || []);
        setRegLoaded(true);
      })
      .catch(() => setRegLoaded(true));
    loadPerf();
    loadRotate();
  }, []);
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRef) timerRef.current = setInterval(() => loadRotate(true), 60_000);
    return () => clearInterval(timerRef.current);
  }, [autoRef, loadRotate]);

  const loadStocks = useCallback(async (themeName) => {
    if (stockData[themeName] || stockLoading[themeName]) return;
    setStockLoading(p => ({ ...p, [themeName]: true }));
    try {
      const r = await apiFetch(`/api/themes/stocks?theme=${encodeURIComponent(themeName)}&min=10&minAdr=${minAdr}&minRelVol=${minRelVol}`);
      setStockData(p => ({ ...p, [themeName]: r }));
    } catch(e) { console.warn("stocks error", e.message); }
    finally { setStockLoading(p => ({ ...p, [themeName]: false })); }
  }, [stockData, stockLoading, minAdr, minRelVol]);

  const loadHistorical = useCallback(async (symbols) => {
    const needed = symbols.filter(s => !histData[s]);
    if (!needed.length) return;
    setHistLoading(true);
    try {
      for (let i = 0; i < needed.length; i += 8) {
        const batch = needed.slice(i, i+8);
        const r = await apiFetch(`/api/charts?symbols=${batch.join(",")}&range=1y`);
        if (r.data) setHistData(p => ({ ...p, ...r.data }));
      }
    } catch(e) {}
    finally { setHistLoading(false); }
  }, [histData]);

  const calcReturn = useCallback((closes, timestamps, tf) => {
    if (!closes || closes.length < 2) return null;
    const now = closes[closes.length-1];
    const bars = TF_DEFS.find(t=>t.key===tf)?.bars;
    if (bars) {
      const from = closes[Math.max(0, closes.length-1-bars)];
      if (!from) return null;
      return +((now-from)/from*100).toFixed(2);
    }
    const yr = new Date().getFullYear();
    const mo = new Date().getMonth();
    const targetTs = tf==="ytd"
      ? Math.floor(new Date(yr,0,1).getTime()/1000)
      : Math.floor(new Date(yr,mo,1).getTime()/1000);
    if (!timestamps) return null;
    let idx = timestamps.findIndex(t => t >= targetTs);
    if (idx < 0) idx = 0;
    const from = closes[idx];
    if (!from) return null;
    return +((now-from)/from*100).toFixed(2);
  }, []);

  const sortedThemes = useMemo(() => {
    let list = registry;
    if (groupFil) list = list.filter(t => t.group === groupFil);
    return list.map(t => ({
      ...t,
      perf: perfData ? (perfData[t.name] || {}) : {},
      liveCount: liveThemes?.[t.name]?.liveCount || rotData?.[t.name]?.liveCount || 0,
      liveAvgChg: liveThemes?.[t.name]?.avgChg ?? null,
      liveTickers: liveThemes?.[t.name]?.tickers || [],
    })).sort((a, b) => {
      if (!perfData) return 0;
      const av = a.perf[activeTf];
      const bv = b.perf[activeTf];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
  }, [registry, perfData, rotData, liveThemes, activeTf, groupFil]);

  const groups = useMemo(() => {
    return [...new Set(registry.map(t => t.group))];
  }, [registry]);

  const loading = perfLoading || rotLoading;

  const cardBg = dark ? T.surface : T.surface;
  const rowBg  = dark ? T.row : T.row;
  const hdBg   = dark ? "#050a0e" : T.header;

  return (
    <div>
      <div style={{background:cardBg,border:`1px solid ${T.border}`,borderRadius:8,
        padding:"12px 16px",marginBottom:12}}>
        <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
          <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:T.text}}>
            THEME SCREENER
          </span>
          <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,
            background:rowBg,padding:"2px 8px",borderRadius:3}}>
            {loading?"Scanning…":`${sortedThemes.length} themes · ${lastFetch?.toLocaleTimeString()||"--"}`}
          </span>
          <div style={{marginLeft:"auto",display:"flex",gap:6}}>
            <button onClick={()=>setAutoRef(a=>!a)}
              style={{fontFamily:"monospace",fontSize:8,padding:"4px 9px",borderRadius:3,border:"none",cursor:"pointer",
                background:autoRef?"rgba(0,232,122,.12)":rowBg,
                color:autoRef?T.accent:T.textDim,
                outline:autoRef?"1px solid rgba(0,232,122,.3)":`1px solid ${T.border}`}}>
              {autoRef?"AUTO ON":"AUTO OFF"}
            </button>
            <button onClick={()=>{loadPerf();loadRotate();}}
              style={{fontFamily:"monospace",fontSize:9,padding:"4px 12px",borderRadius:3,border:"none",cursor:"pointer",
                background:"rgba(0,232,122,.14)",color:T.accent,outline:"1px solid rgba(0,232,122,.3)",
                opacity:loading?.6:1}}>
              {loading?"…":"↺ REFRESH"}
            </button>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14,marginBottom:10}}>
          {[
            {label:"MIN ADR%",min:0,max:10,step:.5,val:minAdr,set:setMinAdr,
              fmt:v=>v.toFixed(1)+"%",color:v=>v>=5?T.down:v>=3?"#ff9f1c":T.accent},
            {label:"MIN REL VOL",min:0,max:5,step:.5,val:minRelVol,set:setMinRelVol,
              fmt:v=>v.toFixed(1)+"×",color:v=>v>=3?T.down:"#ff9f1c"},
            {label:"MIN MCAP",min:0,max:5000,step:50,val:minMcap,set:setMinMcap,
              fmt:v=>v>=1000?(v/1000).toFixed(1)+"B":v+"M",color:()=>T.accent},
          ].map(({label,min,max,step,val,set,fmt,color})=>(
            <div key={label} style={{display:"flex",flexDirection:"column",gap:5}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontFamily:"monospace",fontSize:8,color:T.textDim,letterSpacing:".06em"}}>{label}</span>
                <span style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:color(val)}}>{fmt(val)}</span>
              </div>
              <input type="range" min={min} max={max} step={step} value={val}
                onChange={e=>set(typeof min==="number"&&step<1?parseFloat(e.target.value):parseInt(e.target.value))}
                style={{width:"100%",accentColor:color(val)}}/>
            </div>
          ))}
        </div>

        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>{loadPerf();loadRotate();}}
            style={{fontFamily:"monospace",fontSize:9,padding:"6px 16px",borderRadius:4,
              cursor:"pointer",background:"rgba(0,232,122,.15)",color:T.accent,
              border:"1px solid rgba(0,232,122,.4)",fontWeight:700}}>
            ▶ APPLY
          </button>
          {[
            ["Conservative",{minAdr:1,minRelVol:1,minMcap:500}],
            ["Active",      {minAdr:2,minRelVol:1.5,minMcap:100}],
            ["Aggressive",  {minAdr:4,minRelVol:2,minMcap:50}],
            ["High Octane", {minAdr:6,minRelVol:3,minMcap:50}],
          ].map(([l,v])=>(
            <button key={l} onClick={()=>{setMinAdr(v.minAdr);setMinRelVol(v.minRelVol);setMinMcap(v.minMcap);}}
              style={{fontFamily:"monospace",fontSize:8,padding:"4px 9px",cursor:"pointer",
                background:rowBg,color:T.textDim,border:`1px solid ${T.border}`,borderRadius:3}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div style={{display:"flex",gap:0,marginBottom:12,background:cardBg,
        border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden",alignItems:"stretch"}}>
        <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,padding:"8px 12px",
          borderRight:`1px solid ${T.border}`,display:"flex",alignItems:"center",whiteSpace:"nowrap"}}>
          SORT BY PERIOD:
        </span>
        {TF_DEFS.map(tf=>(
          <button key={tf.key} onClick={()=>setActiveTf(tf.key)}
            style={{fontFamily:"monospace",fontSize:9,padding:"8px 12px",cursor:"pointer",border:"none",
              borderRight:`1px solid ${T.border}`,flex:1,
              background:activeTf===tf.key?"rgba(0,232,122,.14)":cardBg,
              color:activeTf===tf.key?T.accent:T.textDim,
              fontWeight:activeTf===tf.key?"700":"400",
              outline:activeTf===tf.key?"inset 0 -2px 0 #00e87a":"none"}}>
            {tf.label}
          </button>
        ))}
        <select value={groupFil||""} onChange={e=>setGroupFil(e.target.value||null)}
          style={{fontFamily:"monospace",fontSize:9,padding:"0 10px",border:"none",
            background:groupFil?"rgba(0,232,122,.1)":cardBg,
            color:groupFil?T.accent:T.textDim,
            borderLeft:`1px solid ${T.border}`,minWidth:130,cursor:"pointer"}}>
          <option value="">All Groups</option>
          {groups.map(g=><option key={g} value={g}>{g}</option>)}
        </select>
      </div>

      {!regLoaded && (
        <div style={{background:cardBg,border:`1px solid ${T.border}`,borderRadius:6,
          padding:48,textAlign:"center"}}>
          <div style={{fontFamily:"monospace",fontSize:13,color:T.accent,letterSpacing:".1em",marginBottom:8}}>
            LOADING THEMES…
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:6,marginTop:16}}>
            {[0,1,2,3,4].map(i=>(
              <div key={i} style={{width:8,height:8,borderRadius:"50%",background:T.accent,
                animation:`bn 1s ${i*.15}s infinite`}}/>
            ))}
          </div>
        </div>
      )}

      {regLoaded && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:8,marginBottom:14}}>
          {sortedThemes.map((t, rank) => {
            const isOpen = expanded === t.name;
            const actV = t.perf[activeTf];
            const mainColor = actV==null?T.textMid:actV>5?T.accent:actV>0?T.accent:actV>-5?"#ff9f1c":T.down;

            return (
              <div key={t.name}
                style={{background:cardBg,
                  border:`1px solid ${isOpen?t.color+"66":T.border}`,
                  borderRadius:6,overflow:"hidden",cursor:"pointer",transition:"all .15s",
                  boxShadow:isOpen?`0 0 12px ${t.color}22`:"none"}}
                onClick={()=>{
                  if (isOpen) { setExpanded(null); setFullView(null); }
                  else { setExpanded(t.name); loadStocks(t.name); setFullView(null); }
                }}
                onMouseEnter={e=>{ e.currentTarget.style.borderColor=t.color+"44"; }}
                onMouseLeave={e=>{ e.currentTarget.style.borderColor=isOpen?t.color+"66":T.border; }}>

                <div style={{height:3,background:t.color,opacity:.7}}/>

                <div style={{padding:"10px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:T.text,
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</div>
                      <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,marginTop:1}}>{t.group}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0,marginLeft:8}}>
                      <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textGhost,
                        background:rowBg,padding:"1px 5px",borderRadius:2}}>#{rank+1}</span>
                      {actV!=null&&(
                        <span style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:mainColor}}>
                          {actV>=0?"+":""}{actV.toFixed(1)}%
                        </span>
                      )}
                      <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>{TF_DEFS.find(tf=>tf.key===activeTf)?.label}</span>
                    </div>
                  </div>

                  <div style={{display:"flex",gap:3,flexWrap:"wrap",marginBottom:8}}>
                    {TF_DEFS.map(tf=>{
                      const v = t.perf[tf.key];
                      const isActive = tf.key===activeTf;
                      const c = v==null?T.textGhost:v>0?T.accent:T.down;
                      return(
                        <div key={tf.key}
                          onClick={e=>{e.stopPropagation();setActiveTf(tf.key);}}
                          style={{display:"flex",flexDirection:"column",alignItems:"center",
                            background:isActive?`${t.color}15`:rowBg,
                            border:`1px solid ${isActive?t.color+"44":T.border}`,
                            borderRadius:3,padding:"3px 5px",cursor:"pointer",minWidth:36}}>
                          <span style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,letterSpacing:".04em"}}>{tf.label}</span>
                          <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,color:c}}>
                            {v==null?"—":`${v>=0?"+":""}${v.toFixed(1)}%`}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>
                      {t.liveTickers.length>0
                        ? t.liveTickers.slice(0,3).map(s=>s.symbol).join(" · ")
                        : (t.perf.bellwethers||[]).slice(0,3).join(" · ")}
                    </div>
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      {t.liveAvgChg!=null&&(
                        <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
                          color:t.liveAvgChg>0?T.accent:t.liveAvgChg<0?T.down:T.textMid}}>
                          {t.liveAvgChg>=0?"+":""}{t.liveAvgChg.toFixed(1)}%
                        </span>
                      )}
                      {(t.liveCount||0)>0&&(
                        <span style={{fontFamily:"monospace",fontSize:7.5,color:T.accent,
                          background:"rgba(0,232,122,.1)",border:"1px solid rgba(0,232,122,.2)",
                          padding:"1px 5px",borderRadius:2}}>
                          {t.liveCount} LIVE
                        </span>
                      )}
                      <span style={{fontFamily:"monospace",fontSize:8,color:isOpen?t.color:T.textFaint}}>
                        {isOpen?"▲ CLOSE":"▼ EXPAND"}
                      </span>
                    </div>
                  </div>
                </div>

                {isOpen&&(
                  <div style={{borderTop:`1px solid ${t.color}22`}}
                    onClick={e=>e.stopPropagation()}>

                    <div style={{display:"grid",
                      gridTemplateColumns:"76px 110px 140px 80px 80px 80px 70px 52px 52px",
                      padding:"6px 12px",background:rowBg,
                      borderBottom:`1px solid ${T.border}`,gap:4,alignItems:"center"}}>
                      {["TICKER","SECTOR","INDUSTRY","PRICE","1D",`${TF_DEFS.find(tf=>tf.key===activeTf)?.label||"1D"}`,"REL VOL","50D","200D"].map((h,i)=>(
                        <span key={h} style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,
                          letterSpacing:".06em",textAlign:i>=3?"center":"left"}}>{h}</span>
                      ))}
                    </div>

                    {(()=>{
                      const liveList = t.liveTickers.length > 0
                        ? t.liveTickers.map(s=>({
                            symbol:s.symbol, name:s.name||s.symbol,
                            price:s.price||0, change:s.change||0,
                            relVol:s.relVol||0, marketCap:s.marketCap||null,
                            sector:s.sector||"", industry:s.industry||"",
                            _source:"live", _themes:[t.name],
                            above50:null, above200:null,
                          }))
                        : null;
                      const apiList = stockData[t.name]?.stocks || null;
                      const displayList = liveList || apiList;

                      if (!displayList && stockLoading[t.name]) return (
                        <div style={{padding:"12px",textAlign:"center",fontFamily:"monospace",fontSize:9,color:T.textFaint}}>
                          Loading stocks…
                        </div>
                      );
                      if (!displayList) return (
                        <div style={{padding:"12px",textAlign:"center",fontFamily:"monospace",fontSize:9,color:T.textFaint}}>
                          No stocks loaded — click expand to load
                        </div>
                      );

                      return (
                        <>
                          {displayList.map((s, si)=>{
                            const sc = secCol(s.sector||"");
                            const cg = (s.change||0)>0?T.accent:(s.change||0)<0?T.down:T.textMid;
                            const actReturn = histData[s.symbol]
                              ? calcReturn(histData[s.symbol].closes, histData[s.symbol].timestamps, activeTf)
                              : null;
                            const isLive = s._source==="live";
                            return (
                              <div key={s.symbol}
                                style={{display:"grid",
                                  gridTemplateColumns:"76px 110px 140px 80px 80px 80px 70px 52px 52px",
                                  padding:"7px 12px",gap:4,alignItems:"center",
                                  borderBottom:si<displayList.length-1?`1px solid ${T.border}`:"none",
                                  transition:"background .1s"}}
                                onMouseEnter={e=>e.currentTarget.style.background=`${t.color}08`}
                                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>

                                <div>
                                  <div style={{fontFamily:"monospace",fontSize:12,color:T.text,fontWeight:700}}>
                                    {s.symbol}
                                  </div>
                                  <span style={{fontFamily:"monospace",fontSize:6.5,
                                    color:isLive?T.accent:T.textFaint,
                                    background:isLive?"rgba(0,232,122,.1)":rowBg,
                                    border:`1px solid ${isLive?"rgba(0,232,122,.2)":T.border}`,
                                    padding:"1px 3px",borderRadius:2}}>
                                    {isLive?"LIVE":"SEED"}
                                  </span>
                                </div>

                                <div style={{minWidth:0}}>
                                  {s.sector
                                    ?<span style={{fontFamily:"monospace",fontSize:7.5,fontWeight:600,
                                        color:sc,background:`${sc}18`,border:`1px solid ${sc}28`,
                                        padding:"2px 5px",borderRadius:3,display:"inline-block",
                                        maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                        {s.sector}
                                      </span>
                                    :<span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>—</span>}
                                </div>

                                <div style={{minWidth:0}}>
                                  <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim,
                                    display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                    {s.industry||"—"}
                                  </span>
                                </div>

                                <div style={{textAlign:"center",fontFamily:"monospace",fontSize:11,color:T.text}}>
                                  ${fmt(s.price||0)}
                                </div>

                                <div style={{textAlign:"center"}}>
                                  <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:cg}}>
                                    {(s.change||0)>=0?"+":""}{(s.change||0).toFixed(2)}%
                                  </span>
                                </div>

                                <div style={{textAlign:"center"}}>
                                  {actReturn!=null
                                    ?<PerfCell v={actReturn}/>
                                    :<span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>—</span>}
                                </div>

                                <div style={{display:"flex",justifyContent:"center"}}>
                                  <RVBar rv={s.relVol||0}/>
                                </div>

                                {[s.above50,s.above200].map((v,j)=>{
                                  const ab=v===true, no=v===false;
                                  return (
                                    <div key={j} style={{textAlign:"center"}}>
                                      <span style={{fontFamily:"monospace",fontSize:7.5,fontWeight:700,
                                        color:ab?T.accent:no?T.down:T.textGhost,
                                        background:ab?"rgba(0,232,122,.1)":no?"rgba(255,69,96,.1)":"transparent",
                                        padding:"2px 3px",borderRadius:2,
                                        border:`1px solid ${ab?"rgba(0,232,122,.2)":no?"rgba(255,69,96,.2)":"transparent"}`}}>
                                        {["50D","200D"][j]}{ab?"▲":no?"▼":""}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}

                          <div style={{display:"flex",gap:10,alignItems:"center",padding:"8px 12px",
                            background:rowBg,borderTop:`1px solid ${T.border}`,flexWrap:"wrap"}}>
                            {liveList
                              ? <span style={{fontFamily:"monospace",fontSize:8,color:T.accent,fontWeight:700}}>
                                  {liveList.length} LIVE SCREENER STOCKS
                                </span>
                              : apiList&&<>
                                  <span style={{fontFamily:"monospace",fontSize:8,color:T.accent,fontWeight:700}}>
                                    {apiList.filter(s=>s._source==="live").length} LIVE
                                  </span>
                                  <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>
                                    + {apiList.filter(s=>s._source!=="live").length} seed
                                  </span>
                                </>
                            }
                            {apiList&&<button
                              onClick={()=>{
                                setFullView(fullView===t.name?null:t.name);
                                if (fullView!==t.name) {
                                  const syms = apiList.map(s=>s.symbol);
                                  loadHistorical(syms);
                                }
                              }}
                              style={{marginLeft:"auto",fontFamily:"monospace",fontSize:8,
                                padding:"4px 10px",borderRadius:3,border:`1px solid ${t.color}44`,
                                background:`${t.color}10`,color:t.color,cursor:"pointer"}}>
                              {fullView===t.name?"▲ HIDE HISTORY":"▼ FULL HISTORY (1D→1Y)"}
                            </button>}
                          </div>

                          {fullView===t.name&&apiList&&(
                            <div style={{overflowX:"auto",borderTop:`1px solid ${t.color}22`}}>
                              {histLoading&&(
                                <div style={{padding:"10px",textAlign:"center",fontFamily:"monospace",fontSize:9,color:T.textFaint}}>
                                  Loading historical data…
                                </div>
                              )}
                              {!histLoading&&(
                                <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace",fontSize:9}}>
                                  <thead>
                                    <tr style={{background:rowBg,borderBottom:`1px solid ${T.border}`}}>
                                      {["TICKER","SECTOR","INDUSTRY","THEME TAGS","1D","1W","MTD","1M","3M","6M","YTD","1Y"].map(h=>(
                                        <th key={h} style={{padding:"6px 8px",color:T.textFaint,letterSpacing:".06em",
                                          fontWeight:500,textAlign:["TICKER","SECTOR","INDUSTRY","THEME TAGS"].includes(h)?"left":"center",
                                          whiteSpace:"nowrap"}}>
                                          {h}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {apiList.map((s,si)=>{
                                      const cd = histData[s.symbol];
                                      const sc = secCol(s.sector||"");
                                      return(
                                        <tr key={s.symbol}
                                          style={{borderBottom:`1px solid ${T.border}`,transition:"background .1s"}}
                                          onMouseEnter={e=>e.currentTarget.style.background=`${t.color}06`}
                                          onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                          <td style={{padding:"7px 8px",fontWeight:700,color:T.text,whiteSpace:"nowrap"}}>
                                            {s.symbol}
                                            <span style={{marginLeft:4,fontSize:6.5,
                                              color:s._source==="live"?T.accent:T.textFaint,
                                              background:s._source==="live"?"rgba(0,232,122,.1)":rowBg,
                                              border:`1px solid ${s._source==="live"?"rgba(0,232,122,.2)":T.border}`,
                                              padding:"1px 3px",borderRadius:2}}>
                                              {s._source==="live"?"LIVE":"SEED"}
                                            </span>
                                          </td>
                                          <td style={{padding:"7px 8px"}}>
                                            {s.sector&&<span style={{color:sc,background:`${sc}15`,
                                              border:`1px solid ${sc}25`,padding:"2px 5px",borderRadius:3,
                                              display:"inline-block",maxWidth:90,overflow:"hidden",
                                              textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:8}}>
                                              {s.sector}
                                            </span>}
                                          </td>
                                          <td style={{padding:"7px 8px",color:T.textDim,maxWidth:130,
                                            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                            {s.industry||"—"}
                                          </td>
                                          <td style={{padding:"7px 8px"}}>
                                            <div style={{display:"flex",gap:2,flexWrap:"wrap"}}>
                                              {(s._themes||[t.name]).slice(0,3).map(tn=>(
                                                <span key={tn} style={{fontSize:6.5,color:t.color,
                                                  background:`${t.color}12`,border:`1px solid ${t.color}22`,
                                                  padding:"1px 3px",borderRadius:2,whiteSpace:"nowrap"}}>
                                                  {tn.length>16?tn.substring(0,15)+"…":tn}
                                                </span>
                                              ))}
                                            </div>
                                          </td>
                                          {TF_DEFS.map(tf=>{
                                            const v = cd ? calcReturn(cd.closes, cd.timestamps, tf.key) : null;
                                            const isActiveTf = tf.key===activeTf;
                                            return(
                                              <td key={tf.key} style={{padding:"7px 6px",textAlign:"center",
                                                background:isActiveTf?`${t.color}08`:"transparent"}}>
                                                <PerfCell v={v} bold={tf.key==="d1"}/>
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ThemeRotationTab;