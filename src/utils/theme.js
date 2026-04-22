// src/utils/theme.js — semantic color helpers (mode-aware)
// Use these instead of hardcoded hex colors so Day/Night both look good.

// Positive = green, negative = red — adapts to theme via CSS var
export const gc = (v) => v >= 0 ? "var(--clr-up)" : "var(--clr-dn)";

// Percentage return color — thresholds configurable
export const pctColor = (v, hi=5, lo=-5) =>
  v == null ? "var(--clr-dim)" :
  v >=  hi  ? "var(--clr-up)"       :
  v >=  0   ? "var(--clr-up-soft)"  :
  v >=  lo  ? "var(--clr-dn-soft)"  :
              "var(--clr-dn)";

// RS Rank badge color
export const rsColor = (r) =>
  r == null  ? "var(--clr-dim)" :
  r >= 90    ? "var(--clr-up)"       :
  r >= 80    ? "var(--clr-up-soft)"  :
  r >= 70    ? "var(--clr-warn)"     :
  r >= 50    ? "#ff9f1c"             :
               "var(--clr-dn)";
