import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTheme, THEME } from "../../hooks/useTheme.js";
import { Spark, McapBadge, EmaBadge, PctCell, LoadingDots, ScoreDial } from "../common/index.jsx";
import { pct, fmt, gc, fmtMcap, fmtVol, calcRet, calcRetSince, soM, soY, sparkPath } from "../../utils/format.js";
import { GICS, ALL_ETF_SYMS, SECTOR_ETF_SYMS, SUB_ETF_SYMS, ALL_SECTORS, SECTOR_INDUSTRY_MAP, secCol, INDEX_SYMS } from "../../constants/gics.js";
const BASE="";
async function apiFetch(p,o={}){const r=await fetch(p.startsWith("http")?p:BASE+p,{headers:{"Content-Type":"application/json"},...o});if(!r.ok){const e=await r.json().catch(()=>({error:r.statusText}));throw new Error(e.error||"HTTP "+r.status);}return r.json();}
const heat=v=>{if(v>=5)return{bg:"rgba(0,232,122,.25)",fg:"#00e87a"};if(v>=2)return{bg:"rgba(0,232,122,.12)",fg:"#4ddb9e"};if(v>=0)return{bg:"rgba(0,232,122,.05)",fg:"#7ab89a"};if(v>=-2)return{bg:"rgba(255,69,96,.05)",fg:"#d08080"};if(v>=-5)return{bg:"rgba(255,69,96,.12)",fg:"#ff6060"};return{bg:"rgba(255,69,96,.25)",fg:"#ff4560"};};

export default function HeatmapTab({ themes={}, sectors={} }) {
  const rankThemes = Object.entries(themes).sort((a,b)=>{
    const avg=o=>o[1].tickers?.reduce((s,t)=>s+(t.d1||0),0)/(o[1].tickers?.length||1);
    return avg(b)-avg(a);
  });
  const rankSectors = Object.entries(sectors).sort((a,b)=>{
    const avg=o=>o[1].tickers?.reduce((s,t)=>s+(t.d1||0),0)/(o[1].tickers?.length||1);
    return avg(b)-avg(a);
  });
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      {[["THEMES",rankThemes],["SECTORS",rankSectors]].map(([title,rows])=>(
        <div key={title} style={{background:"#06090d",border:"1px solid #111c24",borderRadius:6,padding:14}}>
          <div style={{fontSize:9,color:"#253545",letterSpacing:".12em",marginBottom:12}}>{title} · 1D HEATMAP</div>
          {rows.map(([n,d])=>d&&(
            <div key={n} style={{marginBottom:8}}>
              <div style={{fontFamily:"monospace",fontSize:8.5,color:d.color||"#00e87a",marginBottom:4}}>{n}</div>
              <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                {[...(d.tickers||[])].sort((a,b)=>(b.d1||0)-(a.d1||0)).map(t=>{
                  const h=heat(t.d1||0);
                  return<div key={t.sym||t.symbol}
                    style={{background:h.bg,border:`1px solid ${h.fg}18`,borderRadius:3,
                      padding:"4px 5px",textAlign:"center",minWidth:36,cursor:"default",transition:"transform .1s"}}
                    onMouseEnter={e=>e.currentTarget.style.transform="scale(1.1)"}
                    onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
                    <div style={{fontFamily:"monospace",fontSize:9,color:"#fff",fontWeight:700}}>{t.sym||t.symbol}</div>
                    <div style={{fontFamily:"monospace",fontSize:8,color:h.fg}}>{pct(t.d1||0,1)}</div>
                  </div>;
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
