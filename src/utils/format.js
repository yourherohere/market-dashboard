// src/utils/format.js — Shared formatting helpers
export const pct  = (v, d=2)  => v==null?"—":`${v>=0?"+":""}${(+v).toFixed(d)}%`;
export const fmt  = (v, d=2)  => v==null?"—":(+v).toFixed(d);
export const gc   = (v)       => v>=0?"#00e87a":"#ff4560";

export const fmtMcap = n => {
  if (!n) return "—";
  if (n >= 1e12) return `$${(n/1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(0)}M`;
  return `$${n}`;
};

export const fmtVol = n => {
  if (!n) return "—";
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return `${n}`;
};

export const fmtFloat = n => {
  if (!n) return "—";
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return `${n}`;
};

// ── Return calculators (client-side, from chart data) ─────────────────────────
export const calcRet = (cl, n) => {
  if (!cl || cl.length < n + 1) return null;
  const b = cl[cl.length - 1 - n], a = cl[cl.length - 1];
  return b && b > 0 ? +((a - b) / b * 100).toFixed(2) : null;
};

export const calcRetSince = (cl, ts, tgt) => {
  if (!cl?.length || !ts?.length) return null;
  const t0 = Math.floor(tgt.getTime() / 1000);
  const idx = ts.findIndex(t => t >= t0);
  if (idx === -1) return null;
  const b = cl[idx], a = cl[cl.length - 1];
  return b && b > 0 ? +((a - b) / b * 100).toFixed(2) : null;
};

export const soM = () => { const d=new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; };
export const soY = () => { const d=new Date(); d.setMonth(0,1); d.setHours(0,0,0,0); return d; };

// ── Spark path helper ─────────────────────────────────────────────────────────
export const sparkPath = (c, W=80, H=20) => {
  if (!c?.length || c.length < 2) return "";
  const mn=Math.min(...c), mx=Math.max(...c), rng=mx-mn||1;
  return c.map((v,i)=>`${i===0?"M":"L"}${(i/(c.length-1))*W},${H-3-((v-mn)/rng)*(H-6)}`).join(" ");
};
