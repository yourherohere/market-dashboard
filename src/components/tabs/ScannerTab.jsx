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
  if(v>=5)  return{bg:"rgba(63,185,80,.25)", fg:"var(--clr-up)"};
  if(v>=2)  return{bg:"rgba(63,185,80,.12)", fg:"var(--clr-up)"};
  if(v>=0)  return{bg:"rgba(63,185,80,.05)", fg:"#7ab89a"};
  if(v>=-2) return{bg:"rgba(248,81,73,.05)", fg:T.down};
  if(v>=-5) return{bg:"rgba(248,81,73,.12)", fg:"#ff6060"};
  return      {bg:"rgba(248,81,73,.25)",     fg:"var(--clr-dn)"};
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
  const _tk = useTheme();
  const _T  = THEME[_tk] || THEME.night;
  const colors = { BREAKOUT:_T.accent, "BUY ZONE":_T.accent, PULLBACK:"#ff9f1c", BREAKDOWN:_T.down };
  const c = colors[sig] || _T.textDim;
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
function MultiSelectDropdown({ label, options, selected, onChange, color, width=200 }) {
  const _tk = useTheme();
  const T   = THEME[_tk] || THEME.night;
  const _color = color || T.accent;
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
          width,boxSizing:"border-box",boxShadow:selCount>0?`0 0 8px ${_color}18`:"none"}}>
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
          <div style={{padding:"6px 10px",borderBottom:`1px solid ${T.border}`,display:"flex",gap:8}}>
            <span onClick={()=>onChange(options)} style={{fontFamily:"monospace",fontSize:8,_color,cursor:"pointer"}}>ALL</span>
            <span style={{color:T.border2}}>|</span>
            <span onClick={()=>onChange([])} style={{fontFamily:"monospace",fontSize:8,color:T.textDim,cursor:"pointer"}}>NONE</span>
          </div>
          {options.map(opt=>(
            <div key={opt} onClick={()=>toggle(opt)}
              style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",cursor:"pointer",
                background:selected.includes(opt)?`${_color}0e`:"transparent",borderBottom:`1px solid ${T.border}`}}
              onMouseEnter={e=>{ if(!selected.includes(opt)) e.currentTarget.style.background=T.border; }}
              onMouseLeave={e=>{ e.currentTarget.style.background=selected.includes(opt)?`${_color}0e`:"transparent"; }}>
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

const SCAN_MODES = [
  {key:"gainers",  label:"TOP GAINERS",   icon:"▲",  color:T.accent, desc:"Biggest % movers today"},
  {key:"volume",   label:"VOL SURGE",     icon:"◉",  color:"#ff9f1c", desc:"Rel. vol vs 10D avg"},
  {key:"momentum", label:"RS LEADERS",   icon:"◈",  color:"#00d4ff", desc:"Composite momentum"},
  {key:"losers",   label:"TOP LOSERS",   icon:"▼",  color:T.down, desc:"Biggest % declines"},
  {key:"eod",      label:"EOD DATABASE", icon:"🗄",  color:"#a78bfa", desc:"Historical DB · 1W–2Y returns", manualOnly:true},
  {key:"shorted",  label:"MOST SHORTED", icon:"⚡",  color:"#ff6b9d", desc:"Highest short interest %", manualOnly:true},
  {key:"52wkhigh", label:"52W HIGHS",    icon:"🔝", color:"#ffe45e", desc:"Near 52-week highs",       manualOnly:true},
  {key:"universe", label:"ALL 6500+",    icon:"🌐", color:"#f9c74f", desc:"Full US stock universe"},
  {key:"custom",   label:"CUSTOM SCAN",  icon:"⚙",  color:"#c77dff", desc:"Build your own filter"},
];

function ScannerTab() {
  const themeKey = useTheme();
  const T        = THEME[themeKey] || THEME.night;
  const dark     = themeKey === "night";

  const [mode,      setMode]      = useState("gainers");
  const [results,   setResults]   = useState({});
  const [loading,   setLoading]   = useState({});
  const [errors,    setErrors]    = useState({});
  const [lastFetch, setLastFetch] = useState({});
  const [sortKey,   setSortKey]   = useState(null);
  const [sortDir,   setSortDir]   = useState(-1);
  const [autoRef,   setAutoRef]   = useState(true);
  const [secFilter, setSecFilter] = useState("");
  const [indFilter, setIndFilter] = useState("");

  // Universe scan state
  const [univStatus,   setUnivStatus]   = useState(null);
  const [univResults,  setUnivResults]  = useState([]);
  const [univLoading,  setUnivLoading]  = useState(false);
  const [univProgress, setUnivProgress] = useState(0);
  const [univPassed,   setUnivPassed]   = useState(0);
  const [univTotal,    setUnivTotal]    = useState(0);
  const [univFilters,  setUnivFilters]  = useState({
    minPrice:"1", minChange:"2", minVol:"100000",
    minMcap:"0", maxChange:"100", sortBy:"change",
    sectors:[], limit:"300",
  });
  const setUF = (k,v) => setUnivFilters(p=>({...p,[k]:v}));
  const univAbort = useRef(null);

  // TradingView popup
  const [tvSymbol,  setTvSymbol]  = useState(null);
  const hoverTimer = useRef(null);
  // Symbol search (custom mode)
  const [symSearch,    setSymSearch]    = useState("");
  const [symSearchRes, setSymSearchRes] = useState([]);
  const [symLoading,   setSymLoading]   = useState(false);
  const [pinnedData,   setPinnedData]   = useState({});
  const [pinnedLoading, setPinnedLoading] = useState({});
  const searchRef = useRef(null);
  const timerRef  = useRef(null);

  const [cf, setCf] = useState({
    minPrice:"1", maxPrice:"", minMcap:"10", mcUnit:"M",
    minVol:"50000", minRelVol:"0", minChange:"-100", maxChange:"100",
    sectors:[], industries:[],
    sortBy:"change", limit:"200",
    minRsi:"", maxRsi:"", macdFilter:"any",
    minAdr:"", maxAdr:"",
    quietCandles:"0", quietPct:"2",
  });
  const setC = (k,v) => setCf(p=>({...p,[k]:v}));

  // ── EOD Database scan state ────────────────────────────────────────────────
  const [eodF, setEodF] = useState({
    period:          "d63",
    sortDir:         "desc",
    sortBy:          "period",
    minPrice:        "5",
    maxPrice:        "",
    minVol:          "100000",
    maxAbsReturn:    "500",      // outlier cap — filters reverse-split spikes
    emaFilter:       "any",
    sectors:         [],
    sectorEtfs:      [],
    industryEtfs:    [],
    minPeriod:       "",
    minRsVsSector:   "",
    minRsVsIndustry: "",
    limit:           "200",
  });
  const setE = (k,v) => setEodF(p=>({...p,[k]:v}));

  // Universe status check
  useEffect(() => {
    apiFetch("/api/universe").then(r => {
      setUnivStatus({ count: r.count, loaded: r.loaded, loading: r.loading });
    }).catch(() => {});
  }, [mode]);

  // Stream-based full universe scan
  const runUniverseScan = useCallback(async () => {
    if (univAbort.current) univAbort.current.abort();
    univAbort.current = new AbortController();

    setUnivLoading(true);
    setUnivResults([]);
    setUnivProgress(0);
    setUnivPassed(0);
    setUnivTotal(0);

    const params = new URLSearchParams({
      minPrice:  univFilters.minPrice  || 1,
      minChange: univFilters.minChange || 2,
      minVol:    univFilters.minVol    || 100000,
      minMcap:   parseFloat(univFilters.minMcap||0)*1e6,
      maxChange: univFilters.maxChange || 100,
    });

    try {
      const resp = await fetch(`http://localhost:3001/api/scan/full/stream?${params}`, {
        signal: univAbort.current.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const accumulated = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const msg = JSON.parse(line.slice(5).trim());
            if (msg.error) { setErrors(p=>({...p,universe:msg.error})); break; }
            if (msg.batch) {
              accumulated.push(...msg.batch);
              const sorted = [...accumulated].sort((a,b)=>
                Math.abs(b.change||0)-Math.abs(a.change||0)
              ).slice(0, parseInt(univFilters.limit)||300);
              setUnivResults(sorted);
              setUnivPassed(msg.passed || accumulated.length);
              setUnivTotal(msg.total || 0);
              setUnivProgress(msg.total ? Math.round((msg.progress/msg.total)*100) : 0);
            }
            if (msg.done) {
              setUnivProgress(100);
              setUnivTotal(msg.total || 0);
              setLastFetch(p=>({...p,universe:new Date()}));
            }
          } catch(e) {}
        }
      }
    } catch(e) {
      if (e.name !== "AbortError") {
        setErrors(p=>({...p,universe:e.message}));
      }
    } finally {
      setUnivLoading(false);
    }
  }, [univFilters]);

  // Auto-run universe scan when switching to it
  useEffect(() => {
    if (mode === "universe" && univResults.length === 0 && !univLoading) {
      runUniverseScan();
    }
  }, [mode]);

  const availableIndustries = useMemo(()=>{
    const secs = cf.sectors.length>0?cf.sectors:ALL_SECTORS;
    return [...new Set(secs.flatMap(s=>SECTOR_INDUSTRY_MAP[s]||[]))].sort();
  },[cf.sectors]);

  useEffect(()=>{
    if(cf.sectors.length===0)return;
    const valid=new Set(cf.sectors.flatMap(s=>SECTOR_INDUSTRY_MAP[s]||[]));
    const pruned=cf.industries.filter(i=>valid.has(i));
    if(pruned.length!==cf.industries.length)setC("industries",pruned);
  },[cf.sectors]);

  // ── Symbol search ────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(!symSearch||symSearch.length<1){setSymSearchRes([]);return;}
    const t=setTimeout(async()=>{
      setSymLoading(true);
      try{
        const r=await apiFetch(`/api/search?q=${encodeURIComponent(symSearch)}&limit=8`);
        setSymSearchRes(r.results||[]);
      }catch(e){setSymSearchRes([]);}
      setSymLoading(false);
    },300);
    return()=>clearTimeout(t);
  },[symSearch]);

  // Pin a symbol using the FULL ticker object from search results (no re-fetch needed)
  const pinFromSearchResult = (ticker) => {
    setSymSearch(""); setSymSearchRes([]);
    const sym = ticker.symbol;
    if (pinnedData[sym]) return;
    const fullTicker = { ...ticker, _pinned: true };
    setPinnedData(p=>({...p,[sym]:fullTicker}));
    if (!ticker.sector || !ticker.industry) {
      refreshPinnedSector(sym, fullTicker);
    }
  };

  const refreshPinnedSector = async (sym, existing) => {
    try {
      const r = await apiFetch(`/api/sector-info?symbols=${encodeURIComponent(sym)}`);
      const info = r.data?.[sym];
      if (info?.sector) {
        setPinnedData(p=>({...p,[sym]:{...p[sym],sector:info.sector,industry:info.industry||p[sym]?.industry}}));
      }
    } catch(e) {}
  };

  const addPinnedByText = async (sym) => {
    sym = sym.trim().toUpperCase();
    if (!sym) return;
    setSymSearch(""); setSymSearchRes([]);
    if (pinnedData[sym]) return;
    setPinnedLoading(p=>({...p,[sym]:true}));
    setPinnedData(p=>({...p,[sym]:{symbol:sym,_pinned:true,_loading:true}}));
    try {
      const r = await apiFetch(`/api/scan/symbols?symbols=${encodeURIComponent(sym)}`);
      const ticker = r.results?.[0];
      if (ticker) {
        setPinnedData(p=>({...p,[sym]:{...ticker,_pinned:true}}));
      } else {
        try {
          const q2 = await apiFetch(`/api/quotes?symbols=${encodeURIComponent(sym)}`);
          const qd = q2.data?.[sym];
          if (qd?.regularMarketPrice) {
            const built = {
              symbol: sym, _pinned: true,
              price:     qd.regularMarketPrice,
              change:    qd.regularMarketChangePercent??0,
              changeDol: qd.regularMarketChange??0,
              volume:    qd.regularMarketVolume??0,
              avgVol10:  qd.averageDailyVolume10Day??0,
              relVol:    qd.averageDailyVolume10Day>0 ? +(qd.regularMarketVolume/qd.averageDailyVolume10Day).toFixed(2):0,
              marketCap: qd.marketCap??null,
              hi52:      qd.fiftyTwoWeekHigh??null,
              lo52:      qd.fiftyTwoWeekLow??null,
              ema50:     qd.fiftyDayAverage??null,
              ema200:    qd.twoHundredDayAverage??null,
              above50:   qd.fiftyDayAverage?(qd.regularMarketPrice>qd.fiftyDayAverage):null,
              above200:  qd.twoHundredDayAverage?(qd.regularMarketPrice>qd.twoHundredDayAverage):null,
              sector:    qd.sector??null, industry: qd.industry??null,
              hi52Pct:   qd.fiftyTwoWeekHigh?+((qd.regularMarketPrice/qd.fiftyTwoWeekHigh)*100).toFixed(1):null,
              name:      qd.shortName??sym,
            };
            setPinnedData(p=>({...p,[sym]:built}));
            if (!built.sector) refreshPinnedSector(sym, built);
          } else {
            setPinnedData(p=>({...p,[sym]:{symbol:sym,_pinned:true,_notFound:true}}));
          }
        } catch(e2) {
          setPinnedData(p=>({...p,[sym]:{symbol:sym,_pinned:true,_notFound:true}}));
        }
      }
    } catch(e) {
      try {
        const q2 = await apiFetch(`/api/quotes?symbols=${encodeURIComponent(sym)}`);
        const qd = q2.data?.[sym];
        if (qd?.regularMarketPrice) {
          const built = {
            symbol: sym, _pinned: true,
            price:     qd.regularMarketPrice,
            change:    qd.regularMarketChangePercent??0,
            changeDol: qd.regularMarketChange??0,
            volume:    qd.regularMarketVolume??0,
            avgVol10:  qd.averageDailyVolume10Day??0,
            relVol:    qd.averageDailyVolume10Day>0?+(qd.regularMarketVolume/qd.averageDailyVolume10Day).toFixed(2):0,
            marketCap: qd.marketCap??null,
            hi52:      qd.fiftyTwoWeekHigh??null,
            lo52:      qd.fiftyTwoWeekLow??null,
            ema50:     qd.fiftyDayAverage??null,
            ema200:    qd.twoHundredDayAverage??null,
            above50:   qd.fiftyDayAverage?(qd.regularMarketPrice>qd.fiftyDayAverage):null,
            above200:  qd.twoHundredDayAverage?(qd.regularMarketPrice>qd.twoHundredDayAverage):null,
            sector:    qd.sector??null, industry: qd.industry??null,
            hi52Pct:   qd.fiftyTwoWeekHigh?+((qd.regularMarketPrice/qd.fiftyTwoWeekHigh)*100).toFixed(1):null,
            name:      qd.shortName??sym,
          };
          setPinnedData(p=>({...p,[sym]:built}));
          if (!built.sector) refreshPinnedSector(sym, built);
        } else {
          setPinnedData(p=>({...p,[sym]:{symbol:sym,_pinned:true,_notFound:true}}));
        }
      } catch(e2) {
        setPinnedData(p=>({...p,[sym]:{symbol:sym,_pinned:true,_error:true}}));
      }
    }
    setPinnedLoading(p=>({...p,[sym]:false}));
  };

  const removePinned = (sym) => {
    setPinnedData(p=>{ const n={...p}; delete n[sym]; return n; });
    setPinnedLoading(p=>{ const n={...p}; delete n[sym]; return n; });
  };

  // ── TradingView hover ────────────────────────────────────────────────────────
  const showTV = (sym) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(()=>{ setTvSymbol(sym); }, 500);
  };
  const hideTV = () => { clearTimeout(hoverTimer.current); };

  // ── Scan ─────────────────────────────────────────────────────────────────────
  const buildUrl = useCallback((m)=>{
    if(m==="gainers")  return `/api/scan/gainers?minPrice=1&minVol=50000&limit=150`;
    if(m==="volume")   return `/api/scan/volume?minRelVol=1.5&minPrice=1&limit=150`;
    if(m==="momentum") return `/api/scan/momentum?minPrice=3&limit=150`;
    if(m==="losers")   return `/api/scan/losers?minPrice=0.5&minVol=10000&limit=150`;
    if(m==="shorted")  return `/api/scan/shorted?limit=150`;
    if(m==="52wkhigh") return `/api/scan/52wkhigh?minPrice=1&limit=150`;
    if(m==="eod"){
      const p=new URLSearchParams({
        period:       eodF.period,
        sortDir:      eodF.sortDir,
        sortBy:       eodF.sortBy,
        minPrice:     eodF.minPrice   || 5,
        maxPrice:     eodF.maxPrice   || 99999,
        minVol:       eodF.minVol     || 100000,
        maxAbsReturn: eodF.maxAbsReturn|| 500,
        emaFilter:    eodF.emaFilter,
        sectors:      eodF.sectors.join(","),
        sectorEtf:    eodF.sectorEtfs.join(","),
        industryEtf:  eodF.industryEtfs.join(","),
        limit:        eodF.limit||200,
        ...(eodF.minPeriod        ? {minPeriodReturn:   eodF.minPeriod}        : {}),
        ...(eodF.minRsVsSector    ? {minRsVsSector:     eodF.minRsVsSector}    : {}),
        ...(eodF.minRsVsIndustry  ? {minRsVsIndustry:   eodF.minRsVsIndustry}  : {}),
      });
      return `/api/scan/eod?${p}`;
    }
    if(m==="universe") return null;
    if(m==="custom"){
      const mc=parseFloat(cf.minMcap||0)*(cf.mcUnit==="B"?1e9:cf.mcUnit==="T"?1e12:1e6);
      const p=new URLSearchParams({
        minPrice:cf.minPrice||0,maxPrice:cf.maxPrice||99999,minMcap:mc,
        minVol:cf.minVol||0,minRelVol:cf.minRelVol||0,
        minChange:cf.minChange||-100,maxChange:cf.maxChange||100,
        sectors:cf.sectors.join(","),industries:cf.industries.join(","),
        sortBy:cf.sortBy,limit:cf.limit||200,
        minRsi:cf.minRsi||0,maxRsi:cf.maxRsi||100,
        macdFilter:cf.macdFilter||"any",
        minAdr:cf.minAdr||0,maxAdr:cf.maxAdr||999,
        quietCandles:cf.quietCandles||"0",quietPct:cf.quietPct||2,
      });
      return `/api/scan/custom?${p}`;
    }
    return null;
  },[cf, eodF]);

  const [eodMeta, setEodMeta] = useState({});   // { etfDataReady, etfFallback }

  const runScan = useCallback(async(m=mode,silent=false)=>{
    if(m==="universe"){ runUniverseScan(); return; }
    const url=buildUrl(m); if(!url)return;
    if(!silent)setLoading(p=>({...p,[m]:true}));
    setErrors(p=>({...p,[m]:null}));
    try{
      const r=await apiFetch(url);
      setResults(p=>({...p,[m]:r.results||[]}));
      setLastFetch(p=>({...p,[m]:new Date()}));
      // Capture EOD scan metadata
      if(m==="eod") setEodMeta({ etfDataReady: r.etfDataReady, etfFallback: r.etfFallback });
    }catch(e){setErrors(p=>({...p,[m]:e.message}));}
    finally{setLoading(p=>({...p,[m]:false}));}
  },[mode,buildUrl,runUniverseScan]);

  useEffect(()=>{
    const m=SCAN_MODES.find(s=>s.key===mode);
    if(!results[mode]&&!loading[mode]&&mode!=="universe"&&!m?.manualOnly) runScan(mode);
  },[mode]);
  useEffect(()=>{
    if(timerRef.current)clearInterval(timerRef.current);
    const m=SCAN_MODES.find(s=>s.key===mode);
    if(autoRef&&mode!=="universe"&&!m?.manualOnly) timerRef.current=setInterval(()=>runScan(mode,true),60_000);
    return()=>clearInterval(timerRef.current);
  },[autoRef,mode,runScan]);

  useEffect(()=>{
    const h=e=>{if(e.key==="Escape")setTvSymbol(null);};
    window.addEventListener("keydown",h);
    return()=>window.removeEventListener("keydown",h);
  },[]);

  useEffect(()=>{
    const syms = Object.keys(pinnedData).filter(s=>pinnedData[s]&&!pinnedData[s]._loading&&!pinnedData[s]._notFound);
    if(!syms.length) return;
    const t = setInterval(async()=>{
      try{
        const r = await apiFetch(`/api/scan/symbols?symbols=${syms.join(",")}`);
        (r.results||[]).forEach(ticker=>{
          setPinnedData(p=>({...p,[ticker.symbol]:{...p[ticker.symbol],...ticker,_pinned:true}}));
        });
      }catch(e){}
    }, 30_000);
    return ()=>clearInterval(t);
  },[JSON.stringify(Object.keys(pinnedData))]);

  const { pinnedRows, scanRows } = useMemo(()=>{
    const pinnedList = Object.values(pinnedData).filter(p=>p&&!p._loading);
    const pinnedSet = new Set(pinnedList.map(p=>p.symbol));

    const source = mode==="universe"
      ? univResults.filter(r=>!pinnedSet.has(r.symbol))
      : (results[mode]||[]).filter(r=>!pinnedSet.has(r.symbol));

    let scan = source;
    if(secFilter) scan=scan.filter(r=>(r.sector||"").toLowerCase().includes(secFilter.toLowerCase()));
    if(indFilter) scan=scan.filter(r=>(r.industry||"").toLowerCase().includes(indFilter.toLowerCase()));

    if(sortKey){
      const getV=r=>{
        if(sortKey==="sector")  return(r.sector||"").toLowerCase();
        if(sortKey==="industry")return(r.industry||"").toLowerCase();
        return r[sortKey]??-9999;
      };
      scan=[...scan].sort((a,b)=>{
        const va=getV(a),vb=getV(b);
        if(typeof va==="string")return sortDir*(va<vb?-1:va>vb?1:0);
        return sortDir*(vb-va);
      });
    }

    return { pinnedRows: pinnedList.map(p=>({...p,_isPinned:true})), scanRows: scan };
  },[results,univResults,mode,sortKey,sortDir,secFilter,indFilter,pinnedData]);

  const rows = [...pinnedRows, ...scanRows];

  const handleSort=k=>{if(sortKey===k)setSortDir(p=>-p);else{setSortKey(k);setSortDir(-1);}};
  const cfg=SCAN_MODES.find(m=>m.key===mode);
  const isLoading = mode==="universe" ? univLoading : loading[mode];
  const GRID = mode==="shorted"
    ? "68px 130px 170px 82px 90px 80px 80px 80px 68px 68px"
    : mode==="52wkhigh"
    ? "68px 130px 170px 82px 90px 80px 80px 80px 68px 68px"
    : mode==="eod"
    ? "68px 130px 160px 82px 70px 70px 70px 70px 70px 58px"
    : "68px 110px 140px 72px 80px 72px 52px 52px 80px 60px";

  const EOD_PERIOD_LABELS = {
    d1:"1D %",d5:"1W %",d10:"2W %",d21:"1M %",d42:"2M %",d63:"3M %",
    d126:"6M %",d189:"9M %",d252:"1Y %",d504:"2Y %",
    ytd:"YTD %",mtd:"MTD %",qtd:"QTD %",
    rs_1m:"RS/SPY 1M",rs_3m:"RS/SPY 3M",rs_6m:"RS/SPY 6M",rs_12m:"RS/SPY 1Y",
    rsi14:"RSI(14)",adr14:"ADR %",
    rs_vs_sector:"RS/Sector",rs_vs_industry:"RS/IndETF",
  };
  const eodPeriodLabel = EOD_PERIOD_LABELS[eodF.period] || eodF.period.toUpperCase();

  const COL_HEADERS = mode==="shorted" ? [
    {l:"TICKER",    k:null,          align:"left"},
    {l:"SECTOR",    k:"sector",      align:"left"},
    {l:"INDUSTRY",  k:"industry",    align:"left"},
    {l:"PRICE",     k:"price",       align:"center"},
    {l:"CHANGE",    k:"change",      align:"center"},
    {l:"SHORT %",   k:"shortPct",    align:"center"},
    {l:"S/RATIO",   k:"shortRatio",  align:"center"},
    {l:"FLOAT",     k:"floatShares", align:"center"},
    {l:"50D",       k:null,          align:"center"},
    {l:"200D",      k:null,          align:"center"},
  ] : mode==="52wkhigh" ? [
    {l:"TICKER",    k:null,          align:"left"},
    {l:"SECTOR",    k:"sector",      align:"left"},
    {l:"INDUSTRY",  k:"industry",    align:"left"},
    {l:"PRICE",     k:"price",       align:"center"},
    {l:"CHANGE",    k:"change",      align:"center"},
    {l:"52W HIGH",  k:"hi52",        align:"center"},
    {l:"52W %",     k:"hi52Pct",     align:"center"},
    {l:"FROM HIGH", k:"fromHi52",    align:"center"},
    {l:"50D",       k:null,          align:"center"},
    {l:"200D",      k:null,          align:"center"},
  ] : mode==="eod" ? [
    {l:"TICKER",           k:null,              align:"left"},
    {l:"SECTOR / ETF",     k:"sector",          align:"left"},
    {l:"INDUSTRY / ETF",   k:"industry",        align:"left"},
    {l:"PRICE",            k:"price",           align:"center"},
    {l:eodPeriodLabel,     k:eodF.period,       align:"center"},
    {l:"3M %",             k:"d63",             align:"center"},
    {l:"YTD %",            k:"ytd",             align:"center"},
    {l:"RS vs Sector",     k:"rs_vs_sector",    align:"center"},
    {l:"RS vs Ind ETF",    k:"rs_vs_industry",  align:"center"},
    {l:"RSI",              k:"rsi14",           align:"center"},
  ] : [
    {l:"TICKER",   k:null,          align:"left"},
    {l:"SECTOR",   k:"sector",      align:"left"},
    {l:"INDUSTRY", k:"industry",    align:"left"},
    {l:"PRICE",    k:"price",       align:"center"},
    {l:"CHANGE",   k:"change",      align:"center"},
    {l:"VOLUME",   k:"volume",      align:"center"},
    {l:"REL VOL",  k:"relVol",      align:"center"},
    {l:"RS RANK",  k:"rs_rank",     align:"center"},
    {l:"STAGE",    k:"stage",       align:"center"},
    {l:"SETUP",    k:"setup_score", align:"center"},
  ];

  const IN=(label,key,width,placeholder="")=>(
    <div style={{display:"flex",flexDirection:"column",gap:3}}>
      <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim,letterSpacing:".06em"}}>{label}</span>
      <input value={cf[key]} onChange={e=>setC(key,e.target.value)} placeholder={placeholder}
        style={{width,background:T.inputBg,border:`1px solid ${T.border2}`,borderRadius:3,
          padding:"5px 7px",fontFamily:"monospace",fontSize:11,color:T.text,outline:"none"}}/>
    </div>
  );

  return(
    <div style={{position:"relative"}}>
      <style>{`@keyframes tvFadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes bn{0%,80%,100%{transform:scale(0)}40%{transform:scale(1)}}`}
      </style>

      {tvSymbol&&(
        <TVChartPopup symbol={tvSymbol}
          onClose={()=>setTvSymbol(null)}/>
      )}

      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        {SCAN_MODES.map(m=>(
          <button key={m.key} onClick={()=>{setMode(m.key);setSortKey(null);setSecFilter("");setIndFilter("");}}
            style={{display:"flex",alignItems:"center",gap:7,fontFamily:"monospace",fontSize:10,
              padding:"8px 14px",borderRadius:5,border:"none",cursor:"pointer",transition:"all .15s",
              background:mode===m.key?`${m.color}18`:T.surface,color:mode===m.key?m.color:T.textDim,
              outline:mode===m.key?`1px solid ${m.color}44`:`1px solid ${T.border}`,
              boxShadow:mode===m.key?`0 0 12px ${m.color}20`:"none"}}>
            <span style={{fontSize:14}}>{m.icon}</span>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:5,fontWeight:700,letterSpacing:".08em"}}>
                {m.label}
                {m.manualOnly&&<span style={{fontSize:7,padding:"1px 4px",borderRadius:2,
                  background:"rgba(255,255,255,.06)",border:"1px solid #1e3040",
                  color:mode===m.key?`${m.color}88`:T.textFaint,fontWeight:400,letterSpacing:".04em"}}>
                  CLICK TO RUN
                </span>}
              </div>
              <div style={{fontSize:7.5,color:mode===m.key?`${m.color}88`:T.textFaint,marginTop:1}}>{m.desc}</div>
            </div>
          </button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          {lastFetch[mode]&&<span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>{lastFetch[mode].toLocaleTimeString()}</span>}
          <button onClick={()=>setAutoRef(a=>!a)}
            style={{fontFamily:"monospace",fontSize:8.5,padding:"5px 10px",borderRadius:3,border:"none",cursor:"pointer",
              background:autoRef?"rgba(0,232,122,.12)":T.surface,color:autoRef?T.accent:T.textDim,
              outline:autoRef?"1px solid rgba(0,232,122,.3)":`1px solid ${T.border}`}}>
            {autoRef?"AUTO ON":"AUTO OFF"}
          </button>
          <button onClick={()=>runScan(mode)}
            style={{fontFamily:"monospace",fontSize:10,padding:"6px 14px",borderRadius:3,border:"none",cursor:"pointer",
              background:"rgba(0,232,122,.14)",color:T.accent,outline:"1px solid rgba(0,232,122,.3)",
              opacity:isLoading?.6:1}}>
            {isLoading?"SCANNING…":"↺ REFRESH"}
          </button>
        </div>
      </div>

      <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".06em",whiteSpace:"nowrap"}}>QUICK FILTER:</span>
        {[["⬡ Sector",secFilter,setSecFilter,"e.g. Healthcare"],["◈ Industry",indFilter,setIndFilter,"e.g. Biotechnology"]].map(([label,val,setter,ph])=>(
          <div key={label} style={{display:"flex",alignItems:"center",gap:6,background:T.surface,
            border:`1px solid ${val?"#00e87a33":T.border}`,borderRadius:4,padding:"5px 10px"}}>
            <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,whiteSpace:"nowrap"}}>{label}</span>
            <input value={val} onChange={e=>setter(e.target.value)} placeholder={ph}
              style={{width:130,background:"transparent",border:"none",outline:"none",fontFamily:"monospace",fontSize:10,color:T.text}}/>
            {val&&<span onClick={()=>setter("")} style={{cursor:"pointer",color:T.textDim,fontSize:12}}>×</span>}
          </div>
        ))}
        {(secFilter||indFilter)&&(
          <span style={{fontFamily:"monospace",fontSize:8,color:cfg.color,background:`${cfg.color}12`,
            border:`1px solid ${cfg.color}25`,borderRadius:3,padding:"4px 8px"}}>{rows.length} shown</span>
        )}
        <div ref={searchRef} style={{marginLeft:"auto",position:"relative"}}>
          <div style={{display:"flex",alignItems:"center",gap:6,background:T.surface,
            border:`1px solid ${T.border2}`,borderRadius:4,padding:"5px 10px"}}>
            <span style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,cursor:"pointer"}}
              onClick={()=>{if(symSearch.trim())addPinnedByText(symSearch);}}>🔍</span>
            <input value={symSearch}
              onChange={e=>setSymSearch(e.target.value.toUpperCase())}
              onKeyDown={e=>{ if(e.key==="Enter"&&symSearch.trim()){ addPinnedByText(symSearch); } }}
              placeholder="SYMBOL / COMPANY…"
              style={{width:140,background:"transparent",border:"none",outline:"none",
                fontFamily:"monospace",fontSize:10,color:T.text,letterSpacing:".06em"}}/>
            {symLoading&&<span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>…</span>}
          </div>
          {symSearchRes.length>0&&(
            <div style={{position:"absolute",top:"calc(100% + 4px)",right:0,zIndex:1001,
              background:T.bg,border:`1px solid ${T.border2}`,borderRadius:5,minWidth:240,
              boxShadow:"0 8px 32px rgba(0,0,0,.8)"}}>
              {symSearchRes.map(r=>(
                <div key={r.symbol}
                  onClick={()=>pinFromSearchResult(r)}
                  style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                    padding:"8px 12px",cursor:"pointer",borderBottom:`1px solid ${T.border}`}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.bg}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div>
                    <span style={{fontFamily:"monospace",fontSize:11,color:"#fff",fontWeight:700}}>{r.symbol}</span>
                    <span style={{fontFamily:"monospace",fontSize:8,color:T.textDim,marginLeft:8}}>{(r.name||"").substring(0,22)}</span>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <span style={{fontFamily:"monospace",fontSize:10,color:heat(r.change||0).fg}}>{pct(r.change||0,1)}</span>
                    <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,marginLeft:6}}>${fmt(r.price||0)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {Object.keys(pinnedData).length>0&&(
        <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,letterSpacing:".06em"}}>PINNED:</span>
          {Object.entries(pinnedData).map(([sym,t])=>{
            const isLoading = pinnedLoading[sym];
            const notFound  = t._notFound||t._error;
            const col       = notFound?T.down:isLoading?"#ffe040":"#c77dff";
            return(
              <span key={sym} style={{fontFamily:"monospace",fontSize:9,color:col,
                background:`${col}18`,border:`1px solid ${col}33`,
                borderRadius:3,padding:"3px 8px",display:"flex",alignItems:"center",gap:6}}>
                {isLoading&&<span style={{fontSize:8,animation:"bn 1s infinite"}}>⟳</span>}
                {sym}
                {!isLoading&&t.price!=null&&<span style={{color:T.textDim,fontSize:8}}>${t.price?.toFixed(2)}</span>}
                {notFound&&<span style={{color:T.down,fontSize:8}}>not found</span>}
                {!isLoading&&!notFound&&<span onClick={()=>addPinnedByText(sym)} title="Refresh" style={{cursor:"pointer",color:T.textFaint,fontSize:9}}>↺</span>}
                <span onClick={()=>removePinned(sym)} style={{cursor:"pointer",color:T.textDim,fontSize:11}}>×</span>
              </span>
            ); })}
          <span onClick={()=>{setPinnedData({});setPinnedLoading({});}}
            style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim,cursor:"pointer",marginLeft:4}}>CLEAR ALL</span>
        </div>
      )}

      {mode==="universe"&&(
        <div style={{background:T.surface,border:"1px solid rgba(249,199,79,.2)",
          borderRadius:6,padding:"14px 16px",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12,flexWrap:"wrap"}}>
            <span style={{fontFamily:"monospace",fontSize:9,color:"rgba(249,199,79,.7)",letterSpacing:".12em"}}>
              🌐 FULL US STOCK UNIVERSE — NYSE · NASDAQ · NYSE ARCA
            </span>
            {univStatus&&(
              <span style={{fontFamily:"monospace",fontSize:8,
                color:univStatus.loaded?T.accent:"#ff9f1c",
                background:univStatus.loaded?"rgba(0,232,122,.1)":"rgba(255,159,28,.1)",
                border:`1px solid ${univStatus.loaded?"rgba(0,232,122,.25)":"rgba(255,159,28,.25)"}`,
                padding:"2px 8px",borderRadius:3}}>
                {univStatus.loaded
                  ? `✓ ${univStatus.count?.toLocaleString()} symbols loaded`
                  : univStatus.loading ? "⟳ Loading universe…" : "Universe not loaded"}
              </span>
            )}
            {univLoading&&(
              <div style={{flex:1,minWidth:120,height:6,background:T.border,borderRadius:3,overflow:"hidden"}}>
                <div style={{
                  width:`${univProgress}%`,height:"100%",
                  background:"linear-gradient(90deg,rgba(249,199,79,.6),rgba(249,199,79,1))",
                  borderRadius:3,transition:"width .3s"}}/>
              </div>
            )}
            {univLoading&&(
              <span style={{fontFamily:"monospace",fontSize:8,color:"#f9c74f"}}>
                {univProgress}% · {univPassed} passed · {univTotal} total
              </span>
            )}
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:10}}>
            {[
              ["Min Price","minPrice","52px","1"],
              ["Min Vol","minVol","80px","100k"],
              ["Min |Chg%|","minChange","56px","2"],
              ["Max Chg%","maxChange","56px","100"],
              ["Min McapM","minMcap","72px","0"],
              ["Limit","limit","56px","300"],
            ].map(([label,k,w,ph])=>(
              <div key={k} style={{display:"flex",flexDirection:"column",gap:3}}>
                <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim,letterSpacing:".06em"}}>{label}</span>
                <input value={univFilters[k]} onChange={e=>setUF(k,e.target.value)}
                  placeholder={ph}
                  style={{width:w,background:T.inputBg,border:`1px solid ${T.border2}`,borderRadius:3,
                    padding:"5px 7px",fontFamily:"monospace",fontSize:11,color:T.text,outline:"none"}}/>
              </div>
            ))}
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim,letterSpacing:".06em"}}>SORT BY</span>
              <select value={univFilters.sortBy} onChange={e=>setUF("sortBy",e.target.value)}
                style={{background:T.inputBg,border:`1px solid ${T.border2}`,borderRadius:3,
                  padding:"5px 7px",fontFamily:"monospace",fontSize:11,color:T.text}}>
                <option value="change">% Change</option>
                <option value="volume">Volume</option>
                <option value="relVol">Rel Vol</option>
                <option value="marketCap">Mkt Cap</option>
              </select>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim,letterSpacing:".06em"}}>SECTOR</span>
              <select value={univFilters.sectors[0]||""} onChange={e=>setUF("sectors",e.target.value?[e.target.value]:[])}
                style={{background:T.inputBg,border:`1px solid ${T.border2}`,borderRadius:3,
                  padding:"5px 7px",fontFamily:"monospace",fontSize:10,color:T.text,minWidth:130}}>
                <option value="">All Sectors</option>
                {["Technology","Healthcare","Financials","Consumer Discret.",
                  "Consumer Staples","Energy","Materials","Industrials",
                  "Utilities","Real Estate","Comm Services"].map(s=>(
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <button onClick={runUniverseScan} disabled={univLoading}
              style={{fontFamily:"monospace",fontSize:10,fontWeight:700,
                padding:"7px 20px",border:"none",borderRadius:4,cursor:univLoading?"not-allowed":"pointer",
                background:univLoading?T.border:"rgba(249,199,79,.15)",
                color:univLoading?T.textDim:"#f9c74f",
                outline:"1px solid rgba(249,199,79,.3)"}}>
              {univLoading?"⟳ SCANNING…":"▶ SCAN ALL"}
            </button>
            {univLoading&&(
              <button onClick={()=>{ if(univAbort.current) univAbort.current.abort(); setUnivLoading(false); }}
                style={{fontFamily:"monospace",fontSize:9,padding:"7px 14px",border:"none",
                  borderRadius:4,cursor:"pointer",background:"rgba(255,69,96,.12)",
                  color:T.down,outline:"1px solid rgba(255,69,96,.25)"}}>
                ✕ STOP
              </button>
            )}
          </div>
          {(univResults.length>0||univLoading)&&(
            <div style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"center",
              padding:"6px 10px",background:T.inputBg,borderRadius:4,
              border:`1px solid ${T.border}`,fontSize:8,fontFamily:"monospace"}}>
              <span style={{color:"#f9c74f",fontWeight:700}}>{univResults.length} results</span>
              <span style={{color:T.textDim}}>from {univPassed} passing filters</span>
              <span style={{color:T.textDim}}>out of {univTotal} scanned</span>
              {lastFetch.universe&&(
                <span style={{marginLeft:"auto",color:T.textFaint}}>
                  Last: {lastFetch.universe.toLocaleTimeString()}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {mode==="custom"&&(
        <div style={{background:T.surface,border:"1px solid #c77dff22",borderRadius:6,padding:"16px 18px",marginBottom:12}}>
          <div style={{fontFamily:"monospace",fontSize:9,color:"#c77dff66",letterSpacing:".15em",marginBottom:14}}>
            ⚙ CUSTOM SCAN — FULL US MARKET (NYSE · NASDAQ · AMEX · NO OTC)
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:12}}>
            <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,minWidth:70,alignSelf:"center"}}>PRICE/VOL</span>
            {IN("Min Price","minPrice","52px","1")}
            {IN("Max Price","maxPrice","52px","∞")}
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Min Mcap</span>
              <div style={{display:"flex",gap:3}}>
                <input value={cf.minMcap} onChange={e=>setC("minMcap",e.target.value)}
                  style={{width:46,background:T.inputBg,border:`1px solid ${T.border2}`,borderRadius:3,padding:"5px 7px",fontFamily:"monospace",fontSize:11,color:T.text,outline:"none"}}/>
                <select value={cf.mcUnit} onChange={e=>setC("mcUnit",e.target.value)}
                  style={{background:T.bg,border:`1px solid ${T.border2}`,color:T.text,fontFamily:"monospace",fontSize:10,padding:"4px 5px",borderRadius:3}}>
                  <option>M</option><option>B</option><option>T</option>
                </select>
              </div>
            </div>
            {IN("Min Vol","minVol","76px","50000")}
            {IN("Min RelVol","minRelVol","50px","0")}
            {IN("Min %","minChange","50px","-100")}
            {IN("Max %","maxChange","50px","100")}
            {IN("Limit","limit","52px","200")}
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:12,paddingTop:10,borderTop:`1px solid ${T.border}`}}>
            <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,minWidth:70,alignSelf:"center"}}>SECTOR/IND</span>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Sector (multi)</span>
              <MultiSelectDropdown label="Sector" options={ALL_SECTORS} selected={cf.sectors} onChange={v=>setC("sectors",v)} color={cfg.color} width={220}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Industry (multi{cf.sectors.length>0?" · filtered":""}）</span>
              <MultiSelectDropdown label="Industry" options={availableIndustries} selected={cf.industries} onChange={v=>setC("industries",v)} color="#ffe040" width={260}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Sort By</span>
              <select value={cf.sortBy} onChange={e=>setC("sortBy",e.target.value)}
                style={{background:T.bg,border:`1px solid ${T.border2}`,color:T.text,fontFamily:"monospace",fontSize:10,padding:"5px 8px",borderRadius:3}}>
                <option value="change">% Change</option><option value="relVol">Rel Vol</option>
                <option value="volume">Volume</option><option value="rsi">RSI</option>
                <option value="adr">ADR%</option><option value="mcap">Mkt Cap</option>
                <option value="hi52pct">52W %</option><option value="sector">Sector A-Z</option>
                <option value="industry">Industry A-Z</option>
              </select>
            </div>
          </div>
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:14,paddingTop:10,borderTop:`1px solid ${T.border}`}}>
            <span style={{fontFamily:"monospace",fontSize:7.5,color:"#00e87a66",minWidth:70,alignSelf:"center"}}>TECH FILTER</span>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>RSI Range</span>
              <div style={{display:"flex",gap:4,alignItems:"center"}}>
                <input value={cf.minRsi} onChange={e=>setC("minRsi",e.target.value)} placeholder="0"
                  style={{width:44,background:T.inputBg,border:"1px solid #00e87a18",borderRadius:3,padding:"5px 6px",fontFamily:"monospace",fontSize:11,color:T.accent,outline:"none"}}/>
                <span style={{fontFamily:"monospace",fontSize:9,color:T.textFaint}}>–</span>
                <input value={cf.maxRsi} onChange={e=>setC("maxRsi",e.target.value)} placeholder="100"
                  style={{width:44,background:T.inputBg,border:"1px solid #00e87a18",borderRadius:3,padding:"5px 6px",fontFamily:"monospace",fontSize:11,color:T.accent,outline:"none"}}/>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>MACD Signal</span>
              <select value={cf.macdFilter} onChange={e=>setC("macdFilter",e.target.value)}
                style={{background:T.bg,border:"1px solid #00e87a18",color:T.accent,fontFamily:"monospace",fontSize:9,padding:"5px 8px",borderRadius:3,width:120}}>
                <option value="any">Any</option><option value="bullish">Bullish (MACD&gt;Sig)</option>
                <option value="bearish">Bearish (MACD&lt;Sig)</option><option value="crossedUp">Just Crossed Up ↑</option>
              </select>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>ADR% Range</span>
              <div style={{display:"flex",gap:4,alignItems:"center"}}>
                <input value={cf.minAdr} onChange={e=>setC("minAdr",e.target.value)} placeholder="0"
                  style={{width:44,background:T.inputBg,border:"1px solid #ffe04018",borderRadius:3,padding:"5px 6px",fontFamily:"monospace",fontSize:11,color:"#ffe040",outline:"none"}}/>
                <span style={{fontFamily:"monospace",fontSize:9,color:T.textFaint}}>–</span>
                <input value={cf.maxAdr} onChange={e=>setC("maxAdr",e.target.value)} placeholder="∞"
                  style={{width:44,background:T.inputBg,border:"1px solid #ffe04018",borderRadius:3,padding:"5px 6px",fontFamily:"monospace",fontSize:11,color:"#ffe040",outline:"none"}}/>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Quiet Candles ±%</span>
              <div style={{display:"flex",gap:5,alignItems:"center"}}>
                <button onClick={()=>setC("quietCandles",cf.quietCandles==="1"?"0":"1")}
                  style={{fontFamily:"monospace",fontSize:9,padding:"5px 10px",borderRadius:3,cursor:"pointer",border:"none",
                    background:cf.quietCandles==="1"?"rgba(0,229,255,.15)":T.border,
                    color:cf.quietCandles==="1"?"#00e5ff":T.textDim,
                    outline:cf.quietCandles==="1"?"1px solid #00e5ff44":`1px solid ${T.border}`}}>
                  {cf.quietCandles==="1"?"ON":"OFF"}
                </button>
                <input value={cf.quietPct} onChange={e=>setC("quietPct",e.target.value)}
                  style={{width:36,background:T.inputBg,border:"1px solid #00e5ff18",borderRadius:3,padding:"5px 5px",fontFamily:"monospace",fontSize:11,color:"#00e5ff",outline:"none",textAlign:"center"}}/>
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>PRESETS:</span>
            {[
              ["Liquid",    {minPrice:"10",maxPrice:"",minMcap:"500",mcUnit:"M",minVol:"500000",minRelVol:"2",minChange:"3",maxChange:"100",sectors:[],industries:[],sortBy:"relVol",limit:"200",minRsi:"",maxRsi:"",macdFilter:"any",minAdr:"",maxAdr:"",quietCandles:"0",quietPct:"2"}],
              ["Small Cap", {minPrice:"2", maxPrice:"20",minMcap:"50", mcUnit:"M",minVol:"100000",minRelVol:"2",minChange:"3",maxChange:"100",sectors:[],industries:[],sortBy:"change",limit:"200",minRsi:"",maxRsi:"",macdFilter:"any",minAdr:"",maxAdr:"",quietCandles:"0",quietPct:"2"}],
              ["High Vol",  {minPrice:"5", maxPrice:"",minMcap:"100", mcUnit:"M",minVol:"1000000",minRelVol:"3",minChange:"-100",maxChange:"100",sectors:[],industries:[],sortBy:"relVol",limit:"200",minRsi:"",maxRsi:"",macdFilter:"any",minAdr:"",maxAdr:"",quietCandles:"0",quietPct:"2"}],
              ["RSI <35",   {minPrice:"5", maxPrice:"",minMcap:"100", mcUnit:"M",minVol:"200000",minRelVol:"0",minChange:"-100",maxChange:"100",sectors:[],industries:[],sortBy:"rsi",limit:"200",minRsi:"0",maxRsi:"35",macdFilter:"any",minAdr:"",maxAdr:"",quietCandles:"0",quietPct:"2"}],
              ["MACD↑",     {minPrice:"5", maxPrice:"",minMcap:"100", mcUnit:"M",minVol:"200000",minRelVol:"1",minChange:"-100",maxChange:"100",sectors:[],industries:[],sortBy:"change",limit:"200",minRsi:"",maxRsi:"",macdFilter:"crossedUp",minAdr:"",maxAdr:"",quietCandles:"0",quietPct:"2"}],
              ["Quiet",     {minPrice:"5", maxPrice:"",minMcap:"200", mcUnit:"M",minVol:"200000",minRelVol:"0",minChange:"-100",maxChange:"100",sectors:[],industries:[],sortBy:"adr",limit:"200",minRsi:"",maxRsi:"",macdFilter:"any",minAdr:"3",maxAdr:"",quietCandles:"1",quietPct:"2"}],
              ["Biotech",   {minPrice:"2", maxPrice:"",minMcap:"50",  mcUnit:"M",minVol:"100000",minRelVol:"0",minChange:"-100",maxChange:"100",sectors:["Healthcare"],industries:["Biotechnology"],sortBy:"change",limit:"200",minRsi:"",maxRsi:"",macdFilter:"any",minAdr:"",maxAdr:"",quietCandles:"0",quietPct:"2"}],
            ].map(([l,v])=>(
              <button key={l} onClick={()=>setCf(v)}
                style={{fontFamily:"monospace",fontSize:8,padding:"4px 10px",background:T.border,color:"#c77dff",border:"1px solid #c77dff25",borderRadius:3,cursor:"pointer"}}>{l}</button>
            ))}
            <button onClick={()=>runScan("custom")}
              style={{marginLeft:"auto",fontFamily:"monospace",fontSize:10,padding:"8px 24px",
                background:"#c77dff20",color:"#c77dff",border:"1px solid #c77dff55",
                borderRadius:4,cursor:"pointer",fontWeight:700,letterSpacing:".08em"}}>
              ▶ RUN SCAN
            </button>
          </div>
        </div>
      )}

      {/* ── Manual-only mode banners ─────────────────────────────────────── */}
      {mode==="shorted"&&(
        <div style={{background:T.surface,border:"1px solid #ff6b9d33",borderRadius:6,
          padding:"14px 18px",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <div>
              <div style={{fontFamily:"monospace",fontSize:9,color:"#ff6b9d",letterSpacing:".14em",
                fontWeight:700,marginBottom:4}}>
                ⚡ MOST SHORTED STOCKS · Yahoo Finance Screener
              </div>
              <div style={{fontFamily:"monospace",fontSize:8,color:T.textDim,lineHeight:1.6}}>
                Stocks with highest short interest as % of float.
                Data sourced from Yahoo Finance <code style={{color:"#ff6b9d88"}}>most_shorted_stocks</code> screener
                + quoteSummary short metrics.<br/>
                Short data fetched on-demand and cached 6 hours. First load ~30s.
              </div>
            </div>
            <button onClick={()=>runScan("shorted")} disabled={loading["shorted"]}
              style={{marginLeft:"auto",fontFamily:"monospace",fontSize:11,fontWeight:700,
                padding:"10px 28px",border:"none",borderRadius:5,
                cursor:loading["shorted"]?"not-allowed":"pointer",
                background:loading["shorted"]?T.border:"rgba(255,107,157,.2)",
                color:loading["shorted"]?T.textDim:"#ff6b9d",
                outline:"1px solid rgba(255,107,157,.4)"}}>
              {loading["shorted"]
                ? "⟳ FETCHING SHORT DATA…"
                : results["shorted"] ? "↺ REFRESH" : "▶ RUN SCAN"}
            </button>
          </div>
        </div>
      )}

      {mode==="52wkhigh"&&(
        <div style={{background:T.surface,border:"1px solid #ffe45e33",borderRadius:6,
          padding:"14px 18px",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
            <div>
              <div style={{fontFamily:"monospace",fontSize:9,color:"#ffe45e",letterSpacing:".14em",
                fontWeight:700,marginBottom:4}}>
                🔝 RECENT 52-WEEK HIGHS · Yahoo Finance Screener
              </div>
              <div style={{fontFamily:"monospace",fontSize:8,color:T.textDim,lineHeight:1.6}}>
                Stocks trading at or near their 52-week high — breakout candidates with strong momentum.
                Sourced from Yahoo Finance <code style={{color:"#ffe45e88"}}>recent_52_week_highs</code> screener.
                <br/>Sorted by proximity to 52W high (closest first). Cached 5 minutes.
              </div>
            </div>
            <button onClick={()=>runScan("52wkhigh")} disabled={loading["52wkhigh"]}
              style={{marginLeft:"auto",fontFamily:"monospace",fontSize:11,fontWeight:700,
                padding:"10px 28px",border:"none",borderRadius:5,
                cursor:loading["52wkhigh"]?"not-allowed":"pointer",
                background:loading["52wkhigh"]?T.border:"rgba(255,228,94,.15)",
                color:loading["52wkhigh"]?T.textDim:"#ffe45e",
                outline:"1px solid rgba(255,228,94,.35)"}}>
              {loading["52wkhigh"]
                ? "⟳ LOADING 52W HIGHS…"
                : results["52wkhigh"] ? "↺ REFRESH" : "▶ RUN SCAN"}
            </button>
          </div>
        </div>
      )}

      {mode==="eod"&&(
        <div style={{background:T.surface,border:"1px solid #a78bfa33",borderRadius:6,
          padding:"16px 18px",marginBottom:12}}>

          {/* ── Header ─────────────────────────────────────────────────── */}
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,flexWrap:"wrap"}}>
            <div>
              <div style={{fontFamily:"monospace",fontSize:9,color:"#a78bfa",letterSpacing:".14em",
                fontWeight:700,marginBottom:3}}>
                🗄 EOD DATABASE SCAN · {results["eod"]?.length||0} results
              </div>
              <div style={{fontFamily:"monospace",fontSize:8,color:T.textDim}}>
                Pure SQLite · instant · no Yahoo calls ·
                requires <span style={{color:"#a78bfa88"}}>npm run bootstrap:2y</span> ·
                run <span style={{color:"#a78bfa88"}}>npm run enrich:sectors</span> for ETF data
              </div>
            </div>
            <button onClick={()=>runScan("eod")} disabled={loading["eod"]}
              style={{marginLeft:"auto",fontFamily:"monospace",fontSize:11,fontWeight:700,
                padding:"9px 28px",border:"none",borderRadius:5,
                cursor:loading["eod"]?"not-allowed":"pointer",
                background:loading["eod"]?T.border:"rgba(167,139,250,.2)",
                color:loading["eod"]?T.textDim:"#a78bfa",
                outline:"1px solid rgba(167,139,250,.4)"}}>
              {loading["eod"]?"⟳ QUERYING DB…":results["eod"]?"↺ RE-RUN":"▶ RUN EOD SCAN"}
            </button>
          </div>

          {/* ── Row 1: Sort period + direction + min return ─────────────── */}
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:10}}>
            <span style={{fontFamily:"monospace",fontSize:7.5,color:"#a78bfa88",minWidth:70,alignSelf:"center"}}>SORT BY</span>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Period / Field</span>
              <select value={eodF.period} onChange={e=>setE("period",e.target.value)}
                style={{background:T.bg,border:"1px solid #a78bfa33",color:"#a78bfa",
                  fontFamily:"monospace",fontSize:10,padding:"5px 8px",borderRadius:3,minWidth:165}}>
                <optgroup label="── Short-term ──">
                  <option value="d1">1D Return %</option>
                  <option value="d5">1W Return %</option>
                  <option value="d21">1M Return %</option>
                </optgroup>
                <optgroup label="── Medium-term ──">
                  <option value="d63">3M Return %</option>
                  <option value="d126">6M Return %</option>
                  <option value="d189">9M Return %</option>
                </optgroup>
                <optgroup label="── Long-term ──">
                  <option value="d252">1Y Return %</option>
                  <option value="d504">2Y Return %</option>
                  <option value="ytd">YTD %</option>
                  <option value="mtd">MTD %</option>
                  <option value="qtd">QTD %</option>
                </optgroup>
                <optgroup label="── vs SPY ──">
                  <option value="rs_1m">RS vs SPY 1M</option>
                  <option value="rs_3m">RS vs SPY 3M</option>
                  <option value="rs_6m">RS vs SPY 6M</option>
                  <option value="rs_12m">RS vs SPY 1Y</option>
                </optgroup>
                <optgroup label="── vs ETF ──">
                  <option value="rs_vs_sector">RS vs Sector ETF</option>
                  <option value="rs_vs_industry">RS vs Industry ETF</option>
                </optgroup>
                <optgroup label="── Technical ──">
                  <option value="rsi14">RSI(14)</option>
                  <option value="adr14">ADR% (volatility)</option>
                </optgroup>
              </select>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Direction</span>
              <div style={{display:"flex",background:T.inputBg,border:`1px solid ${T.border2}`,borderRadius:4,overflow:"hidden"}}>
                {[["desc","▲ TOP"],["asc","▼ WORST"]].map(([v,l])=>(
                  <button key={v} onClick={()=>setE("sortDir",v)}
                    style={{fontFamily:"monospace",fontSize:9,padding:"5px 12px",border:"none",cursor:"pointer",
                      background:eodF.sortDir===v?"rgba(167,139,250,.2)":"transparent",
                      color:eodF.sortDir===v?"#a78bfa":T.textDim}}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:"#a78bfa"}}>Min Return %</span>
              <input value={eodF.minPeriod} onChange={e=>setE("minPeriod",e.target.value)}
                placeholder="e.g. 5"
                style={{width:66,background:T.inputBg,border:"1px solid #a78bfa22",borderRadius:3,
                  padding:"5px 7px",fontFamily:"monospace",fontSize:11,color:"#a78bfa",outline:"none"}}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Min $ · Max $</span>
              <div style={{display:"flex",gap:4}}>
                <input value={eodF.minPrice} onChange={e=>setE("minPrice",e.target.value)}
                  placeholder="5"
                  style={{width:50,background:T.inputBg,border:`1px solid ${T.border2}`,borderRadius:3,
                    padding:"5px 6px",fontFamily:"monospace",fontSize:11,color:T.text,outline:"none"}}/>
                <input value={eodF.maxPrice||""} onChange={e=>setE("maxPrice",e.target.value)}
                  placeholder="∞"
                  style={{width:50,background:T.inputBg,border:`1px solid ${T.border2}`,borderRadius:3,
                    padding:"5px 6px",fontFamily:"monospace",fontSize:11,color:T.text,outline:"none"}}/>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Min Vol / Avg Vol</span>
              <input value={eodF.minVol} onChange={e=>setE("minVol",e.target.value)}
                placeholder="100000"
                style={{width:90,background:T.inputBg,border:`1px solid ${T.border2}`,borderRadius:3,
                  padding:"5px 7px",fontFamily:"monospace",fontSize:11,color:T.text,outline:"none"}}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:"#ff9f1c66"}}>Max Abs Return % <span style={{color:T.textFaint}}>(outlier cap)</span></span>
              <input value={eodF.maxAbsReturn||"500"} onChange={e=>setE("maxAbsReturn",e.target.value)}
                placeholder="500"
                style={{width:64,background:T.inputBg,border:"1px solid #ff9f1c18",borderRadius:3,
                  padding:"5px 7px",fontFamily:"monospace",fontSize:11,color:"#ff9f1c",outline:"none"}}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Limit</span>
              <input value={eodF.limit} onChange={e=>setE("limit",e.target.value)}
                placeholder="200"
                style={{width:56,background:T.inputBg,border:`1px solid ${T.border2}`,borderRadius:3,
                  padding:"5px 7px",fontFamily:"monospace",fontSize:11,color:T.text,outline:"none"}}/>
            </div>
          </div>

          {/* ── ETF data not yet enriched warning ──────────────────────── */}
          {eodMeta.etfFallback&&(
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,
              background:"rgba(255,159,28,.07)",border:"1px solid rgba(255,159,28,.25)",
              borderRadius:4,padding:"8px 12px"}}>
              <span style={{fontSize:16}}>⚠️</span>
              <div>
                <div style={{fontFamily:"monospace",fontSize:8,color:"#ff9f1c",fontWeight:700,marginBottom:2}}>
                  ETF COLUMNS NOT YET POPULATED — showing sector/industry name fallback
                </div>
                <div style={{fontFamily:"monospace",fontSize:7.5,color:T.warn,lineHeight:1.6}}>
                  Results are filtered by sector/industry name instead of stored ETF columns.
                  Run <span style={{color:"#ff9f1c"}}>npm run enrich:sectors</span> once to populate
                  exact ETF mappings + RS vs ETF benchmarks.
                </div>
              </div>
            </div>
          )}

          {/* ── Row 2: ETF Filters ──────────────────────────────────────── */}
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:10,
            paddingTop:10,borderTop:`1px solid ${T.border}`}}>
            <span style={{fontFamily:"monospace",fontSize:7.5,color:"#a78bfa88",minWidth:70,alignSelf:"center"}}>
              ETF FILTER
            </span>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Sector ETF</span>
              <MultiSelectDropdown label="Sector ETF"
                options={["XLK","XLV","XLF","XLY","XLP","XLC","XLE","XLB","XLI","XLU","XLRE"].map(s=>s)}
                selected={eodF.sectorEtfs} onChange={v=>setE("sectorEtfs",v)}
                color="#a78bfa" width={180}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Industry ETF</span>
              <MultiSelectDropdown label="Industry ETF"
                options={["SOXX","IGV","CLOU","FDN","CIBR","BOTZ","ESPO","IBB","XBI","IHI","PJP","XHS","KRE","KBE","KCE","KIE","XRT","XHB","PEJ","XOP","OIH","AMLP","TAN","URA","GDX","GDXJ","SIL","XME","COPX","LIT","ITA","JETS","IYT","PAVE","VNQ","IYZ"].map(s=>s)}
                selected={eodF.industryEtfs} onChange={v=>setE("industryEtfs",v)}
                color="#00d4ff" width={200}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Min RS vs Sector ETF</span>
              <input value={eodF.minRsVsSector} onChange={e=>setE("minRsVsSector",e.target.value)}
                placeholder="e.g. 5"
                style={{width:72,background:T.inputBg,border:"1px solid #a78bfa22",borderRadius:3,
                  padding:"5px 7px",fontFamily:"monospace",fontSize:11,color:"#a78bfa",outline:"none"}}/>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Min RS vs Industry ETF</span>
              <input value={eodF.minRsVsIndustry} onChange={e=>setE("minRsVsIndustry",e.target.value)}
                placeholder="e.g. 5"
                style={{width:72,background:T.inputBg,border:"1px solid #00d4ff22",borderRadius:3,
                  padding:"5px 7px",fontFamily:"monospace",fontSize:11,color:"#00d4ff",outline:"none"}}/>
            </div>
          </div>

          {/* ── Row 3: Technical + Sector name filters ─────────────────── */}
          <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:10,
            paddingTop:10,borderTop:`1px solid ${T.border}`}}>
            <span style={{fontFamily:"monospace",fontSize:7.5,color:"#a78bfa88",minWidth:70,alignSelf:"center"}}>
              TECHNICAL
            </span>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>EMA Position</span>
              <select value={eodF.emaFilter} onChange={e=>setE("emaFilter",e.target.value)}
                style={{background:T.bg,border:`1px solid ${T.border2}`,color:T.text,
                  fontFamily:"monospace",fontSize:10,padding:"5px 8px",borderRadius:3}}>
                <option value="any">Any</option>
                <option value="above50">Above EMA50</option>
                <option value="above200">Above EMA200</option>
                <option value="above_both">Above EMA50 + EMA200</option>
              </select>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>Sector (name)</span>
              <MultiSelectDropdown label="Sector" options={ALL_SECTORS}
                selected={eodF.sectors} onChange={v=>setE("sectors",v)}
                color="#a78bfa" width={190}/>
            </div>
          </div>

          {/* ── Quick presets ────────────────────────────────────────────── */}
          <div style={{display:"flex",gap:5,flexWrap:"wrap",paddingTop:10,borderTop:`1px solid ${T.border}`}}>
            <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,alignSelf:"center",marginRight:4}}>
              PRESETS:
            </span>
            {[
              {l:"1M Leaders",     f:{period:"d21",  sortDir:"desc",emaFilter:"above50",  minPeriod:"5",  sortBy:"period",        sectorEtfs:[],industryEtfs:[],minRsVsSector:"",minRsVsIndustry:"",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"3M Leaders",     f:{period:"d63",  sortDir:"desc",emaFilter:"above50",  minPeriod:"10", sortBy:"period",        sectorEtfs:[],industryEtfs:[],minRsVsSector:"",minRsVsIndustry:"",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"6M Breakouts",   f:{period:"d126", sortDir:"desc",emaFilter:"above_both",minPeriod:"10",sortBy:"period",        sectorEtfs:[],industryEtfs:[],minRsVsSector:"",minRsVsIndustry:"",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"YTD Champions",  f:{period:"ytd",  sortDir:"desc",emaFilter:"above_both",minPeriod:"10",sortBy:"period",        sectorEtfs:[],industryEtfs:[],minRsVsSector:"",minRsVsIndustry:"",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"RS vs SPY 3M",   f:{period:"rs_3m",sortDir:"desc",emaFilter:"above50",  minPeriod:"5",  sortBy:"period",        sectorEtfs:[],industryEtfs:[],minRsVsSector:"",minRsVsIndustry:"",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"Top vs Sector",  f:{period:"d63",  sortDir:"desc",emaFilter:"above50",  minPeriod:"",   sortBy:"rs_vs_sector",  sectorEtfs:[],industryEtfs:[],minRsVsSector:"5",minRsVsIndustry:"",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"Top vs Ind ETF", f:{period:"d63",  sortDir:"desc",emaFilter:"above50",  minPeriod:"",   sortBy:"rs_vs_industry",sectorEtfs:[],industryEtfs:[],minRsVsSector:"",minRsVsIndustry:"5",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"Tech Leaders",   f:{period:"d63",  sortDir:"desc",emaFilter:"above50",  minPeriod:"",   sortBy:"rs_vs_sector",  sectorEtfs:["XLK"],industryEtfs:[],minRsVsSector:"3",minRsVsIndustry:"",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"Semis vs SOXX",  f:{period:"d63",  sortDir:"desc",emaFilter:"any",      minPeriod:"",   sortBy:"rs_vs_industry",sectorEtfs:[],industryEtfs:["SOXX"],minRsVsSector:"",minRsVsIndustry:"3",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"Biotech vs IBB", f:{period:"d63",  sortDir:"desc",emaFilter:"any",      minPeriod:"",   sortBy:"rs_vs_industry",sectorEtfs:[],industryEtfs:["IBB"],minRsVsSector:"",minRsVsIndustry:"3",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"Energy E&P",     f:{period:"d63",  sortDir:"desc",emaFilter:"any",      minPeriod:"",   sortBy:"period",        sectorEtfs:[],industryEtfs:["XOP"],minRsVsSector:"",minRsVsIndustry:"",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"High ADR%",      f:{period:"adr14",sortDir:"desc",emaFilter:"above50",  minPeriod:"3",  sortBy:"period",        sectorEtfs:[],industryEtfs:[],minRsVsSector:"",minRsVsIndustry:"",minPrice:"5",minVol:"200000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"Oversold RSI",   f:{period:"rsi14",sortDir:"asc", emaFilter:"above200", minPeriod:"",   sortBy:"period",        sectorEtfs:[],industryEtfs:[],minRsVsSector:"",minRsVsIndustry:"",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
              {l:"1Y Worst",       f:{period:"d252", sortDir:"asc", emaFilter:"any",      minPeriod:"",   sortBy:"period",        sectorEtfs:[],industryEtfs:[],minRsVsSector:"",minRsVsIndustry:"",minPrice:"5",minVol:"100000",maxAbsReturn:"500",sectors:[],limit:"200",maxPrice:""}},
            ].map(({l,f})=>(
              <button key={l} onClick={()=>setEodF(p=>({...p,...f}))}
                style={{fontFamily:"monospace",fontSize:8,padding:"4px 9px",borderRadius:3,
                  border:"none",cursor:"pointer",
                  background:"rgba(167,139,250,.08)",color:"#a78bfa88",
                  outline:"1px solid rgba(167,139,250,.15)"}}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}

      {errors[mode]&&(
        <div style={{fontFamily:"monospace",fontSize:11,color:T.down,background:"rgba(255,69,96,.08)",border:"1px solid rgba(255,69,96,.2)",borderRadius:5,padding:"10px 14px",marginBottom:12}}>
          ⚠ {errors[mode]}
        </div>
      )}

      {isLoading&&!rows.length&&(
        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,padding:48,textAlign:"center"}}>
          <div style={{fontFamily:"monospace",fontSize:13,color:cfg.color,letterSpacing:".1em",marginBottom:8}}>SCANNING US MARKET…</div>
          <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,marginBottom:20}}>Querying Yahoo Finance screener pools…</div>
          <div style={{display:"flex",justifyContent:"center",gap:6}}>
            {[0,1,2,3,4].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:cfg.color,animation:`bn 1s ${i*.15}s infinite`}}/>)}
          </div>
        </div>
      )}

      {rows.length>0&&(
        <div style={{background:T.bg,border:`1px solid ${cfg.color}22`,borderRadius:6,overflow:"hidden"}}>
          <div style={{display:"grid",gridTemplateColumns:GRID,padding:"8px 16px",background:T.surface2,
            borderBottom:`2px solid ${cfg.color}22`,gap:4,alignItems:"center"}}>
            {COL_HEADERS.map((col,i)=>{
              const active=sortKey===col.k;
              return(
                <div key={i} onClick={()=>col.k&&handleSort(col.k)}
                  style={{fontFamily:"monospace",fontSize:8,letterSpacing:".1em",userSelect:"none",
                    cursor:col.k?"pointer":"default",display:"flex",alignItems:"center",gap:2,
                    justifyContent:col.align==="left"?"flex-start":"center",
                    color:active?cfg.color:T.textGhost,
                    textDecoration:col.k?"underline dotted":"none",textUnderlineOffset:3}}>
                  {col.l}{active&&<span style={{fontSize:8,color:cfg.color}}>{sortDir>0?"↑":"↓"}</span>}
                </div>
              ); })}
          </div>
          <div style={{display:"flex",gap:12,padding:"6px 16px",borderBottom:`1px solid ${T.border}`,background:`${cfg.color}07`,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontFamily:"monospace",fontSize:9,color:cfg.color,fontWeight:700}}>{scanRows.length} RESULTS</span>
            {pinnedRows.length>0&&<span style={{fontFamily:"monospace",fontSize:9,color:"#c77dff",fontWeight:700}}>+ {pinnedRows.length} PINNED</span>}
            <span style={{fontFamily:"monospace",fontSize:8.5,color:T.textDim}}>{scanRows.filter(r=>r.change>0).length} adv · {scanRows.filter(r=>r.change<0).length} dec</span>
            <span style={{fontFamily:"monospace",fontSize:8.5,color:T.textDim}}>avg {pct(scanRows.reduce((s,r)=>s+(r.change||0),0)/Math.max(scanRows.length,1),1)}</span>
            <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,marginLeft:"auto"}}>hover ticker → chart · click sector/industry → filter</span>
            {isLoading&&<span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>refreshing…</span>}
          </div>
          {pinnedRows.length>0&&scanRows.length>0&&(
            <div style={{display:"grid",gridTemplateColumns:GRID,padding:"4px 16px",
              background:"rgba(199,125,255,0.04)",borderBottom:"1px solid rgba(199,125,255,0.1)",
              borderTop:"1px solid rgba(199,125,255,0.1)"}}>
              <div style={{gridColumn:"1/-1",display:"flex",alignItems:"center",gap:8}}>
                <div style={{flex:1,height:1,background:"rgba(199,125,255,0.1)"}}/>
                <span style={{fontFamily:"monospace",fontSize:7.5,color:"rgba(199,125,255,0.4)",letterSpacing:".1em",whiteSpace:"nowrap"}}>
                  ↑ {pinnedRows.length} PINNED · {scanRows.length} SCAN RESULTS ↓
                </span>
                <div style={{flex:1,height:1,background:"rgba(199,125,255,0.1)"}}/>
              </div>
            </div>
          )}
          {rows.map((r,i)=>{
            const isPinned = r._isPinned;
            const rowBg = isPinned ? "rgba(199,125,255,0.06)" : "transparent";
            const rowBorder = isPinned
              ? "1px solid rgba(199,125,255,0.15)"
              : i<rows.length-1?`1px solid ${T.border}`:"none";
            return(
            <div key={r.symbol}
              style={{display:"grid",gridTemplateColumns:GRID,padding:"8px 16px",gap:4,alignItems:"center",
                borderBottom:rowBorder,transition:"background .1s",
                background:rowBg,
                opacity:r._loading?0.5:1,
                boxShadow:isPinned?"inset 3px 0 0 rgba(199,125,255,0.5)":"none"}}
              onMouseEnter={e=>{ if(!isPinned) e.currentTarget.style.background=`${cfg.color}07`; }}
              onMouseLeave={e=>{ e.currentTarget.style.background=rowBg; }}>

              <div style={{position:"relative"}}>
                <div
                  onMouseEnter={()=>showTV(r.symbol)}
                  onMouseLeave={hideTV}
                  style={{display:"inline-block",cursor:"crosshair"}}>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <span style={{fontFamily:"monospace",fontSize:13,color:isPinned?T.accentPurple:"#fff",fontWeight:700,
                      borderBottom:"1px dotted #1e3040",paddingBottom:1}}>
                      {r.symbol}
                    </span>
                    {isPinned&&<span style={{fontSize:9,color:"#c77dff",lineHeight:1}} title="Pinned — always shown at top">📌</span>}
                  </div>
                </div>
                <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,marginTop:1}}>
                  {r.above50!=null?(r.above50?"▲":"▼")+"50 "+(r.above200?"▲":"▼")+"200":""}
                  {r.rsi!=null&&<span style={{marginLeft:3,color:r.rsi<30?T.down:r.rsi>70?T.accent:T.textDim}}>RSI{r.rsi}</span>}
                </div>
              </div>

              <div style={{minWidth:0}}>
                {r.sector
                  ?<span style={{fontFamily:"monospace",fontSize:8,fontWeight:600,color:secCol(r.sector),
                      background:`${secCol(r.sector)}1e`,border:`1px solid ${secCol(r.sector)}38`,
                      padding:"3px 7px",borderRadius:3,display:"inline-block",maxWidth:"100%",
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer"}}
                    onClick={()=>setSecFilter(r.sector)}>{r.sector}</span>
                  :<span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>—</span>}
                {mode==="eod"&&r.sector_etf&&(
                  <div style={{fontFamily:"monospace",fontSize:7,color:"#a78bfa88",marginTop:2}}>
                    {r.sector_etf}
                  </div>
                )}
              </div>

              <div style={{minWidth:0}}>
                <span style={{fontFamily:"monospace",fontSize:8,color:T.textDim,display:"block",
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer"}}
                  onClick={()=>setIndFilter(r.industry||"")}>{r.industry||"—"}</span>
                {mode==="eod"&&r.industry_etf
                  ?<span style={{fontFamily:"monospace",fontSize:7,color:"#00d4ff88"}}>ETF: {r.industry_etf}</span>
                  :<>
                    {r.adr!=null&&<span style={{fontFamily:"monospace",fontSize:7,color:"#ffe04055"}}>ADR {r.adr}%</span>}
                    {r.macd?.crossedUp&&<span style={{fontFamily:"monospace",fontSize:7,color:T.accent,marginLeft:4}}>MACD↑</span>}
                  </>
                }
              </div>

              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:"monospace",fontSize:11,color:T.text,fontWeight:500}}>${fmt(r.price||0)}</div>
                {r.hi52&&<div style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>{(r.price/r.hi52*100).toFixed(0)}% of 52H</div>}
              </div>

              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:heat(r.change||0).fg}}>{pct(r.change||0)}</div>
                <div style={{fontFamily:"monospace",fontSize:8,color:T.textDim}}>{(r.changeDol||0)>=0?"+":""}${Math.abs(r.changeDol||0).toFixed(2)}</div>
              </div>

              {mode==="shorted" ? (<>
                <div style={{textAlign:"center"}}>
                  {r.shortPct!=null
                    ?<div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,
                        color:r.shortPct>30?T.down:r.shortPct>15?"#ff9f1c":T.text}}>
                        {r.shortPct}%<div style={{fontSize:7,color:T.textDim,fontWeight:400}}>of float</div>
                      </div>
                    :<div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint}}>—</div>}
                </div>
                <div style={{textAlign:"center"}}>
                  {r.shortRatio!=null
                    ?<div style={{fontFamily:"monospace",fontSize:12,color:"#ff9f1c",fontWeight:600}}>
                        {r.shortRatio}<div style={{fontSize:7,color:T.textDim,fontWeight:400}}>days cover</div>
                      </div>
                    :<div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint}}>—</div>}
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{fontFamily:"monospace",fontSize:9,color:T.textMid}}>{r.floatShares?fmtVol(r.floatShares):"—"}</div>
                  <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>float shares</div>
                </div>
              </>) : mode==="52wkhigh" ? (<>
                <div style={{textAlign:"center"}}>
                  <div style={{fontFamily:"monospace",fontSize:11,color:"#ffe45e",fontWeight:600}}>
                    ${r.hi52!=null?r.hi52.toFixed(2):"—"}
                  </div>
                  <div style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>52W high</div>
                </div>
                <div style={{textAlign:"center"}}>
                  {r.hi52Pct!=null
                    ?<div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,
                        color:r.hi52Pct>=98?T.accent:r.hi52Pct>=90?T.accent:T.text}}>
                        {r.hi52Pct}%<div style={{fontSize:7,color:T.textDim,fontWeight:400}}>of 52W high</div>
                      </div>
                    :<div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint}}>—</div>}
                </div>
                <div style={{textAlign:"center"}}>
                  {r.fromHi52!=null
                    ?<div style={{fontFamily:"monospace",fontSize:11,fontWeight:600,
                        color:r.fromHi52>=0?T.accent:"#ff9f1c"}}>
                        {r.fromHi52>=0?"+":""}{r.fromHi52}%
                        <div style={{fontSize:7,color:T.textDim,fontWeight:400}}>vs high</div>
                      </div>
                    :<div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint}}>—</div>}
                </div>
              </>) : mode==="eod" ? (<>
                {/* Sort period return */}
                <div style={{textAlign:"center"}}>
                  {(()=>{const v=r[eodF.period];const c=v==null?T.textFaint:v>10?T.accent:v>0?T.accent:v>-10?"#ff9f1c":T.down;return(
                    <div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:c}}>
                      {v==null?"—":(v>=0?"+":"")+v.toFixed(1)+"%"}
                      <div style={{fontSize:7,color:T.textDim,fontWeight:400}}>{eodPeriodLabel}</div>
                    </div>
                  );})()}
                </div>
                {/* 3M % */}
                <div style={{textAlign:"center"}}>
                  {(()=>{const v=r.d63;const c=v==null?T.textFaint:v>10?T.accent:v>0?T.accent:v>-10?"#ff9f1c":T.down;
                    return<span style={{fontFamily:"monospace",fontSize:10,color:c}}>{v==null?"—":(v>=0?"+":"")+v.toFixed(1)+"%"}</span>;})()}
                </div>
                {/* YTD % */}
                <div style={{textAlign:"center"}}>
                  {(()=>{const v=r.ytd;const c=v==null?T.textFaint:v>15?T.accent:v>0?T.accent:v>-15?"#ff9f1c":T.down;
                    return<span style={{fontFamily:"monospace",fontSize:10,color:c}}>{v==null?"—":(v>=0?"+":"")+v.toFixed(1)+"%"}</span>;})()}
                </div>
                {/* RS vs Sector ETF */}
                <div style={{textAlign:"center"}}>
                  {r.rs_vs_sector!=null ? (
                    <div>
                      <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,
                        color:r.rs_vs_sector>5?T.accent:r.rs_vs_sector>0?T.accent:r.rs_vs_sector>-5?"#ff9f1c":T.down}}>
                        {r.rs_vs_sector>=0?"+":""}{r.rs_vs_sector.toFixed(1)}
                      </span>
                      {r.sector_etf&&<div style={{fontFamily:"monospace",fontSize:7,color:"#a78bfa88",marginTop:1}}>vs {r.sector_etf}</div>}
                    </div>
                  ) : <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>—</span>}
                </div>
                {/* RS vs Industry ETF */}
                <div style={{textAlign:"center"}}>
                  {r.rs_vs_industry!=null ? (
                    <div>
                      <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,
                        color:r.rs_vs_industry>5?T.accent:r.rs_vs_industry>0?T.accent:r.rs_vs_industry>-5?"#ff9f1c":T.down}}>
                        {r.rs_vs_industry>=0?"+":""}{r.rs_vs_industry.toFixed(1)}
                      </span>
                      {r.industry_etf&&<div style={{fontFamily:"monospace",fontSize:7,color:"#00d4ff88",marginTop:1}}>vs {r.industry_etf}</div>}
                    </div>
                  ) : <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>—</span>}
                </div>
              </>) : (<>
                {/* Volume */}
                <div style={{textAlign:"center"}}>
                  <div style={{fontFamily:"monospace",fontSize:10,color:T.textMid}}>{fmtVol(r.volume||0)}</div>
                  <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>avg {fmtVol(r.avgVol10||0)}</div>
                </div>
                {/* Rel Vol */}
                <div style={{display:"flex",justifyContent:"center"}}><RVBar rv={r.relVol||0}/></div>
                {/* RS Rank */}
                <div style={{textAlign:"center"}}>
                  {r.rs_rank!=null ? (()=>{
                    const c=r.rs_rank>=90?T.accent:r.rs_rank>=80?T.accent:r.rs_rank>=70?"#ffe040":r.rs_rank>=50?"#ff9f1c":T.down;
                    return(
                      <div>
                        <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:c}}>{r.rs_rank}</span>
                        <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>RS rank</div>
                      </div>
                    );
                  })()
                  : <span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>—</span>}
                </div>
                {/* Stage */}
                <div style={{textAlign:"center"}}>
                  {(()=>{
                    const stageMap={1:{c:"#ffe040",l:"S1"},2:{c:T.accent,l:"S2"},3:{c:"#ff9f1c",l:"S3"},4:{c:T.down,l:"S4"}};
                    const s=stageMap[r.stage];
                    return s
                      ?<span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,color:s.c,
                          background:`${s.c}15`,padding:"3px 6px",borderRadius:3}}>{s.l}</span>
                      :<span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>—</span>;
                  })()}
                </div>
                {/* Setup Score */}
                <div style={{textAlign:"center"}}>
                  {r.setup_score!=null ? (()=>{
                    const c=r.setup_score>=80?T.accent:r.setup_score>=60?T.accent:r.setup_score>=40?"#ffe040":"#ff9f1c";
                    return(
                      <div>
                        <div style={{fontFamily:"monospace",fontSize:10,fontWeight:700,color:c}}>{r.setup_score}</div>
                        <div style={{width:40,height:2,background:T.textGhost2,borderRadius:1,margin:"2px auto 0",overflow:"hidden"}}>
                          <div style={{width:`${r.setup_score}%`,height:"100%",background:c}}/>
                        </div>
                        {r.pocket_pivot===1&&<div style={{fontFamily:"monospace",fontSize:7,color:"#00d4ff",marginTop:1}}>PP↑</div>}
                        {r.days_to_earn!=null&&r.days_to_earn<=7&&(
                          <div style={{fontFamily:"monospace",fontSize:7,
                            color:r.days_to_earn<=2?T.down:"#ff9f1c",marginTop:1}}>
                            📅{r.days_to_earn}d
                          </div>
                        )}
                      </div>
                    );
                  })()
                  : <span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>—</span>}
                </div>
              </>)}

              {/* EOD mode: last col = RSI */}
              {mode==="eod" && (
                <div style={{textAlign:"center"}}>
                  {r.rsi!=null
                    ?<span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
                        color:r.rsi<30?T.down:r.rsi<50?"#ff9f1c":r.rsi<70?T.accent:T.down,
                        background:"rgba(0,0,0,.2)",padding:"2px 5px",borderRadius:2}}>
                        RSI {r.rsi.toFixed(0)}
                      </span>
                    :<span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>—</span>}
                </div>
              )}
            </div>
          ); })}
        </div>
      )}

      {!isLoading&&!errors[mode]&&rows.length===0&&(results[mode]!=null||mode==="universe")&&(
        <div style={{fontFamily:"monospace",fontSize:11,color:T.textFaint,textAlign:"center",
          padding:48,background:T.bg,border:`1px solid ${T.border}`,borderRadius:6}}>
          {mode==="universe"
            ? !univStatus?.loaded
              ? "Universe loading — wait a moment then click ▶ SCAN ALL"
              : "No stocks match current filters — lower Min Change or Min Price"
            : mode==="losers"
              ?"No decliners yet — market may be fully green, try REFRESH"
              :"No results — try relaxing your filters"}
        </div>
      )}
    </div>
  );
}

export default ScannerTab;