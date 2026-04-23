// src/components/tabs/IntelligenceTab.jsx
// Full market intelligence dashboard:
//   • Market Internals (McClellan Osc, NH-NL, Breadth %)
//   • Sector Breadth Grid
//   • Top Setup Scores (best trade candidates right now)
//   • Pocket Pivot & RS Line Leaders
//   • Earnings Calendar (next 7 days)
//   • Position Sizing / Risk Calculator

import { useState, useEffect, useCallback } from "react";
import { useTheme, THEME }  from "../../hooks/useTheme.js";
import { pct, fmt, gc, fmtVol } from "../../utils/format.js";
import { secCol } from "../../constants/gics.js";

const BASE = "http://localhost:3001";
async function apiFetch(p, o={}) {
  const r = await fetch(p.startsWith("http") ? p : BASE+p,
    { headers:{"Content-Type":"application/json"}, ...o });
  if (!r.ok) { const e=await r.json().catch(()=>({error:r.statusText}));
    throw new Error(e.error||"HTTP "+r.status); }
  return r.json();
}

// ── Mini bar chart ────────────────────────────────────────────────────────────
function MiniBarChart({ data=[], height=40, colorPos="var(--clr-accent)", colorNeg="var(--clr-dn)" }) {
  if (!data.length) return (
    <div style={{height, background:T.row, borderRadius:3, display:"flex",
      alignItems:"center", justifyContent:"center"}}>
      <span style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>NO DATA</span>
    </div>
  );
  const vals = data.map(d => d.value ?? 0);
  const max  = Math.max(...vals.map(Math.abs), 0.001);
  const half = Math.floor(height/2) - 1;
  return (
    <div style={{position:"relative",height,background:T.row,borderRadius:3,overflow:"hidden"}}>
      {data.map((d,i)=>{
        const v  = d.value ?? 0;
        const px = Math.max(1, Math.round(Math.abs(v)/max*half));
        const up = v >= 0;
        return <div key={i} style={{
          position:"absolute", left:`${(i/data.length)*100}%`,
          width:`${(1/data.length)*100}%`, height:px,
          ...(up ? {bottom:"50%"} : {top:"50%"}),
          background: up ? colorPos : colorNeg, opacity:.85,
        }}/>;
      })}
      <div style={{position:"absolute",top:"50%",left:0,right:0,height:1,background:T.textGhost}}/>
    </div>
  );
}

// ── Gauge widget ─────────────────────────────────────────────────────────────
function Gauge({ value, min=-0.1, max=0.1, label="" }) {
  const norm   = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const color  = value > 0.02 ? T.accent : value < -0.02 ? T.down : "#ffe040";
  const deg    = norm * 180 - 90;   // -90° to +90°
  return (
    <div style={{textAlign:"center"}}>
      <svg width={90} height={52} viewBox="0 0 90 52">
        {/* Track */}
        <path d="M 10 45 A 35 35 0 0 1 80 45" fill="none" stroke={T.border2} strokeWidth={6}/>
        {/* Fill */}
        <path d={`M 10 45 A 35 35 0 0 1 80 45`} fill="none"
          stroke={color} strokeWidth={6} strokeDasharray="110"
          strokeDashoffset={110*(1-norm)} style={{transition:"stroke-dashoffset .8s"}}/>
        {/* Needle */}
        <line x1={45} y1={45}
          x2={45 + 30*Math.cos((deg-90)*Math.PI/180)}
          y2={45 + 30*Math.sin((deg-90)*Math.PI/180)}
          stroke={color} strokeWidth={2} strokeLinecap="round"/>
        <circle cx={45} cy={45} r={3} fill={color}/>
        <text x={45} y={34} textAnchor="middle" fontFamily="monospace" fontSize={10}
          fontWeight={700} fill={color}>{value > 0 ? "+" : ""}{value?.toFixed(3)}</text>
      </svg>
      <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,marginTop:-4}}>{label}</div>
    </div>
  );
}

// ── Stage badge ───────────────────────────────────────────────────────────────
function StageBadge({ stage }) {
  const map = {
    1: { c:"#ffe040", bg:"rgba(255,224,64,.12)",  l:"S1" },
    2: { c:T.accent, bg:"rgba(0,232,122,.15)",   l:"S2" },
    3: { c:"#ff9f1c", bg:"rgba(255,159,28,.12)",  l:"S3" },
    4: { c:T.down, bg:"rgba(255,69,96,.12)",   l:"S4" },
  };
  const s = map[stage];
  if (!s) return null;
  return (
    <span title={`Stage ${stage}`} style={{
      fontFamily:"monospace", fontSize:8, fontWeight:700, color:s.c,
      background:s.bg, padding:"2px 5px", borderRadius:3,
    }}>{s.l}</span>
  );
}

// ── RS Rank badge ─────────────────────────────────────────────────────────────
function RSBadge({ rank }) {
  if (rank == null) return <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>—</span>;
  const c = rank>=90?T.accent:rank>=80?T.accent:rank>=70?"#ffe040":rank>=50?"#ff9f1c":T.down;
  return (
    <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,color:c,
      background:`${c}18`,padding:"2px 6px",borderRadius:3}}>
      {rank}
    </span>
  );
}

// ── Setup score bar ───────────────────────────────────────────────────────────
function SetupBar({ score }) {
  if (score == null) return null;
  const c = score>=80?T.accent:score>=60?T.accent:score>=40?"#ffe040":"#ff9f1c";
  return (
    <div style={{display:"flex",alignItems:"center",gap:5}}>
      <div style={{width:48,height:4,background:T.textGhost2,borderRadius:2,overflow:"hidden"}}>
        <div style={{width:`${score}%`,height:"100%",background:c,borderRadius:2}}/>
      </div>
      <span style={{fontFamily:"monospace",fontSize:9,color:c,fontWeight:600}}>{score}</span>
    </div>
  );
}

// ── Earnings flag ─────────────────────────────────────────────────────────────
function EarningsBadge({ days }) {
  if (days == null) return null;
  const c   = days <= 2 ? T.down : days <= 5 ? "#ff9f1c" : "#ffe040";
  const lbl = days === 0 ? "TODAY" : days === 1 ? "TOMORROW" : `${days}D`;
  return (
    <span title={`Earnings in ${days} days`} style={{
      fontFamily:"monospace", fontSize:7, fontWeight:700, color:c,
      background:`${c}15`, border:`1px solid ${c}40`,
      padding:"1px 4px", borderRadius:2, letterSpacing:".04em",
    }}>📅 {lbl}</span>
  );
}

// ── Position Size Calculator ──────────────────────────────────────────────────
function RiskCalculator({ prefill={} }) {
  const [account, setAccount] = useState("100000");
  const [riskPct, setRiskPct] = useState("1");
  const [entry,   setEntry]   = useState(prefill.price ? String(prefill.price.toFixed(2)) : "");
  const [stop,    setStop]    = useState("");
  const [adr,     setAdr]     = useState(prefill.adr14 ? String(prefill.adr14.toFixed(1)) : "");

  const acc    = parseFloat(account) || 0;
  const rPct   = parseFloat(riskPct) || 1;
  const ent    = parseFloat(entry)   || 0;
  const stp    = parseFloat(stop)    || 0;
  const adrVal = parseFloat(adr)     || 0;

  const dollarRisk  = acc * rPct / 100;
  const stopDist    = ent > 0 && stp > 0 ? ent - stp : 0;
  const shares      = stopDist > 0 ? Math.floor(dollarRisk / stopDist) : 0;
  const posSize     = shares * ent;
  const posPct      = acc > 0 ? (posSize / acc * 100).toFixed(1) : 0;
  const r1          = ent + stopDist;        // 1R target
  const r2          = ent + stopDist * 2;   // 2R
  const r3          = ent + stopDist * 3;   // 3R

  // ATR-based stop suggestion
  const atrStop     = adrVal > 0 && ent > 0 ? (ent * (1 - adrVal/100 * 1.5)).toFixed(2) : null;

  const F = ({label, value, color="var(--clr-text)"}) => (
    <div style={{display:"flex",justifyContent:"space-between",padding:"5px 0",
      borderBottom:`1px solid ${T.border}`}}>
      <span style={{fontFamily:"monospace",fontSize:9,color:T.textDim}}>{label}</span>
      <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,color}}>{value}</span>
    </div>
  );

  const I = ({label, value, onChange, prefix="", suffix="", width=90}) => (
    <div style={{display:"flex",flexDirection:"column",gap:3}}>
      <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>{label}</span>
      <div style={{display:"flex",alignItems:"center",gap:3,background:T.inputBg,
        border:`1px solid ${T.border2}`,borderRadius:3,padding:"5px 8px"}}>
        {prefix&&<span style={{fontFamily:"monospace",fontSize:10,color:T.textDim}}>{prefix}</span>}
        <input value={value} onChange={e=>onChange(e.target.value)}
          style={{width,background:"transparent",border:"none",outline:"none",
            fontFamily:"monospace",fontSize:11,color:T.text}}/>
        {suffix&&<span style={{fontFamily:"monospace",fontSize:10,color:T.textDim}}>{suffix}</span>}
      </div>
    </div>
  );

  return (
    <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,padding:"14px 16px"}}>
      <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,letterSpacing:".14em",
        marginBottom:12}}>⚖ POSITION SIZE CALCULATOR</div>

      {prefill.symbol && (
        <div style={{fontFamily:"monospace",fontSize:9,color:T.accent,marginBottom:8}}>
          {prefill.symbol} · Stage {prefill.stage} · RS {prefill.rs_rank}
        </div>
      )}

      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:12}}>
        <I label="Account $"    value={account} onChange={setAccount} prefix="$" width={80}/>
        <I label="Risk %"       value={riskPct} onChange={setRiskPct} suffix="%" width={40}/>
        <I label="Entry Price"  value={entry}   onChange={setEntry}   prefix="$" width={70}/>
        <I label="Stop Price"   value={stop}    onChange={setStop}    prefix="$" width={70}/>
        <I label="ADR%"         value={adr}     onChange={setAdr}     suffix="%" width={40}/>
      </div>

      {atrStop && !stop && (
        <div style={{fontFamily:"monospace",fontSize:8,color:"#ff9f1c",marginBottom:8,
          cursor:"pointer"}} onClick={()=>setStop(atrStop)}>
          ↗ ATR-based stop suggestion: ${atrStop} (1.5× ADR below entry) — click to use
        </div>
      )}

      {shares > 0 && (
        <div>
          <F label="Dollar Risk"   value={`$${dollarRisk.toFixed(0)} (${rPct}%)`} color="#ff9f1c"/>
          <F label="Stop Distance" value={`$${stopDist.toFixed(2)} (${(stopDist/ent*100).toFixed(1)}%)`}/>
          <F label="Shares"        value={shares.toLocaleString()} color="var(--clr-accent)"/>
          <F label="Position Size" value={`$${posSize.toLocaleString(undefined,{maximumFractionDigits:0})} (${posPct}% of acct)`}/>
          <div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
            {[[1,r1,T.accent],[2,r2,T.accent],[3,r3,"#00d4ff"]].map(([n,t,c])=>(
              <div key={n} style={{background:`${c}10`,border:`1px solid ${c}30`,
                borderRadius:4,padding:"5px 10px",textAlign:"center"}}>
                <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>{n}R TARGET</div>
                <div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:c}}>
                  ${t.toFixed(2)}
                </div>
                <div style={{fontFamily:"monospace",fontSize:8,color:c}}>
                  +${(shares*(t-ent)).toFixed(0)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!shares && entry && stop && (
        <div style={{fontFamily:"monospace",fontSize:9,color:T.down}}>
          {stp >= ent ? "Stop must be below entry" : "Enter valid entry and stop prices"}
        </div>
      )}
    </div>
  );
}

// ── TABS ──────────────────────────────────────────────────────────────────────
const TABS = [
  { key:"internals",  label:"INTERNALS"    },
  { key:"setups",     label:"TOP SETUPS"   },
  { key:"earnings",   label:"EARNINGS"     },
  { key:"emacross",   label:"⚡ EMA CROSS" },
  { key:"symbol",     label:"🔍 SYMBOL"    },
  { key:"risk",       label:"RISK CALC"    },
  { key:"validate",   label:"✅ VALIDATE"  },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function IntelligenceTab() {
  const themeKey = useTheme();
  const T        = THEME[themeKey] || THEME.night;
  const dark     = themeKey === "night";
  const [tab,    setTab]    = useState("internals");
  const [intern, setIntern] = useState(null);
  const [setups, setSetups] = useState([]);
  const [earn,   setEarn]   = useState([]);
  const [status, setStatus] = useState(null);
  const [loading,setLoading]= useState({});
  const [riskPf, setRiskPf] = useState({});

  // Sector / industry dropdowns (loaded from API)
  const [sectorsList,    setSectorsList]    = useState([]);
  const [industriesList, setIndustriesList] = useState([]);

  // EMA Cross scanner state
  const [emaCrossF, setEmaCrossF] = useState({
    emas:       ["10","20"],   // selected EMA periods (Pine: ema10_en, ema20_en ...)
    touchMode:  "min",         // "min" = Min touches(≥) | "all" = All selected
    minTouches: "1",           // Pine: minTouches input
    minPrice:   "5",
    minVol:     "100000",
    minDolVol:  "",
    sectors:    [],
    industries: [],
    limit:      "300",
  });
  const [emaCrossResults, setEmaCrossResults] = useState([]);
  const [emaCrossLoading, setEmaCrossLoading] = useState(false);
  const [emaCrossSort, setEmaCrossSort] = useState({ k:"cross_dist_pct_abs", d:1 });  // sort by abs distance, asc = closest first

  // Validate state
  const [validateData, setValidateData] = useState(null);
  const [validateLoading, setValidateLoading] = useState(false);

  // Breadth table period + filter state
  const [breadthPeriod,       setBreadthPeriod]       = useState("avg3m");
  const [breadthSectorFilter, setBreadthSectorFilter] = useState("");
  const [breadthShowAll,      setBreadthShowAll]      = useState(false);

  // Symbol search state
  const [symQuery,  setSymQuery]  = useState("");
  const [symResult, setSymResult] = useState(null);
  const [symErr,    setSymErr]    = useState(null);
  const [symLoading,setSymLoading]= useState(false);
  const [filterS, setFilterS] = useState({
    minScore:"0",  maxScore:"100",
    minRS:"0",     maxRS:"99",
    minPrice:"1",  maxPrice:"",
    minVol:"100000",
    minDolVol:"",      // dollar volume filter, e.g. "1000000" = $1M
    industries:[],     // industry names to include
    stage:"0", emaFilter:"any",
    sectors:[],
    vcpMin:"0", ppOnly:false, rsLineHi:false,
    maxEarn:"0",
    sortBy:"setup_score", sortDir:"desc",
    limit:"",           // blank = all matching rows (no limit)
  });
  const setF = (k,v) => setFilterS(p=>({...p,[k]:v}));

  const load = useCallback(async (which) => {
    setLoading(p=>({...p,[which]:true}));
    try {
      if (which==="internals" && !intern) {
        const d = await apiFetch("/api/analytics/internals");
        setIntern(d);
      }
      if (which==="setups") {
        const p = new URLSearchParams({
          minScore:  filterS.minScore  || 50,
          maxScore:  filterS.maxScore  || 100,
          minRS:     filterS.minRS     || 60,
          maxRS:     filterS.maxRS     || 99,
          minPrice:  filterS.minPrice  || 1,
          maxPrice:  filterS.maxPrice  || 99999,
          minVol:    filterS.minVol    || 100000,
          minDolVol: filterS.minDolVol  || 0,
          industries:(filterS.industries||[]).join(","),
          stage:     filterS.stage     || 0,
          emaFilter: filterS.emaFilter || "any",
          sectors:   (filterS.sectors||[]).join(","),
          vcpMin:    filterS.vcpMin    || 0,
          ppOnly:    filterS.ppOnly    ? "1" : "0",
          rsLineHi:  filterS.rsLineHi  ? "1" : "0",
          maxEarn:   filterS.maxEarn   || 0,
          sortBy:    filterS.sortBy    || "setup_score",
          sortDir:   filterS.sortDir   || "desc",
          limit:     filterS.limit     || 9999,  // blank/empty = all
        });
        const d = await apiFetch(`/api/analytics/setup?${p}`);
        setSetups(d.results || []);
      }
      if (which==="earnings") {
        const d = await apiFetch("/api/analytics/earnings?days=14&minRS=0&limit=100");
        setEarn(d.results || []);
      }
      if (which==="status" && !status) {
        const d = await apiFetch("/api/analytics/status");
        setStatus(d);
      }
    } catch {}
    setLoading(p=>({...p,[which]:false}));
  }, [intern, filterS]);

  useEffect(() => {
    load("internals");
    load("status");
    // Load sector list on mount
    apiFetch("/api/analytics/sectors-list")
      .then(d => setSectorsList(d.sectors || []))
      .catch(() => {});
  }, []);

  useEffect(() => { if (tab==="setups")   load("setups");   }, [tab, filterS]);
  useEffect(() => { if (tab==="earnings") load("earnings"); }, [tab]);

  // When sector filter changes, reload industry list for that sector
  useEffect(() => {
    const sec = (filterS.sectors||[])[0] || "";
    apiFetch(`/api/analytics/industries-list${sec?"?sector="+encodeURIComponent(sec):""}`)
      .then(d => setIndustriesList(d.industries || []))
      .catch(() => {});
  }, [filterS.sectors]);

  // EMA cross fetch
  const runEmaCross = useCallback(async () => {
    setEmaCrossLoading(true);
    try {
      const p = new URLSearchParams({
        emas:       (emaCrossF.emas||["10","20"]).join(","),
        touchMode:  emaCrossF.touchMode  || "min",
        minTouches: emaCrossF.minTouches || "1",
        minPrice:   emaCrossF.minPrice   || 5,
        minVol:     emaCrossF.minVol     || 100000,
        minDolVol:  emaCrossF.minDolVol  || 0,
        sectors:    (emaCrossF.sectors||[]).join(","),
        industries: (emaCrossF.industries||[]).join(","),
        limit:      emaCrossF.limit      || 300,
      });
      const d = await apiFetch(`/api/analytics/ema-cross?${p}`);
      if (d.computing) {
        // Touch data not ready — show computing state
        setEmaCrossResults({ _computing: true, _message: d.message });
        // Auto-retry after 30s
        setTimeout(() => runEmaCross(), 30_000);
      } else {
        setEmaCrossResults(d.results || []);
      }
    } catch(e) { console.error(e); setEmaCrossResults([]); }
    setEmaCrossLoading(false);
  }, [emaCrossF]);

  // Validate fetch
  const runValidate = useCallback(async () => {
    setValidateLoading(true);
    try {
      const d = await apiFetch("/api/analytics/validate");
      setValidateData(d);
    } catch(e) { console.error(e); }
    setValidateLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "validate" && !validateData) runValidate();
    if (tab === "emacross" && !emaCrossResults.length) runEmaCross();
  }, [tab]);

  const lookupSymbol = useCallback(async (sym) => {
    if (!sym.trim()) return;
    const s = sym.trim().toUpperCase();
    setSymLoading(true); setSymErr(null); setSymResult(null);
    try {
      const d = await apiFetch(`/api/analytics/symbol/${s}`);
      setSymResult(d);
    } catch(e) {
      setSymErr(e.message || `${s} not found`);
    }
    setSymLoading(false);
  }, []);

  // Export setups to Excel-compatible CSV (opens in Excel natively)
  const exportToExcel = useCallback((rows) => {
    const fmtNum = (v, dec=2) => v==null ? "" : (+v).toFixed(dec);
    const fmtPct = (v) => v==null ? "" : ((+v)>=0?"+":"")+fmtNum(v,1)+"%";
    const fmtDolVol = (v) => {
      if (v==null) return "";
      const n = +v;
      if (n>=1e9) return (n/1e9).toFixed(2)+"B";
      if (n>=1e6) return (n/1e6).toFixed(2)+"M";
      if (n>=1e3) return (n/1e3).toFixed(0)+"K";
      return String(n);
    };
    const fmtMcap = (v) => {
      if (v==null) return "";
      const n = +v;
      if (n>=1e12) return (n/1e12).toFixed(2)+"T";
      if (n>=1e9)  return (n/1e9).toFixed(2)+"B";
      if (n>=1e6)  return (n/1e6).toFixed(2)+"M";
      return String(Math.round(n));
    };
    const STAGE_LABELS = {1:"Stage 1 Basing",2:"Stage 2 Uptrend",3:"Stage 3 Topping",4:"Stage 4 Decline"};

    const headers = [
      "Symbol","Company","Sector","Industry","Market Cap",
      "Price","1D%","3M%","6M%","1Y%","YTD%",
      "RS Rank","RS Rank 3M","Stage","Setup Score",
      "VCP Score","ADR%","RSI14","Volume","$ Volume",
      "Above EMA50","Above EMA200","% of 52W High",
      "Pocket Pivot","Tight Base","RS Line High",
      "Earnings Date","Days to Earnings",
      "RS vs Sector ETF","RS vs Industry ETF",
      "Sector ETF","Industry ETF",
    ];
    const escCsv = v => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g,'""')}"` : s;
    };
    const dataRows = rows.map(r => [
      r.symbol, r.name||"", r.sector||"", r.industry||"", fmtMcap(r.market_cap),
      fmtNum(r.close), fmtPct(r.d1), fmtPct(r.d63), fmtPct(r.d126), fmtPct(r.d252), fmtPct(r.ytd),
      r.rs_rank??"", r.rs_rank_3m??"", STAGE_LABELS[r.stage]||"", r.setup_score??"",
      r.vcp_score??"", fmtNum(r.adr14,1), fmtNum(r.rsi14,1),
      r.volume??"", fmtDolVol(r.dol_vol||(r.close*r.volume)),
      r.above_ema50===1?"Yes":"No", r.above_ema200===1?"Yes":"No",
      r.pct_hi52?fmtNum(r.pct_hi52,1)+"%":"",
      r.pocket_pivot===1?"Yes":"", r.tight_flag===1?"Yes":"", r.rs_line_hi===1?"Yes":"",
      r.earnings_date??"", r.days_to_earn??"",
      r.rs_vs_sector!=null?fmtPct(r.rs_vs_sector):"",
      r.rs_vs_industry!=null?fmtPct(r.rs_vs_industry):"",
      r.sector_etf??"", r.industry_etf??"",
    ].map(escCsv));

    const csvContent = [headers.map(escCsv), ...dataRows].map(r=>r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF"+csvContent], {type:"text/csv;charset=utf-8;"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `intel_setups_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }, []);

  // Server returns pre-sorted results. Column header clicks update filterS.sortBy
  // and trigger a re-fetch — no client-side sort needed.
  const sortedSetups = setups;   // already sorted by server

  const th = (k, label) => {
    if (!k) return <span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>{label}</span>;
    const active  = filterS.sortBy === k;
    const nextDir = active && filterS.sortDir === "desc" ? "asc" : "desc";
    return (
      <div onClick={()=>{ setF("sortBy",k); setF("sortDir",nextDir); setTimeout(()=>load("setups"),20); }}
        style={{fontFamily:"monospace",fontSize:8,letterSpacing:".1em",userSelect:"none",
          cursor:"pointer",color:active?"#a78bfa":T.textGhost,
          textDecoration:"underline dotted",textUnderlineOffset:3,display:"flex",gap:3,alignItems:"center"}}>
        {label}
        <span style={{fontSize:9,color:active?"#a78bfa":T.textGhost}}>
          {active ? (filterS.sortDir==="desc" ? "↓" : "↑") : "↕"}
        </span>
      </div>
    );
  };

  return (
    <div>
      {/* ── Sub-tab bar ─────────────────────────────────────────────────── */}
      <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        {TABS.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)}
            style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
              padding:"7px 16px",borderRadius:4,border:"none",cursor:"pointer",
              background:tab===t.key?"rgba(167,139,250,.2)":T.surface,
              color:tab===t.key?"#a78bfa":T.textDim,
              outline:tab===t.key?"1px solid rgba(167,139,250,.4)":`1px solid ${T.border}`}}>
            {t.label}
          </button>
        ))}

        {/* Status */}
        {status && (
          <div style={{marginLeft:"auto",display:"flex",gap:8,flexWrap:"wrap"}}>
            {[
              ["RS",   status.rsRankPct+"%"],
              ["Stage",status.stagePct+"%"],
              ["Score",status.scorePct+"%"],
            ].map(([l,v])=>(
              <span key={l} style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>
                {l}: <span style={{color:parseInt(v)>=80?T.accent:"#ffe040"}}>{v}</span>
              </span>
            ))}
            <button onClick={async()=>{
              await apiFetch("/api/analytics/compute",{method:"POST"});
              setTimeout(()=>load("status"),2000);
            }} style={{fontFamily:"monospace",fontSize:8,padding:"4px 10px",borderRadius:3,
              border:"none",cursor:"pointer",background:"rgba(167,139,250,.1)",color:"#a78bfa",
              outline:"1px solid rgba(167,139,250,.3)"}}>
              ↺ RECOMPUTE
            </button>
          </div>
        )}
      </div>

      {/* ══ INTERNALS TAB ═══════════════════════════════════════════════════ */}
      {tab==="internals"&&(
        <div>
          {!intern&&loading.internals&&(
            <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,padding:24,textAlign:"center"}}>
              Computing market internals…
            </div>
          )}
          {intern&&(<>
            {/* ── Row 1: Breadth overview cards ────────────────────────── */}
            {intern.breadth&&(
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
                {[
                  { l:"% Above EMA200", v:intern.breadth.pctAbove200, key:"above200",
                    desc:`${intern.breadth.above200} / ${intern.breadth.total}` },
                  { l:"% Above EMA50",  v:intern.breadth.pctAbove50,  key:"above50",
                    desc:`${intern.breadth.above50} / ${intern.breadth.total}` },
                  { l:"Stage 2 Stocks", v:intern.breadth.pctStage2,   key:"stage2",
                    desc:`${intern.breadth.stage2} uptrends` },
                  { l:"Near 52W High",  v:intern.breadth.pctNear52H,  key:"near52h",
                    desc:`${intern.breadth.near52H} within 5%` },
                ].map(({l,v,key,desc})=>{
                  const c = v>=60?T.accent:v>=45?"#ffe040":T.down;
                  return (
                    <div key={key} style={{background:T.surface,border:`1px solid ${c}22`,
                      borderRadius:6,padding:"12px 14px"}}>
                      <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,marginBottom:4}}>
                        {l}
                      </div>
                      <div style={{fontFamily:"monospace",fontSize:22,fontWeight:700,
                        color:c,lineHeight:1,marginBottom:4}}>{v}%</div>
                      <div style={{height:3,background:T.textGhost2,borderRadius:2,marginBottom:4,overflow:"hidden"}}>
                        <div style={{width:`${v}%`,height:"100%",background:c,borderRadius:2}}/>
                      </div>
                      <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>{desc}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Row 2: McClellan + NH-NL + Breadth Score ─────────────── */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:12}}>

              {/* McClellan */}
              <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,
                padding:"12px 14px"}}>
                <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,letterSpacing:".12em",
                  marginBottom:10}}>McCLELLAN OSCILLATOR</div>
                {intern.mcClellan ? (<>
                  <div style={{display:"flex",justifyContent:"center",marginBottom:8}}>
                    <Gauge value={intern.mcClellan.current ?? 0} min={-0.15} max={0.15}
                      label={intern.mcClellan.signal}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>Oscillator</span>
                    <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
                      color:(intern.mcClellan.current||0)>0?T.accent:T.down}}>
                      {(intern.mcClellan.current||0) > 0 ? "+" : ""}
                      {(intern.mcClellan.current||0).toFixed(4)}
                    </span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>Summation</span>
                    <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
                      color:(intern.mcClellan.currentSum||0)>0?T.accent:T.down}}>
                      {(intern.mcClellan.currentSum||0) > 0 ? "+" : ""}
                      {(intern.mcClellan.currentSum||0).toFixed(1)}
                    </span>
                  </div>
                  {intern.mcClellan.oscillator?.length>0&&(
                    <MiniBarChart data={intern.mcClellan.oscillator} height={36}/>
                  )}
                  <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,marginTop:6}}>
                    {intern.mcClellan.overbought ? "⚠ OVERBOUGHT (>+0.05)"
                      : intern.mcClellan.oversold ? "⚠ OVERSOLD (<-0.05)"
                      : `Trend: ${intern.mcClellan.trend || "—"}`}
                  </div>
                </>) : (
                  <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,
                    padding:"20px 0",textAlign:"center"}}>
                    Needs 40+ days of A/D history<br/>Run bootstrap to populate
                  </div>
                )}
              </div>

              {/* NH-NL */}
              <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,
                padding:"12px 14px"}}>
                <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,letterSpacing:".12em",
                  marginBottom:10}}>NEW HIGHS vs NEW LOWS</div>
                {intern.nhnl && (<>
                  <div style={{display:"flex",gap:14,marginBottom:10}}>
                    <div>
                      <div style={{fontFamily:"monospace",fontSize:20,fontWeight:700,
                        color:T.accent}}>{intern.nhnl.newHighs}</div>
                      <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>
                        New 52W Highs
                      </div>
                    </div>
                    <div>
                      <div style={{fontFamily:"monospace",fontSize:20,fontWeight:700,
                        color:T.down}}>{intern.nhnl.newLows}</div>
                      <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>
                        New 52W Lows
                      </div>
                    </div>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>NH-NL Net</span>
                    <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,
                      color:intern.nhnl.net>=0?T.accent:T.down}}>
                      {intern.nhnl.net>=0?"+":""}{intern.nhnl.net}
                    </span>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>NH/NL Ratio</span>
                    <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,
                      color:(intern.nhnl.ratio||0)>=1.5?T.accent:(intern.nhnl.ratio||0)>=1?"#ffe040":T.down}}>
                      {intern.nhnl.ratio ?? "—"}×
                    </span>
                  </div>
                  <div style={{fontFamily:"monospace",fontSize:8,color:T.textDim}}>
                    RS Line Highs: <span style={{color:"#a78bfa"}}>
                      {intern.breadth?.rsLineHi ?? 0}
                    </span>
                  </div>
                  <div style={{fontFamily:"monospace",fontSize:8,color:T.textDim,marginTop:4}}>
                    Pocket Pivots today: <span style={{color:"#00d4ff"}}>
                      {intern.breadth?.ppToday ?? 0}
                    </span>
                  </div>
                </>)}
              </div>

              {/* Breadth Score */}
              <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,
                padding:"12px 14px"}}>
                <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,letterSpacing:".12em",
                  marginBottom:10}}>OVERALL BREADTH SCORE</div>
                {intern.breadth && (<>
                  {(()=>{
                    const s  = intern.breadth.breadthScore;
                    const c  = s>=65?T.accent:s>=50?"#ffe040":T.down;
                    const lbl = s>=80?"STRONG":s>=65?"BULLISH":s>=50?"NEUTRAL":s>=35?"WEAK":"BEARISH";
                    return (<>
                      <div style={{textAlign:"center",marginBottom:10}}>
                        <div style={{fontFamily:"monospace",fontSize:36,fontWeight:700,
                          color:c,lineHeight:1}}>{s}</div>
                        <div style={{fontFamily:"monospace",fontSize:9,color:c,
                          letterSpacing:".1em",marginTop:4}}>● {lbl}</div>
                      </div>
                      <div style={{height:4,background:T.textGhost2,borderRadius:2,marginBottom:10,
                        overflow:"hidden"}}>
                        <div style={{width:`${s}%`,height:"100%",background:c,borderRadius:2,
                          transition:"width .8s"}}/>
                      </div>
                    </>);
                  })()}
                  {[
                    ["Stage 2", intern.breadth.pctStage2+"%"],
                    ["Pocket Pivots", intern.breadth.pctPP+"%"],
                    ["RS Line Highs", intern.breadth.pctRsLineHi+"%"],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",
                      padding:"3px 0",borderBottom:`1px solid ${T.border}`}}>
                      <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>{l}</span>
                      <span style={{fontFamily:"monospace",fontSize:8,color:T.textDim}}>{v}</span>
                    </div>
                  ))}
                </>)}
              </div>
            </div>

            {/* ── Sector Breadth table ──────────────────────────────────── */}
            {intern.sectors?.length>0&&(()=>{
              // Period selector state — shared for both sector and industry tables
              const PERIODS = [
                {k:"avg1d", l:"1D"},  {k:"avg1w", l:"1W"},  {k:"avg1m",  l:"1M"},
                {k:"avg3m", l:"3M"},  {k:"avg6m", l:"6M"},  {k:"avgYtd", l:"YTD"},
                {k:"avg1y", l:"1Y"},
              ];
              return(<>
              {/* ── Shared period selector ─────────────────────────────────── */}
              <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
                <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,
                  letterSpacing:".12em",marginRight:4}}>PERIOD:</span>
                {PERIODS.map(({k,l})=>{
                  const active = breadthPeriod === k;
                  return(
                    <button key={k} onClick={()=>setBreadthPeriod(k)}
                      style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
                        padding:"4px 12px",borderRadius:3,border:"none",cursor:"pointer",
                        background:active?"rgba(167,139,250,.25)":T.surface,
                        color:active?"#a78bfa":T.textDim,
                        outline:`1px solid ${active?"rgba(167,139,250,.5)":T.border}`}}>
                      {l}
                    </button>
                  );
                })}
                <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,marginLeft:8}}>
                  showing avg {PERIODS.find(p=>p.k===breadthPeriod)?.l||"3M"} return per sector/industry
                </span>
              </div>

              {/* ── SECTOR BREADTH ─────────────────────────────────────────── */}
              <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,
                padding:"14px 16px",marginBottom:10}}>
                <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,letterSpacing:".12em",
                  marginBottom:8}}>
                  SECTOR BREADTH
                  <span style={{color:T.textGhost,marginLeft:6,fontSize:7.5}}>
                    % above EMA200 · EMA50 · Stage2 · Avg {PERIODS.find(p=>p.k===breadthPeriod)?.l} return · Avg RS
                  </span>
                </div>
                {/* Header */}
                <div style={{display:"grid",
                  gridTemplateColumns:"170px 72px 66px 66px 80px 64px",
                  gap:4,padding:"5px 4px",borderBottom:`2px solid ${T.border}`,
                  fontFamily:"monospace",fontSize:7.5,color:T.textGhost,letterSpacing:".1em"}}>
                  <span>SECTOR</span>
                  <span style={{textAlign:"center"}}>ABV 200</span>
                  <span style={{textAlign:"center"}}>ABV 50</span>
                  <span style={{textAlign:"center"}}>STAGE2</span>
                  <span style={{textAlign:"center",color:"#a78bfa88"}}>
                    AVG {PERIODS.find(p=>p.k===breadthPeriod)?.l}%
                  </span>
                  <span style={{textAlign:"center"}}>AVG RS</span>
                </div>
                {/* Rows — sorted by selected period return */}
                {[...intern.sectors].sort((a,b)=>(b[breadthPeriod]??-999)-(a[breadthPeriod]??-999)).map(s=>{
                  const c200 = s.pctAbove200>=60?T.accent:s.pctAbove200>=40?"#ffe040":T.down;
                  const retVal = s[breadthPeriod];
                  const retC  = retVal==null?T.textFaint:retVal>=0?T.accent:"#ff6060";
                  return(
                    <div key={s.sector} style={{display:"grid",
                      gridTemplateColumns:"170px 72px 66px 66px 80px 64px",
                      gap:4,padding:"7px 4px",borderBottom:`1px solid ${T.border}`,alignItems:"center"}}>
                      <div>
                        <span style={{fontFamily:"monospace",fontSize:9,fontWeight:600,
                          color:secCol(s.sector)||T.textMid,overflow:"hidden",
                          textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>
                          {s.sector}
                        </span>
                        <span style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>
                          {s.total} stocks
                        </span>
                      </div>
                      {/* ABV200 with bar */}
                      <div style={{textAlign:"center"}}>
                        <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,color:c200}}>
                          {s.pctAbove200}%
                        </span>
                        <div style={{height:2,background:T.textGhost2,borderRadius:1,marginTop:2,overflow:"hidden"}}>
                          <div style={{width:`${s.pctAbove200}%`,height:"100%",background:c200}}/>
                        </div>
                      </div>
                      <span style={{fontFamily:"monospace",fontSize:9,textAlign:"center",
                        color:s.pctAbove50>=50?T.accent:T.textDim}}>
                        {s.pctAbove50}%
                      </span>
                      <span style={{fontFamily:"monospace",fontSize:9,textAlign:"center",
                        color:s.pctStage2>=30?T.accent:T.textDim}}>
                        {s.pctStage2}%
                      </span>
                      {/* Selected period return — highlighted */}
                      <div style={{textAlign:"center",background:"rgba(167,139,250,.05)",
                        borderRadius:3,padding:"2px 4px"}}>
                        <span style={{fontFamily:"monospace",fontSize:10,fontWeight:700,color:retC}}>
                          {retVal!=null?(retVal>=0?"+":"")+retVal.toFixed(1)+"%" : "—"}
                        </span>
                      </div>
                      <span style={{fontFamily:"monospace",fontSize:9,textAlign:"center",
                        color:s.avgRS>=70?T.accent:s.avgRS>=50?"#ffe040":T.textDim}}>
                        {s.avgRS??"-"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* ── INDUSTRY BREADTH ───────────────────────────────────────── */}
              {intern.industries?.length>0&&(
                <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,
                  padding:"14px 16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    marginBottom:8}}>
                    <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,letterSpacing:".12em"}}>
                      INDUSTRY BREADTH
                      <span style={{color:T.textGhost,marginLeft:6,fontSize:7.5}}>
                        % above EMA200 · Avg {PERIODS.find(p=>p.k===breadthPeriod)?.l} return · Avg RS
                      </span>
                    </div>
                    <div style={{display:"flex",gap:5,alignItems:"center"}}>
                      <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>
                        Filter sector:
                      </span>
                      <select value={breadthSectorFilter}
                        onChange={e=>setBreadthSectorFilter(e.target.value)}
                        style={{background:T.bg,border:`1px solid ${T.border2}`,color:T.text,
                          fontFamily:"monospace",fontSize:8,padding:"3px 6px",borderRadius:3}}>
                        <option value="">All Sectors</option>
                        {intern.sectors.map(s=>(
                          <option key={s.sector} value={s.sector}>{s.sector}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {/* Header */}
                  <div style={{display:"grid",
                    gridTemplateColumns:"200px 120px 72px 66px 66px 80px 64px",
                    gap:4,padding:"5px 4px",borderBottom:`2px solid ${T.border}`,
                    fontFamily:"monospace",fontSize:7.5,color:T.textGhost,letterSpacing:".1em"}}>
                    <span>INDUSTRY</span>
                    <span>SECTOR</span>
                    <span style={{textAlign:"center"}}>ABV200</span>
                    <span style={{textAlign:"center"}}>ABV50</span>
                    <span style={{textAlign:"center"}}>STAGE2</span>
                    <span style={{textAlign:"center",color:"#a78bfa88"}}>
                      AVG {PERIODS.find(p=>p.k===breadthPeriod)?.l}%
                    </span>
                    <span style={{textAlign:"center"}}>AVG RS</span>
                  </div>
                  {/* Industry rows — filtered + sorted by selected period */}
                  {[...intern.industries]
                    .filter(ind=>!breadthSectorFilter||ind.sector===breadthSectorFilter)
                    .sort((a,b)=>(b[breadthPeriod]??-999)-(a[breadthPeriod]??-999))
                    .slice(0, breadthShowAll ? 9999 : 30)
                    .map(ind=>{
                      const c200   = ind.pctAbove200>=60?T.accent:ind.pctAbove200>=40?"#ffe040":T.down;
                      const retVal = ind[breadthPeriod];
                      const retC   = retVal==null?T.textFaint:retVal>=0?T.accent:"#ff6060";
                      return(
                        <div key={ind.industry} style={{display:"grid",
                          gridTemplateColumns:"200px 120px 72px 66px 66px 80px 64px",
                          gap:4,padding:"6px 4px",borderBottom:`1px solid ${T.border}`,alignItems:"center"}}>
                          <div>
                            <span style={{fontFamily:"monospace",fontSize:8.5,color:T.text,
                              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>
                              {ind.industry}
                            </span>
                            <span style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>
                              {ind.total} stocks
                            </span>
                          </div>
                          <span style={{fontFamily:"monospace",fontSize:7.5,
                            color:secCol(ind.sector)||T.textDim,
                            overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            {ind.sector}
                          </span>
                          <div style={{textAlign:"center"}}>
                            <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,color:c200}}>
                              {ind.pctAbove200}%
                            </span>
                            <div style={{height:2,background:T.textGhost2,borderRadius:1,marginTop:2,overflow:"hidden"}}>
                              <div style={{width:`${ind.pctAbove200}%`,height:"100%",background:c200}}/>
                            </div>
                          </div>
                          <span style={{fontFamily:"monospace",fontSize:9,textAlign:"center",
                            color:ind.pctAbove50>=50?T.accent:T.textDim}}>
                            {ind.pctAbove50}%
                          </span>
                          <span style={{fontFamily:"monospace",fontSize:9,textAlign:"center",
                            color:ind.pctStage2>=30?T.accent:T.textDim}}>
                            {ind.pctStage2}%
                          </span>
                          <div style={{textAlign:"center",background:"rgba(167,139,250,.05)",
                            borderRadius:3,padding:"2px 4px"}}>
                            <span style={{fontFamily:"monospace",fontSize:10,fontWeight:700,color:retC}}>
                              {retVal!=null?(retVal>=0?"+":"")+retVal.toFixed(1)+"%" : "—"}
                            </span>
                          </div>
                          <span style={{fontFamily:"monospace",fontSize:9,textAlign:"center",
                            color:ind.avgRS>=70?T.accent:ind.avgRS>=50?"#ffe040":T.textDim}}>
                            {ind.avgRS??"-"}
                          </span>
                        </div>
                      );
                    })
                  }
                  {/* Show more button */}
                  {!breadthShowAll&&(
                    (intern.industries.filter(i=>!breadthSectorFilter||i.sector===breadthSectorFilter).length>30)
                  )&&(
                    <div style={{textAlign:"center",paddingTop:8}}>
                      <button onClick={()=>setBreadthShowAll(true)}
                        style={{fontFamily:"monospace",fontSize:8,padding:"5px 16px",
                          borderRadius:3,border:"none",cursor:"pointer",
                          background:"rgba(167,139,250,.1)",color:"#a78bfa",
                          outline:"1px solid rgba(167,139,250,.2)"}}>
                        ↓ Show all {intern.industries.filter(i=>!breadthSectorFilter||i.sector===breadthSectorFilter).length} industries
                      </button>
                    </div>
                  )}
                </div>
              )}
              </>);
            })()}
          </>)}
        </div>
      )}

      {/* ══ TOP SETUPS TAB ══════════════════════════════════════════════════ */}
      {tab==="setups"&&(
        <div>
          {/* ── Filter panel ──────────────────────────────────────────────── */}
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,
            padding:"12px 14px",marginBottom:12}}>

            {/* Row 1: Score + RS + Price/Vol */}
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:10}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:"#a78bfa88",
                minWidth:60,alignSelf:"center",letterSpacing:".1em"}}>SCORE</span>
              {/* Setup Score range */}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Min Setup Score</span>
                <input value={filterS.minScore} onChange={e=>setF("minScore",e.target.value)}
                  style={{width:50,background:T.inputBg,border:"1px solid #00e87a22",borderRadius:3,
                    padding:"4px 6px",fontFamily:"monospace",fontSize:10,color:T.accent,outline:"none"}}/>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Max Setup Score</span>
                <input value={filterS.maxScore} onChange={e=>setF("maxScore",e.target.value)}
                  style={{width:50,background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:3,
                    padding:"4px 6px",fontFamily:"monospace",fontSize:10,color:T.text,outline:"none"}}/>
              </div>
              {/* RS Rank range */}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Min RS Rank</span>
                <input value={filterS.minRS} onChange={e=>setF("minRS",e.target.value)}
                  style={{width:50,background:T.inputBg,border:"1px solid #a78bfa22",borderRadius:3,
                    padding:"4px 6px",fontFamily:"monospace",fontSize:10,color:"#a78bfa",outline:"none"}}/>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Max RS Rank</span>
                <input value={filterS.maxRS} onChange={e=>setF("maxRS",e.target.value)}
                  style={{width:50,background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:3,
                    padding:"4px 6px",fontFamily:"monospace",fontSize:10,color:T.text,outline:"none"}}/>
              </div>
              {/* Price */}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Min Price $</span>
                <input value={filterS.minPrice} onChange={e=>setF("minPrice",e.target.value)}
                  style={{width:52,background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:3,
                    padding:"4px 6px",fontFamily:"monospace",fontSize:10,color:T.text,outline:"none"}}/>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Max Price $</span>
                <input value={filterS.maxPrice} onChange={e=>setF("maxPrice",e.target.value)}
                  placeholder="∞"
                  style={{width:52,background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:3,
                    padding:"4px 6px",fontFamily:"monospace",fontSize:10,color:T.text,outline:"none"}}/>
              </div>
              {/* Share Volume */}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Min Share Vol</span>
                <input value={filterS.minVol} onChange={e=>setF("minVol",e.target.value)}
                  placeholder="100000"
                  style={{width:88,background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:3,
                    padding:"4px 6px",fontFamily:"monospace",fontSize:10,color:T.text,outline:"none"}}/>
              </div>
              {/* Dollar Volume */}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:"#00d4ff88"}}>
                  Min $ Volume <span style={{color:T.textFaint}}>(price×vol)</span>
                </span>
                <select value={filterS.minDolVol||""} onChange={e=>setF("minDolVol",e.target.value)}
                  style={{background:T.bg,border:"1px solid #00d4ff22",color:"#00d4ff",
                    fontFamily:"monospace",fontSize:9,padding:"5px 7px",borderRadius:3}}>
                  <option value="">Any</option>
                  <option value="500000">$500K+</option>
                  <option value="1000000">$1M+</option>
                  <option value="5000000">$5M+</option>
                  <option value="10000000">$10M+</option>
                  <option value="25000000">$25M+</option>
                  <option value="50000000">$50M+</option>
                  <option value="100000000">$100M+</option>
                </select>
              </div>
              {/* Results limit */}
              <div style={{display:"flex",flexDirection:"column",gap:3,minWidth:100}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>
                  Max Results
                </span>
                <div style={{display:"flex",gap:5,alignItems:"center"}}>
                  <input
                    value={filterS.limit}
                    onChange={e=>setF("limit",e.target.value)}
                    placeholder="All"
                    style={{width:60,background:T.inputBg,border:`1px solid ${T.border}`,
                      borderRadius:3,padding:"4px 6px",fontFamily:"monospace",
                      fontSize:10,color:"#a78bfa",outline:"none"}}/>
                  <button onClick={()=>setF("limit","")}
                    style={{fontFamily:"monospace",fontSize:8,padding:"4px 8px",
                      borderRadius:3,border:"none",cursor:"pointer",
                      background: !filterS.limit?"rgba(167,139,250,.25)":"rgba(167,139,250,.07)",
                      color: !filterS.limit?"#a78bfa":T.textDim,
                      outline:`1px solid ${!filterS.limit?"rgba(167,139,250,.4)":T.border}`}}>
                    ALL
                  </button>
                </div>
                <span style={{fontFamily:"monospace",fontSize:6.5,color:T.textGhost}}>
                  {filterS.limit?`showing top ${filterS.limit}`:"showing all matches"}
                </span>
              </div>
            </div>

            {/* Row 2: Stage + EMA + Sector + VCP */}
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:10,
              paddingTop:8,borderTop:`1px solid ${T.border}`}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:"#a78bfa88",
                minWidth:60,alignSelf:"center",letterSpacing:".1em"}}>TECHNICAL</span>
              {/* Stage */}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Stage</span>
                <select value={filterS.stage} onChange={e=>setF("stage",e.target.value)}
                  style={{background:T.bg,border:`1px solid ${T.border2}`,color:T.text,
                    fontFamily:"monospace",fontSize:9,padding:"5px 7px",borderRadius:3}}>
                  <option value="0">Any Stage</option>
                  <option value="2">Stage 2 — Uptrend</option>
                  <option value="1">Stage 1 — Basing</option>
                  <option value="3">Stage 3 — Topping</option>
                  <option value="4">Stage 4 — Decline</option>
                </select>
              </div>
              {/* EMA */}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>EMA Position</span>
                <select value={filterS.emaFilter} onChange={e=>setF("emaFilter",e.target.value)}
                  style={{background:T.bg,border:`1px solid ${T.border2}`,color:T.text,
                    fontFamily:"monospace",fontSize:9,padding:"5px 7px",borderRadius:3}}>
                  <option value="any">Any</option>
                  <option value="above50">Above EMA50</option>
                  <option value="above200">Above EMA200</option>
                  <option value="above_both">Above EMA50 + EMA200</option>
                </select>
              </div>
              {/* Sector — loaded from DB */}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>
                  Sector {sectorsList.length>0&&<span style={{color:T.textFaint}}>({sectorsList.length})</span>}
                </span>
                <select value={filterS.sectors[0]||""}
                  onChange={e=>{
                    setF("sectors", e.target.value ? [e.target.value] : []);
                    setF("industries", []);  // reset industry when sector changes
                  }}
                  style={{background:T.bg,border:`1px solid ${T.border2}`,color:T.text,
                    fontFamily:"monospace",fontSize:9,padding:"5px 7px",borderRadius:3,minWidth:170}}>
                  <option value="">— All Sectors —</option>
                  {sectorsList.map(s=>(
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              {/* Industry — filtered by selected sector */}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>
                  Industry {industriesList.length>0&&<span style={{color:T.textFaint}}>({industriesList.length})</span>}
                </span>
                <select value={(filterS.industries||[])[0]||""}
                  onChange={e=>setF("industries", e.target.value ? [e.target.value] : [])}
                  style={{background:T.bg,border:`1px solid ${T.border2}`,color:T.text,
                    fontFamily:"monospace",fontSize:9,padding:"5px 7px",borderRadius:3,minWidth:200}}>
                  <option value="">— All Industries —</option>
                  {industriesList.map(ind=>(
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
              </div>
              {/* Min VCP */}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Min VCP Score</span>
                <input value={filterS.vcpMin} onChange={e=>setF("vcpMin",e.target.value)}
                  placeholder="0"
                  style={{width:52,background:T.inputBg,border:"1px solid #00d4ff22",borderRadius:3,
                    padding:"4px 6px",fontFamily:"monospace",fontSize:10,color:"#00d4ff",outline:"none"}}/>
              </div>
              {/* Exclude earnings */}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Excl earnings ≤ N days</span>
                <input value={filterS.maxEarn} onChange={e=>setF("maxEarn",e.target.value)}
                  placeholder="0 = off"
                  style={{width:68,background:T.inputBg,border:"1px solid #ff9f1c22",borderRadius:3,
                    padding:"4px 6px",fontFamily:"monospace",fontSize:10,color:"#ff9f1c",outline:"none"}}/>
              </div>
            </div>

            {/* Row 3: Checkboxes + Sort + Apply */}
            <div style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"center",
              paddingTop:8,borderTop:`1px solid ${T.border}`}}>
              <span style={{fontFamily:"monospace",fontSize:7.5,color:"#a78bfa88",
                minWidth:60,letterSpacing:".1em"}}>FLAGS</span>
              {/* Checkboxes */}
              {[
                ["ppOnly",  "Pocket Pivot only",    "#00d4ff"],
                ["rsLineHi","RS Line at 52W High",  "#a78bfa"],
              ].map(([k,label,c])=>(
                <label key={k} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer"}}>
                  <input type="checkbox" checked={!!filterS[k]}
                    onChange={e=>setF(k,e.target.checked)}
                    style={{accentColor:c, width:12, height:12}}/>
                  <span style={{fontFamily:"monospace",fontSize:8,color:c}}>{label}</span>
                </label>
              ))}
              {/* Sort by */}
              <div style={{display:"flex",flexDirection:"column",gap:2,marginLeft:"auto"}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Sort By</span>
                <select value={filterS.sortBy} onChange={e=>setF("sortBy",e.target.value)}
                  style={{background:T.bg,border:`1px solid ${T.border2}`,color:T.text,
                    fontFamily:"monospace",fontSize:9,padding:"5px 7px",borderRadius:3}}>
                  <option value="setup_score">Setup Score</option>
                  <option value="rs_rank">RS Rank (composite)</option>
                  <option value="rs_rank_3m">RS Rank (3M)</option>
                  <option value="d63">3M Return %</option>
                  <option value="d126">6M Return %</option>
                  <option value="d252">1Y Return %</option>
                  <option value="ytd">YTD Return %</option>
                  <option value="vcp_score">VCP Score</option>
                  <option value="adr14">ADR% (volatility)</option>
                  <option value="rsi14">RSI(14)</option>
                  <option value="market_cap">Market Cap</option>
                  <option value="dol_vol">$ Volume (daily)</option>
                </select>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Dir</span>
                <div style={{display:"flex",background:T.inputBg,border:`1px solid ${T.border}`,
                  borderRadius:3,overflow:"hidden"}}>
                  {[["desc","▲ TOP"],["asc","▼ BOTTOM"]].map(([v,l])=>(
                    <button key={v} onClick={()=>setF("sortDir",v)}
                      style={{fontFamily:"monospace",fontSize:8,padding:"4px 10px",
                        border:"none",cursor:"pointer",
                        background:filterS.sortDir===v?"rgba(167,139,250,.2)":"transparent",
                        color:filterS.sortDir===v?"#a78bfa":T.textDim}}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {/* Apply */}
              <button onClick={()=>load("setups")}
                style={{fontFamily:"monospace",fontSize:10,fontWeight:700,
                  padding:"7px 20px",borderRadius:4,border:"none",cursor:"pointer",
                  background:"rgba(167,139,250,.25)",color:"#a78bfa",
                  outline:"1px solid rgba(167,139,250,.5)"}}>
                ▶ APPLY
              </button>
              {/* Export to Excel */}
              {sortedSetups.length>0&&(
                <button onClick={()=>exportToExcel(sortedSetups)}
                  style={{fontFamily:"monospace",fontSize:10,fontWeight:700,
                    padding:"7px 16px",borderRadius:4,border:"none",cursor:"pointer",
                    background:"rgba(0,232,122,.15)",color:T.accent,
                    outline:"1px solid rgba(0,232,122,.3)"}}>
                  ⬇ EXCEL
                </button>
              )}
              {/* Quick presets */}
              {[
                {l:"Stage 2 Leaders", f:{stage:"2",minRS:"80",minScore:"60",emaFilter:"above_both",ppOnly:false,rsLineHi:false,sortBy:"setup_score"}},
                {l:"RS 90+ Any Stage",f:{stage:"0",minRS:"90",minScore:"50",emaFilter:"any",ppOnly:false,rsLineHi:false,sortBy:"rs_rank"}},
                {l:"Pocket Pivots",   f:{stage:"0",minRS:"60",minScore:"50",emaFilter:"any",ppOnly:true, rsLineHi:false,sortBy:"setup_score"}},
                {l:"RS Line Highs",  f:{stage:"0",minRS:"70",minScore:"50",emaFilter:"above200",ppOnly:false,rsLineHi:true,sortBy:"rs_rank"}},
                {l:"High VCP",       f:{stage:"0",minRS:"60",minScore:"50",emaFilter:"above50",vcpMin:"60",ppOnly:false,rsLineHi:false,sortBy:"vcp_score"}},
                {l:"Reset",          f:{minScore:"0",maxScore:"100",minRS:"0",maxRS:"99",minPrice:"1",maxPrice:"",minVol:"100000",minDolVol:"",stage:"0",emaFilter:"any",sectors:[],industries:[],vcpMin:"0",ppOnly:false,rsLineHi:false,maxEarn:"0",sortBy:"setup_score",sortDir:"desc",limit:""}},
              ].map(({l,f})=>(
                <button key={l} onClick={()=>{setFilterS(p=>({...p,...f})); setTimeout(()=>load("setups"),50);}}
                  style={{fontFamily:"monospace",fontSize:8,padding:"4px 8px",borderRadius:3,
                    border:"none",cursor:"pointer",
                    background:l==="Reset"?"rgba(255,69,96,.08)":"rgba(167,139,250,.07)",
                    color:l==="Reset"?T.down:"#a78bfa88",
                    outline:`1px solid ${l==="Reset"?"rgba(255,69,96,.2)":"rgba(167,139,250,.15)"}`}}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          {sortedSetups.length>0 ? (
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,
              overflow:"hidden"}}>
              {/* Result summary bar */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"6px 14px",background:T.row,borderBottom:`1px solid ${T.border}`}}>
                <span style={{fontFamily:"monospace",fontSize:8,color:T.textDim}}>
                  <span style={{color:"#a78bfa",fontWeight:700}}>{sortedSetups.length}</span> results
                  {filterS.sortBy&&<span style={{color:T.textFaint,marginLeft:8}}>
                    sorted by {filterS.sortBy.replace(/_/g," ")} {filterS.sortDir==="desc"?"↓":"↑"}
                  </span>}
                </span>
                <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint}}>
                  click column header to sort · ⚖ to risk calc
                </span>
              </div>
              <div style={{display:"grid",
                gridTemplateColumns:"68px 110px 140px 64px 68px 58px 54px 56px 60px 60px 60px 66px",
                padding:"8px 14px",background:T.row,
                borderBottom:`2px solid ${T.border}`,gap:4,alignItems:"center"}}>
                {th(null,"TICKER")}
                {th("sector","SECTOR")}
                {th("industry","INDUSTRY")}
                {th("market_cap","MKT CAP")}
                {th("close","PRICE")}
                {th("setup_score","SETUP")}
                {th("rs_rank","RS")}
                {th("stage","STG")}
                {th("d63","3M%")}
                {th("dol_vol","$VOL")}
                {th("vcp_score","VCP")}
                <span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>FLAGS</span>
              </div>
              {sortedSetups.map((r,i)=>(
                <div key={r.symbol} style={{
                  display:"grid",
                  gridTemplateColumns:"68px 110px 140px 64px 68px 58px 54px 56px 60px 60px 60px 66px",
                  padding:"8px 14px",gap:4,alignItems:"center",
                  borderBottom: i<sortedSetups.length-1?`1px solid ${T.border}`:"none",
                  background: r.pocket_pivot?"rgba(0,212,255,.03)":"transparent",
                  transition:"background .1s",
                }} onMouseEnter={e=>e.currentTarget.style.background="rgba(167,139,250,.04)"}
                   onMouseLeave={e=>e.currentTarget.style.background=r.pocket_pivot?"rgba(0,212,255,.03)":"transparent"}>
                  <div>
                    <span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:"#fff"}}>
                      {r.symbol}
                    </span>
                    {r.rs_line_hi===1&&(
                      <div style={{fontFamily:"monospace",fontSize:7,color:"#a78bfa"}}>RS↑ HIGH</div>
                    )}
                  </div>
                  <span style={{fontFamily:"monospace",fontSize:8,color:secCol(r.sector)||T.textDim,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.sector||"—"}</span>
                  <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.industry||"—"}</span>
                  {/* Market Cap */}
                  <div style={{textAlign:"center"}}>
                    {(()=>{
                      const mc = r.market_cap;
                      if (!mc) return <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>—</span>;
                      const n = +mc;
                      const [val,sfx,c] = n>=1e12?[(n/1e12).toFixed(1),"T","#a78bfa"]:
                                          n>=1e9 ?[(n/1e9).toFixed(1),"B","#00d4ff"]:
                                          n>=1e6 ?[(n/1e6).toFixed(1),"M",T.accent]:
                                                  [(n/1e3).toFixed(0),"K",T.textDim];
                      return(
                        <span style={{fontFamily:"monospace",fontSize:9,fontWeight:600,color:c}}>
                          ${val}{sfx}
                        </span>
                      );
                    })()}
                  </div>
                  <div style={{textAlign:"center"}}>
                    <div style={{fontFamily:"monospace",fontSize:11,color:T.text}}>
                      ${(r.close||0).toFixed(2)}
                    </div>
                    <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim}}>
                      {r.pct_hi52?`${r.pct_hi52.toFixed(0)}% of 52H`:""}
                    </div>
                  </div>
                  <div>
                    <SetupBar score={r.setup_score}/>
                  </div>
                  <div style={{textAlign:"center"}}><RSBadge rank={r.rs_rank}/></div>
                  <div style={{textAlign:"center"}}><StageBadge stage={r.stage}/></div>
                  <div style={{textAlign:"center"}}>
                    {r.d63!=null ? (
                      <span style={{fontFamily:"monospace",fontSize:10,fontWeight:600,
                        color:r.d63>=0?T.accent:"#ff6060"}}>
                        {r.d63>=0?"+":""}{r.d63.toFixed(1)}%
                      </span>
                    ) : "—"}
                  </div>
                  {/* $ Volume cell */}
                  <div style={{textAlign:"center"}}>
                    {(()=>{
                      const dv = r.dol_vol || (r.close * r.volume);
                      if (!dv) return <span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>—</span>;
                      const fmt = dv>=1e9?(dv/1e9).toFixed(1)+"B":dv>=1e6?(dv/1e6).toFixed(1)+"M":dv>=1e3?(dv/1e3).toFixed(0)+"K":String(Math.round(dv));
                      const c   = dv>=50e6?T.accent:dv>=10e6?T.accent:dv>=1e6?"#ffe040":T.textDim;
                      return(
                        <span style={{fontFamily:"monospace",fontSize:9,fontWeight:600,color:c}}>
                          ${fmt}
                        </span>
                      );
                    })()}
                  </div>
                  <div style={{textAlign:"center"}}>
                    {r.vcp_score>0 ? (
                      <div>
                        <div style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
                          color:r.vcp_score>=70?"#00d4ff":r.vcp_score>=50?"#4cc9f0":T.textFaint}}>
                          {r.vcp_score}
                        </div>
                        <div style={{height:2,background:T.textGhost2,borderRadius:1,overflow:"hidden",width:50}}>
                          <div style={{width:`${r.vcp_score}%`,height:"100%",
                            background:r.vcp_score>=70?"#00d4ff":"#4cc9f0"}}/>
                        </div>
                      </div>
                    ) : "—"}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:3}}>
                    {r.pocket_pivot===1&&(
                      <span style={{fontFamily:"monospace",fontSize:7,color:"#00d4ff",
                        background:"rgba(0,212,255,.1)",padding:"1px 4px",borderRadius:2}}>
                        PP↑
                      </span>
                    )}
                    {r.tight_flag===1&&(
                      <span style={{fontFamily:"monospace",fontSize:7,color:"#a78bfa",
                        background:"rgba(167,139,250,.1)",padding:"1px 4px",borderRadius:2}}>
                        TIGHT
                      </span>
                    )}
                    {r.days_to_earn!=null&&<EarningsBadge days={r.days_to_earn}/>}
                    <button onClick={()=>{setRiskPf(r);setTab("risk");}}
                      style={{fontFamily:"monospace",fontSize:7,padding:"2px 5px",borderRadius:2,
                        border:"none",cursor:"pointer",background:"rgba(0,232,122,.1)",
                        color:T.accent}}>⚖</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{fontFamily:"monospace",fontSize:10,color:T.textFaint,textAlign:"center",
              padding:48,background:T.bg,border:`1px solid ${T.border}`,borderRadius:6}}>
              {loading.setups ? "Loading setups…"
                : "No setups matching filters. Run: npm run compute:analytics"}
            </div>
          )}
        </div>
      )}

      {/* ══ EARNINGS TAB ════════════════════════════════════════════════════ */}
      {tab==="earnings"&&(
        <div>
          <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,marginBottom:10}}>
            EARNINGS IN NEXT 14 DAYS — {earn.length} stocks
            <span style={{color:T.textDim,marginLeft:8,fontSize:8}}>
              Run npm run compute:earnings to refresh
            </span>
          </div>
          {earn.length>0 ? (
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden"}}>
              <div style={{display:"grid",gridTemplateColumns:"68px 140px 90px 72px 70px 60px 56px 70px 70px",
                padding:"8px 14px",background:T.surface2,borderBottom:`2px solid ${T.border}`,gap:4}}>
                {["TICKER","COMPANY","DATE","PRICE","3M%","RS","STG","SETUP","ADR%"].map(l=>(
                  <span key={l} style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>{l}</span>
                ))}
              </div>
              {earn.map((r,i)=>{
                const dc = r.days_to_earn<=2?T.down:r.days_to_earn<=5?"#ff9f1c":"#ffe040";
                return (
                  <div key={r.symbol} style={{display:"grid",
                    gridTemplateColumns:"68px 140px 90px 72px 70px 60px 56px 70px 70px",
                    padding:"8px 14px",gap:4,alignItems:"center",
                    borderBottom:i<earn.length-1?`1px solid ${T.border}`:"none"}}>
                    <span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:"#fff"}}>
                      {r.symbol}
                    </span>
                    <span style={{fontFamily:"monospace",fontSize:8,color:T.textDim,
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {r.name||"—"}
                    </span>
                    <div>
                      <span style={{fontFamily:"monospace",fontSize:9,color:dc,fontWeight:700}}>
                        {r.earnings_date}
                      </span>
                      <div style={{fontFamily:"monospace",fontSize:7,color:dc}}>
                        {r.days_to_earn===0?"TODAY":r.days_to_earn===1?"TOMORROW":`in ${r.days_to_earn}d`}
                      </div>
                    </div>
                    <span style={{fontFamily:"monospace",fontSize:11,color:T.text,textAlign:"center"}}>
                      ${(r.close||0).toFixed(2)}
                    </span>
                    <span style={{fontFamily:"monospace",fontSize:10,textAlign:"center",
                      color:r.d63>=0?T.accent:"#ff6060"}}>
                      {r.d63!=null?(r.d63>=0?"+":"")+r.d63.toFixed(1)+"%":"—"}
                    </span>
                    <div style={{textAlign:"center"}}><RSBadge rank={r.rs_rank}/></div>
                    <div style={{textAlign:"center"}}><StageBadge stage={r.stage}/></div>
                    <div><SetupBar score={r.setup_score}/></div>
                    <span style={{fontFamily:"monospace",fontSize:9,textAlign:"center",
                      color:r.adr14>=5?"#ff9f1c":T.textDim}}>
                      {r.adr14!=null?r.adr14.toFixed(1)+"%":"—"}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{fontFamily:"monospace",fontSize:10,color:T.textFaint,textAlign:"center",
              padding:48,background:T.bg,border:`1px solid ${T.border}`,borderRadius:6}}>
              {loading.earnings ? "Loading…" : "No earnings data. Run: npm run compute:earnings"}
            </div>
          )}
        </div>
      )}

      {/* ══ SYMBOL SEARCH TAB ══════════════════════════════════════════════ */}
      {tab==="symbol"&&(
        <div>
          {/* Search bar */}
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:16,
            background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,padding:"12px 16px"}}>
            <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,
              letterSpacing:".12em",minWidth:80}}>SYMBOL LOOKUP</div>
            <input
              value={symQuery}
              onChange={e=>setSymQuery(e.target.value.toUpperCase())}
              onKeyDown={e=>{ if(e.key==="Enter") lookupSymbol(symQuery); }}
              placeholder="e.g. AAPL, NVDA, TSLA"
              style={{flex:1,maxWidth:260,background:T.inputBg,border:"1px solid #a78bfa44",
                borderRadius:4,padding:"8px 12px",fontFamily:"monospace",fontSize:13,
                color:"#fff",outline:"none",letterSpacing:".06em"}}
            />
            <button onClick={()=>lookupSymbol(symQuery)}
              style={{fontFamily:"monospace",fontSize:10,fontWeight:700,padding:"8px 20px",
                borderRadius:4,border:"none",cursor:"pointer",
                background:"rgba(167,139,250,.25)",color:"#a78bfa",
                outline:"1px solid rgba(167,139,250,.5)"}}>
              SEARCH
            </button>
            {symLoading&&(
              <span style={{fontFamily:"monospace",fontSize:9,color:T.textFaint}}>
                Looking up…
              </span>
            )}
            {symErr&&(
              <span style={{fontFamily:"monospace",fontSize:9,color:T.down}}>
                ⚠ {symErr}
              </span>
            )}
          </div>

          {/* Result panel */}
          {symResult&&(()=>{
            const r   = symResult.data || {};
            const ctx = symResult.context || {};
            const bars= symResult.bars || [];

            const gc2 = v => v>=0 ? T.accent : T.down;
            const pct2= v => v==null?"—":(v>=0?"+":"")+v.toFixed(2)+"%";
            const fmt2= v => v==null?"—":("$"+v.toFixed(2));

            // Stage config
            const stageMap = {
              1:{c:"#ffe040",lbl:"STAGE 1 — BASING",  desc:"Accumulation phase. Waiting for breakout."},
              2:{c:T.accent,lbl:"STAGE 2 — UPTREND", desc:"Ideal trend. Price above rising MAs."},
              3:{c:"#ff9f1c",lbl:"STAGE 3 — TOPPING", desc:"Distribution. Weakening internals."},
              4:{c:T.down,lbl:"STAGE 4 — DECLINE", desc:"Downtrend. Avoid or short."},
            };
            const stage = stageMap[r.stage] || null;

            // RS rank color
            const rsC = r.rs_rank>=90?T.accent:r.rs_rank>=80?T.accent:r.rs_rank>=70?"#ffe040":r.rs_rank>=50?"#ff9f1c":T.down;
            const scC = r.setup_score>=80?T.accent:r.setup_score>=60?T.accent:r.setup_score>=40?"#ffe040":"#ff9f1c";

            // Mini sparkline from bars
            const closes = bars.map(b=>b.close).filter(Boolean);
            const spMin  = Math.min(...closes);
            const spMax  = Math.max(...closes);
            const spH    = 60, spW = 320;
            const spPts  = closes.map((c,i)=>`${(i/(closes.length-1))*spW},${spH - ((c-spMin)/(spMax-spMin||1))*spH}`).join(" ");

            return (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>

                {/* ── Left: Identity + Price ── */}
                <div style={{background:T.surface,border:`1px solid ${T.border}`,
                  borderRadius:6,padding:"16px 18px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",
                    alignItems:"flex-start",marginBottom:12}}>
                    <div>
                      <div style={{fontFamily:"monospace",fontSize:28,fontWeight:700,
                        color:"#fff",lineHeight:1}}>{symResult.symbol}</div>
                      <div style={{fontFamily:"monospace",fontSize:11,color:T.textDim,
                        marginTop:4}}>{r.name||"—"}</div>
                      <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                        {r.sector&&<span style={{fontFamily:"monospace",fontSize:8,fontWeight:600,
                          padding:"2px 8px",borderRadius:3,
                          background:`${(()=>{try{return secCol(r.sector)}catch{returnT.textDim}})()}22`,
                          color:(()=>{try{return secCol(r.sector)}catch{returnT.textDim}})()}}>{r.sector}</span>}
                        {r.industry&&<span style={{fontFamily:"monospace",fontSize:7.5,
                          color:T.textDim}}>{r.industry}</span>}
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontFamily:"monospace",fontSize:26,fontWeight:700,
                        color:T.text}}>${(r.close||0).toFixed(2)}</div>
                      <div style={{fontFamily:"monospace",fontSize:12,fontWeight:700,
                        color:gc2(r.d1||0),marginTop:2}}>{pct2(r.d1)}</div>
                    </div>
                  </div>

                  {/* Sparkline */}
                  {closes.length>2&&(
                    <div style={{background:T.row,borderRadius:3,padding:"6px 4px",
                      marginBottom:12}}>
                      <svg width="100%" height={spH} viewBox={`0 0 ${spW} ${spH}`}
                        preserveAspectRatio="none">
                        <polyline points={spPts} fill="none"
                          stroke={r.d252>=0?T.accent:T.down} strokeWidth={1.5}/>
                        <line x1={spW} y1={0} x2={spW} y2={spH}
                          stroke="#ffffff10" strokeWidth={1}/>
                      </svg>
                      <div style={{display:"flex",justifyContent:"space-between",
                        fontFamily:"monospace",fontSize:7,color:T.textFaint,
                        padding:"0 4px",marginTop:2}}>
                        <span>{bars[0]?.date||""}</span>
                        <span>63 trading days</span>
                        <span>{bars[bars.length-1]?.date||""}</span>
                      </div>
                    </div>
                  )}

                  {/* Price stats grid */}
                  {[
                    ["52W High",    r.hi52   ? "$"+r.hi52.toFixed(2)   : "—"],
                    ["52W Low",     r.lo52   ? "$"+r.lo52.toFixed(2)   : "—"],
                    ["% of 52W H",  r.pct_hi52 ? r.pct_hi52.toFixed(1)+"%" : "—"],
                    ["EMA 50",      r.ema50  ? "$"+r.ema50.toFixed(2)  : "—"],
                    ["EMA 200",     r.ema200 ? "$"+r.ema200.toFixed(2) : "—"],
                    ["SMA 150",     r.sma150 ? "$"+r.sma150.toFixed(2) : "—"],
                    ["Volume",      r.volume ? (r.volume/1e6).toFixed(2)+"M" : "—"],
                    ["ADR %",       r.adr14  ? r.adr14.toFixed(2)+"%" : "—"],
                    ["RSI(14)",     r.rsi14  ? r.rsi14.toFixed(1)      : "—"],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:"flex",justifyContent:"space-between",
                      padding:"4px 0",borderBottom:`1px solid ${T.border}`}}>
                      <span style={{fontFamily:"monospace",fontSize:8.5,color:T.textDim}}>{l}</span>
                      <span style={{fontFamily:"monospace",fontSize:8.5,color:T.text,
                        fontWeight:500}}>{v}</span>
                    </div>
                  ))}

                  {/* EMA position badges */}
                  <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                    {[["Above EMA50",r.above_ema50],["Above EMA200",r.above_ema200]].map(([l,v])=>(
                      <span key={l} style={{fontFamily:"monospace",fontSize:8,fontWeight:600,
                        padding:"3px 8px",borderRadius:3,
                        color:v===1?T.accent:T.down,
                        background:v===1?"rgba(0,232,122,.1)":"rgba(255,69,96,.1)"}}>
                        {v===1?"▲":"▼"} {l}
                      </span>
                    ))}
                  </div>
                </div>

                {/* ── Right: Analytics ── */}
                <div style={{display:"flex",flexDirection:"column",gap:10}}>

                  {/* Stage */}
                  {stage&&(
                    <div style={{background:T.surface,border:`1px solid ${stage.c}33`,
                      borderRadius:6,padding:"14px 16px"}}>
                      <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,
                        letterSpacing:".12em",marginBottom:6}}>WEINSTEIN STAGE</div>
                      <div style={{fontFamily:"monospace",fontSize:16,fontWeight:700,
                        color:stage.c,marginBottom:4}}>{stage.lbl}</div>
                      <div style={{fontFamily:"monospace",fontSize:8.5,color:T.textDim}}>
                        {stage.desc}
                      </div>
                    </div>
                  )}

                  {/* RS Rank + Setup Score */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <div style={{background:T.surface,border:`1px solid ${rsC}22`,
                      borderRadius:6,padding:"12px 14px",textAlign:"center"}}>
                      <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,
                        letterSpacing:".12em",marginBottom:6}}>RS RANK</div>
                      <div style={{fontFamily:"monospace",fontSize:32,fontWeight:700,
                        color:rsC,lineHeight:1}}>{r.rs_rank??"-"}</div>
                      <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,
                        marginTop:4}}>out of 99</div>
                      {ctx.rsRankPct!=null&&(
                        <div style={{fontFamily:"monospace",fontSize:8,color:rsC,marginTop:4}}>
                          beats {(100-ctx.rsRankPct).toFixed(0)}% of stocks
                        </div>
                      )}
                    </div>
                    <div style={{background:T.surface,border:`1px solid ${scC}22`,
                      borderRadius:6,padding:"12px 14px",textAlign:"center"}}>
                      <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,
                        letterSpacing:".12em",marginBottom:6}}>SETUP SCORE</div>
                      <div style={{fontFamily:"monospace",fontSize:32,fontWeight:700,
                        color:scC,lineHeight:1}}>{r.setup_score??"-"}</div>
                      <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,
                        marginTop:4}}>out of 100</div>
                      {ctx.setupPct!=null&&(
                        <div style={{fontFamily:"monospace",fontSize:8,color:scC,marginTop:4}}>
                          top {ctx.setupPct.toFixed(0)}% quality
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Returns table */}
                  <div style={{background:T.surface,border:`1px solid ${T.border}`,
                    borderRadius:6,padding:"12px 14px"}}>
                    <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,
                      letterSpacing:".12em",marginBottom:8}}>RETURNS</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                      {[
                        ["1D",  r.d1],  ["1W",  r.d5],  ["1M",  r.d21],
                        ["3M",  r.d63], ["6M",  r.d126],["1Y",  r.d252],
                        ["YTD", r.ytd], ["RS/SPY 3M",r.rs_3m],["RS/SPY 1Y",r.rs_12m],
                      ].map(([l,v])=>{
                        const c = v==null?T.textFaint:v>=0?T.accent:T.down;
                        return (
                          <div key={l} style={{background:T.row,borderRadius:3,
                            padding:"6px 8px",textAlign:"center"}}>
                            <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,
                              marginBottom:2}}>{l}</div>
                            <div style={{fontFamily:"monospace",fontSize:10,fontWeight:700,color:c}}>
                              {v==null?"—":(v>=0?"+":"")+v.toFixed(1)+"%"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Flags */}
                  <div style={{background:T.surface,border:`1px solid ${T.border}`,
                    borderRadius:6,padding:"12px 14px"}}>
                    <div style={{fontFamily:"monospace",fontSize:8,color:T.textFaint,
                      letterSpacing:".12em",marginBottom:8}}>SIGNALS & FLAGS</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
                      {r.pocket_pivot===1&&(
                        <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
                          color:"#00d4ff",background:"rgba(0,212,255,.12)",
                          padding:"3px 8px",borderRadius:3}}>⚡ POCKET PIVOT</span>
                      )}
                      {r.tight_flag===1&&(
                        <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
                          color:"#a78bfa",background:"rgba(167,139,250,.12)",
                          padding:"3px 8px",borderRadius:3}}>◈ TIGHT BASE</span>
                      )}
                      {r.rs_line_hi===1&&(
                        <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
                          color:"#a78bfa",background:"rgba(167,139,250,.12)",
                          padding:"3px 8px",borderRadius:3}}>📈 RS LINE HIGH</span>
                      )}
                      {r.vcp_score>50&&(
                        <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
                          color:"#00d4ff",background:"rgba(0,212,255,.12)",
                          padding:"3px 8px",borderRadius:3}}>
                          VCP {r.vcp_score}
                        </span>
                      )}
                    </div>
                    {r.earnings_date&&(
                      <div style={{fontFamily:"monospace",fontSize:9,
                        color:r.days_to_earn<=5?"#ff9f1c":"#ffe040"}}>
                        📅 Earnings: {r.earnings_date}
                        {r.days_to_earn!=null&&<span style={{marginLeft:6,fontSize:8,color:T.textDim}}>
                          ({r.days_to_earn===0?"today":r.days_to_earn===1?"tomorrow":`in ${r.days_to_earn} days`})
                        </span>}
                      </div>
                    )}
                    {/* RS vs ETF */}
                    {(r.rs_vs_sector!=null||r.rs_vs_industry!=null)&&(
                      <div style={{marginTop:8,display:"flex",gap:10}}>
                        {r.rs_vs_sector!=null&&(
                          <div style={{fontFamily:"monospace",fontSize:8}}>
                            <span style={{color:T.textFaint}}>RS vs Sector ETF: </span>
                            <span style={{fontWeight:700,
                              color:r.rs_vs_sector>=0?T.accent:T.down}}>
                              {r.rs_vs_sector>=0?"+":""}{r.rs_vs_sector.toFixed(1)}%
                              {r.sector_etf&&<span style={{color:"#a78bfa66",marginLeft:4}}>
                                ({r.sector_etf})</span>}
                            </span>
                          </div>
                        )}
                        {r.rs_vs_industry!=null&&(
                          <div style={{fontFamily:"monospace",fontSize:8}}>
                            <span style={{color:T.textFaint}}>RS vs Industry: </span>
                            <span style={{fontWeight:700,
                              color:r.rs_vs_industry>=0?T.accent:T.down}}>
                              {r.rs_vs_industry>=0?"+":""}{r.rs_vs_industry.toFixed(1)}%
                              {r.industry_etf&&<span style={{color:"#00d4ff66",marginLeft:4}}>
                                ({r.industry_etf})</span>}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Use in Risk Calc button */}
                  <button onClick={()=>{ setRiskPf(r); setTab("risk"); }}
                    style={{fontFamily:"monospace",fontSize:10,fontWeight:700,
                      padding:"10px",borderRadius:5,border:"none",cursor:"pointer",
                      background:"rgba(0,232,122,.15)",color:T.accent,
                      outline:"1px solid rgba(0,232,122,.3)"}}>
                    ⚖ USE IN RISK CALCULATOR
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Empty state */}
          {!symResult&&!symLoading&&!symErr&&(
            <div style={{fontFamily:"monospace",fontSize:10,color:T.textGhost,
              textAlign:"center",padding:60,
              background:T.surface,border:`1px solid ${T.border}`,borderRadius:6}}>
              Enter a ticker symbol above and press Enter or SEARCH
            </div>
          )}
        </div>
      )}

      {/* ══ EMA CROSS TAB ══════════════════════════════════════════════════ */}
      {tab==="emacross"&&(
        <div>
          {/* Filter bar */}
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,
            padding:"12px 16px",marginBottom:12}}>

            {/* Row 1: EMA toggles + Touch mode + Min touches */}
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end",marginBottom:10}}>

              {/* EMA Period multi-select (Pine: ema10_en ... ema200_en) */}
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontFamily:"monospace",fontSize:8,color:"#00e87a88",letterSpacing:".1em"}}>
                    EMA PERIOD
                  </span>
                  <span style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>(select multiple)</span>
                </div>
                <div style={{display:"flex",gap:4}}>
                  {["10","20","50","100","200"].map(n=>{
                    const sel = (emaCrossF.emas||[]).includes(n);
                    return(
                      <button key={n} onClick={()=>setEmaCrossF(p=>{
                        const cur  = p.emas||[];
                        const next = sel ? cur.filter(x=>x!==n) : [...cur,n];
                        return {...p, emas: next.length ? next : [n]};
                      })}
                        style={{fontFamily:"monospace",fontSize:10,fontWeight:700,
                          padding:"6px 14px",borderRadius:4,border:"none",cursor:"pointer",
                          background:sel?"rgba(0,232,122,.2)":T.row,
                          color:sel?T.accent:T.textDim,
                          outline:`1px solid ${sel?"rgba(0,232,122,.4)":T.border}`,
                          position:"relative"}}>
                        EMA {n}
                        {sel&&<span style={{position:"absolute",top:-4,right:-4,background:T.accent,
                          color:"#000",borderRadius:"50%",width:10,height:10,fontSize:7,
                          display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900}}>
                          ✓</span>}
                      </button>
                    );
                  })}
                </div>
                {(emaCrossF.emas||[]).length>0&&(
                  <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>
                    Selected: {(emaCrossF.emas||[]).map(e=>`EMA${e}`).join(" + ")}
                    {" ("}{(emaCrossF.emas||[]).length} EMA{(emaCrossF.emas||[]).length>1?"s":""}{")"}
                  </div>
                )}
              </div>

              {/* Touch mode (Pine: touchMode input) */}
              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Touch Condition</span>
                <div style={{display:"flex",background:T.inputBg,border:`1px solid ${T.border}`,
                  borderRadius:3,overflow:"hidden"}}>
                  {[
                    ["min","Min touches (≥)"],
                    ["all","All selected EMAs"],
                  ].map(([v,l])=>(
                    <button key={v} onClick={()=>setEmaCrossF(p=>({...p,touchMode:v}))}
                      style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
                        padding:"7px 14px",border:"none",cursor:"pointer",
                        background:emaCrossF.touchMode===v?"rgba(0,232,122,.2)":"transparent",
                        color:emaCrossF.touchMode===v?T.accent:T.textDim}}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Min touches (Pine: minTouches — only shown in "min" mode) */}
              {emaCrossF.touchMode==="min"&&(
                <div style={{display:"flex",flexDirection:"column",gap:3}}>
                  <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>
                    Min EMAs to touch
                  </span>
                  <div style={{display:"flex",gap:3}}>
                    {[1,2,3,4,5].filter(n=>n<=(emaCrossF.emas||[]).length||n===1).map(n=>{
                      const active = (+emaCrossF.minTouches||1) === n;
                      const c = n===1?T.accent:n===2?"#ffe040":n===3?"#ff9f1c":n===4?T.down:"#a78bfa";
                      return(
                        <button key={n} onClick={()=>setEmaCrossF(p=>({...p,minTouches:String(n)}))}
                          style={{fontFamily:"monospace",fontSize:10,fontWeight:700,
                            width:32,height:32,borderRadius:4,border:"none",cursor:"pointer",
                            background:active?`${c}25`:T.row,color:active?c:T.textDim,
                            outline:`1px solid ${active?c+"55":T.border}`}}>
                          {n}
                        </button>
                      );
                    })}
                  </div>
                  <span style={{fontFamily:"monospace",fontSize:6.5,color:T.textFaint}}>
                    {(+emaCrossF.minTouches||1)===1?"any 1 touch"
                     :(+emaCrossF.minTouches||1)===2?"≥2 EMAs touched (yellow)"
                     :(+emaCrossF.minTouches||1)===3?"≥3 EMAs touched (orange)"
                     :(+emaCrossF.minTouches||1)===4?"≥4 EMAs touched (red)"
                     :"all 5 EMAs touched (purple)"}
                  </span>
                </div>
              )}

              {/* Filters: price, vol, sector, industry */}
              {[["Min $","minPrice","5",52],["Min Vol","minVol","100000",90]].map(([lbl,k,ph,w])=>(
                <div key={k} style={{display:"flex",flexDirection:"column",gap:2}}>
                  <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>{lbl}</span>
                  <input value={emaCrossF[k]} onChange={e=>setEmaCrossF(p=>({...p,[k]:e.target.value}))}
                    placeholder={ph}
                    style={{width:w,background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:3,
                      padding:"4px 6px",fontFamily:"monospace",fontSize:10,color:T.text,outline:"none"}}/>
                </div>
              ))}

              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Sector</span>
                <select value={(emaCrossF.sectors||[])[0]||""}
                  onChange={e=>setEmaCrossF(p=>({...p,sectors:e.target.value?[e.target.value]:[]}))}
                  style={{background:T.bg,border:`1px solid ${T.border2}`,color:T.text,
                    fontFamily:"monospace",fontSize:9,padding:"5px 7px",borderRadius:3,minWidth:140}}>
                  <option value="">All Sectors</option>
                  {sectorsList.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                <span style={{fontFamily:"monospace",fontSize:7,color:T.textDim}}>Industry</span>
                <select value={(emaCrossF.industries||[])[0]||""}
                  onChange={e=>setEmaCrossF(p=>({...p,industries:e.target.value?[e.target.value]:[]}))}
                  style={{background:T.bg,border:`1px solid ${T.border2}`,color:T.text,
                    fontFamily:"monospace",fontSize:9,padding:"5px 7px",borderRadius:3,minWidth:160}}>
                  <option value="">All Industries</option>
                  {industriesList.map(i=><option key={i} value={i}>{i}</option>)}
                </select>
              </div>

              <button onClick={runEmaCross}
                style={{fontFamily:"monospace",fontSize:10,fontWeight:700,
                  padding:"7px 20px",borderRadius:4,border:"none",cursor:"pointer",
                  background:"rgba(0,232,122,.2)",color:T.accent,
                  outline:"1px solid rgba(0,232,122,.4)",alignSelf:"flex-end"}}>
                ▶ SCAN
              </button>
            </div>

            {/* Info banner */}
            <div style={{fontFamily:"monospace",fontSize:7.5,color:T.textFaint,lineHeight:1.8}}>
              <strong style={{color:T.accent}}>Touch</strong> = candle low ≤ EMA ≤ candle high (exact Pine Script logic). &nbsp;
              Signal strength: <span style={{color:"#ffe040"}}>●2</span> <span style={{color:"#ff9f1c"}}>●3</span> <span style={{color:T.down}}>●4</span> <span style={{color:"#a78bfa"}}>●5</span> &nbsp;
              EMA computed live from price history — always accurate.
            </div>
          </div>

          {emaCrossLoading&&(
            <div style={{fontFamily:"monospace",fontSize:10,color:T.textFaint,
              textAlign:"center",padding:32}}>Scanning…</div>
          )}
          {/* EMA touch data computing */}
          {!emaCrossLoading&&emaCrossResults._computing&&(
            <div style={{background:"rgba(255,224,64,.07)",border:"1px solid rgba(255,224,64,.25)",
              borderRadius:6,padding:"14px 18px",marginBottom:10}}>
              <div style={{fontFamily:"monospace",fontSize:9,color:"#ffe040",fontWeight:700,marginBottom:4}}>
                ⚙ Computing EMA touch data in background…
              </div>
              <div style={{fontFamily:"monospace",fontSize:8,color:"#7a6a20"}}>
                {emaCrossResults._message}
              </div>
              <div style={{fontFamily:"monospace",fontSize:8,color:"#7a6a20",marginTop:4}}>
                Or run manually: <span style={{color:"#ffe040"}}>npm run compute:ema</span>
                {" "}(takes ~3 min for 6500 stocks)
              </div>
            </div>
          )}

          {/* Results table */}
          {!emaCrossLoading&&Array.isArray(emaCrossResults)&&emaCrossResults.length>0&&(
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden"}}>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"6px 14px",background:T.row,borderBottom:`1px solid ${T.border}`}}>
                <span style={{fontFamily:"monospace",fontSize:8,color:T.textDim}}>
                  <span style={{color:T.accent,fontWeight:700}}>
                    {Array.isArray(emaCrossResults)?emaCrossResults.length:0}
                  </span>
                  {" "}stocks touching {(emaCrossF.emas||[]).map(e=>`EMA${e}`).join("/")}
                  {" — "}
                  {emaCrossF.touchMode==="all"
                    ? "all selected EMAs must touch"
                    : `≥${emaCrossF.minTouches||1} EMA${+emaCrossF.minTouches!==1?"s":""} touched`}
                  {" — "}sorted by touch count then RS Rank
                </span>
                {/* Export EMA cross results */}
                <button onClick={()=>exportToExcel(emaCrossResults)}
                  style={{fontFamily:"monospace",fontSize:8,padding:"3px 10px",borderRadius:3,
                    border:"none",cursor:"pointer",background:"rgba(0,232,122,.1)",color:T.accent,
                    outline:"1px solid rgba(0,232,122,.2)"}}>
                  ⬇ EXCEL
                </button>
              </div>
              {(()=>{
                const thC = (k,label,align="left") => {
                  const active  = emaCrossSort.k === k;
                  const nextDir = active && emaCrossSort.d === 1 ? -1 : 1;
                  return (
                    <div key={k||label} onClick={()=>k&&setEmaCrossSort({k,d:nextDir})}
                      style={{fontFamily:"monospace",fontSize:8,letterSpacing:".08em",
                        color:active?"#a78bfa":T.textGhost,userSelect:"none",
                        cursor:k?"pointer":"default",textAlign:align,
                        display:"flex",gap:2,alignItems:"center",
                        textDecoration:k?"underline dotted":"none",textUnderlineOffset:3}}>
                      {label}
                      {active&&<span style={{fontSize:9}}>{emaCrossSort.d>0?"↑":"↓"}</span>}
                      {!active&&k&&<span style={{fontSize:8,color:T.textGhost}}>↕</span>}
                    </div>
                  );
                };
                return(
                  <div style={{display:"grid",
                    gridTemplateColumns:"68px 110px 150px 64px 70px 58px 56px 70px 70px 70px",
                    padding:"6px 14px",background:T.surface2,borderBottom:`2px solid ${T.border}`,gap:4,
                    alignItems:"center"}}>
                    {thC(null,"TICKER")}
                    {thC("sector","SECTOR")}
                    {thC("industry","INDUSTRY")}
                    {thC("close","PRICE","center")}
                    {thC("cross_dist_pct_abs","EMA DIST","center")}
                    {thC("rs_rank","RS","center")}
                    {thC("stage","STG","center")}
                    {thC("d63","3M%","center")}
                    {thC("dol_vol","$VOL","center")}
                    <span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>FLAGS</span>
                  </div>
                );
              })()}
              {(Array.isArray(emaCrossResults)?[...emaCrossResults]:[]).sort((a,b)=>{
                // Special key: abs distance
                const getVal = (row) => {
                  if (emaCrossSort.k === "cross_dist_pct_abs") {
                    const d = row.cross_dist_pct ?? row.ema_dist_pct;
                    return d != null ? Math.abs(d) : (emaCrossSort.d>0?Infinity:-Infinity);
                  }
                  return row[emaCrossSort.k] ?? (emaCrossSort.d>0?Infinity:-Infinity);
                };
                return emaCrossSort.d * (getVal(a) - getVal(b));
              }).map((r,i)=>{
                // cross_dist_pct: % distance of close from EMA (+ve = above, -ve = below)
                const dp  = r.cross_dist_pct != null ? r.cross_dist_pct : null;
                // Color: how far close is from EMA (absolute %)
                const distC = dp==null ? T.textFaint
                  : Math.abs(dp)<1   ? T.accent    // ≤1% = green (very tight)
                  : Math.abs(dp)<3   ? T.accent    // 1-3% = teal
                  : Math.abs(dp)<8   ? "#ffe040"    // 3-8% = yellow (recent touch)
                  : Math.abs(dp)<15  ? "#ff9f1c"    // 8-15% = orange
                  : T.down;                       // >15% = red (too far, stale data)
                const dv = r.dol_vol||(r.close*r.volume);
                const dvFmt = dv>=1e9?(dv/1e9).toFixed(1)+"B":dv>=1e6?(dv/1e6).toFixed(1)+"M":dv>=1e3?(dv/1e3).toFixed(0)+"K":"—";
                return(
                  <div key={r.symbol} style={{display:"grid",
                    gridTemplateColumns:"68px 110px 150px 64px 70px 58px 56px 70px 70px 70px",
                    padding:"7px 14px",gap:4,alignItems:"center",
                    borderBottom:i<emaCrossResults.length-1?`1px solid ${T.border}`:"none",
                    background:i%2===0?T.surface:T.row}}>
                    <div>
                      <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:"#fff"}}>
                        {r.symbol}
                      </div>
                      {r.rs_line_hi===1&&<div style={{fontFamily:"monospace",fontSize:7,color:"#a78bfa"}}>RS↑</div>}
                    </div>
                    <span style={{fontFamily:"monospace",fontSize:8,
                      color:(()=>{try{return secCol(r.sector)}catch{returnT.textDim}})(),
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.sector||"—"}</span>
                    <span style={{fontFamily:"monospace",fontSize:7.5,color:T.textDim,
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.industry||"—"}</span>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontFamily:"monospace",fontSize:11,color:T.text,fontWeight:600}}>
                        ${(r.close||0).toFixed(2)}
                      </div>
                      {/* Show all matched EMA values */}
                      {r.ema_val>0&&(
                        <div style={{fontFamily:"monospace",fontSize:7,
                          color:r.cross_dist_pct>=0?"#00e87a55":"#ff456055"}}>
                          EMA{r.ema_period}: ${r.ema_val.toFixed(2)}
                        </div>
                      )}
                      {r.matched_emas?.length>1&&(
                        <div style={{fontFamily:"monospace",fontSize:6.5,color:T.textFaint}}>
                          {r.matched_emas.map(e=>`EMA${e}`).join("+")}
                        </div>
                      )}
                    </div>
                    {/* EMA distance */}
                    <div style={{textAlign:"center"}}>
                      {dp!=null ? (<>
                        <span style={{fontFamily:"monospace",fontSize:11,fontWeight:700,color:distC}}>
                          {dp>=0?"+":""}{dp.toFixed(2)}%
                        </span>
                        <div style={{fontFamily:"monospace",fontSize:7,
                          color:dp>=0?"#00e87a66":"#ff456066"}}>
                          {dp>=0?"▲ above":"▼ below"} EMA{r.ema_period}
                        </div>
                        {/* Show matched EMAs if multiple */}
                        {r.matched_emas?.length>1&&(
                          <div style={{fontFamily:"monospace",fontSize:6.5,color:T.textFaint,marginTop:1}}>
                            also: {r.matched_emas.filter(e=>e!==r.ema_period).map(e=>`EMA${e}`).join("+")}
                          </div>
                        )}
                      </>) : (
                        <div>
                          <span style={{fontFamily:"monospace",fontSize:9,color:T.textFaint}}>—</span>
                          <div style={{fontFamily:"monospace",fontSize:7,color:T.textGhost}}>
                            EMA{r.ema_period}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* RS */}
                    <div style={{textAlign:"center"}}><RSBadge rank={r.rs_rank}/></div>
                    {/* Stage */}
                    <div style={{textAlign:"center"}}><StageBadge stage={r.stage}/></div>
                    {/* 3M% */}
                    <div style={{textAlign:"center"}}>
                      {r.d63!=null?(
                        <span style={{fontFamily:"monospace",fontSize:10,fontWeight:600,
                          color:r.d63>=0?T.accent:"#ff6060"}}>
                          {r.d63>=0?"+":""}{r.d63.toFixed(1)}%
                        </span>
                      ):"—"}
                    </div>
                    {/* $ Vol */}
                    <div style={{textAlign:"center"}}>
                      <span style={{fontFamily:"monospace",fontSize:9,color:dv>=10e6?T.accent:dv>=1e6?"#ffe040":T.textDim}}>
                        ${dvFmt}
                      </span>
                    </div>
                    {/* Flags — Pine strength color + touched EMAs */}
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      {/* Strength badge: color matches Pine plotshape arrowColor */}
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <span style={{fontSize:14,color:r.strength_color||T.accent}}>▲</span>
                        <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,
                          color:r.strength_color||T.accent}}>
                          {r.touch_count}
                        </span>
                        <span style={{fontFamily:"monospace",fontSize:7,color:T.textFaint}}>touch{r.touch_count>1?"es":""}</span>
                      </div>
                      {/* Which EMAs were touched */}
                      <div style={{display:"flex",gap:2,flexWrap:"wrap"}}>
                        {(r.touched_emas||[]).sort((a,b)=>a-b).map(e=>(
                          <span key={e} style={{fontFamily:"monospace",fontSize:7,fontWeight:700,
                            color:r.strength_color||T.accent,
                            background:`${r.strength_color||T.accent}18`,
                            padding:"1px 4px",borderRadius:2}}>
                            {e}
                          </span>
                        ))}
                      </div>
                      {r.pocket_pivot===1&&<span style={{fontFamily:"monospace",fontSize:7,
                        color:"#00d4ff",background:"rgba(0,212,255,.1)",padding:"1px 4px",borderRadius:2}}>PP↑</span>}
                      {r.tight_flag===1&&<span style={{fontFamily:"monospace",fontSize:7,
                        color:"#a78bfa",background:"rgba(167,139,250,.1)",padding:"1px 4px",borderRadius:2}}>TIGHT</span>}
                      <button onClick={()=>{setRiskPf(r);setTab("risk");}}
                        style={{fontFamily:"monospace",fontSize:7,padding:"2px 5px",borderRadius:2,
                          border:"none",cursor:"pointer",background:"rgba(0,232,122,.1)",color:T.accent}}>⚖</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!emaCrossLoading&&Array.isArray(emaCrossResults)&&!emaCrossResults.length&&(
            <div style={{fontFamily:"monospace",fontSize:10,color:T.textFaint,textAlign:"center",
              padding:40,background:T.surface,border:`1px solid ${T.border}`,borderRadius:6}}>
              Press ▶ SCAN to find stocks crossing {(emaCrossF.emas||["50"]).map(e=>`EMA${e}`).join(" / ")}
            </div>
          )}
        </div>
      )}

      {/* ══ VALIDATE TAB ════════════════════════════════════════════════════ */}
      {tab==="validate"&&(
        <div>
          <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14}}>
            <div style={{fontFamily:"monospace",fontSize:9,color:T.textFaint,letterSpacing:".12em"}}>
              DATA QUALITY VALIDATION
            </div>
            <button onClick={runValidate}
              style={{fontFamily:"monospace",fontSize:9,padding:"6px 16px",borderRadius:4,
                border:"none",cursor:"pointer",background:"rgba(167,139,250,.2)",color:"#a78bfa",
                outline:"1px solid rgba(167,139,250,.4)"}}>
              ↺ REFRESH
            </button>
            {validateLoading&&<span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>Checking…</span>}
          </div>

          {validateData&&(
            <div>
              {/* Overall status */}
              <div style={{background:T.surface,border:`1px solid ${validateData.allGood?"#00e87a33":"#ff9f1c33"}`,
                borderRadius:6,padding:"12px 16px",marginBottom:12,
                display:"flex",gap:12,alignItems:"center"}}>
                <span style={{fontSize:24}}>{validateData.allGood?"✅":"⚠️"}</span>
                <div>
                  <div style={{fontFamily:"monospace",fontSize:11,fontWeight:700,
                    color:validateData.allGood?T.accent:"#ff9f1c",marginBottom:4}}>
                    {validateData.allGood?"ALL SYSTEMS READY":"ACTION REQUIRED"}
                  </div>
                  <div style={{fontFamily:"monospace",fontSize:8.5,color:T.textDim}}>
                    Universe: <span style={{color:T.text,fontWeight:700}}>{validateData.total?.toLocaleString()}</span> active symbols ·
                    In EOD DB: <span style={{color:T.text,fontWeight:700}}>{validateData.inEOD?.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Check rows */}
              <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:6,overflow:"hidden"}}>
                {validateData.checks?.map((c,i)=>{
                  const color = c.ok ? T.accent : c.pct>50 ? "#ff9f1c" : T.down;
                  return(
                    <div key={c.key} style={{display:"grid",
                      gridTemplateColumns:"24px 220px 80px 1fr 180px",
                      padding:"10px 16px",gap:10,alignItems:"center",
                      borderBottom:i<validateData.checks.length-1?`1px solid ${T.border}`:"none",
                      background:i%2===0?T.surface:T.row}}>
                      {/* Status icon */}
                      <span style={{fontSize:14}}>{c.ok?"✅":"❌"}</span>
                      {/* Label */}
                      <span style={{fontFamily:"monospace",fontSize:9,color:T.text,fontWeight:600}}>
                        {c.label}
                      </span>
                      {/* Count */}
                      <span style={{fontFamily:"monospace",fontSize:9,color:color,fontWeight:700,
                        textAlign:"right"}}>
                        {c.n?.toLocaleString()}
                      </span>
                      {/* Progress bar */}
                      <div>
                        <div style={{height:4,background:T.textGhost2,borderRadius:2,overflow:"hidden"}}>
                          <div style={{width:`${Math.min(c.pct,100)}%`,height:"100%",
                            background:color,borderRadius:2,transition:"width .6s"}}/>
                        </div>
                        <div style={{fontFamily:"monospace",fontSize:7,color:T.textFaint,marginTop:2}}>
                          {c.pct}%
                        </div>
                      </div>
                      {/* Fix command */}
                      {!c.ok&&c.cmd&&(
                        <div style={{background:"rgba(255,159,28,.07)",border:"1px solid rgba(255,159,28,.2)",
                          borderRadius:3,padding:"4px 8px"}}>
                          <div style={{fontFamily:"monospace",fontSize:7,color:"#ff9f1c88",marginBottom:2}}>
                            Run to fix:
                          </div>
                          <div style={{fontFamily:"monospace",fontSize:8,color:"#ff9f1c",
                            fontWeight:700,letterSpacing:".03em"}}>
                            {c.cmd}
                          </div>
                        </div>
                      )}
                      {c.ok&&<span style={{fontFamily:"monospace",fontSize:8,color:T.textFaint}}>—</span>}
                    </div>
                  );
                })}
              </div>

              {/* Hint */}
              <div style={{marginTop:10,fontFamily:"monospace",fontSize:8,color:T.textFaint,lineHeight:1.8}}>
                Run checks in order: bootstrap → enrich:sectors → compute:analytics → compute:earnings
              </div>
            </div>
          )}

          {!validateData&&!validateLoading&&(
            <div style={{fontFamily:"monospace",fontSize:10,color:T.textFaint,textAlign:"center",
              padding:48,background:T.bg,border:`1px solid ${T.border}`,borderRadius:6}}>
              Press ↺ REFRESH to check data quality
            </div>
          )}
        </div>
      )}

      {/* ══ RISK CALCULATOR TAB ═════════════════════════════════════════════ */}
      {tab==="risk"&&(
        <div style={{maxWidth:560}}>
          <RiskCalculator prefill={riskPf}/>
          {riskPf.symbol&&(
            <div style={{marginTop:10,fontFamily:"monospace",fontSize:8,color:T.textFaint}}>
              Pre-filled from {riskPf.symbol} · click ⚖ on any setup row to pre-fill
            </div>
          )}
        </div>
      )}
    </div>
  );
}
