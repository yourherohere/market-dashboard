// src/components/common/index.jsx — Shared UI primitives
import { useState, useEffect } from "react";
import { useTheme, THEME } from "../../hooks/useTheme.js";
import { sparkPath, fmtMcap } from "../../utils/format.js";

export function Spark({ closes, w=80, h=20, color="#00e87a" }) {
  const d = sparkPath(closes, w, h);
  if (!d) return null;
  return (
    <svg width={w} height={h} style={{display:"block",overflow:"visible"}}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.2" opacity=".8"/>
    </svg>
  );
}

export function McapBadge({ v }) {
  const themeKey = useTheme();
  const T = THEME[themeKey];
  if (!v) return <span style={{fontFamily:"monospace",fontSize:9,color:T.textGhost}}>—</span>;
  const color =
    v >= 1e11 ? "#00e87a" :
    v >= 1e10 ? "#4ddb9e" :
    v >= 1e9  ? "#ff9f1c" : "#ff4560";
  return (
    <span style={{fontFamily:"monospace",fontSize:9,fontWeight:700,color,
      background:`${color}15`,border:`1px solid ${color}30`,
      padding:"1px 5px",borderRadius:3}}>
      {fmtMcap(v)}
    </span>
  );
}

export function EmaBadge({ above, label }) {
  if (above == null) return <span style={{fontFamily:"monospace",fontSize:8,color:"#1e3040"}}>—</span>;
  const c = above ? "rgba(0,232,122,.25)" : "rgba(255,69,96,.25)";
  return (
    <span style={{fontFamily:"monospace",fontSize:8,fontWeight:700,
      color:above?"#00e87a":"#ff4560",
      background:above?"rgba(0,232,122,.1)":"rgba(255,69,96,.1)",
      padding:"2px 4px",borderRadius:2,border:`1px solid ${c}`}}>
      {label}{above?"▲":"▼"}
    </span>
  );
}

export function PctCell({ v, size=10, bold=false }) {
  if (v == null) return <span style={{fontFamily:"monospace",fontSize:9,color:"#1e3040"}}>—</span>;
  const c = v>5?"#00e87a":v>0?"#4ddb9e":v>-5?"#ff9f1c":"#ff4560";
  return (
    <span style={{fontFamily:"monospace",fontSize:size,fontWeight:bold?"700":"600",color:c}}>
      {v>=0?"+":""}{v.toFixed(2)}%
    </span>
  );
}

export function LoadingDots({ color="#00e87a", label="Loading…" }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,padding:32,justifyContent:"center"}}>
      <div style={{display:"flex",gap:4}}>
        {[0,1,2,3,4].map(i=>(
          <div key={i} style={{width:7,height:7,borderRadius:"50%",background:color,
            animation:`bn 1s ${i*.12}s infinite`}}/>
        ))}
      </div>
      <span style={{fontFamily:"monospace",fontSize:10,color,letterSpacing:".08em"}}>{label}</span>
    </div>
  );
}

export function ScoreDial({ score: s, size=138 }) {
  const r=44, cx=size/2, cy=size/2;
  const circ = 2*Math.PI*r;
  const color = s<30?"#ff4560":s<50?"#ff9f1c":s<70?"#ffe040":"#00e87a";
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0c1720" strokeWidth="8"/>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${circ*(s/100)} ${circ*(1-s/100)}`}
        strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`}
        style={{transition:"stroke-dasharray 1s ease"}}/>
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
        style={{fontFamily:"monospace",fontSize:26,fontWeight:700,fill:color}}>{s}</text>
      <text x={cx} y={cy+20} textAnchor="middle"
        style={{fontFamily:"monospace",fontSize:8,fill:color,letterSpacing:".1em"}}>
        {s<30?"BEARISH":s<50?"CAUTION":s<70?"NEUTRAL":"BULLISH"}
      </text>
    </svg>
  );
}

export function UniverseStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await (await fetch("/api/universe")).json();
        setStatus({ count: r.count, loaded: r.loaded, loading: r.loading });
      } catch {}
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, []);
  if (!status) return null;
  if (status.loading) return (
    <span style={{fontFamily:"monospace",fontSize:9,color:"#ff9f1c"}}>⟳ Loading universe…</span>
  );
  if (status.loaded && status.count > 0) return (
    <span style={{fontFamily:"monospace",fontSize:9,color:"#00e87a",
      background:"rgba(0,232,122,.08)",padding:"2px 8px",borderRadius:3,
      border:"1px solid rgba(0,232,122,.2)"}}>
      ✓ {status.count.toLocaleString()} US stocks
    </span>
  );
  return null;
}
