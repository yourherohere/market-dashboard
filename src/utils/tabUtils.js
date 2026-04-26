// src/utils/tabUtils.js
// Shared utilities for all tab components — import from here, don't duplicate
//
// Usage: import { apiFetch, heat, calcRS, calcCompositeRS } from '../../utils/tabUtils.js';

// ── API base URL ──────────────────────────────────────────────────────────────
// Empty string = same origin via Vite proxy (dev) or nginx (prod)
// Set VITE_API_BASE_URL env var for external API host
export const BASE = (typeof __API_BASE__ !== "undefined" && __API_BASE__) ? __API_BASE__ : "";

// ── Fetch wrapper with JSON parsing + error throwing ─────────────────────────
export async function apiFetch(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), ...opts });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? ": " + body.slice(0,100) : ""}`);
  }
  return res.json();
}

// ── Heat map color helper (uses CSS vars — theme-aware without needing T) ─────
// Returns { bg, fg } style values based on percentage change
export const heat = (v) => {
  if (v >=  5) return { bg:"rgba(63,185,80,.25)",  fg:"var(--clr-up)" };
  if (v >=  2) return { bg:"rgba(63,185,80,.12)",  fg:"var(--clr-up)" };
  if (v >=  0) return { bg:"rgba(63,185,80,.05)",  fg:"#7ab89a" };
  if (v >= -2) return { bg:"rgba(248,81,73,.05)",  fg:"var(--clr-dn)" };
  if (v >= -5) return { bg:"rgba(248,81,73,.12)",  fg:"#ff6060" };
  return              { bg:"rgba(248,81,73,.25)",  fg:"var(--clr-dn)" };
};

// ── RS computation helpers ────────────────────────────────────────────────────
export const calcRS = (secRet, spyRet) => {
  if (secRet == null || spyRet == null || spyRet === 0) return null;
  return +((secRet / Math.abs(spyRet)) * 50).toFixed(1);
};

export const calcCompositeRS = (s, spy) => {
  if (!s || !spy) return null;
  const w = [
    [s.d252, spy.d252, 0.4], [s.d189, spy.d189, 0.2],
    [s.d126, spy.d126, 0.2], [s.d63,  spy.d63,  0.2],
  ];
  let sum = 0, wSum = 0;
  for (const [sv, bv, wt] of w) {
    if (sv != null && bv != null && bv !== 0) {
      sum  += (sv / Math.abs(bv)) * wt;
      wSum += wt;
    }
  }
  return wSum > 0 ? +(sum / wSum * 50).toFixed(1) : null;
};

// ── EMA series computation (Pine Script ta.ema equivalent) ────────────────────
export function calcEMASeries(closes, period) {
  if (!closes || closes.length < period) return [];
  const k   = 2 / (period + 1);
  const out = new Array(closes.length).fill(null);
  let seed  = 0;
  for (let i = 0; i < period; i++) seed += closes[i];
  seed /= period;
  out[period - 1] = seed;
  for (let i = period; i < closes.length; i++)
    out[i] = closes[i] * k + out[i-1] * (1 - k);
  return out;
}
