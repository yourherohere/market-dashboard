import { useState, useEffect } from "react";
import { useTheme, THEME } from "../../hooks/useTheme.js";
import { Spark, ScoreDial } from "../common/index.jsx";
import { pct, gc } from "../../utils/format.js";

const BASE = "http://localhost:3001";
async function apiFetch(p, o={}) {
  const r = await fetch(p.startsWith("http") ? p : BASE+p,
    { headers:{"Content-Type":"application/json"}, ...o });
  if (!r.ok) { const e=await r.json().catch(()=>({error:r.statusText}));
    throw new Error(e.error||"HTTP "+r.status); }
  return r.json();
}

// ── Bidirectional A/D bar chart ───────────────────────────────────────────────
function ADBarChart({ daily=[], height=56 }) {
  if (!daily.length) return (
    <div style={{height, background:T.row, borderRadius:3,
      display:"flex", alignItems:"center", justifyContent:"center"}}>
      <span style={{fontFamily:"monospace",fontSize:8,color:"var(--clr-faint)"}}>NO DATA AVAILABLE</span>
    </div>
  );
  const slice = daily.slice(-63);
  const max   = Math.max(...slice.map(r => Math.abs(r.net ?? r.value ?? 0)), 1);
  const half  = Math.floor(height / 2) - 1;
  return (
    <div style={{position:"relative", height, background:T.row, borderRadius:3, overflow:"hidden"}}>
      {slice.map((r, i) => {
        const val = r.net ?? r.value ?? 0;
        const px  = Math.max(1, Math.round(Math.abs(val) / max * half));
        const up  = val >= 0;
        return <div key={i} style={{
          position:"absolute",
          left:`${(i/slice.length)*100}%`,
          width:`${(1/slice.length)*100}%`,
          height:px,
          ...(up ? {bottom:"50%"} : {top:"50%"}),
          background: up ? "var(--clr-accent)" : "var(--clr-dn)",
          opacity: .82,
        }}/>;
      })}
      <div style={{position:"absolute",top:"50%",left:0,right:0,height:1,background:T.textGhost}}/>
    </div>
  );
}

// ── Compute A/D score from ratio ──────────────────────────────────────────────
function adScore(ratio) {
  if (ratio == null) return null;
  if (ratio >= 3)   return 95;
  if (ratio >= 2)   return Math.round(75 + (ratio-2)*10);
  if (ratio >= 1.5) return Math.round(65 + (ratio-1.5)*20);
  if (ratio >= 1)   return Math.round(50 + (ratio-1)*30);
  return Math.max(5, Math.round(ratio*50));
}
function scoreColor(s) {
  if (s==null) return "var(--clr-text)"Faint;
  return s>=70 ? "var(--clr-accent)" : s>=50 ? "#ffe040" : "var(--clr-dn)";
}
function signalLabel(s) {
  if (s==null) return "NO DATA";
  if (s>=80)  return "STRONG BREADTH";
  if (s>=65)  return "BULLISH";
  if (s>=50)  return "NEUTRAL";
  if (s>=35)  return "WEAK";
  return "BEARISH BREADTH";
}
function fmtBig(n) {
  if (n==null) return "—";
  const abs = Math.abs(n);
  return abs >= 1000 ? (n/1000).toFixed(1)+"K" : String(Math.round(n));
}

// ── Full A/D row panel (horizontal layout) ───────────────────────────────────
function ADRow({ label, subtitle, daily=[], latestAdv, latestDec, latestRatio, cumLine=[] }) {
  const last     = daily[daily.length-1];
  const adv      = last?.adv  ?? latestAdv  ?? null;
  const dec      = last?.dec  ?? latestDec  ?? null;
  const ratio    = last?.ratio ?? latestRatio ?? (adv>0&&dec>0 ? +(adv/dec).toFixed(2) : null);
  const net      = (adv!=null && dec!=null) ? adv-dec : (last?.net ?? last?.value ?? null);
  const advPct   = (adv!=null && dec!=null && adv+dec>0) ? +((adv/(adv+dec))*100).toFixed(1) : null;
  const score    = adScore(ratio);
  const sc       = scoreColor(score);
  const hasData  = daily.length > 0 || adv != null;

  return (
    <div style={{background:T.surface, border:`1px solid ${hasData ? sc+"22" : T.border}`,
      borderRadius:6, padding:"14px 18px", marginBottom:10}}>

      {/* ── Header row ──────────────────────────────────────────────────── */}
      <div style={{display:"flex", alignItems:"center", gap:14, marginBottom:12}}>

        {/* Score */}
        <div style={{minWidth:64, textAlign:"center",
          background: hasData ? `${sc}10` : T.row,
          border:`1px solid ${hasData ? sc+"33" : T.border}`,
          borderRadius:5, padding:"8px 4px"}}>
          <div style={{fontFamily:"monospace", fontSize:22, fontWeight:700,
            color: sc, lineHeight:1}}>{score ?? "—"}</div>
          <div style={{fontFamily:"monospace", fontSize:7, color:T.textFaint, marginTop:2}}>/100</div>
          <div style={{fontFamily:"monospace", fontSize:7, color:sc, marginTop:3,
            letterSpacing:".06em"}}>{signalLabel(score)}</div>
        </div>

        {/* Label + stats */}
        <div style={{flex:1}}>
          <div style={{display:"flex", alignItems:"baseline", gap:8, marginBottom:4}}>
            <span style={{fontFamily:"monospace", fontSize:11, fontWeight:700,
              color:T.text, letterSpacing:".08em"}}>{label}</span>
            <span style={{fontFamily:"monospace", fontSize:7.5, color:T.textFaint}}>{subtitle}</span>
          </div>

          {hasData ? (
            <div style={{display:"flex", gap:10, flexWrap:"wrap", alignItems:"center"}}>
              {adv!=null && (
                <span style={{fontFamily:"monospace", fontSize:10, color:T.accent}}>
                  ▲ {fmtBig(adv)} adv
                </span>
              )}
              {dec!=null && (
                <span style={{fontFamily:"monospace", fontSize:10, color:T.down}}>
                  ▼ {fmtBig(dec)} dec
                </span>
              )}
              {net!=null && (
                <span style={{fontFamily:"monospace", fontSize:10, fontWeight:700,
                  color:net>=0?T.accent:T.down}}>
                  Net {net>0?"+":""}{fmtBig(net)}
                </span>
              )}
              {ratio!=null && (
                <span style={{fontFamily:"monospace", fontSize:12, fontWeight:700, color:sc}}>
                  A/D {ratio}×
                </span>
              )}
              {advPct!=null && (
                <span style={{fontFamily:"monospace", fontSize:9, color:T.textDim}}>
                  {advPct}% advancing
                </span>
              )}
            </div>
          ) : (
            <span style={{fontFamily:"monospace", fontSize:9, color:T.textFaint}}>
              Fetching from Yahoo Finance…
            </span>
          )}
        </div>

        {/* Cumulative spark */}
        {cumLine.length > 5 && (
          <div style={{minWidth:120}}>
            <div style={{fontFamily:"monospace", fontSize:7, color:T.textFaint, marginBottom:3}}>
              CUMULATIVE A/D
            </div>
            <Spark closes={cumLine.map(c=>c.value)} w={120} h={22}
              color={cumLine[cumLine.length-1]?.value > cumLine[0]?.value ? T.accent : T.down}/>
          </div>
        )}
      </div>

      {/* ── Advance % bar ────────────────────────────────────────────────── */}
      {advPct!=null && (
        <div style={{marginBottom:8}}>
          <div style={{display:"flex", justifyContent:"space-between", marginBottom:3}}>
            <span style={{fontFamily:"monospace", fontSize:7.5, color:T.textFaint}}>
              ADVANCING %
            </span>
            <span style={{fontFamily:"monospace", fontSize:7.5, color:sc}}>{advPct}%</span>
          </div>
          <div style={{height:4, background:T.textGhost2, borderRadius:2, overflow:"hidden"}}>
            <div style={{height:"100%", width:`${advPct}%`, background:sc,
              borderRadius:2, transition:"width .8s"}}/>
          </div>
        </div>
      )}

      {/* ── Daily bar chart ───────────────────────────────────────────────── */}
      {daily.length > 0
        ? <ADBarChart daily={daily} height={52}/>
        : (
          <div style={{height:52, background:T.row, borderRadius:3,
            display:"flex", alignItems:"center", justifyContent:"center"}}>
            <span style={{fontFamily:"monospace",fontSize:8,color:T.textGhost}}>
              {adv!=null ? "SINGLE SNAPSHOT · NO HISTORY" : "NO DATA"}
            </span>
          </div>
        )
      }
    </div>
  );
}

// ── Main ConditionsTab ────────────────────────────────────────────────────────
export default function ConditionsTab({ score=0, subs=[], indices={}, vix=0 }) {
  const T       = THEME[useTheme()];
  const [adData, setAdData]   = useState(null);
  const [adErr,  setAdErr]    = useState(null);
  const [loading,setLoading]  = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch("/api/advance-decline?days=126")
      .then(d => { setAdData(d); setAdErr(null); })
      .catch(e => setAdErr(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Normalise NYSE/NASDAQ raw rows
  const buildDaily = (raw=[]) => raw.map(r => ({
    ts:      r.ts,
    adv:     Math.round(r.adv  ?? 0),
    dec:     Math.round(r.dec  ?? 0),
    net:     Math.round(r.net  ?? r.value ?? 0),
    ratio:   r.ratio   ?? (r.dec>0 ? +(r.adv/r.dec).toFixed(2) : null),
    advPct:  r.advPct  ?? (r.adv+r.dec>0 ? +((r.adv/(r.adv+r.dec))*100).toFixed(1) : null),
  }));

  const nyseDailyFull   = buildDaily(adData?.nyseAD?.raw   || []);
  const nasdaqDailyFull = buildDaily(adData?.nasdaqAD?.raw  || []);
  const sp500Daily      = adData?.sp500?.daily || [];

  return (
    <div>
      {/* ── Row 1: Score · Breakdown · Index Status ─────────────────────── */}
      <div style={{display:"grid", gridTemplateColumns:"155px 1fr 210px",
        gap:12, marginBottom:14}}>

        {/* Score dial */}
        <div style={{background:T.surface, border:`1px solid ${T.border}`, borderRadius:6,
          padding:"14px 12px", display:"flex", flexDirection:"column", alignItems:"center"}}>
          <div style={{fontSize:8.5, color:T.textFaint, letterSpacing:".14em", marginBottom:6}}>
            CONDITIONS SCORE
          </div>
          <ScoreDial score={score}/>
        </div>

        {/* Breakdown */}
        <div style={{background:T.surface, border:`1px solid ${T.border}`, borderRadius:6,
          padding:"14px 18px"}}>
          <div style={{fontSize:9, color:T.textFaint, letterSpacing:".12em", marginBottom:12}}>
            BREAKDOWN
          </div>
          {subs.map(s => {
            const c = s.score<30?T.down:s.score<50?"#ff9f1c":s.score<70?"#ffe040":T.accent;
            return (
              <div key={s.label} style={{marginBottom:10}}>
                <div style={{display:"flex", justifyContent:"space-between", marginBottom:3}}>
                  <span style={{fontSize:10, color:"#6a8a98"}}>{s.label}</span>
                  <span style={{fontSize:10, color:c, fontWeight:700}}>{s.score}/100</span>
                </div>
                <div style={{height:4, background:T.textGhost2, borderRadius:2}}>
                  <div style={{height:"100%", width:`${s.score}%`, background:c,
                    borderRadius:2, transition:"width 1.2s"}}/>
                </div>
                <div style={{fontSize:8.5, color:T.textFaint, marginTop:2}}>{s.desc}</div>
              </div>
            );
          })}
        </div>

        {/* Index status */}
        <div style={{background:T.surface, border:`1px solid ${T.border}`, borderRadius:6,
          padding:"12px 14px"}}>
          <div style={{fontSize:9, color:T.textFaint, letterSpacing:".12em", marginBottom:10}}>
            INDEX STATUS
          </div>
          {Object.entries(indices).map(([sym, d]) => (
            <div key={sym} style={{marginBottom:10, paddingBottom:10,
              borderBottom:"1px solid #091422"}}>
              <div style={{display:"flex", justifyContent:"space-between", marginBottom:2}}>
                <span style={{fontSize:11, color:"#fff", fontWeight:700}}>{sym}</span>
                <span style={{fontSize:11, color:gc(d.d1), fontWeight:700}}>{pct(d.d1)}</span>
              </div>
              <div style={{fontSize:10, color:"#5a7a8a", marginBottom:3}}>
                ${(d.price||0).toFixed(2)}
              </div>
              <div style={{display:"flex", gap:3, marginBottom:4}}>
                {[["50D",d.a50],["200D",d.a200]].map(([l,v])=>(
                  <span key={l} style={{fontFamily:"monospace", fontSize:8,
                    color:v?T.accent:T.down,
                    background:v?"rgba(0,232,122,.1)":"rgba(255,69,96,.1)",
                    padding:"2px 4px", borderRadius:2}}>{l} {v?"▲":"▼"}</span>
                ))}
              </div>
              <Spark closes={d.closes||[]} w={155} h={20} color={gc(d.d1)}/>
            </div>
          ))}
        </div>
      </div>

      {/* ── A/D Section header ───────────────────────────────────────────── */}
      <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:10}}>
        <div style={{fontFamily:"monospace", fontSize:9, color:T.textFaint,
          letterSpacing:".14em"}}>
          ADVANCE / DECLINE BREADTH — 3 MARKETS
        </div>
        {loading && (
          <span style={{fontFamily:"monospace", fontSize:8, color:T.textFaint}}>
            loading…
          </span>
        )}
        {adErr && (
          <span style={{fontFamily:"monospace", fontSize:8, color:T.down}}>
            ⚠ {adErr}
          </span>
        )}
      </div>

      {/* ── NYSE ──────────────────────────────────────────────────────────── */}
      <ADRow
        label="NYSE"
        subtitle="^ADVN / ^DECN · ~2,800 stocks · 63 days"
        daily={nyseDailyFull}
        cumLine={adData?.nyseAD?.cumulative || []}
        latestAdv={adData?.nyseAD?.latestAdv}
        latestDec={adData?.nyseAD?.latestDec}
        latestRatio={adData?.nyseAD?.latestRatio}
      />

      {/* ── NASDAQ ────────────────────────────────────────────────────────── */}
      <ADRow
        label="NASDAQ"
        subtitle="^ADDQ / ^DCLQ · ~3,200 stocks · 63 days"
        daily={nasdaqDailyFull}
        cumLine={adData?.nasdaqAD?.cumulative || []}
        latestAdv={adData?.nasdaqAD?.latestAdv}
        latestDec={adData?.nasdaqAD?.latestDec}
        latestRatio={adData?.nasdaqAD?.latestRatio}
      />

      {/* ── S&P 500 Proxy ─────────────────────────────────────────────────── */}
      <ADRow
        label="S&P 500 PROXY"
        subtitle={`${adData?.sp500?.symCount ?? 110} large-cap stocks · daily calc · 63 days`}
        daily={sp500Daily}
        cumLine={adData?.sp500?.cumulative || []}
      />
    </div>
  );
}
