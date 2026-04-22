import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTheme, THEME } from "../../hooks/useTheme.js";
import { Spark, McapBadge, EmaBadge, PctCell, LoadingDots, ScoreDial } from "../common/index.jsx";
import { pct, fmt, gc, fmtMcap, fmtVol, calcRet, calcRetSince, soM, soY, sparkPath } from "../../utils/format.js";
import { GICS, ALL_ETF_SYMS, SECTOR_ETF_SYMS, SUB_ETF_SYMS, secCol, INDEX_SYMS } from "../../constants/gics.js";

// ── apiFetch helper ─────────────────────────────────────────────────────────
const BASE = "http://localhost:3001";
async function apiFetch(path, opts={}) {
  const url = path.startsWith("http") ? path : BASE + path;
  const res = await fetch(url, { headers:{"Content-Type":"application/json"}, ...opts });
  if (!res.ok) { const e=await res.json().catch(()=>({error:res.statusText})); throw new Error(e.error||"HTTP "+res.status); }
  return res.json();
}

// ── Shared constants ─────────────────────────────────────────────────────────
const heat = v => {
  if(v>=5)  return{bg:"rgba(0,232,122,.25)", fg:"var(--clr-up)"};
  if(v>=2)  return{bg:"rgba(0,232,122,.12)", fg:"var(--clr-up-soft)"};
  if(v>=0)  return{bg:"rgba(0,232,122,.05)", fg:"#7ab89a"};
  if(v>=-2) return{bg:"rgba(255,69,96,.05)",  fg:"#d08080"};
  if(v>=-5) return{bg:"rgba(255,69,96,.12)",  fg:"#ff6060"};
  return      {bg:"rgba(255,69,96,.25)",      fg:"var(--clr-dn)"};
};

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
    if (chartRef.current) { try { chartRef.current.remove(); } catch(e) {} chartRef.current = null; }
  }

  async function buildChart() {
    if (!containerRef.current) return;
    setLoading(true); setErr(null); setInfo(null);
    try {
      const res = await fetch(`http://localhost:3001/api/candles?symbol=${encodeURIComponent(symbol)}&days=365`);
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
        width: containerRef.current.clientWidth, height: chartH,
        layout: { background: { color: cBg }, textColor: cTxt },
        grid: { vertLines: { color: cGrid }, horzLines: { color: cGrid } },
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
        color: T.textGhost, priceFormat: { type: "volume" }, priceScaleId: "vol",
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.76, bottom: 0 } });
      vol.setData(data.map(d => ({
        time: d.time, value: d.volume,
        color: d.close >= d.open ? "rgba(0,232,122,0.28)" : "rgba(255,69,96,0.28)",
      })));
      const emaStyles = [
        { period: 20, color: "#00e5ff", width: 0.8 },
        { period: 50, color: "#ffe040", width: 1 },
        { period: 200, color: "#ff6b6b", width: 1.2 },
      ];
      emaStyles.forEach(e => {
        const emaData = calcEMASeries(data, e.period);
        if (!emaData.length) return;
        const line = chart.addLineSeries({
          color: e.color, lineWidth: e.width,
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false,
        });
        line.setData(emaData);
      });
      chart.timeScale().fitContent();
      const last = data[data.length - 1];
      const prev = data[data.length - 2];
      const chg = prev ? +((last.close - prev.close) / prev.close * 100).toFixed(2) : 0;
      const chgD = prev ? +(last.close - prev.close).toFixed(2) : 0;
      setInfo({ price: last.close, change: chg, changeDol: chgD });
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
          if (containerRef.current && chartRef.current) chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        });
        ro.observe(containerRef.current);
      }
    } catch(e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!symbol) return;
    destroyChart();
    if (window.LightweightCharts) buildChart();
    else {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js";
      script.onload = buildChart;
      script.onerror = () => { setErr("Failed to load chart library"); setLoading(false); };
      document.head.appendChild(script);
    }
    return () => destroyChart();
  }, [symbol, themeKey]);

  if (!symbol) return null;
  const changeColor = info && info.change > 0 ? T.accent : info && info.change < 0 ? T.down : T.textMid;
  return (
    <div style={{ position:"fixed", top:48, right:0, width:"50vw", minWidth:480, height:"calc(100vh - 48px)", zIndex:9999, background:T.chartBg, borderLeft:`1px solid ${T.border2}`, boxShadow:"-14px 0 48px rgba(0,0,0,.7)", display:"flex", flexDirection:"column", animation:"tvFadeIn .18s ease" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", background:T.header, borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
          <span style={{ fontFamily:"monospace", fontSize:16, color:T.text, fontWeight:700, letterSpacing:".04em" }}>{symbol}</span>
          {info && (
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontFamily:"monospace", fontSize:14, color:T.text, fontWeight:600 }}>${info.price?.toFixed(2)}</span>
              <span style={{ fontFamily:"monospace", fontSize:10, color:changeColor, fontWeight:700 }}>{info.change>=0?"+":""}{info.change}% ({info.changeDol>=0?"+":""}{info.changeDol})</span>
            </div>
          )}
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexShrink:0 }}>
          <a href={`https://www.tradingview.com/chart/?symbol=${symbol}`} target="_blank" rel="noreferrer" style={{ fontFamily:"monospace", fontSize:8, color:T.accent, textDecoration:"none", border:"1px solid #00e87a33", padding:"4px 8px", borderRadius:3, letterSpacing:".06em", whiteSpace:"nowrap" }}>TV ↗</a>
          <span onClick={onClose} style={{ cursor:"pointer", color:T.textDim, fontSize:20, lineHeight:1, padding:"2px 6px" }}>×</span>
        </div>
      </div>
      <div style={{ display:"flex", gap:14, padding:"5px 14px", background:T.surface2, borderBottom:`1px solid ${T.border}`, flexShrink:0, alignItems:"center" }}>
        {[["20 EMA","#00e5ff"],["50 EMA","#ffe040"],["200 EMA","#ff6b6b"],["Volume","rgba(0,232,122,0.3)"]].map(item => (
          <div key={item[0]} style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:18, height:2, background:item[1], borderRadius:2 }}/>
            <span style={{ fontFamily:"monospace", fontSize:8, color:T.textDim }}>{item[0]}</span>
          </div>
        ))}
        <span style={{ fontFamily:"monospace", fontSize:7.5, color:T.border2, marginLeft:"auto" }}>DAILY · scroll to zoom</span>
      </div>
      <div ref={containerRef} style={{ flex:1, minHeight:0, position:"relative", overflow:"hidden" }}>
        {loading && (
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"inherit", zIndex:2, gap:12 }}>
            <div style={{ display:"flex", gap:5 }}>{[0,1,2,3,4].map(i => <div key={i} style={{ width:7, height:7, borderRadius:"50%", background:T.accent, animation:`bn 1s ${i*0.15}s infinite` }}/>)}</div>
            <span style={{ fontFamily:"monospace", fontSize:9, color:T.textDim }}>Loading {symbol}…</span>
          </div>
        )}
        {err && !loading && (
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:T.bg, zIndex:2, gap:12 }}>
            <span style={{ fontFamily:"monospace", fontSize:10, color:T.down }}>⚠ {err}</span>
            <a href={`https://www.tradingview.com/chart/?symbol=${symbol}`} target="_blank" rel="noreferrer" style={{ fontFamily:"monospace", fontSize:9, color:T.accent, padding:"5px 12px", border:"1px solid #00e87a33", borderRadius:3, textDecoration:"none" }}>Open on TradingView ↗</a>
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

// ─── DUMMY SIGBADGE (since original is not defined) ─────────────────────────
function SigBadge({ sig }) {
  // Original component likely displayed a signal icon; fallback to a simple dash.
  return <span style={{ fontFamily:"monospace", fontSize:9, color:T.textDim }}>—</span>;
}

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
    <div ref={ref} style={{ position:"relative", display:"inline-block", userSelect:"none" }}>
      <div onClick={()=>setOpen(o=>!o)} style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", background:T.inputBg, border:`1px solid ${selCount>0?_color+"44":T.border2}`, borderRadius:4, padding:"6px 10px", width, boxSizing:"border-box", boxShadow:selCount>0?`0 0 8px ${color}18`:"none" }}>
        <span style={{ fontFamily:"monospace", fontSize:9, color:selCount>0?color:T.textDim, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", letterSpacing:".04em" }}>{selCount===0?`ALL ${label.toUpperCase()}S`:selCount===1?selected[0]:`${selCount} ${label}s`}</span>
        {selCount>0 && <span onClick={clearAll} style={{ color:T.textDim, fontSize:12, cursor:"pointer" }}>×</span>}
        <span style={{ color:T.textFaint, fontSize:9 }}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:1000, background:T.bg, border:`1px solid ${T.border2}`, borderRadius:5, width:Math.max(width,240), maxHeight:260, overflowY:"auto", boxShadow:"0 8px 32px rgba(0,0,0,.7)" }}>
          <div style={{ padding:"6px 10px", borderBottom:"1px solid #0d1a26", display:"flex", gap:8 }}>
            <span onClick={()=>onChange(options)} style={{ fontFamily:"monospace", fontSize:8, _color, cursor:"pointer" }}>ALL</span>
            <span style={{ color:T.border2 }}>|</span>
            <span onClick={()=>onChange([])} style={{ fontFamily:"monospace", fontSize:8, color:T.textDim, cursor:"pointer" }}>NONE</span>
          </div>
          {options.map(opt => (
            <div key={opt} onClick={()=>toggle(opt)} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 12px", cursor:"pointer", background:selected.includes(opt)?`${color}0e`:"transparent", borderBottom:`1px solid ${T.border}` }}
              onMouseEnter={e=>{ if(!selected.includes(opt)) e.currentTarget.style.background=T.border; }}
              onMouseLeave={e=>{ e.currentTarget.style.background=selected.includes(opt)?`${color}0e`:"transparent"; }}>
              <div style={{ width:12, height:12, borderRadius:2, flexShrink:0, background:selected.includes(opt)?color:"transparent", border:`1.5px solid ${selected.includes(opt)?color:T.border2}`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                {selected.includes(opt) && <span style={{ color:"#000", fontSize:9, fontWeight:900, lineHeight:1 }}>✓</span>}
              </div>
              <span style={{ fontFamily:"monospace", fontSize:9, color:selected.includes(opt)?T.text:T.textDim, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{opt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const calcRS = (secRet, spyRet) => {
  if (secRet==null || spyRet==null || spyRet===0) return null;
  return +(((1 + secRet/100) / (1 + spyRet/100)) * 100 - 100).toFixed(2);
};
const calcCompositeRS = (s, spy) => {
  const w1m = calcRS(s.d1m, spy.d1m);
  const w3m = calcRS(s.d3m, spy.d3m);
  const w6m = calcRS(s.d6m, spy.d6m);
  if (w1m==null && w3m==null && w6m==null) return null;
  const num = (w1m||0)*0.25 + (w3m||0)*0.35 + (w6m||0)*0.40;
  return +num.toFixed(2);
};

export default function SectorsTab({ sectors, spySrc, etfQuotes = {}, liveSectors = null }) {
  const themeKey = useTheme();
  const T = THEME[themeKey] || THEME.night;
  const dark = themeKey === "night";

  const [view, setView] = useState("overview");
  const [sk, setSk] = useState("d1");
  const [skDir, setSkDir] = useState(-1);
  const [expanded, setExpanded] = useState(null);
  const [ef, setEf] = useState("all");
  const [mc, setMc] = useState(0);
  const [selSec, setSelSec] = useState(null);
  const [rrgTrail, setRrgTrail] = useState(false);
  const [rrgPeriod, setRrgPeriod] = useState("1m");
  const [rrgData, setRrgData] = useState(null);
  const [rrgLoading, setRrgLoading] = useState(false);
  const [rrgMode, setRrgMode] = useState("sectors");
  const [rrgSector, setRrgSector] = useState(null);
  const [rrgQuadFil, setRrgQuadFil] = useState([]);
  const [rrgHidden, setRrgHidden] = useState(new Set());
  const [liveInds, setLiveInds] = useState([]);
  const [indLoading, setIndLoading] = useState(false);
  const [indSort, setIndSort] = useState("avgChg");
  const [indSortDir, setIndSortDir] = useState(-1);
  const [indSec, setIndSec] = useState(null);
  const [indPeriod, setIndPeriod] = useState("1d");
  const [selEtf, setSelEtf] = useState({});
  const [etfStocks, setEtfStocks] = useState({});
  const [etfSortKey, setEtfSortKey] = useState("change");
  const [etfSortDir, setEtfSortDir] = useState(-1);

  const loadEtfStocks = useCallback(async (etfSym, focus, sectorName, forceRefresh=false) => {
    if (etfStocks[etfSym]?.stocks && !forceRefresh) return;
    setEtfStocks(prev => ({...prev, [etfSym]: {stocks:null, loading:true, focus, sector:sectorName}}));
    try {
      const subDef = Object.values(GICS).flatMap(g => g.subEtfs).find(se => se.sym === etfSym);
      const industries = subDef?.industries || [];
      const params = new URLSearchParams({ etf: etfSym, industries: industries.join(','), sector: sectorName, limit: 12 });
      const r = await apiFetch(`/api/etf/stocks?${params}`).catch(() => null);
      const stocks = r?.stocks || [];
      setEtfStocks(prev => ({...prev, [etfSym]: {stocks, loading:false, focus, sector:sectorName, ts:new Date()}}));
    } catch(e) { setEtfStocks(prev => ({...prev, [etfSym]: {stocks:[], loading:false, focus, sector:sectorName}})); }
  }, [etfStocks]);

  const spyData = useMemo(() => {
    if (!spySrc) return null;
    return { d1: spySrc.d1??0, d5: spySrc.d5??null, d1m: spySrc.d1m??null, d3m: spySrc.d3m??null, d6m: spySrc.d6m??null, d1y: spySrc.d1y??null, ytd: spySrc.dYTD??null, mtd: spySrc.dMTD??null };
  }, [spySrc]);

  const loadRRG = useCallback(async (period, mode, sector) => {
    setRrgLoading(true);
    try {
      const params = new URLSearchParams({ period, trail:7, mode });
      if (sector) params.set("sector", sector);
      const r = await apiFetch(`/api/rrg?${params}`);
      setRrgData(r);
    } catch(e) { console.warn('RRG fetch error', e.message); }
    finally { setRrgLoading(false); }
  }, []);

  useEffect(() => { if (view === 'rrg') loadRRG(rrgPeriod, rrgMode, rrgSector); }, [view, rrgPeriod, rrgMode, rrgSector]);

  const loadLiveInds = useCallback(async () => {
    setIndLoading(true);
    try {
      const [GR,LR,VR] = await Promise.allSettled([
        apiFetch("/api/scan/gainers?minPrice=1&minVol=100000&limit=200"),
        apiFetch("/api/scan/losers?minPrice=1&minVol=100000&limit=200"),
        apiFetch("/api/scan/volume?minRelVol=1.5&minPrice=1&limit=200"),
      ]);
      const all = [...(GR.value?.results||[]), ...(LR.value?.results||[]), ...(VR.value?.results||[])];
      const bySymbol = {};
      all.forEach(t => { if(!bySymbol[t.symbol]) bySymbol[t.symbol]=t; });
      const deduped = Object.values(bySymbol).filter(t=>t.industry);
      const indMap = {};
      deduped.forEach(t => { const k = t.industry; if (!indMap[k]) indMap[k] = {industry:k, sector:t.sector, tickers:[]}; indMap[k].tickers.push(t); });
      const inds = Object.values(indMap).map(g => {
        const n = g.tickers.length;
        const avgChg = +(g.tickers.reduce((a,t)=>a+t.change,0)/n).toFixed(2);
        const avgRV = +(g.tickers.reduce((a,t)=>a+(t.relVol||1),0)/n).toFixed(2);
        const adv = g.tickers.filter(t=>t.change>0).length;
        const dec = g.tickers.filter(t=>t.change<0).length;
        const topMover = [...g.tickers].sort((a,b)=>Math.abs(b.change)-Math.abs(a.change))[0];
        return { ...g, n, avgChg, avgRV, adv, dec, topMover };
      });
      setLiveInds(inds);
    } catch(e) { console.warn('ind load error', e.message); }
    finally { setIndLoading(false); }
  }, []);

  useEffect(() => { if (view === 'industry') loadLiveInds(); }, [view]);

  const cardBg = dark ? T.surface : T.surface;
  const rowBg  = dark ? T.row : T.row;

  const sRows = useMemo(() => {
    return Object.entries(sectors).map(([nm, cfg]) => {
      const tickers = cfg.tickers.filter(t => t.hasData);
      const avg = k => tickers.length ? +(tickers.reduce((s,t)=>s+(t[k]??0),0)/tickers.length).toFixed(2) : null;
      const adv = tickers.filter(t => (t.d1||0) > 0).length;
      const dec = tickers.filter(t => (t.d1||0) < 0).length;
      const adPct = tickers.length ? +((adv / tickers.length)*100).toFixed(0) : 0;
      const relVol = tickers.length ? +(tickers.reduce((s,t)=>s+(t.relVol||1),0)/tickers.length).toFixed(2) : 1;
      const d1m = avg("d1m"), d3m = avg("d3m"), d6m = avg("d6m");
      const compRS = spyData ? calcCompositeRS({d1m,d3m,d6m}, spyData) : null;
      const rs1m = spyData ? calcRS(d1m, spyData.d1m) : null;
      const rs3m = spyData ? calcRS(d3m, spyData.d3m) : null;
      const rsMom = (rs1m!=null && rs3m!=null) ? +(rs1m - rs3m/3).toFixed(2) : null;
      const rrgQ = rs1m==null ? null : rs1m>0 && rsMom>0 ? "leading" : rs1m>0 && rsMom<=0 ? "weakening" : rs1m<=0 && rsMom>0 ? "improving" : "lagging";
      const hasThrustSignal = adPct >= 62;
      const gicsDef = GICS[nm] || null;
      const etfSym = gicsDef?.etf || null;
      const etf = etfSym ? (etfQuotes[etfSym] || null) : null;
      return { nm, color:cfg.color, count:tickers.length, d1:avg("d1"), d5:avg("d5"), dMTD:avg("dMTD"), d1m, d3m, d6m, dYTD:avg("dYTD"), d1y:avg("d1y"), adv, dec, adPct, relVol, compRS, rs1m, rs3m, rs6m:null, rs1y:null, rsMom, rrgQ, hasThrustSignal, ema20: tickers.filter(t=>t.ema20s==="ABOVE").length, ema50: tickers.filter(t=>t.ema50s==="ABOVE").length, ema200:tickers.filter(t=>t.ema200s==="ABOVE").length, cycle: {early:3,mid:3,late:3,rec:3,label:"—"}, tickers, etfSym, etf, gicsDef };
    });
  }, [sectors, spyData]);

  const sortedRows = useMemo(() => [...sRows].sort((a,b) => skDir * ((b[sk]??-999) - (a[sk]??-999))), [sRows, sk, skDir]);
  const handleSort = key => { if (sk===key) setSkDir(d=>-d); else { setSk(key); setSkDir(-1); } };
  const QC = { leading:T.accent, weakening:"#ff9f1c", improving:"#4cc9f0", lagging:T.down };
  const pct2c = v => v==null?T.textGhost:v>5?T.accent:v>0?T.accent:v>-5?"#ff9f1c":T.down;
  const pct2bg = v => v==null?"transparent":v>5?"rgba(0,232,122,.12)":v>0?"rgba(77,219,158,.09)":v>-5?"rgba(255,159,28,.09)":"rgba(255,69,96,.09)";
  const PCell = ({v, big}) => {
    const c = pct2c(v), bg = pct2bg(v);
    return <span style={{fontFamily:"monospace",fontSize:big?12:10,fontWeight:big?"700":"500", color:c, background:bg, padding:"2px 5px", borderRadius:3, whiteSpace:"nowrap"}}>{v==null?"—":`${v>=0?"+":""}${v.toFixed(1)}%`}</span>;
  };
  const VIEW_BTNS = [{k:"overview",l:"OVERVIEW"},{k:"rrg",l:"RRG CHART"},{k:"industry",l:"INDUSTRY DRILL"}];

  return (
    <div>
      <div style={{display:"flex",gap:0,marginBottom:12,background:cardBg,border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden"}}>
        {VIEW_BTNS.map(({k,l}) => (
          <button key={k} onClick={()=>setView(k)} style={{flex:1,fontFamily:"monospace",fontSize:10,padding:"9px 0",border:"none",borderRight:k!=="industry"?`1px solid ${T.border}`:"none",cursor:"pointer",background:view===k?"rgba(0,232,122,.12)":cardBg,color:view===k?T.accent:T.textDim,fontWeight:view===k?"700":"400",outline:view===k?"inset 0 -2px 0 #00e87a":"none",letterSpacing:".06em"}}>{l}</button>
        ))}
      </div>
      {view==="overview" && (
        <div>
          <div style={{display:"flex",gap:0,marginBottom:10,background:cardBg,border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden",alignItems:"stretch"}}>
            <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,padding:"7px 10px",borderRight:`1px solid ${T.border}`,display:"flex",alignItems:"center",whiteSpace:"nowrap"}}>SORT BY</span>
            {[{k:"d1",l:"1D"},{k:"d5",l:"1W"},{k:"dMTD",l:"MTD"},{k:"d1m",l:"1M"},{k:"d3m",l:"3M"},{k:"d6m",l:"6M"},{k:"dYTD",l:"YTD"},{k:"d1y",l:"1Y"},{k:"compRS",l:"RS SCORE"},{k:"adPct",l:"A/D%"},{k:"relVol",l:"REL VOL"}].map(({k,l}) => (
              <button key={k} onClick={()=>handleSort(k)} style={{fontFamily:"monospace",fontSize:8.5,padding:"7px 10px",border:"none",borderRight:`1px solid ${T.border}`,cursor:"pointer",whiteSpace:"nowrap",background:sk===k?"rgba(0,232,122,.12)":cardBg,color:sk===k?T.accent:T.textDim,fontWeight:sk===k?"700":"400"}}>{l}{sk===k?skDir>0?" ↑":" ↓":""}</button>
            ))}
          </div>
          {sortedRows.map(s => {
            const isOpen = expanded === s.nm;
            const cycleScore = s.cycle;
            return (
              <div key={s.nm} style={{marginBottom:6}}>
                <div style={{background:cardBg,border:`1px solid ${isOpen?s.color+"55":T.border}`,borderLeft:`4px solid ${s.color}`,borderRadius:6,overflow:"hidden"}}>
                  <div style={{display:"grid",gridTemplateColumns:"160px 68px 68px 68px 68px 68px 68px 68px 68px 80px 70px 70px 70px 100px",padding:"8px 12px",gap:4,alignItems:"center",cursor:"pointer"}} onClick={()=>setExpanded(isOpen?null:s.nm)}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                        <span style={{fontFamily:"monospace",fontSize:12,color:T.text,fontWeight:700}}>{s.nm}</span>
                        {s.etfSym && <span style={{fontFamily:"monospace",fontSize:8,color:s.color,background:`${s.color}18`,border:`1px solid ${s.color}30`,padding:"1px 5px",borderRadius:2}}>{s.etfSym}</span>}
                        {s.etf && <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,color:s.etf.d1>0?T.accent:s.etf.d1<0?T.down:T.textMid}}>{s.etf.d1>=0?"+":""}{s.etf.d1.toFixed(1)}%</span>}
                        {s.hasThrustSignal && <span style={{fontFamily:"monospace",fontSize:7,color:T.accent,background:"rgba(0,232,122,.15)",border:"1px solid rgba(0,232,122,.3)",padding:"1px 4px",borderRadius:2,animation:"pulse 1.4s infinite"}}>THRUST</span>}
                        {s.rrgQ && <span style={{fontFamily:"monospace",fontSize:7,color:QC[s.rrgQ],background:`${QC[s.rrgQ]}18`,border:`1px solid ${QC[s.rrgQ]}30`,padding:"1px 4px",borderRadius:2}}>{s.rrgQ.toUpperCase()}</span>}
                      </div>
                      <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,marginTop:1}}>{s.count} stocks · {cycleScore.label}</div>
                    </div>
                    {[s.d1,s.d5,s.dMTD,s.d1m,s.d3m,s.d6m,s.dYTD,s.d1y].map((v,i) => <div key={i} style={{textAlign:"center"}}><PCell v={v}/></div>)}
                    <div style={{textAlign:"center"}}>
                      {s.compRS!=null ? <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:s.compRS>5?T.accent:s.compRS>0?T.accent:s.compRS>-5?"#ff9f1c":T.down,background:pct2bg(s.compRS),padding:"2px 6px",borderRadius:3}}>{s.compRS>=0?"+":""}{s.compRS.toFixed(1)}</span> : <span style={{fontFamily:"monospace",fontSize:9,color:T.textGhost}}>—</span>}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span style={{fontFamily:"monospace",fontSize:8,color:T.accent}}>{s.adv}▲</span><span style={{fontFamily:"monospace",fontSize:8,color:T.down}}>{s.dec}▼</span></div>
                      <div style={{height:4,background:T.border,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${s.adPct}%`,background:s.adPct>=70?T.accent:s.adPct>=50?T.accent:s.adPct>=30?"#ff9f1c":T.down,borderRadius:2,transition:"width .5s"}}/></div>
                      <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,textAlign:"center"}}>{s.adPct}%</span>
                    </div>
                    <div style={{textAlign:"center"}}><span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:s.relVol>=2?"#ff9f1c":s.relVol>=1.5?"#ffe040":T.textMid}}>{s.relVol.toFixed(1)}×</span></div>
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      {[["20",s.ema20,"#00e5ff"],["50",s.ema50,"#ffe040"],["200",s.ema200,"#ff6b6b"]].map(([l,n,c]) => (
                        <div key={l} style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontFamily:"monospace",fontSize:6.5,color:T.textGhost,minWidth:14}}>{l}</span><div style={{flex:1,height:3,background:T.border,borderRadius:1,overflow:"hidden"}}><div style={{height:"100%",width:`${(n/s.count)*100}%`,background:c,borderRadius:1}}/></div><span style={{fontFamily:"monospace",fontSize:6.5,color:c}}>{n}/{s.count}</span></div>
                      ))}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:1.5}}>
                      {[["E",cycleScore.early,T.accent],["M",cycleScore.mid,T.accent],["L",cycleScore.late,"#ff9f1c"],["R",cycleScore.rec,"#c77dff"]].map(([l,v,c]) => (
                        <div key={l} style={{display:"flex",gap:3,alignItems:"center"}}><span style={{fontFamily:"monospace",fontSize:6.5,color:T.textGhost,minWidth:8}}>{l}</span><div style={{flex:1,height:3,background:T.border,borderRadius:1,overflow:"hidden"}}><div style={{height:"100%",width:`${v*20}%`,background:c,borderRadius:1}}/></div></div>
                      ))}
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{borderTop:`1px solid ${s.color}22`}}>
                      <div style={{padding:"10px 12px",background:dark?`${s.color}06`:`${s.color}04`,borderBottom:`1px solid ${s.color}18`}}>
                        <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,letterSpacing:".08em",marginBottom:8}}> · {s.gicsDef?.gicsDesc?.substring(0,60)||""}</div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:6}}>
                          {s.etfSym && (()=>{ const isPrimSel = (selEtf[s.nm] || s.etfSym) === s.etfSym; return (
                            <div key={s.etfSym} onClick={()=>setSelEtf(prev=>({...prev,[s.nm]:s.etfSym}))} style={{background:cardBg,border:`1px solid ${isPrimSel?s.color:T.border}`,borderTop:`3px solid ${isPrimSel?s.color:"transparent"}`,borderRadius:4,padding:"7px 10px",cursor:"pointer",boxShadow:isPrimSel?`0 0 10px ${s.color}30`:"none",transition:"all .15s"}}>
                              <div style={{fontFamily:"monospace",fontSize:7.5,color:s.color,letterSpacing:".06em",marginBottom:3}}>PRIMARY ETF</div>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:T.text}}>{s.etfSym}</div><div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,marginTop:1}}>{s.gicsDef?.etfFull?.substring(0,24)}</div></div>{s.etf?<div style={{textAlign:"right"}}><div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:s.etf.d1>0?T.accent:s.etf.d1<0?T.down:T.textMid}}>{s.etf.d1>=0?"+":""}{s.etf.d1.toFixed(2)}%</div><div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>${s.etf.price.toFixed(2)}</div><div style={{display:"flex",gap:3,marginTop:3,flexWrap:"wrap"}}>{["d5","d1m","d3m"].map(k=>{const v=s.etf[k];return<span key={k} style={{fontFamily:"monospace",fontSize:7,color:v>0?T.accent:v<0?T.down:T.textMid}}>{k==="d5"?"1W":k==="d1m"?"1M":"3M"} {v!=null?(v>=0?"+":"")+v.toFixed(1)+"%":"—"}</span>;})}</div></div>:<span style={{fontFamily:"monospace",fontSize:9,color:T.textGhost}}>No data</span>}</div>
                            </div>
                          )})()}
                          {(s.gicsDef?.subEtfs||[]).map(se => {
                            const d = etfQuotes[se.sym];
                            const c2 = d?(d.d1>0?T.accent:d.d1<0?T.down:T.textMid):T.textMid;
                            const isSelected = (selEtf[s.nm] || s.etfSym) === se.sym;
                            return (
                              <div key={se.sym} onClick={()=>{ setSelEtf(prev=>({...prev,[s.nm]:se.sym})); loadEtfStocks(se.sym, se.focus, s.nm, false); }} style={{background:cardBg,border:`1px solid ${isSelected?c2:T.border}`,borderTop:`3px solid ${isSelected?c2:"transparent"}`,borderRadius:4,padding:"7px 10px",cursor:"pointer",opacity:d?1:0.55,boxShadow:isSelected?`0 0 10px ${c2}30`:"none",transition:"all .15s"}}>
                                <div style={{fontFamily:"monospace",fontSize:7.5,color:isSelected?c2:T.textFaint,letterSpacing:".04em",marginBottom:3,fontWeight:isSelected?"700":"400"}}>{se.focus}</div>
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:T.text}}>{se.sym}</div><div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,marginTop:1}}>{se.name.substring(0,22)}</div></div>{d?<div style={{textAlign:"right"}}><div style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:c2}}>{d.d1>=0?"+":""}{d.d1.toFixed(2)}%</div><div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>${d.price.toFixed(2)}</div><div style={{display:"flex",gap:3,marginTop:3,flexWrap:"wrap"}}>{["d5","d1m","d3m"].map(k=>{const v=d[k];return<span key={k} style={{fontFamily:"monospace",fontSize:7,color:v>0?T.accent:v<0?T.down:T.textMid}}>{k==="d5"?"1W":k==="d1m"?"1M":"3M"} {v!=null?(v>=0?"+":"")+v.toFixed(1)+"%":"—"}</span>;})}</div></div>:<span style={{fontFamily:"monospace",fontSize:9,color:T.textGhost}}>No data</span>}</div>
                              </div>
                            );
                          })}
                        </div>
                        {(()=>{ const activeEtfSym = selEtf[s.nm]; if (!activeEtfSym || activeEtfSym === s.etfSym) return null; const entry = etfStocks[activeEtfSym]; const subDef = (s.gicsDef?.subEtfs||[]).find(se=>se.sym===activeEtfSym); const etfD = etfQuotes[activeEtfSym]; const etfC = etfD?(etfD.d1>0?T.accent:etfD.d1<0?T.down:T.textMid):T.textMid; return (
                          <div style={{marginTop:10,background:dark?T.inputBg:T.surface2,border:`1px solid ${etfC}22`,borderRadius:6,overflow:"hidden"}}>
                            <div style={{padding:"8px 12px",background:`${etfC}10`,borderBottom:`1px solid ${etfC}22`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                              <div style={{display:"flex",alignItems:"center",gap:10}}><div style={{width:3,height:24,background:etfC,borderRadius:2}}/><div><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:T.text}}>{activeEtfSym}</span><span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:etfC}}>{etfD?(etfD.d1>=0?"+":"")+etfD.d1.toFixed(2)+"%":""}</span><span style={{fontFamily:"monospace",fontSize:8,color:s.color,background:`${s.color}18`,border:`1px solid ${s.color}30`,padding:"1px 6px",borderRadius:2}}>{subDef?.focus}</span></div><div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,marginTop:2}}>{subDef?.name}{subDef?.industries?.length>0 && ` · ${subDef.industries.slice(0,2).join(", ")}`}</div></div></div>
                              {etfD && <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>{[["$",etfD.price?.toFixed(2)],["1W",etfD.d5],["1M",etfD.d1m],["3M",etfD.d3m],["YTD",etfD.dYTD]].map(([l,v])=>{if(l==="$")return<span key={l} style={{fontFamily:"monospace",fontSize:10,color:T.textMid}}>${v}</span>;const vc=v==null?T.textGhost:v>0?T.accent:T.down;return(<div key={l} style={{textAlign:"center",background:rowBg,border:`1px solid ${T.border}`,borderRadius:3,padding:"3px 7px"}}><div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>{l}</div><div style={{fontFamily:"monospace",fontSize:9,fontWeight:700,color:vc}}>{v==null?"—":(v>=0?"+":"")+v.toFixed(1)+"%"}</div></div>);})}<button onClick={()=>loadEtfStocks(activeEtfSym, subDef?.focus, s.nm, true)} style={{fontFamily:"monospace",fontSize:8,padding:"4px 8px",border:"none",background:"rgba(0,232,122,.1)",color:T.accent,borderRadius:3,cursor:"pointer"}}>↺</button></div>}
                            </div>
                            {entry?.loading && <div style={{padding:"16px",textAlign:"center",fontFamily:"monospace",fontSize:10,color:etfC,letterSpacing:".08em"}}>SCANNING {activeEtfSym} HOLDINGS…</div>}
                            {entry?.stocks && entry.stocks.length===0 && !entry.loading && <div style={{padding:"16px",textAlign:"center",fontFamily:"monospace",fontSize:10,color:T.textFaint}}>No live screener matches for {subDef?.focus}</div>}
                            {entry?.stocks?.length > 0 && (
                              <>
                                <div style={{display:"flex",gap:0,alignItems:"stretch",borderBottom:`1px solid ${T.border}`,background:rowBg}}>
                                  <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,padding:"5px 10px",borderRight:`1px solid ${T.border}`,display:"flex",alignItems:"center",whiteSpace:"nowrap"}}>SORT</span>
                                  {[["change","1D"],["d5","1W"],["dMTD","MTD"],["d1m","1M"],["d3m","3M"],["d6m","6M"],["dYTD","YTD"],["d1y","1Y"],["relVol","VOL"],["marketCap","MCAP"],["rsi","RSI"]].map(([k,l]) => (
                                    <button key={k} onClick={()=>{ if(etfSortKey===k) setEtfSortDir(d=>-d); else { setEtfSortKey(k); setEtfSortDir(-1); } }} style={{fontFamily:"monospace",fontSize:8,padding:"5px 9px",border:"none",borderRight:`1px solid ${T.border}`,cursor:"pointer",background:etfSortKey===k?`${etfC}18`:rowBg,color:etfSortKey===k?etfC:T.textDim,fontWeight:etfSortKey===k?"700":"400"}}>{l}{etfSortKey===k?(etfSortDir<0?"↓":"↑"):""}</button>
                                  ))}
                                </div>
                                <div style={{display:"grid",gridTemplateColumns:"82px 90px 1fr 76px 68px 68px 68px 68px 68px 68px 68px 76px 72px 60px 60px",padding:"5px 12px",background:rowBg,borderBottom:`1px solid ${T.border}`,gap:3,alignItems:"center"}}>
                                  {["TICKER","PRICE","INDUSTRY","1D","1W","MTD","1M","3M","6M","YTD","1Y","REL VOL","MCAP","50D","200D"].map(h => <span key={h} style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,letterSpacing:".05em",textAlign:h==="TICKER"||h==="PRICE"||h==="INDUSTRY"?"left":"center"}}>{h}</span>)}
                                </div>
                                {[...entry.stocks].sort((a,b)=>{ const av=a[etfSortKey]??-9999, bv=b[etfSortKey]??-9999; return etfSortDir*(bv-av); }).map((t,ti,arr) => {
                                  const cg = (t.change||0)>0?T.accent:(t.change||0)<0?T.down:T.textMid;
                                  const rv = t.relVol||0;
                                  const a50 = t.above50??null, a200 = t.above200??null;
                                  const PCell = ({v}) => { if(v==null) return <span style={{fontFamily:"monospace",fontSize:9,color:T.textGhost}}>—</span>; const c=v>5?T.accent:v>0?T.accent:v>-5?"#ff9f1c":T.down; return <span style={{fontFamily:"monospace",fontSize:10,fontWeight:600,color:c}}>{v>=0?"+":""}{v.toFixed(1)}%</span>; };
                                  const EmaCell = ({v,label}) => { if(v==null) return <span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>—</span>; return <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,color:v?T.accent:T.down,background:v?"rgba(0,232,122,.1)":"rgba(255,69,96,.1)",padding:"2px 5px",borderRadius:2,border:`1px solid ${v?"rgba(0,232,122,.25)":"rgba(255,69,96,.25)"}`}}>{label}{v?"▲":"▼"}</span>; };
                                  return (
                                    <div key={t.symbol} style={{display:"grid",gridTemplateColumns:"82px 90px 1fr 76px 68px 68px 68px 68px 68px 68px 68px 76px 72px 60px 60px",padding:"7px 12px",gap:3,alignItems:"center",borderBottom:ti<arr.length-1?`1px solid ${T.border}`:"none",transition:"background .1s"}} onMouseEnter={e=>e.currentTarget.style.background=`${etfC}06`} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                      <div><div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:T.text}}>{t.symbol}</div><div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>{t.name?.substring(0,13)}</div></div>
                                      <div><div style={{fontFamily:"monospace",fontSize:11,color:T.text}}>${(t.price||0).toFixed(2)}</div>{t.hi52Pct && <div style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>{t.hi52Pct}% 52H</div>}</div>
                                      <div style={{minWidth:0}}><span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.industry||"—"}</span>{t.rsi!=null && <span style={{fontFamily:"monospace",fontSize:7,color:t.rsi<30?T.accent:t.rsi>70?T.down:T.textMid}}>RSI {t.rsi.toFixed(0)}</span>}</div>
                                      <div style={{textAlign:"center"}}><span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:cg}}>{(t.change||0)>=0?"+":""}{(t.change||0).toFixed(2)}%</span></div>
                                      {[t.d5, t.dMTD, t.d1m, t.d3m, t.d6m, t.dYTD, t.d1y].map((v,ki) => <div key={ki} style={{textAlign:"center"}}><PCell v={v}/></div>)}
                                      <div style={{textAlign:"center"}}><span style={{fontFamily:"monospace",fontSize:10,fontWeight:700,color:rv>=2?"#ff9f1c":rv>=1.5?"#ffe040":T.textMid}}>{rv.toFixed(1)}×</span></div>
                                      <div style={{textAlign:"center"}}><McapBadge v={t.marketCap}/></div>
                                      <div style={{textAlign:"center"}}><EmaCell v={a50} label="50D"/></div>
                                      <div style={{textAlign:"center"}}><EmaCell v={a200} label="200D"/></div>
                                    </div>
                                  );
                                })}
                                <div style={{padding:"6px 12px",fontFamily:"monospace",fontSize:7.5,color:T.textFaint,borderTop:`1px solid ${T.border}`,display:"flex",gap:10,alignItems:"center"}}><span>{entry.stocks.length} stocks</span><span style={{color:etfC}}>{activeEtfSym} · {subDef?.focus}</span><span style={{color:"rgba(0,232,122,.5)"}}>live screener + 1Y chart</span>{entry.ts && <span style={{marginLeft:"auto",color:T.textGhost}}>{new Date(entry.ts).toLocaleTimeString()}</span>}</div>
                              </>
                            )}
                          </div>
                        )})()}
                      </div>
                      <div style={{display:"flex",gap:6,padding:"7px 12px",background:rowBg,borderBottom:`1px solid ${T.border}`,flexWrap:"wrap",alignItems:"center"}}>
                        {[["all","ALL"],["e20","EMA20▲"],["e50","EMA50▲"],["e200","EMA200▲"]].map(([k,l]) => <button key={k} onClick={()=>setEf(k)} style={{fontFamily:"monospace",fontSize:8,padding:"3px 8px",borderRadius:3,border:"none",cursor:"pointer",background:ef===k?`${s.color}20`:rowBg,color:ef===k?s.color:T.textDim,outline:ef===k?`1px solid ${s.color}44`:`1px solid ${T.border}`}}>{l}</button>)}
                        {[[0,"ALL"],[1e9,"$1B+"],[1e10,"$10B+"],[1e11,"$100B+"]].map(([v,l]) => <button key={v} onClick={()=>setMc(v)} style={{fontFamily:"monospace",fontSize:8,padding:"3px 8px",borderRadius:3,border:"none",cursor:"pointer",background:mc===v?`${s.color}20`:rowBg,color:mc===v?s.color:T.textDim,outline:mc===v?`1px solid ${s.color}44`:`1px solid ${T.border}`}}>{l}</button>)}
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"88px 82px repeat(8,60px) 34px 34px 34px 80px 72px",padding:"6px 12px",gap:2,background:rowBg,borderBottom:`1px solid ${T.border}`,alignItems:"center"}}>
                        {["TICKER","PRICE","1D","1W","MTD","1M","3M","6M","YTD","1Y","20","50","200","MCAP","SIG"].map((h,i) => <span key={h} style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,letterSpacing:".06em",textAlign:i<=1?"left":"center"}}>{h}</span>)}
                      </div>
                      {(()=>{
                        const liveSec = liveSectors?.[s.nm];
                        const displayTickers = liveSec ? liveSec.tickers.map(lt=>({ sym: lt.symbol, name: lt.name||lt.symbol, price: lt.price||0, d1: lt.change||0, relVol: lt.relVol||0, marketCap: lt.marketCap||null, sector: lt.sector||s.nm, industry: lt.industry||"", above50: null, above200: null, ema20s:"N/A", ema50s:"N/A", ema200s:"N/A", sig: null, hasData: true, _live: true })) : s.tickers.filter(t=>t.hasData);
                        return displayTickers.filter(t => { if (!t.hasData && !t._live) return false; if (ef==="e20" && t.ema20s!=="ABOVE") return false; if (ef==="e50" && t.ema50s!=="ABOVE") return false; if (ef==="e200" && t.ema200s!=="ABOVE") return false; if (mc>0 && (t.marketCap||0)<mc) return false; return true; }).sort((a,b)=>(b[sk]??b.d1??-999)-(a[sk]??a.d1??-999)).map((t, ri, arr) => (
                          <div key={t.sym} style={{display:"grid",gridTemplateColumns:"88px 82px repeat(8,60px) 34px 34px 34px 80px 72px",padding:"7px 12px",gap:2,alignItems:"center",borderBottom:ri<arr.length-1?`1px solid ${T.border}`:"none",transition:"background .1s"}} onMouseEnter={e=>e.currentTarget.style.background=`${s.color}08`} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <div><div style={{fontFamily:"monospace",fontSize:12,color:T.text,fontWeight:700}}>{t.sym}</div><div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>{t.name?.substring(0,12)}</div></div>
                            <div><div style={{fontFamily:"monospace",fontSize:11,color:T.textMid}}>${fmt(t.price)}</div>{t.hi52 && <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>{((t.price/t.hi52)*100).toFixed(0)}% 52H</div>}</div>
                            {[t.d1,t.d5,t.dMTD,t.d1m,t.d3m,t.d6m,t.dYTD,t.d1y].map((v,i) => <div key={i} style={{display:"flex",justifyContent:"center"}}><PCell v={v} big={i===0}/></div>)}
                            {[t.ema20s,t.ema50s,t.ema200s].map((st,j) => { const ab=st==="ABOVE", no=st==="BELOW"; return <div key={j} style={{display:"flex",justifyContent:"center"}}><span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,color:ab?T.accent:no?T.down:T.textGhost,background:ab?"rgba(0,232,122,.1)":no?"rgba(255,69,96,.1)":"transparent",border:`1px solid ${ab?"rgba(0,232,122,.25)":no?"rgba(255,69,96,.25)":"transparent"}`,padding:"2px 4px",borderRadius:3}}>{ab?"▲":no?"▼":"—"}</span></div>; })}
                            <div style={{textAlign:"center"}}><McapBadge v={t.marketCap}/></div>
                            <div style={{display:"flex",justifyContent:"center"}}><SigBadge sig={t.sig}/></div>
                          </div>
                        ));
                      })()}
                      <div style={{display:"grid",gridTemplateColumns:"88px 82px repeat(8,60px)",padding:"6px 12px",gap:2,background:rowBg,borderTop:`1px solid ${T.border}`,alignItems:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>AVG</span><span/>
                        {[s.d1,s.d5,s.dMTD,s.d1m,s.d3m,s.d6m,s.dYTD,s.d1y].map((v,i) => <div key={i} style={{display:"flex",justifyContent:"center"}}><PCell v={v}/></div>)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div style={{display:"flex",gap:16,padding:"10px 14px",background:cardBg,border:`1px solid ${T.border}`,borderRadius:6,marginTop:8,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".06em"}}>RRG QUADRANTS:</span>
            {Object.entries(QC).map(([q,c]) => <span key={q} style={{fontFamily:"monospace",fontSize:8,color:c,background:`${c}15`,border:`1px solid ${c}30`,padding:"2px 7px",borderRadius:3}}>{q}</span>)}
            <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,marginLeft:"auto"}}>CYCLE: E=Early · M=Mid · L=Late · R=Recession</span>
            <span style={{fontFamily:"monospace",fontSize:8,color:T.accent,background:"rgba(0,232,122,.1)",padding:"2px 6px",borderRadius:3}}>THRUST = A/D ≥ 62% (Zweig breadth)</span>
          </div>
        </div>
      )}
      {view==="rrg" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
            <div style={{display:"flex",background:cardBg,border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden"}}>
              {[["sectors","SECTORS"],["industry","INDUSTRIES"]].map(([k,l]) => (
                <button key={k} onClick={()=>{ setRrgMode(k); setRrgData(null); setRrgHidden(new Set()); setRrgQuadFil([]); }} style={{fontFamily:"monospace",fontSize:9,padding:"7px 16px",border:"none",cursor:"pointer",background:rrgMode===k?"rgba(0,232,122,.15)":cardBg,color:rrgMode===k?T.accent:T.textDim,fontWeight:rrgMode===k?"700":"400",borderRight:k==="sectors"?`1px solid ${T.border}`:"none"}}>{l}</button>
              ))}
            </div>
            {rrgMode==="industry" && (
              <select value={rrgSector||""} onChange={e=>{setRrgSector(e.target.value||null);setRrgData(null);}} style={{fontFamily:"monospace",fontSize:9,padding:"7px 12px",border:`1px solid ${T.border}`,borderRadius:6,background:rrgSector?"rgba(0,232,122,.1)":cardBg,color:rrgSector?T.accent:T.textDim,cursor:"pointer",minWidth:160}}>
                <option value="">All Industries</option>{Object.keys(GICS).map(nm => <option key={nm} value={nm}>{nm}</option>)}
              </select>
            )}
            <div style={{display:"flex",gap:4,marginLeft:"auto",flexWrap:"wrap"}}>
              <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,display:"flex",alignItems:"center",paddingRight:6}}>SHOW:</span>
              {[["leading","LEADING",T.accent],["improving","IMPROVING","#4cc9f0"],["weakening","WEAKENING","#ff9f1c"],["lagging","LAGGING",T.down]].map(([k,l,c]) => {
                const active = rrgQuadFil.length===0 || rrgQuadFil.includes(k);
                return <button key={k} onClick={()=>{ setRrgQuadFil(prev => { if(prev.length===0) return [k]; if(prev.includes(k)){ const next=prev.filter(q=>q!==k); return next.length===0?[]:next; } const next=[...prev,k]; return next.length===4?[]:next; }); }} style={{fontFamily:"monospace",fontSize:8,padding:"5px 10px",border:"none",borderRadius:4,cursor:"pointer",background:active?`${c}18`:dark?T.border:"#eee",color:active?c:T.textGhost,outline:active?`1px solid ${c}40`:"none",fontWeight:active?"700":"400"}}>{l}</button>;
              })}
              {rrgQuadFil.length>0 && <button onClick={()=>setRrgQuadFil([])} style={{fontFamily:"monospace",fontSize:8,padding:"5px 8px",border:"none",borderRadius:4,cursor:"pointer",background:"rgba(255,255,255,.06)",color:T.textDim}}>ALL</button>}
            </div>
          </div>
          <div style={{display:"flex",gap:0,marginBottom:12,background:cardBg,border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden",alignItems:"stretch"}}>
            <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,padding:"7px 12px",borderRight:`1px solid ${T.border}`,display:"flex",alignItems:"center",whiteSpace:"nowrap",letterSpacing:".06em"}}>PERIOD</span>
            {[["1d","1D"],["1w","1W"],["mtd","MTD"],["1m","1M"],["3m","3M"],["6m","6M"],["ytd","YTD"],["1y","1Y"]].map(([k,l]) => <button key={k} onClick={()=>setRrgPeriod(k)} style={{flex:1,fontFamily:"monospace",fontSize:9,padding:"7px 0",border:"none",borderRight:`1px solid ${T.border}`,cursor:"pointer",background:rrgPeriod===k?"rgba(0,232,122,.14)":cardBg,color:rrgPeriod===k?T.accent:T.textDim,fontWeight:rrgPeriod===k?"700":"400"}}>{l}</button>)}
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"0 12px",borderLeft:`1px solid ${T.border}`}}>
              <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,whiteSpace:"nowrap"}}>{rrgMode==="industry"?(rrgSector||"ALL SECTORS"):"11 SECTOR ETFs"} · TRAIL=7pts</span>
              {rrgData && <span style={{fontFamily:"monospace",fontSize:8,color:T.accent,background:"rgba(0,232,122,.1)",padding:"2px 8px",borderRadius:3}}>LIVE ✓</span>}
              <button onClick={()=>loadRRG(rrgPeriod,rrgMode,rrgSector)} style={{fontFamily:"monospace",fontSize:9,padding:"4px 10px",background:"rgba(0,232,122,.1)",color:T.accent,border:"1px solid rgba(0,232,122,.25)",borderRadius:3,cursor:"pointer"}}>↺</button>
            </div>
          </div>
          <div style={{background:cardBg,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden",position:"relative"}}>
            {rrgLoading && <div style={{position:"absolute",inset:0,zIndex:10,display:"flex",alignItems:"center",justifyContent:"center",background:dark?"rgba(4,7,16,.85)":"rgba(255,255,255,.85)"}}><span style={{fontFamily:"monospace",fontSize:11,color:T.accent,letterSpacing:".1em"}}>CALCULATING RRG…</span></div>}
            <div style={{position:"relative",paddingTop:8,paddingBottom:32,paddingLeft:52,paddingRight:16}}>
              <div style={{position:"absolute",left:4,top:"50%",transform:"translateY(-50%) rotate(-90deg)",fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".06em",whiteSpace:"nowrap",transformOrigin:"center center"}}>JdK RS-MOMENTUM (100 = no change)</div>
              {!rrgData && !rrgLoading && <div style={{height:500,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontFamily:"monospace",fontSize:11,color:T.textFaint}}>Select a period above to load RRG</span></div>}
              {rrgData && (()=>{ const {etfs} = rrgData; const getQ = e => e.current.ratio>=100&&e.current.momentum>=100?"leading":e.current.ratio>=100&&e.current.momentum<100?"weakening":e.current.ratio<100&&e.current.momentum>=100?"improving":"lagging"; const visibleEtfs = Object.values(etfs).filter(e=>!rrgHidden.has(e.sym) && (rrgQuadFil.length===0 || rrgQuadFil.includes(getQ(e)))); const allRatios = visibleEtfs.flatMap(e=>e.trail.map(p=>p.ratio)); const allMoms = visibleEtfs.flatMap(e=>e.trail.map(p=>p.momentum)); const xDev = Math.max(...allRatios.map(v=>Math.abs(v-100)),2.5); const yDev = Math.max(...allMoms.map(v=>Math.abs(v-100)),2.5); const pad=0.8; const halfRange = Math.max(xDev,yDev)+pad; const xMin=100-halfRange, xMax=100+halfRange, yMin=100-halfRange, yMax=100+halfRange; const W=840,H=520,PL=40,PR=10,PT=10,PB=24,plotW=W-PL-PR,plotH=H-PT-PB; const toX=v=>PL+((v-xMin)/(xMax-xMin))*plotW; const toY=v=>PT+plotH-((v-yMin)/(yMax-yMin))*plotH; const cx100=toX(100), cy100=toY(100); const range=xMax-xMin; const step=range>10?2:range>6?1:0.5; const yTicks=[], xTicks=[]; for(let v=Math.ceil(xMin/step)*step; v<=xMax; v=+(v+step).toFixed(2)){ xTicks.push(v); yTicks.push(v); } return (
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",maxHeight:"calc(100vh - 220px)"}}>
                  <rect x={PL} y={PT} width={cx100-PL} height={cy100-PT} fill="rgba(76,201,240,0.06)"/>
                  <rect x={cx100} y={PT} width={W-PR-cx100} height={cy100-PT} fill="rgba(0,232,122,0.06)"/>
                  <rect x={PL} y={cy100} width={cx100-PL} height={H-PB-cy100} fill="rgba(255,69,96,0.06)"/>
                  <rect x={cx100} y={cy100} width={W-PR-cx100} height={H-PB-cy100} fill="rgba(255,159,28,0.06)"/>
                  <text x={PL+10} y={PT+18} style={{fontFamily:"monospace",fontSize:11,fill:"#4cc9f0",opacity:.55}}>IMPROVING</text>
                  <text x={PL+10} y={PT+30} style={{fontFamily:"monospace",fontSize:8,fill:"#4cc9f0",opacity:.3}}>(underperforming·improving)</text>
                  <text x={W-PR-10} y={PT+18} textAnchor="end" style={{fontFamily:"monospace",fontSize:11,fill:T.accent,opacity:.55}}>LEADING</text>
                  <text x={W-PR-10} y={PT+30} textAnchor="end" style={{fontFamily:"monospace",fontSize:8,fill:T.accent,opacity:.3}}>(outperforming·improving)</text>
                  <text x={PL+10} y={H-PB-18} style={{fontFamily:"monospace",fontSize:11,fill:T.down,opacity:.55}}>LAGGING</text>
                  <text x={PL+10} y={H-PB-6} style={{fontFamily:"monospace",fontSize:8,fill:T.down,opacity:.3}}>(underperforming·declining)</text>
                  <text x={W-PR-10} y={H-PB-18} textAnchor="end" style={{fontFamily:"monospace",fontSize:11,fill:"#ff9f1c",opacity:.55}}>WEAKENING</text>
                  <text x={W-PR-10} y={H-PB-6} textAnchor="end" style={{fontFamily:"monospace",fontSize:8,fill:"#ff9f1c",opacity:.3}}>(outperforming·declining)</text>
                  {yTicks.map(v=><g key={v}><line x1={PL} x2={W-PR} y1={toY(v)} y2={toY(v)} stroke={v===100?"rgba(255,255,255,.2)":dark?"rgba(255,255,255,.04)":"rgba(0,0,0,.06)"} strokeWidth={v===100?1.2:.5} strokeDasharray={v===100?"6 4":undefined}/><text x={PL-4} y={toY(v)+4} textAnchor="end" style={{fontFamily:"monospace",fontSize:8,fill:dark?"rgba(255,255,255,.35)":"rgba(0,0,0,.35)"}}>{v}</text></g>)}
                  {xTicks.map(v=><g key={v}><line x1={toX(v)} x2={toX(v)} y1={PT} y2={H-PB} stroke={v===100?"rgba(255,255,255,.2)":dark?"rgba(255,255,255,.04)":"rgba(0,0,0,.06)"} strokeWidth={v===100?1.2:.5} strokeDasharray={v===100?"6 4":undefined}/><text x={toX(v)} y={H-PB+14} textAnchor="middle" style={{fontFamily:"monospace",fontSize:8,fill:dark?"rgba(255,255,255,.35)":"rgba(0,0,0,.35)"}}>{v}</text></g>)}
                  <text x={cx100+4} y={PT+10} style={{fontFamily:"monospace",fontSize:8,fill:dark?"rgba(255,255,255,.4)":"rgba(0,0,0,.4)"}}>100</text>
                  <text x={PL+4} y={cy100-4} style={{fontFamily:"monospace",fontSize:8,fill:dark?"rgba(255,255,255,.4)":"rgba(0,0,0,.4)"}}>100</text>
                  {(()=>{ const n=visibleEtfs.length; const R=n<=3?20:n<=6?16:n<=10?14:n<=15?12:10; const TRAIL_R=n<=6?3.5:n<=15?2.5:2; const FS_SYM=n<=6?10:n<=15?9:7; const FS_LBL=n<=6?7:6; const SHOW_LBL=n<=20; return visibleEtfs.map(etf=>{ const trail=etf.trail; if(!trail.length) return null; const current=trail[trail.length-1]; const cx=toX(current.ratio), cy=toY(current.momentum); const pts=trail.map(p=>`${toX(p.ratio).toFixed(1)},${toY(p.momentum).toFixed(1)}`).join(' '); const q=getQ(etf); const qColor=q==="leading"?T.accent:q==="improving"?"#4cc9f0":q==="weakening"?"#ff9f1c":T.down; return(<g key={etf.sym}>{trail.length>1 && <polyline points={pts} fill="none" stroke={etf.color} strokeWidth={n>15?"1":"1.5"} opacity=".45" strokeLinejoin="round" strokeLinecap="round"/>}{trail.slice(0,-1).map((p,i)=><circle key={i} cx={toX(p.ratio)} cy={toY(p.momentum)} r={TRAIL_R*(0.5+0.5*(i+1)/trail.length)} fill={etf.color} opacity={0.15+0.55*(i/(trail.length-1))}/>)}<circle cx={cx} cy={cy} r={R} fill={etf.color} fillOpacity=".2" stroke={qColor} strokeWidth="1.5" style={{filter:`drop-shadow(0 0 4px ${etf.color}60)`}}/>{trail.length>=2 && (()=>{const prev=trail[trail.length-2]; const px=toX(prev.ratio), py=toY(prev.momentum); const dx=cx-px, dy=cy-py; const len=Math.sqrt(dx*dx+dy*dy)||1; const nx=dx/len, ny=dy/len; const ax=cx-nx*(R+2), ay=cy-ny*(R+2); return <line x1={px} y1={py} x2={ax} y2={ay} stroke={etf.color} strokeWidth="2" opacity=".7" markerEnd="url(#arr)"/>;})()}<text x={cx} y={cy+(SHOW_LBL&&rrgMode==="industry"&&etf.label&&etf.label!==etf.sym?-3:1)} textAnchor="middle" dominantBaseline="central" style={{fontFamily:"monospace",fontSize:FS_SYM,fontWeight:"700",fill:"#fff",pointerEvents:"none",textShadow:"0 1px 2px rgba(0,0,0,.9)"}}>{etf.sym}</text>{SHOW_LBL&&rrgMode==="industry"&&etf.label&&etf.label!==etf.sym && <text x={cx} y={cy+FS_SYM-2} textAnchor="middle" style={{fontFamily:"monospace",fontSize:FS_LBL,fill:"rgba(255,255,255,.65)",pointerEvents:"none"}}>{etf.label.substring(0,n<=10?12:8)}</text>}</g>);})})()}
                  <defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></marker></defs>
                </svg>
              ); })()}
              <div style={{textAlign:"center",marginTop:6,fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".06em"}}>JdK RS-RATIO (100 = no change vs SPY)</div>
            </div>
            {rrgData && (
              <div style={{padding:"10px 14px",borderTop:`1px solid ${T.border}`,background:rowBg}}>
                {[["leading","LEADING",T.accent],["improving","IMPROVING","#4cc9f0"],["weakening","WEAKENING","#ff9f1c"],["lagging","LAGGING",T.down]].map(([q,ql,qc])=>{
                  const group = Object.values(rrgData.etfs).filter(e=>{ const eq=e.current.ratio>=100&&e.current.momentum>=100?"leading":e.current.ratio>=100&&e.current.momentum<100?"weakening":e.current.ratio<100&&e.current.momentum>=100?"improving":"lagging"; return eq===q; });
                  if(!group.length) return null;
                  return <div key={q} style={{marginBottom:6}}><div style={{fontFamily:"monospace",fontSize:7.5,color:qc,letterSpacing:".1em",marginBottom:4,fontWeight:700}}>{ql} ({group.length})</div><div style={{display:"flex",flexWrap:"wrap",gap:5}}>{group.sort((a,b)=>b.current.ratio-a.current.ratio).map(etf=>{ const hidden=rrgHidden.has(etf.sym); return <div key={etf.sym} onClick={()=>setRrgHidden(prev=>{ const s=new Set(prev); if(s.has(etf.sym)) s.delete(etf.sym); else s.add(etf.sym); return s; })} title="Click to hide/show" style={{display:"flex",alignItems:"center",gap:5,background:hidden?"transparent":cardBg,border:`1px solid ${hidden?T.border:etf.color+"40"}`,borderRadius:4,padding:"3px 8px",cursor:"pointer",opacity:hidden?0.35:1,transition:"all .15s"}}><div style={{width:7,height:7,borderRadius:"50%",background:hidden?T.textDim:etf.color,flexShrink:0}}/><span style={{fontFamily:"monospace",fontSize:9,color:hidden?T.textGhost:T.text,fontWeight:700}}>{etf.sym}</span>{rrgMode==="industry"&&etf.label&&etf.label!==etf.sym && <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>{etf.label.substring(0,10)}</span>}{rrgMode==="sectors" && <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>{(etf.sector||"").substring(0,10)}</span>}<span style={{fontFamily:"monospace",fontSize:7.5,color:T.textGhost}}>{etf.current.ratio.toFixed(1)}/{etf.current.momentum.toFixed(1)}</span></div>;})}</div></div>;
                })}
                {rrgHidden.size>0 && <button onClick={()=>setRrgHidden(new Set())} style={{fontFamily:"monospace",fontSize:8,padding:"3px 10px",border:"none",background:"rgba(255,255,255,.06)",color:T.textDim,borderRadius:3,cursor:"pointer",marginTop:4}}>SHOW ALL ({rrgHidden.size} hidden)</button>}
              </div>
            )}
          </div>
        </div>
      )}
      {view==="industry" && (
        <div>
          <div style={{display:"flex",gap:0,marginBottom:10,background:cardBg,border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden",alignItems:"stretch"}}>
            <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,padding:"7px 10px",borderRight:`1px solid ${T.border}`,display:"flex",alignItems:"center",whiteSpace:"nowrap"}}>PERIOD</span>
            {[["1d","1D"],["1w","1W"],["mtd","MTD"],["1m","1M"],["3m","3M"],["6m","6M"],["ytd","YTD"]].map(([k,l])=> <button key={k} onClick={()=>setIndPeriod(k)} style={{fontFamily:"monospace",fontSize:9,padding:"7px 10px",border:"none",borderRight:`1px solid ${T.border}`,cursor:"pointer",background:indPeriod===k?"rgba(0,232,122,.14)":cardBg,color:indPeriod===k?T.accent:T.textDim,fontWeight:indPeriod===k?"700":"400"}}>{l}</button>)}
            <select value={indSec||""} onChange={e=>setIndSec(e.target.value||null)} style={{fontFamily:"monospace",fontSize:9,padding:"0 10px",border:"none",background:indSec?"rgba(0,232,122,.1)":cardBg,color:indSec?T.accent:T.textDim,borderLeft:`1px solid ${T.border}`,cursor:"pointer",minWidth:130}}><option value="">All Sectors</option>{Object.keys(GICS).map(nm=><option key={nm} value={nm}>{nm}</option>)}</select>
            <select value={indSort} onChange={e=>setIndSort(e.target.value)} style={{fontFamily:"monospace",fontSize:9,padding:"0 10px",border:"none",background:cardBg,color:T.textDim,borderLeft:`1px solid ${T.border}`,cursor:"pointer",minWidth:120}}><option value="periodAvg">Sort: % Change</option><option value="avgRV">Sort: Rel Vol</option><option value="n">Sort: # Tickers</option><option value="adv">Sort: Advancing</option></select>
            <button onClick={()=>setIndSortDir(d=>-d)} style={{fontFamily:"monospace",fontSize:10,padding:"0 10px",border:"none",borderLeft:`1px solid ${T.border}`,cursor:"pointer",background:cardBg,color:T.textDim}}>{indSortDir<0?"↓":"↑"}</button>
            <button onClick={loadLiveInds} style={{fontFamily:"monospace",fontSize:9,padding:"0 12px",border:"none",borderLeft:`1px solid ${T.border}`,cursor:"pointer",background:"rgba(0,232,122,.1)",color:T.accent}}>{indLoading?"…":"↺"}</button>
          </div>
          {indLoading && <div style={{textAlign:"center",padding:40,fontFamily:"monospace",fontSize:11,color:T.accent,letterSpacing:".1em"}}>SCANNING LIVE INDUSTRIES…</div>}
          {!indLoading && (()=>{
            const periodKey=indPeriod==="1d"?"change":indPeriod==="1w"?"d5":indPeriod==="mtd"?"dMTD":indPeriod==="1m"?"d1m":indPeriod==="3m"?"d3m":indPeriod==="6m"?"d6m":indPeriod==="ytd"?"dYTD":"change";
            const computed=liveInds.filter(ind=>!indSec||ind.sector===indSec).map(ind=>{ const n=ind.tickers.length; const pVals=ind.tickers.map(t=>t[periodKey]||t.change||0); const periodAvg=+(pVals.reduce((a,b)=>a+b,0)/n).toFixed(2); return {...ind,periodAvg}; });
            const leading=computed.filter(i=>i.periodAvg>0).sort((a,b)=>indSortDir*((b[indSort]??b.periodAvg)-(a[indSort]??a.periodAvg)));
            const lagging=computed.filter(i=>i.periodAvg<0).sort((a,b)=>indSortDir*((a[indSort]??a.periodAvg)-(b[indSort]??b.periodAvg)));
            const ROW=(ind,col)=>{
              const c=secCol(ind.sector);
              const gd=Object.entries(GICS).find(([nm])=>nm===ind.sector)?.[1];
              const etfD=gd?etfQuotes[gd.etf]:null;
              return <div key={ind.industry} style={{display:"grid",gridTemplateColumns:"1fr 72px 60px 56px 56px 86px",padding:"7px 12px",borderBottom:`1px solid ${T.border}`,alignItems:"center",transition:"background .1s"}} onMouseEnter={e=>e.currentTarget.style.background=`${col}06`} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <div><div style={{fontFamily:"monospace",fontSize:10,color:T.text}}>{ind.industry.substring(0,28)}</div><div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>{ind.n} stocks · {ind.sector?.substring(0,16)} · top: {ind.topMover?.symbol}</div></div>
                <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:ind.periodAvg>0?T.accent:T.down,textAlign:"center",display:"block"}}>{ind.periodAvg>=0?"+":""}{ind.periodAvg.toFixed(1)}%</span>
                <span style={{fontFamily:"monospace",fontSize:10,color:ind.avgRV>=2?"#ff9f1c":T.textMid,fontWeight:700,textAlign:"center",display:"block"}}>{ind.avgRV.toFixed(1)}×</span>
                <span style={{fontFamily:"monospace",fontSize:9,color:T.accent,textAlign:"center",display:"block",fontWeight:700}}>{ind.adv}▲</span>
                <span style={{fontFamily:"monospace",fontSize:9,color:T.down,textAlign:"center",display:"block",fontWeight:700}}>{ind.dec}▼</span>
                <div style={{display:"flex",gap:4,alignItems:"center"}}>{gd && <span style={{fontFamily:"monospace",fontSize:8,color:c,background:`${c}18`,border:`1px solid ${c}28`,padding:"1px 4px",borderRadius:2}}>{gd.etf}</span>}{etfD && <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,color:etfD.d1>0?T.accent:etfD.d1<0?T.down:T.textMid}}>{etfD.d1>=0?"+":""}{etfD.d1.toFixed(1)}%</span>}</div>
              </div>;
            };
            const HDR = cols => <div style={{display:"grid",gridTemplateColumns:"1fr 72px 60px 56px 56px 86px",padding:"5px 12px",background:rowBg,borderBottom:`1px solid ${T.border}`}}>{cols.map(h=><span key={h} style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>{h}</span>)}</div>;
            return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div style={{background:cardBg,border:"1px solid rgba(0,232,122,.2)",borderRadius:8,overflow:"hidden"}}><div style={{fontFamily:"monospace",fontSize:8,color:T.accent,padding:"8px 12px",borderBottom:"1px solid rgba(0,232,122,.2)",background:"rgba(0,232,122,.07)",display:"flex",justifyContent:"space-between"}}><span>▲ LEADING — {indPeriod.toUpperCase()} ({leading.length} industries)</span><span style={{color:"rgba(0,232,122,.4)",fontSize:7}}>live US screener</span></div>{HDR(["INDUSTRY / SECTOR","CHG","REL VOL","ADV","DEC","SECTOR ETF"])}{leading.map(i=>ROW(i,T.accent))}{leading.length===0 && <div style={{padding:20,textAlign:"center",fontFamily:"monospace",fontSize:10,color:T.textFaint}}>No leading industries for {indPeriod.toUpperCase()}</div>}</div>
              <div style={{background:cardBg,border:"1px solid rgba(255,69,96,.2)",borderRadius:8,overflow:"hidden"}}><div style={{fontFamily:"monospace",fontSize:8,color:T.down,padding:"8px 12px",borderBottom:"1px solid rgba(255,69,96,.2)",background:"rgba(255,69,96,.07)",display:"flex",justifyContent:"space-between"}}><span>▼ LAGGING — {indPeriod.toUpperCase()} ({lagging.length} industries)</span><span style={{color:"rgba(255,69,96,.4)",fontSize:7}}>live US screener</span></div>{HDR(["INDUSTRY / SECTOR","CHG","REL VOL","ADV","DEC","SECTOR ETF"])}{lagging.map(i=>ROW(i,T.down))}{lagging.length===0 && <div style={{padding:20,textAlign:"center",fontFamily:"monospace",fontSize:10,color:T.textFaint}}>No lagging industries for {indPeriod.toUpperCase()}</div>}</div>
            </div>;
          })()}
        </div>
      )}
    </div>
  );
}