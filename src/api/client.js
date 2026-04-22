// src/api/client.js — Centralised API fetch helper
const BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

export async function apiFetch(path, opts = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Typed API calls ────────────────────────────────────────────────────────────
export const api = {
  health:       ()           => apiFetch("/api/health"),
  universe:     ()           => apiFetch("/api/universe"),
  quotes:       (syms)       => apiFetch(`/api/quotes?symbols=${syms.join(",")}`),
  charts:       (syms, rng)  => apiFetch(`/api/charts?symbols=${syms.join(",")}&range=${rng||"1y"}`),
  sectorInfo:   (syms)       => apiFetch(`/api/sector-info?symbols=${syms.join(",")}`),
  search:       (q, n=8)     => apiFetch(`/api/search?q=${encodeURIComponent(q)}&limit=${n}`),

  scan: {
    gainers:    (p={})       => apiFetch(`/api/scan/gainers?${new URLSearchParams(p)}`),
    losers:     (p={})       => apiFetch(`/api/scan/losers?${new URLSearchParams(p)}`),
    volume:     (p={})       => apiFetch(`/api/scan/volume?${new URLSearchParams(p)}`),
    momentum:   (p={})       => apiFetch(`/api/scan/momentum?${new URLSearchParams(p)}`),
    custom:     (p={})       => apiFetch(`/api/scan/custom?${new URLSearchParams(p)}`),
    symbols:    (syms)       => apiFetch(`/api/scan/symbols?symbols=${syms.join(",")}`),
    full:       (p={})       => apiFetch(`/api/scan/full?${new URLSearchParams(p)}`),
    sectors:    ()           => apiFetch("/api/scan/sectors"),
  },

  live: {
    sectors:    (n=10)       => apiFetch(`/api/live/sectors?limit=${n}`),
    themes:     (n=8)        => apiFetch(`/api/live/themes?limit=${n}`),
  },

  etf:          (p={})       => apiFetch(`/api/etf/stocks?${new URLSearchParams(p)}`),
  rrg:          (p={})       => apiFetch(`/api/rrg?${new URLSearchParams(p)}`),
  premarket:    (p={})       => apiFetch(`/api/premarket?${new URLSearchParams(p)}`),
  news:         (sym)        => apiFetch(`/api/news/${sym}`),
  advanceDecline:(days=126)  => apiFetch(`/api/advance-decline?days=${days}`),

  eod: {
    returns:    (sym)        => apiFetch(`/api/eod/returns/${sym}`),
    log:        ()           => apiFetch("/api/eod/log"),
    collect:    (opts={})    => apiFetch("/api/eod/collect", { method:"POST", body:JSON.stringify(opts) }),
  },
};
