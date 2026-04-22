# Market Dashboard – Fixes & Improvements

## Date: April 23, 2026

## Issue Summary

The application crashed with `ReferenceError: T is not defined` when loading the **Intelligence**, **Rotation**, **Sectors**, and **Themes** tabs. The root cause was that helper components and utility functions were defined at the top level of the file but referenced the `T` theme object, which is only defined inside the React component.

## Fixes Applied

### 1. IntelligenceTab.jsx – Major Refactor

**Problem:**  
Seven helper components (`MiniBarChart`, `Gauge`, `StageBadge`, `RSBadge`, `SetupBar`, `EarningsBadge`, `RiskCalculator`) were defined outside the `IntelligenceTab` component, making `T` inaccessible.

**Solution:**  
All helper components were moved **inside** the `IntelligenceTab` function, immediately after `const T = ...`. This gives them access to `T` via JavaScript closure.

**Additional Fix:**  
Inside `RiskCalculator`, the destructuring default `color={T.text}` was invalid syntax. Changed to `color = T.text`.

**Result:**  
The Intelligence tab now loads correctly without errors.

---

### 2. RotationTab.jsx – Heat Function Fix

**Problem:**  
The `heat` function was defined at the top level and used `T.accent` and `T.down`, which are not defined globally.

**Solution:**  
Replaced `T.accent` and `T.down` with CSS variables `var(--clr-up)`, `var(--clr-up-soft)`, and `var(--clr-dn)`. These variables are defined in `App.jsx` and are theme-aware.

**Before:**
```js
if(v>=5) return{bg:"rgba(0,232,122,.25)", fg:T.accent};
