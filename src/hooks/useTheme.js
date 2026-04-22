// src/hooks/useTheme.js
// Professional trader-grade theme system
// Night: refined dark terminal — easy on eyes, reduced contrast harshness
// Day:   clean light mode — Bloomberg/TradingView inspired
import { createContext, useContext, useState, useCallback, useEffect } from "react";

export const ThemeCtx = createContext("night");
export const useTheme = () => useContext(ThemeCtx);

export const THEME = {
  night: {
    // ── Backgrounds ──────────────────────────────────────────────
    bg:          "#0d1117",   // main canvas — deep navy-grey (not pure black)
    header:      "#0d1117",   // header bar
    surface:     "#161b22",   // cards, panels
    surface2:    "#1c2230",   // nested surfaces, hover states
    row:         "#0d1117",   // table rows (odd)
    rowAlt:      "#131920",   // table rows (even)
    rowHover:    "#1c2230",   // hover

    // ── Borders ───────────────────────────────────────────────────
    border:      "#21262d",   // standard border
    border2:     "#30363d",   // elevated border / active

    // ── Text ──────────────────────────────────────────────────────
    text:        "#cdd9e5",   // primary — softer than pure white
    textMid:     "#8b949e",   // secondary
    textDim:     "#6e7681",   // tertiary
    textFaint:   "#3d444d",   // very dim
    textGhost:   "#21262d",   // near invisible
    textGhost2:  "#161b22",   // matches surface

    // ── Accents ───────────────────────────────────────────────────
    accent:      "#3fb950",   // GitHub green — friendlier than #00e87a neon
    accentBlue:  "#58a6ff",   // links, active states
    accentPurple:"#a371f7",   // intel tab, setups
    accentCyan:  "#39d0d8",   // EMA cross, indicators

    // ── Semantic ──────────────────────────────────────────────────
    up:          "#3fb950",   // gains
    down:        "#f85149",   // losses — softer red than #ff4560
    warn:        "#d29922",   // warnings — amber
    info:        "#58a6ff",   // info

    // ── Charts ───────────────────────────────────────────────────
    chartBg:     "#161b22",
    chartGrid:   "rgba(255,255,255,.03)",
    chartBorder: "rgba(255,255,255,.06)",
    chartText:   "#6e7681",

    // ── Input fields ──────────────────────────────────────────────
    inputBg:     "#0d1117",
    inputBorder: "#30363d",
    inputText:   "#cdd9e5",
    placeholder: "#3d444d",

    // ── Scrollbar ─────────────────────────────────────────────────
    scrollThumb: "#21262d",
    scrollHover: "#30363d",
  },

  day: {
    // ── Backgrounds ──────────────────────────────────────────────
    bg:          "#f0f3f7",   // warm grey canvas (not blinding white)
    header:      "#ffffff",
    surface:     "#ffffff",
    surface2:    "#f6f8fa",
    row:         "#ffffff",
    rowAlt:      "#f6f8fa",
    rowHover:    "#eef1f5",

    // ── Borders ───────────────────────────────────────────────────
    border:      "#d0d7de",
    border2:     "#b0bac4",

    // ── Text ──────────────────────────────────────────────────────
    text:        "#1c2128",   // near-black, not pure black
    textMid:     "#424a53",
    textDim:     "#656d76",
    textFaint:   "#8c959f",
    textGhost:   "#c4cdd5",
    textGhost2:  "#e0e6ec",

    // ── Accents ───────────────────────────────────────────────────
    accent:      "#1a7f37",   // darker green for light bg
    accentBlue:  "#0969da",
    accentPurple:"#8250df",
    accentCyan:  "#0598a0",

    // ── Semantic ──────────────────────────────────────────────────
    up:          "#1a7f37",
    down:        "#cf222e",
    warn:        "#9a6700",
    info:        "#0969da",

    // ── Charts ───────────────────────────────────────────────────
    chartBg:     "#ffffff",
    chartGrid:   "rgba(0,0,0,.04)",
    chartBorder: "rgba(0,0,0,.08)",
    chartText:   "#656d76",

    // ── Input fields ──────────────────────────────────────────────
    inputBg:     "#ffffff",
    inputBorder: "#d0d7de",
    inputText:   "#1c2128",
    placeholder: "#8c959f",

    // ── Scrollbar ─────────────────────────────────────────────────
    scrollThumb: "#c4cdd5",
    scrollHover: "#b0bac4",
  },
};

// CSS variable injection — allows transitioning between themes smoothly
export function injectThemeVars(t) {
  const root = document.documentElement;
  Object.entries(t).forEach(([k, v]) => {
    root.style.setProperty(`--t-${k}`, v);
  });
}

export function useThemeToggle() {
  // Persist to localStorage
  const saved = typeof localStorage !== "undefined"
    ? (localStorage.getItem("md_theme") || "night")
    : "night";
  const [mode, setMode] = useState(saved);

  const toggle = useCallback(() => {
    setMode(m => {
      const next = m === "night" ? "day" : "night";
      localStorage.setItem("md_theme", next);
      return next;
    });
  }, []);

  // Inject CSS variables whenever mode changes
  useEffect(() => {
    injectThemeVars(THEME[mode]);
    document.documentElement.setAttribute("data-theme", mode);
  }, [mode]);

  return { mode, toggle, T: THEME[mode], dark: mode === "night" };
}
