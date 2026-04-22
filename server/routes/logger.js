// server/logger.js — Structured logger
import { LOG_LEVEL } from "./config.js";

const LEVELS = { error:0, warn:1, info:2, debug:3 };
const current = LEVELS[LOG_LEVEL] ?? 2;

const ts = () => new Date().toLocaleTimeString("en-US",{hour12:false});

export const log = {
  error: (msg, ...a) => current >= 0 && console.error(`[${ts()}] ❌  ${msg}`, ...a),
  warn:  (msg, ...a) => current >= 1 && console.warn( `[${ts()}] ⚠️   ${msg}`, ...a),
  info:  (msg, ...a) => current >= 2 && console.log(  `[${ts()}] ℹ️   ${msg}`, ...a),
  debug: (msg, ...a) => current >= 3 && console.log(  `[${ts()}] 🔍  ${msg}`, ...a),
  ok:    (msg, ...a) => current >= 2 && console.log(  `[${ts()}] ✅  ${msg}`, ...a),
  step:  (msg, ...a) => current >= 2 && console.log(  `[${ts()}]  ↳  ${msg}`, ...a),
};
