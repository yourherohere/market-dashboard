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

// ─── FIXED: heat function using CSS variables ─────────────────────────────────
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
  const colors = { BREAKOUT:"var(--clr-up)", "BUY ZONE":"var(--clr-up)", PULLBACK:"#ff9f1c", BREAKDOWN:"var(--clr-dn)" };
  const c = colors[sig] || "var(--clr-mid)";
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

// ─── FIXED: MULTI-SELECT DROPDOWN (parameter renamed to propColor) ─────────────
function MultiSelectDropdown({ label, options, selected, onChange, propColor, width=200 }) {
  const _tk2 = useTheme();
  const T2   = THEME[_tk2] || THEME.night;
  const _color = propColor || T2.accent;
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
        style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",background:T2.inputBg,
          border:`1px solid ${selCount>0?_color+"44":T2.border2}`,borderRadius:4,padding:"6px 10px",
          width,boxSizing:"border-box",boxShadow:selCount>0?`0 0 8px ${_color}18`:"none"}}>
        <span style={{fontFamily:"monospace",fontSize:9,color:selCount>0?_color:T2.textDim,flex:1,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",letterSpacing:".04em"}}>
          {selCount===0?`ALL ${label.toUpperCase()}S`:selCount===1?selected[0]:`${selCount} ${label}s`}
        </span>
        {selCount>0&&<span onClick={clearAll} style={{color:T2.textDim,fontSize:12,cursor:"pointer"}}>×</span>}
        <span style={{color:T2.textFaint,fontSize:9}}>{open?"▲":"▼"}</span>
      </div>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,zIndex:1000,background:T2.bg,
          border:`1px solid ${T2.border2}`,borderRadius:5,width:Math.max(width,240),maxHeight:260,
          overflowY:"auto",boxShadow:"0 8px 32px rgba(0,0,0,.7)"}}>
          <div style={{padding:"6px 10px",borderBottom:"1px solid #0d1a26",display:"flex",gap:8}}>
            <span onClick={()=>onChange(options)} style={{fontFamily:"monospace",fontSize:8,color:_color,cursor:"pointer"}}>ALL</span>
            <span style={{color:T2.border2}}>|</span>
            <span onClick={()=>onChange([])} style={{fontFamily:"monospace",fontSize:8,color:T2.textDim,cursor:"pointer"}}>NONE</span>
          </div>
          {options.map(opt=>(
            <div key={opt} onClick={()=>toggle(opt)}
              style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",cursor:"pointer",
                background:selected.includes(opt)?`${_color}0e`:"transparent",borderBottom:`1px solid ${T2.border}`}}
              onMouseEnter={e=>{ if(!selected.includes(opt)) e.currentTarget.style.background=T2.border; }}
              onMouseLeave={e=>{ e.currentTarget.style.background=selected.includes(opt)?`${_color}0e`:"transparent"; }}>
              <div style={{width:12,height:12,borderRadius:2,flexShrink:0,background:selected.includes(opt)?_color:"transparent",
                border:`1.5px solid ${selected.includes(opt)?_color:T2.border2}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {selected.includes(opt)&&<span style={{color:"#000",fontSize:9,fontWeight:900,lineHeight:1}}>✓</span>}
              </div>
              <span style={{fontFamily:"monospace",fontSize:9,color:selected.includes(opt)?T2.text:T2.textDim,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{opt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MAIN ROTATION TAB (rest of the component unchanged) ─────────────────────
export default function RotationTab({ etfQuotes = {} }) {
  const themeKey = useTheme();
  const T = THEME[themeKey] || THEME.night;
  const dark = themeKey === "night";

  const [rotData, setRotData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState("overview");
  const [selSec,  setSelSec]  = useState(null);
  const [sortInd, setSortInd] = useState("avgChg");
  const [etfSort, setEtfSort] = useState("d1");
  const [etfSortDir,setEtfSortDir] = useState(-1);
  const timerRef = useRef(null);

  const cardBg = dark ? T.surface : T.surface;
  const rowBg  = dark ? T.row : T.row;

  const load = useCallback(async (silent=false) => {
    if (!silent) setLoading(true);
    try {
      const [GR,LR,VR] = await Promise.allSettled([
        apiFetch("/api/scan/gainers?minPrice=1&minVol=100000&limit=150"),
        apiFetch("/api/scan/losers?minPrice=1&minVol=100000&limit=150"),
        apiFetch("/api/scan/volume?minRelVol=1.5&minPrice=1&limit=150"),
      ]);
      const gainers = GR.value?.results || [];
      const losers  = LR.value?.results || [];
      const volList = VR.value?.results || [];

      const bySymbol = {};
      [...gainers,...losers,...volList].forEach(t=>{if(!bySymbol[t.symbol])bySymbol[t.symbol]=t;});
      const all = Object.values(bySymbol).filter(t=>t.sector);

      const secMap = {};
      all.forEach(t=>{
        const s=t.sector;
        if(!secMap[s]) secMap[s]={sector:s,all:[],adv:[],dec:[],volTickers:[]};
        secMap[s].all.push(t);
        if(t.change>0) secMap[s].adv.push(t);
        if(t.change<0) secMap[s].dec.push(t);
      });
      volList.filter(t=>t.sector).forEach(t=>{
        const s=t.sector;
        if(secMap[s]&&!secMap[s].volTickers.find(x=>x.symbol===t.symbol)) secMap[s].volTickers.push(t);
      });

      const indMap = {};
      all.filter(t=>t.industry).forEach(t=>{
        const k=`${t.sector}|${t.industry}`;
        if(!indMap[k]) indMap[k]={industry:t.industry,sector:t.sector,tickers:[]};
        indMap[k].tickers.push(t);
      });

      const sectors = Object.values(secMap).filter(s=>s.all.length>=1).map(s=>{
        const n=s.all.length;
        const adv=s.adv.length, dec=s.dec.length;
        const avgChg=+(s.all.reduce((a,t)=>a+t.change,0)/n).toFixed(2);
        const avgRV=+(s.all.reduce((a,t)=>a+(t.relVol||1),0)/n).toFixed(2);
        const adPct=Math.round(adv/n*100);
        const chgS=Math.max(0,Math.min(40,avgChg*4+20));
        const adS=adPct*0.35, rvS=Math.min(avgRV/4*25,25);
        const score=Math.round(chgS+adS+rvS);

        const gicsDef = GICS[s.sector] || null;
        const etfSym = gicsDef?.etf || null;
        const etf = etfSym ? etfQuotes[etfSym] : null;

        const subEtfData = gicsDef?.subEtfs?.map(se=>({
          ...se,
          data: etfQuotes[se.sym] || null,
        })) || [];

        const sectorInds = Object.values(indMap)
          .filter(i=>i.sector===s.sector)
          .map(i=>{
            const n2=i.tickers.length;
            return {
              ...i, n: n2,
              avgChg: +(i.tickers.reduce((a,t)=>a+t.change,0)/n2).toFixed(2),
              avgRV:  +(i.tickers.reduce((a,t)=>a+(t.relVol||1),0)/n2).toFixed(2),
              adv: i.tickers.filter(t=>t.change>0).length,
              dec: i.tickers.filter(t=>t.change<0).length,
              topMover: [...i.tickers].sort((a,b)=>Math.abs(b.change)-Math.abs(a.change))[0],
            };
          }).sort((a,b)=>b.avgChg-a.avgChg);

        return {
          sector:s.sector, n, adv, dec, avgChg, avgRV, adPct, score,
          topG:[...s.adv].sort((a,b)=>b.change-a.change)[0]||null,
          topL:[...s.dec].sort((a,b)=>a.change-b.change)[0]||null,
          topV:[...s.all].sort((a,b)=>(b.relVol||0)-(a.relVol||0))[0]||null,
          gainers:s.adv, losers:s.dec, volTickers:s.volTickers, all:s.all,
          status:score>=62?"LEADING":score>=38?"NEUTRAL":"LAGGING",
          etfSym, etf, subEtfData, sectorInds,
          gicsDef, gicsCode: gicsDef?.code,
          color: gicsDef?.color || secCol(s.sector),
        };
      }).sort((a,b)=>b.score-a.score);

      const allInds = Object.values(indMap).map(i=>{
        const n=i.tickers.length;
        return{...i,n,avgChg:+(i.tickers.reduce((a,t)=>a+t.change,0)/n).toFixed(2),
          avgRV:+(i.tickers.reduce((a,t)=>a+(t.relVol||1),0)/n).toFixed(2),
          adv:i.tickers.filter(t=>t.change>0).length,
          dec:i.tickers.filter(t=>t.change<0).length,
          topMover:[...i.tickers].sort((a,b)=>Math.abs(b.change)-Math.abs(a.change))[0]};
      }).filter(i=>i.n>=1);

      setRotData({sectors,allInds,gainers,losers,volList,ts:new Date()});
      setSelSec(null);
    } catch(e){console.error(e);}
    finally{setLoading(false);}
  },[etfQuotes]);

  useEffect(()=>{load();},[]);
  useEffect(()=>{
    timerRef.current=setInterval(()=>load(true),90_000);
    return()=>clearInterval(timerRef.current);
  },[load]);

  if(loading&&!rotData) return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:80,gap:18}}>
      <div style={{display:"flex",gap:6}}>{[0,1,2,3,4].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:T.accent,animation:`bn 1s ${i*.15}s infinite`}}/>)}</div>
      <span style={{fontFamily:"monospace",fontSize:12,color:T.accent,letterSpacing:".1em"}}>SCANNING SECTOR ROTATION…</span>
    </div>
  );
  if(!rotData) return null;
  const {sectors,allInds,gainers,losers,volList,ts}=rotData;
  const leading=sectors.filter(s=>s.status==="LEADING");
  const neutral=sectors.filter(s=>s.status==="NEUTRAL");
  const lagging=sectors.filter(s=>s.status==="LAGGING");
  const sel=selSec?sectors.find(s=>s.sector===selSec):null;

  function PCell({v,big}){
    if(v==null) return <span style={{fontFamily:"monospace",fontSize:9,color:T.textGhost}}>—</span>;
    const c=v>5?T.accent:v>0?T.accent:v>-5?"#ff9f1c":T.down;
    const bg=v>5?"rgba(0,232,122,.12)":v>0?"rgba(77,219,158,.09)":v>-5?"rgba(255,159,28,.09)":"rgba(255,69,96,.09)";
    return<span style={{fontFamily:"monospace",fontSize:big?12:10,fontWeight:big?"700":"500",
      color:c,background:bg,padding:"2px 5px",borderRadius:3,whiteSpace:"nowrap"}}>
      {v>=0?"+":""}{v.toFixed(1)}%
    </span>;
  }

  function EtfBadge({etf,sym,fullName}){
    if(!etf) return<span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>{sym||"—"}</span>;
    const c=etf.d1>0?T.accent:etf.d1<0?T.down:T.textMid;
    return(
      <div style={{display:"flex",alignItems:"center",gap:5,background:cardBg,
        border:`1px solid ${c}30`,borderRadius:4,padding:"4px 8px",minWidth:0}}>
        <div>
          <span style={{fontFamily:"monospace",fontSize:10,fontWeight:700,color:T.text}}>{sym}</span>
          {fullName&&<span style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,display:"block",
            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:120}}>{fullName}</span>}
        </div>
        <div style={{marginLeft:"auto",textAlign:"right"}}>
          <div style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:c}}>
            {etf.d1>=0?"+":""}{etf.d1.toFixed(2)}%
          </div>
          <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>${etf.price.toFixed(2)}</div>
        </div>
      </div>
    );
  }

  const VIEW_BTNS=[["overview","OVERVIEW"],["etf","ETF DASHBOARD"],["industry","INDUSTRY DRILL"],["heatmap","HEAT MAP"]];

  return(
    <div>
      <div style={{display:"flex",gap:0,marginBottom:14,background:cardBg,border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden"}}>
        {VIEW_BTNS.map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)}
            style={{flex:1,fontFamily:"monospace",fontSize:9,padding:"8px 0",border:"none",
              borderRight:k!=="heatmap"?`1px solid ${T.border}`:"none",cursor:"pointer",
              background:view===k?"rgba(0,232,122,.12)":cardBg,
              color:view===k?T.accent:T.textDim,fontWeight:view===k?"700":"400",
              letterSpacing:".06em",
              borderBottom:view===k?"2px solid #00e87a":"2px solid transparent"}}>
            {l}
          </button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10,padding:"0 14px",borderLeft:`1px solid ${T.border}`}}>
          <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>
            {ts.toLocaleTimeString()} · GICS standard
          </span>
          <button onClick={()=>load()}
            style={{fontFamily:"monospace",fontSize:9,padding:"4px 12px",background:"rgba(0,232,122,.1)",
              color:T.accent,border:"1px solid rgba(0,232,122,.25)",borderRadius:3,cursor:"pointer"}}>
            ↺
          </button>
        </div>
      </div>

      {view==="overview"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:cardBg,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
            <div style={{display:"grid",
              gridTemplateColumns:"170px 80px 70px 60px 60px 70px 80px 80px 90px 120px",
              padding:"8px 16px",background:rowBg,borderBottom:`2px solid ${T.border2}`,gap:4,alignItems:"center"}}>
              {["SECTOR / ETF","1D CHG","1W","1M","3M","YTD","A/D%","REL VOL","SCORE","STATUS"].map((h,i)=>(
                <span key={h} style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,
                  letterSpacing:".08em",textAlign:i>=2?"center":"left"}}>{h}</span>
              ))}
            </div>

            {sectors.map((s,i)=>{
              const sc=s.status==="LEADING"?T.accent:s.status==="NEUTRAL"?"#ffe040":T.down;
              const isSelected=selSec===s.sector;
              const etfD1 = s.etf?.d1;
              return(
                <div key={s.sector}>
                  <div
                    onClick={()=>setSelSec(isSelected?null:s.sector)}
                    style={{display:"grid",
                      gridTemplateColumns:"170px 80px 80px 70px 60px 60px 70px 80px 80px 90px 120px",
                      padding:"9px 16px",gap:4,alignItems:"center",
                      borderBottom:i<sectors.length-1?`1px solid ${T.border}`:"none",
                      cursor:"pointer",transition:"background .12s",
                      borderLeft:`4px solid ${s.color}`,
                      background:isSelected?`${s.color}0d`:"transparent"}}
                    onMouseEnter={e=>{if(!isSelected)e.currentTarget.style.background=`${s.color}07`;}}
                    onMouseLeave={e=>{if(!isSelected)e.currentTarget.style.background="transparent";}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:T.text}}>{s.sector}</span>
                        {s.etfSym&&(
                          <span style={{fontFamily:"monospace",fontSize:8,color:s.color,
                            background:`${s.color}18`,border:`1px solid ${s.color}30`,
                            padding:"1px 5px",borderRadius:2}}>{s.etfSym}</span>
                        )}
                      </div>
                      <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,marginTop:1}}>
                        {s.n} live tickers · {s.sectorInds.length} industries
                      </div>
                    </div>
                    <div style={{textAlign:"center"}}><PCell v={s.avgChg} big/></div>
                    {[null,null,null,null].map((_,j)=>{
                      const keys=["d5","d1m","d3m","dYTD"];
                      const v=s.etf?s.etf[keys[j]]:null;
                      return<div key={j} style={{textAlign:"center"}}><PCell v={v}/></div>;
                    })}
                    <div style={{display:"flex",flexDirection:"column",gap:2,alignItems:"center"}}>
                      <div style={{width:"100%",height:4,background:T.border,borderRadius:2,overflow:"hidden"}}>
                        <div style={{width:`${s.adPct}%`,height:"100%",borderRadius:2,
                          background:s.adPct>=70?T.accent:s.adPct>=50?"#ffe040":T.down}}/>
                      </div>
                      <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
                        color:s.adPct>=70?T.accent:s.adPct>=50?"#ffe040":T.down}}>{s.adPct}%</span>
                    </div>
                    <div style={{textAlign:"center"}}>
                      <span style={{fontFamily:"monospace",fontSize:11,
                        color:s.avgRV>=2?"#ff9f1c":s.avgRV>=1.5?"#ffe040":T.textMid,fontWeight:700}}>
                        {s.avgRV.toFixed(1)}×
                      </span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <div style={{flex:1,height:6,background:T.border,borderRadius:3,overflow:"hidden"}}>
                        <div style={{width:`${s.score}%`,height:"100%",background:sc,borderRadius:3,transition:"width .8s"}}/>
                      </div>
                      <span style={{fontFamily:"monospace",fontSize:10,fontWeight:700,color:sc,minWidth:20}}>{s.score}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"center"}}>
                      <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,color:sc,
                        background:`${sc}15`,border:`1px solid ${sc}33`,padding:"3px 10px",borderRadius:3}}>
                        {s.status}
                      </span>
                    </div>
                  </div>

                  {s.etf&&(
                    <div style={{display:"grid",
                      gridTemplateColumns:"170px 80px 80px 70px 60px 60px 70px 80px 80px 90px 120px",
                      padding:"5px 16px 5px 20px",gap:4,alignItems:"center",
                      borderBottom:`1px solid ${T.border}`,
                      background:dark?"rgba(255,255,255,.015)":T.surface2}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:2,height:16,background:s.color,opacity:.4,borderRadius:1,flexShrink:0}}/>
                        <div>
                          <span style={{fontFamily:"monospace",fontSize:9,color:s.color,fontWeight:700}}>{s.etfSym}</span>
                          <span style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,marginLeft:5}}>{s.gicsDef?.etfFull?.substring(0,28)}</span>
                        </div>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>ETF BENCH</span>
                      </div>
                      {["d1","d5","d1m","d3m","dYTD"].map(k=>(
                        <div key={k} style={{textAlign:"center"}}><PCell v={s.etf[k]}/></div>
                      ))}
                      <div style={{textAlign:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>
                          {s.etf.a50!=null?(s.etf.a50?"50D ▲":"50D ▼"):""}
                        </span>
                      </div>
                      <div style={{textAlign:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>
                          ${s.etf.price.toFixed(2)}
                        </span>
                      </div>
                      <div/>
                      <div/>
                    </div>
                  )}

                  {isSelected&&sel&&(
                    <div style={{borderBottom:`1px solid ${s.color}22`,background:dark?T.inputBg:T.surface2}}>
                      <div style={{padding:"12px 16px",background:`${s.color}0e`,
                        borderBottom:`1px solid ${s.color}22`,display:"flex",flexWrap:"wrap",gap:12,alignItems:"flex-start"}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                            <div style={{width:4,height:28,background:s.color,borderRadius:2}}/>
                            <div>
                              <div style={{fontFamily:"monospace",fontSize:13,color:T.text,fontWeight:700}}>
                                {s.sector}
                              </div>
                              <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>
                                {s.gicsDef?.gicsDesc||""}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                          {[["▲ TOP GAINER",sel.topG,T.accent],
                            ["▼ TOP LOSER", sel.topL,T.down],
                            ["◉ HIGHEST VOL",sel.topV,"#ff9f1c"]].map(([lbl,t,col])=>t&&(
                            <div key={lbl} style={{background:cardBg,border:`1px solid ${col}22`,borderRadius:5,padding:"7px 12px",minWidth:100}}>
                              <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,letterSpacing:".06em",marginBottom:3}}>{lbl}</div>
                              <div style={{fontFamily:"monospace",fontSize:13,color:T.text,fontWeight:700}}>{t.symbol}</div>
                              <div style={{fontFamily:"monospace",fontSize:11,color:col,fontWeight:700}}>{pct(t.change)}</div>
                              {t.industry&&<div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,marginTop:2}}>{t.industry.substring(0,20)}</div>}
                            </div>
                          ))}
                        </div>
                      </div>

                      {sel.subEtfData?.length>0&&(
                        <div style={{padding:"10px 16px",borderBottom:`1px solid ${T.border}`}}>
                          <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".08em",marginBottom:8}}>
                            SUB-SECTOR ETFs
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:6}}>
                            <div style={{background:cardBg,border:`1px solid ${s.color}44`,borderRadius:4,padding:"8px 10px"}}>
                              <div style={{fontFamily:"monospace",fontSize:8,color:s.color,letterSpacing:".06em",marginBottom:4}}>PRIMARY — {sel.etfSym}</div>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                <div>
                                  <div style={{fontFamily:"monospace",fontSize:12,color:T.text,fontWeight:700}}>${sel.etf?.price.toFixed(2)||"—"}</div>
                                  <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,marginTop:1}}>
                                    {sel.gicsDef?.etfFull?.substring(0,22)}
                                  </div>
                                </div>
                                <PCell v={sel.etf?.d1} big/>
                              </div>
                            </div>
                            {sel.subEtfData.map(se=>{
                              const d=se.data;
                              const c=d?(d.d1>0?T.accent:d.d1<0?T.down:T.textMid):T.textMid;
                              return(
                                <div key={se.sym} style={{background:cardBg,border:`1px solid ${T.border}`,borderRadius:4,padding:"8px 10px",
                                  opacity:d?1:0.5}}>
                                  <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".04em",marginBottom:4}}>
                                    {se.focus}
                                  </div>
                                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                    <div>
                                      <div style={{fontFamily:"monospace",fontSize:12,color:T.text,fontWeight:700}}>{se.sym}</div>
                                      <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,marginTop:1}}>
                                        {se.name.substring(0,22)}
                                      </div>
                                    </div>
                                    <div style={{textAlign:"right"}}>
                                      {d
                                        ?<><div style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:c}}>{d.d1>=0?"+":""}{d.d1.toFixed(2)}%</div>
                                           <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>${d.price.toFixed(2)}</div></>
                                        :<span style={{fontFamily:"monospace",fontSize:9,color:T.textGhost}}>No data</span>}
                                    </div>
                                  </div>
                                  {d&&<div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>
                                    {["d5","d1m","d3m"].map(k=>(
                                      <span key={k} style={{fontFamily:"monospace",fontSize:7.5,
                                        color:d[k]>0?T.accent:d[k]<0?T.down:T.textMid}}>
                                        {k==="d5"?"1W":k==="d1m"?"1M":"3M"} {d[k]!=null?(d[k]>=0?"+":"")+d[k].toFixed(1)+"%":"—"}
                                      </span>
                                    ))}
                                  </div>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {sel.sectorInds.length>0&&(
                        <div style={{padding:"10px 16px",borderBottom:`1px solid ${T.border}`}}>
                          <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".08em",marginBottom:8}}>
                            INDUSTRIES IN THIS SECTOR ({sel.sectorInds.length})
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 70px 60px 50px 50px",
                            padding:"4px 10px",background:rowBg,borderRadius:4,marginBottom:4}}>
                            {["INDUSTRY","1D AVG","REL VOL","ADV","DEC"].map(h=>(
                              <span key={h} style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,letterSpacing:".06em"}}>{h}</span>
                            ))}
                          </div>
                          {sel.sectorInds.map((ind,idx)=>(
                            <div key={ind.industry}
                              style={{display:"grid",gridTemplateColumns:"1fr 70px 60px 50px 50px",
                                padding:"6px 10px",borderBottom:idx<sel.sectorInds.length-1?`1px solid ${T.border}`:"none",
                                alignItems:"center",transition:"background .1s"}}
                              onMouseEnter={e=>e.currentTarget.style.background=`${s.color}06`}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                              <div>
                                <div style={{fontFamily:"monospace",fontSize:10,color:T.text}}>{ind.industry}</div>
                                <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>
                                  {ind.n} tickers · top: {ind.topMover?.symbol}
                                </div>
                              </div>
                              <div style={{textAlign:"center"}}><PCell v={ind.avgChg} big/></div>
                              <div style={{textAlign:"center"}}>
                                <span style={{fontFamily:"monospace",fontSize:10,
                                  color:ind.avgRV>=2?"#ff9f1c":ind.avgRV>=1.5?"#ffe040":T.textMid,fontWeight:700}}>
                                  {ind.avgRV.toFixed(1)}×
                                </span>
                              </div>
                              <div style={{textAlign:"center",fontFamily:"monospace",fontSize:10,color:T.accent,fontWeight:700}}>{ind.adv}</div>
                              <div style={{textAlign:"center",fontFamily:"monospace",fontSize:10,color:T.down,fontWeight:700}}>{ind.dec}</div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr"}}>
                        {[["▲ GAINERS",sel.gainers.sort((a,b)=>b.change-a.change).slice(0,6),T.accent],
                          ["▼ LOSERS", sel.losers.sort((a,b)=>a.change-b.change).slice(0,6),T.down],
                          ["◉ VOL",    [...sel.all].sort((a,b)=>(b.relVol||0)-(a.relVol||0)).slice(0,6),"#ff9f1c"],
                        ].map(([lbl,list,col])=>(
                          <div key={lbl} style={{borderRight:`1px solid ${T.border}`}}>
                            <div style={{fontFamily:"monospace",fontSize:8,color:col,padding:"6px 12px",
                              borderBottom:`1px solid ${col}22`,background:`${col}08`,letterSpacing:".08em"}}>{lbl}</div>
                            {list.map(t=>(
                              <div key={t.symbol} style={{display:"flex",justifyContent:"space-between",
                                padding:"5px 12px",borderBottom:`1px solid ${T.border}`,transition:"background .1s"}}
                                onMouseEnter={e=>e.currentTarget.style.background=`${col}06`}
                                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                <div>
                                  <div style={{fontFamily:"monospace",fontSize:11,color:T.text,fontWeight:700}}>{t.symbol}</div>
                                  <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>{(t.industry||"").substring(0,22)}</div>
                                </div>
                                <div style={{textAlign:"right"}}>
                                  <div style={{fontFamily:"monospace",fontSize:10,color:gc(t.change),fontWeight:700}}>{pct(t.change)}</div>
                                  <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>{(t.relVol||1).toFixed(1)}×</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            {[["LEADING",T.accent,leading],["NEUTRAL","#ffe040",neutral],["LAGGING",T.down,lagging]].map(([lbl,col,list])=>(
              <div key={lbl} style={{background:cardBg,border:`1px solid ${col}22`,borderRadius:6,overflow:"hidden"}}>
                <div style={{fontFamily:"monospace",fontSize:9,color:col,padding:"7px 12px",
                  borderBottom:`1px solid ${col}22`,background:`${col}09`,letterSpacing:".08em",fontWeight:700}}>
                  {lbl} <span style={{color:`${col}55`,fontWeight:400}}>({list.length})</span>
                </div>
                {list.map(s=>(
                  <div key={s.sector}
                    onClick={()=>setSelSec(selSec===s.sector?null:s.sector)}
                    style={{padding:"8px 12px",borderBottom:`1px solid ${T.border}`,cursor:"pointer",
                      transition:"background .1s",background:selSec===s.sector?`${col}0e`:"transparent"}}
                    onMouseEnter={e=>e.currentTarget.style.background=`${col}06`}
                    onMouseLeave={e=>e.currentTarget.style.background=selSec===s.sector?`${col}0e`:"transparent"}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:secCol(s.sector),flexShrink:0}}/>
                        <span style={{fontFamily:"monospace",fontSize:10,color:T.text,fontWeight:600}}>{s.sector}</span>
                        {s.etfSym&&<span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,
                          background:rowBg,border:`1px solid ${T.border}`,padding:"0px 4px",borderRadius:2}}>{s.etfSym}</span>}
                      </div>
                      <span style={{fontFamily:"monospace",fontSize:11,color:gc(s.avgChg),fontWeight:700}}>{pct(s.avgChg)}</span>
                    </div>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontFamily:"monospace",fontSize:8,color:T.accent}}>▲{s.adv}</span>
                      <span style={{fontFamily:"monospace",fontSize:8,color:T.down}}>▼{s.dec}</span>
                      <span style={{fontFamily:"monospace",fontSize:8,color:"#ff9f1c"}}>{s.avgRV.toFixed(1)}× vol</span>
                      {s.etf&&<span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>
                        ETF {s.etf.d1>=0?"+":""}{s.etf.d1.toFixed(1)}%
                      </span>}
                    </div>
                  </div>
                ))}
                {list.length===0&&<div style={{fontFamily:"monospace",fontSize:10,color:T.textGhost,padding:"16px",textAlign:"center"}}>—</div>}
              </div>
            ))}
          </div>

          <div style={{background:cardBg,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
            <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,padding:"8px 16px",
              borderBottom:`1px solid ${T.border}`,letterSpacing:".1em"}}>
              ADVANCE / DECLINE BREADTH · RELATIVE VOLUME FLOW
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0}}>
              <div style={{borderRight:`1px solid ${T.border}`}}>
                {sectors.map((s,i)=>{
                  const ap=s.adPct;
                  const c=ap>=70?T.accent:ap>=50?"#ffe040":T.down;
                  return(
                    <div key={s.sector} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 14px",
                      borderBottom:i<sectors.length-1?`1px solid ${T.border}`:"none"}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:s.color,flexShrink:0}}/>
                      <span style={{fontFamily:"monospace",fontSize:9.5,color:T.text,minWidth:120}}>{s.sector}</span>
                      <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,minWidth:28}}>{s.etfSym||""}</span>
                      <div style={{flex:1,height:8,background:dark?"rgba(255,69,96,.12)":T.border,borderRadius:3,overflow:"hidden"}}>
                        <div style={{width:`${ap}%`,height:"100%",background:c,borderRadius:3,transition:"width .8s"}}/>
                      </div>
                      <span style={{fontFamily:"monospace",fontSize:10,color:c,fontWeight:700,minWidth:32,textAlign:"right"}}>{ap}%</span>
                      <span style={{fontFamily:"monospace",fontSize:8.5,color:T.accent,minWidth:20}}>{s.adv}▲</span>
                      <span style={{fontFamily:"monospace",fontSize:8.5,color:T.down}}>{s.dec}▼</span>
                    </div>
                  );
                })}
              </div>
              <div>
                {[...sectors].sort((a,b)=>b.avgRV-a.avgRV).map((s,i)=>{
                  const maxRV=Math.max(...sectors.map(x=>x.avgRV),1);
                  return(
                    <div key={s.sector} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 14px",
                      borderBottom:i<sectors.length-1?`1px solid ${T.border}`:"none"}}>
                      <div style={{width:6,height:6,borderRadius:"50%",background:s.color,flexShrink:0}}/>
                      <span style={{fontFamily:"monospace",fontSize:9.5,color:T.text,minWidth:120}}>{s.sector}</span>
                      <div style={{flex:1,height:6,background:T.border,borderRadius:3,overflow:"hidden"}}>
                        <div style={{width:`${s.avgRV/maxRV*100}%`,height:"100%",
                          background:s.color,borderRadius:3,transition:"width .8s"}}/>
                      </div>
                      <span style={{fontFamily:"monospace",fontSize:11,
                        color:s.avgRV>=2?"#ff9f1c":T.textMid,fontWeight:700,minWidth:32,textAlign:"right"}}>
                        {s.avgRV.toFixed(1)}×
                      </span>
                      {s.etf&&<span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,minWidth:60}}>
                        ETF ${s.etf.price.toFixed(2)}
                      </span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {view==="etf"&&(
        <div>
          <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".1em",marginBottom:10}}>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span>11 SECTOR ETFs (SPDR)</span>
              <span style={{color:T.textFaint,fontSize:7,marginLeft:4}}>SORT:</span>
              {[["d1","1D"],["d5","1W"],["d1m","1M"],["d3m","3M"],["dYTD","YTD"]].map(([k,l])=>(
                <button key={k} onClick={()=>{setEtfSort(k);setEtfSortDir(d=>etfSort===k?-d:-1);}}
                  style={{fontFamily:"monospace",fontSize:8,padding:"2px 6px",border:"none",
                    borderRadius:3,cursor:"pointer",
                    background:etfSort===k?"rgba(0,232,122,.2)":rowBg,
                    color:etfSort===k?T.accent:T.textDim}}>
                  {l}{etfSort===k?(etfSortDir<0?"↓":"↑"):""}
                </button>
              ))}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8,marginBottom:16}}>
            {Object.entries(GICS)
              .map(([nm,cfg])=>({nm,cfg,etf:etfQuotes[cfg.etf]}))
              .sort((a,b)=>{
                const av=a.etf?(a.etf[etfSort]??-999):-999;
                const bv=b.etf?(b.etf[etfSort]??-999):-999;
                return etfSortDir*(bv-av);
              })
              .map(({nm,cfg})=>{
              const etf=etfQuotes[cfg.etf];
              const c=etf?(etf.d1>0?T.accent:etf.d1<0?T.down:T.textMid):T.textGhost;
              return(
                <div key={nm} style={{background:cardBg,border:`1px solid ${etf?cfg.color+"33":T.border}`,
                  borderTop:`3px solid ${cfg.color}`,borderRadius:6,padding:"10px 12px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                    <div>
                      <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:T.text}}>{cfg.etf}</div>
                      <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,marginTop:1}}>{nm}</div>
                    </div>
                    {etf
                      ?<div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:c}}>
                            {etf.d1>=0?"+":""}{etf.d1.toFixed(2)}%
                          </div>
                          <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint}}>${etf.price.toFixed(2)}</div>
                        </div>
                      :<span style={{fontFamily:"monospace",fontSize:9,color:T.textGhost}}>—</span>}
                  </div>
                  {etf&&(
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:3}}>
                      {[["1W",etf.d5],["1M",etf.d1m],["3M",etf.d3m],["YTD",etf.dYTD]].map(([l,v])=>{
                        const vc=v==null?T.textGhost:v>0?T.accent:T.down;
                        return<div key={l} style={{background:rowBg,borderRadius:3,padding:"2px 5px",display:"flex",justifyContent:"space-between"}}>
                          <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>{l}</span>
                          <span style={{fontFamily:"monospace",fontSize:7.5,color:vc,fontWeight:700}}>
                            {v==null?"—":(v>=0?"+":"")+v.toFixed(1)+"%"}
                          </span>
                        </div>;
                      })}
                    </div>
                  )}
                  <div style={{marginTop:6}}>
                    {etf&&<div style={{display:"flex",gap:4,alignItems:"center"}}>
                      <span style={{fontFamily:"monospace",fontSize:7.5,
                        color:etf.a50?T.accent:T.down,
                        background:etf.a50?"rgba(0,232,122,.1)":"rgba(255,69,96,.1)",
                        padding:"1px 4px",borderRadius:2}}>
                        {etf.a50?"50D ▲":"50D ▼"}
                      </span>
                      {etf.a200!=null&&<span style={{fontFamily:"monospace",fontSize:7.5,
                        color:etf.a200?T.accent:T.down,
                        background:etf.a200?"rgba(0,232,122,.1)":"rgba(255,69,96,.1)",
                        padding:"1px 4px",borderRadius:2}}>
                        {etf.a200?"200D ▲":"200D ▼"}
                      </span>}
                    </div>}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".1em",marginBottom:8}}>
            SUB-SECTOR ETFs — FULL UNIVERSE
          </div>
          <div style={{background:cardBg,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
            <div style={{display:"grid",gridTemplateColumns:"80px 1fr 120px 80px 70px 70px 70px 70px 70px 60px 60px",
              padding:"7px 14px",background:rowBg,borderBottom:`1px solid ${T.border2}`,gap:4}}>
              {["ETF","NAME","FOCUS / SECTOR","PRICE","1D","1W","1M","3M","YTD","50D","200D"].map((h,i)=>(
                <span key={h} style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,
                  letterSpacing:".06em",textAlign:i>=3?"center":"left"}}>{h}</span>
              ))}
            </div>
            {Object.entries(GICS).flatMap(([sectorNm,cfg])=>
              cfg.subEtfs.map(se=>({...se,sectorNm,sectorColor:cfg.color}))
            ).map((se,i,arr)=>{
              const d=etfQuotes[se.sym];
              const c=d?(d.d1>0?T.accent:d.d1<0?T.down:T.textMid):T.textMid;
              return(
                <div key={se.sym} style={{display:"grid",
                  gridTemplateColumns:"80px 1fr 120px 80px 70px 70px 70px 70px 70px 60px 60px",
                  padding:"7px 14px",gap:4,alignItems:"center",
                  borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none",
                  borderLeft:`3px solid ${se.sectorColor}`,
                  opacity:d?1:0.5,transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background=`${se.sectorColor}06`}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span style={{fontFamily:"monospace",fontSize:12,color:T.text,fontWeight:700}}>{se.sym}</span>
                  <span style={{fontFamily:"monospace",fontSize:9,color:T.textMid}}>{se.name.substring(0,34)}</span>
                  <div>
                    <span style={{fontFamily:"monospace",fontSize:8,color:se.sectorColor,
                      background:`${se.sectorColor}18`,border:`1px solid ${se.sectorColor}30`,
                      padding:"1px 5px",borderRadius:3}}>{se.focus}</span>
                  </div>
                  {d?<>
                    <div style={{textAlign:"center",fontFamily:"monospace",fontSize:10,color:T.text}}>${d.price.toFixed(2)}</div>
                    {["d1","d5","d1m","d3m","dYTD"].map(k=>(
                      <div key={k} style={{textAlign:"center"}}>
                        {d[k]!=null
                          ?<span style={{fontFamily:"monospace",fontSize:10,fontWeight:700,
                              color:d[k]>0?T.accent:d[k]<0?T.down:T.textMid}}>
                              {d[k]>=0?"+":""}{d[k].toFixed(1)}%
                            </span>
                          :<span style={{fontFamily:"monospace",fontSize:9,color:T.textGhost}}>—</span>}
                      </div>
                    ))}
                    {[d.a50,d.a200].map((v,j)=>{
                      const ab=v===true,no=v===false;
                      return<div key={j} style={{textAlign:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
                          color:ab?T.accent:no?T.down:T.textGhost,
                          background:ab?"rgba(0,232,122,.1)":no?"rgba(255,69,96,.1)":"transparent",
                          padding:"2px 3px",borderRadius:2,border:`1px solid ${ab?"rgba(0,232,122,.2)":no?"rgba(255,69,96,.2)":"transparent"}`}}>
                          {["50D","200D"][j]}{ab?"▲":no?"▼":""}
                        </span>
                      </div>;
                    })}
                  </>:<>
                    <div style={{textAlign:"center",fontFamily:"monospace",fontSize:9,color:T.textGhost}}>—</div>
                    {[0,1,2,3,4,5,6].map(k=><div key={k} style={{textAlign:"center",fontFamily:"monospace",fontSize:9,color:T.textGhost}}>—</div>)}
                  </>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view==="industry"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div style={{background:cardBg,border:`1px solid rgba(0,232,122,.2)`,borderRadius:8,overflow:"hidden"}}>
            <div style={{fontFamily:"monospace",fontSize:8,color:T.accent,padding:"8px 14px",
              borderBottom:"1px solid rgba(0,232,122,.2)",background:"rgba(0,232,122,.07)",letterSpacing:".1em"}}>
              ▲ LEADING INDUSTRIES
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 72px 64px 100px",padding:"5px 14px",
              background:rowBg,borderBottom:`1px solid ${T.border}`}}>
              {["INDUSTRY / SECTOR","AVG CHG","REL VOL","SECTOR ETF"].map(h=>(
                <span key={h} style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,letterSpacing:".06em"}}>{h}</span>
              ))}
            </div>
            {allInds.filter(i=>i.avgChg>0).sort((a,b)=>b.avgChg-a.avgChg).slice(0,20).map((ind,i,arr)=>{
              const c=secCol(ind.sector);
              const sectorGics=Object.entries(GICS).find(([nm])=>nm===ind.sector)?.[1];
              const etfD=sectorGics?etfQuotes[sectorGics.etf]:null;
              return(
                <div key={ind.industry+i} style={{display:"grid",gridTemplateColumns:"1fr 72px 64px 100px",
                  padding:"7px 14px",borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none",
                  alignItems:"center",transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(0,232,122,.04)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div>
                    <div style={{fontFamily:"monospace",fontSize:10,color:T.text}}>{ind.industry.substring(0,30)}</div>
                    <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>
                      {ind.n} tickers · {ind.sector} · top: {ind.topMover?.symbol}
                    </div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,
                      color:ind.avgChg>0?T.accent:T.down}}>
                      {ind.avgChg>=0?"+":""}{ind.avgChg.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <span style={{fontFamily:"monospace",fontSize:10,
                      color:ind.avgRV>=2?"#ff9f1c":T.textMid,fontWeight:700}}>{ind.avgRV.toFixed(1)}×</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    {sectorGics&&<span style={{fontFamily:"monospace",fontSize:9,color:c,
                      background:`${c}18`,border:`1px solid ${c}28`,padding:"1px 5px",borderRadius:2}}>
                      {sectorGics.etf}
                    </span>}
                    {etfD&&<span style={{fontFamily:"monospace",fontSize:8.5,
                      color:etfD.d1>0?T.accent:etfD.d1<0?T.down:T.textMid,fontWeight:700}}>
                      {etfD.d1>=0?"+":""}{etfD.d1.toFixed(1)}%
                    </span>}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{background:cardBg,border:"1px solid rgba(255,69,96,.2)",borderRadius:8,overflow:"hidden"}}>
            <div style={{fontFamily:"monospace",fontSize:8,color:T.down,padding:"8px 14px",
              borderBottom:"1px solid rgba(255,69,96,.2)",background:"rgba(255,69,96,.07)",letterSpacing:".1em"}}>
              ▼ LAGGING INDUSTRIES
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 72px 64px 100px",padding:"5px 14px",
              background:rowBg,borderBottom:`1px solid ${T.border}`}}>
              {["INDUSTRY / SECTOR","AVG CHG","REL VOL","SECTOR ETF"].map(h=>(
                <span key={h} style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,letterSpacing:".06em"}}>{h}</span>
              ))}
            </div>
            {allInds.filter(i=>i.avgChg<0).sort((a,b)=>a.avgChg-b.avgChg).slice(0,20).map((ind,i,arr)=>{
              const c=secCol(ind.sector);
              const sectorGics=Object.entries(GICS).find(([nm])=>nm===ind.sector)?.[1];
              const etfD=sectorGics?etfQuotes[sectorGics.etf]:null;
              return(
                <div key={ind.industry+i} style={{display:"grid",gridTemplateColumns:"1fr 72px 64px 100px",
                  padding:"7px 14px",borderBottom:i<arr.length-1?`1px solid ${T.border}`:"none",
                  alignItems:"center",transition:"background .1s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,69,96,.04)"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div>
                    <div style={{fontFamily:"monospace",fontSize:10,color:T.text}}>{ind.industry.substring(0,30)}</div>
                    <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>
                      {ind.n} tickers · {ind.sector} · worst: {[...ind.tickers].sort((a,b)=>a.change-b.change)[0]?.symbol}
                    </div>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:T.down}}>
                      {ind.avgChg.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{textAlign:"center"}}>
                    <span style={{fontFamily:"monospace",fontSize:10,
                      color:ind.avgRV>=2?"#ff9f1c":T.textMid,fontWeight:700}}>{ind.avgRV.toFixed(1)}×</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    {sectorGics&&<span style={{fontFamily:"monospace",fontSize:9,color:c,
                      background:`${c}18`,border:`1px solid ${c}28`,padding:"1px 5px",borderRadius:2}}>
                      {sectorGics.etf}
                    </span>}
                    {etfD&&<span style={{fontFamily:"monospace",fontSize:8.5,
                      color:etfD.d1>0?T.accent:etfD.d1<0?T.down:T.textMid,fontWeight:700}}>
                      {etfD.d1>=0?"+":""}{etfD.d1.toFixed(1)}%
                    </span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view==="heatmap"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:cardBg,border:`1px solid ${T.border}`,borderRadius:8,padding:"16px 18px"}}>
            <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".1em",marginBottom:12}}>
              SECTOR HEAT MAP — 1D avg change · border intensity = rel vol · GICS standard
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {sectors.map(s=>{
                const h=heat(s.avgChg); const isS=selSec===s.sector;
                const etfC=s.etf?(s.etf.d1>0?T.accent:s.etf.d1<0?T.down:T.textMid):null;
                return(
                  <div key={s.sector}
                    onClick={()=>{setSelSec(isS?null:s.sector);setView(isS?"heatmap":"overview");}}
                    style={{background:h.bg,border:`${isS?2:Math.ceil(Math.min(s.avgRV*1.5,4))}px solid ${isS?"#fff":h.fg}30`,
                      borderRadius:6,padding:"10px 14px",cursor:"pointer",
                      minWidth:Math.max(100,Math.min(s.n*10,190)),
                      flex:`0 0 ${Math.max(110,Math.min(s.n*12,210))}px`,
                      transition:"transform .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
                    onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                      <span style={{fontFamily:"monospace",fontSize:9,color:T.text}}>{s.sector.substring(0,14)}</span>
                      {s.etfSym&&<span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>{s.etfSym}</span>}
                    </div>
                    <div style={{fontFamily:"monospace",fontSize:20,color:h.fg,fontWeight:700,marginBottom:3}}>{pct(s.avgChg,1)}</div>
                    {s.etf&&<div style={{fontFamily:"monospace",fontSize:9,color:etfC,marginBottom:3}}>
                      ETF {s.etf.d1>=0?"+":""}{s.etf.d1.toFixed(2)}%
                    </div>}
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"monospace",fontSize:8,color:T.accent}}>▲{s.adv}</span>
                      <span style={{fontFamily:"monospace",fontSize:8,color:T.down}}>▼{s.dec}</span>
                      <span style={{fontFamily:"monospace",fontSize:8,color:"#ff9f1c"}}>{s.avgRV.toFixed(1)}×</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{background:cardBg,border:`1px solid ${T.border}`,borderRadius:8,padding:"14px 18px"}}>
            <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,letterSpacing:".1em",marginBottom:10}}>
              MOMENTUM SPECTRUM — screener avg vs ETF benchmark
            </div>
            <div style={{display:"flex",gap:4,alignItems:"flex-end",height:100}}>
              {sectors.map(s=>{
                const h=heat(s.avgChg); const barH=Math.max(6,Math.abs(s.avgChg)*7);
                const etfH=s.etf?Math.max(3,Math.abs(s.etf.d1)*7):0;
                const isPos=s.avgChg>=0;
                return(
                  <div key={s.sector} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",cursor:"pointer",gap:2,minWidth:0}}>
                    {isPos&&(
                      <div style={{width:"100%",position:"relative"}}>
                        <div style={{width:"100%",background:h.fg,borderRadius:"3px 3px 0 0",height:barH,transition:"height .8s"}}/>
                        {s.etf&&etfH>0&&isPos&&(
                          <div style={{position:"absolute",bottom:0,left:"50%",transform:"translateX(-50%)",
                            width:"40%",background:h.fg,opacity:.4,height:etfH,borderRadius:"2px 2px 0 0"}}/>
                        )}
                      </div>
                    )}
                    <div style={{fontFamily:"monospace",fontSize:8,color:h.fg,fontWeight:700,whiteSpace:"nowrap"}}>{pct(s.avgChg,1)}</div>
                    {!isPos&&<div style={{width:"100%",background:h.fg,borderRadius:"0 0 3px 3px",height:barH,transition:"height .8s"}}/>}
                    <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,textAlign:"center",
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%"}}>
                      {s.etfSym||s.sector.substring(0,6)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}