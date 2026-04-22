import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTheme, THEME } from "../../hooks/useTheme.js";
import { Spark, McapBadge, EmaBadge, PctCell, LoadingDots, ScoreDial } from "../common/index.jsx";
import { pct, fmt, gc, fmtMcap, fmtVol, calcRet, calcRetSince, soM, soY, sparkPath } from "../../utils/format.js";
import { GICS, ALL_ETF_SYMS, SECTOR_ETF_SYMS, SUB_ETF_SYMS, ALL_SECTORS, SECTOR_INDUSTRY_MAP, secCol, INDEX_SYMS } from "../../constants/gics.js";
const BASE="http://localhost:3001";
async function apiFetch(p,o={}){const r=await fetch(p.startsWith("http")?p:BASE+p,{headers:{"Content-Type":"application/json"},...o});if(!r.ok){const e=await r.json().catch(()=>({error:r.statusText}));throw new Error(e.error||"HTTP "+r.status);}return r.json();}
const heat=v=>{if(v>=5)return{bg:"rgba(0,232,122,.25)",fg:"#00e87a"};if(v>=2)return{bg:"rgba(0,232,122,.12)",fg:"#4ddb9e"};if(v>=0)return{bg:"rgba(0,232,122,.05)",fg:"#7ab89a"};if(v>=-2)return{bg:"rgba(255,69,96,.05)",fg:"#d08080"};if(v>=-5)return{bg:"rgba(255,69,96,.12)",fg:"#ff6060"};return{bg:"rgba(255,69,96,.25)",fg:"#ff4560"};};

export default function CockpitTab({ themes={}, sectors={}, liveThemes=null, liveSectors=null }) {
  const [cpMode,setCpMode]=useState("themes");
  const [cpGrp,setCpGrp]=useState(null);
  const cpSrc = cpMode==="themes" ? themes : sectors;
  const cpGrps = cpGrp ? {[cpGrp]:cpSrc[cpGrp]} : cpSrc;
  return (
    <div>
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12}}>
        <div style={{display:"flex",background:"#06090d",border:"1px solid #111c24",borderRadius:4,overflow:"hidden"}}>
          {[["themes","THEMES"],["sectors","SECTORS"]].map(([k,l])=>(
            <button key={k} onClick={()=>{setCpMode(k);setCpGrp(null);}}
              style={{fontFamily:"monospace",fontSize:9.5,padding:"7px 16px",
                background:cpMode===k?"#00e87a":"transparent",
                color:cpMode===k?"#040710":"#334455",border:"none",cursor:"pointer"}}>{l}</button>
          ))}
        </div>
        <select value={cpGrp||""} onChange={e=>setCpGrp(e.target.value||null)}
          style={{background:"#06090d",border:"1px solid #111c24",borderRadius:4,color:"#c0d0da",fontFamily:"monospace",fontSize:10,padding:"7px 12px",cursor:"pointer"}}>
          <option value="">— All {cpMode} —</option>
          {Object.keys(cpSrc).map(n=><option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      {Object.entries(cpGrps).map(([n,d])=>d&&(
        <div key={n} style={{background:"#070a0e",border:`1px solid ${d.color||"#1a2a36"}28`,borderRadius:6,overflow:"hidden",marginBottom:8}}>
          <div style={{background:`linear-gradient(90deg,${d.color||"#1a2a36"}14,transparent)`,borderBottom:`1px solid ${d.color||"#1a2a36"}22`,padding:"7px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontFamily:"monospace",fontSize:11,color:d.color||"#00e87a",fontWeight:700,letterSpacing:".1em"}}>{n.toUpperCase()}</span>
            <span style={{fontFamily:"monospace",fontSize:8.5,color:"#253545"}}>{(d.tickers||[]).length} stocks</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min((d.tickers||[]).length,10)},1fr)`}}>
            {[...(d.tickers||[])].sort((a,b)=>(b.d1||0)-(a.d1||0)).map((t,i)=>{
              const chg=t.d1??t.change??0;
              return(
                <div key={t.sym||t.symbol} style={{padding:"8px 4px",borderRight:i<(d.tickers||[]).length-1?"1px solid #091422":"none",textAlign:"center"}}>
                  <div style={{fontFamily:"monospace",fontSize:11,color:"#fff",fontWeight:700}}>{t.sym||t.symbol}</div>
                  <div style={{fontFamily:"monospace",fontSize:9,color:"#5a7a8a"}}>${fmt(t.price||0)}</div>
                  <div style={{fontSize:13,color:gc(chg),fontWeight:700}}>{pct(chg,1)}</div>
                  {t.closes?.length>0&&<Spark closes={t.closes.slice(-15)} w={60} h={14} color={gc(chg)}/>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
