// server/jobs/eod-manual.js — Run EOD collection manually
// Usage: node server/jobs/eod-manual.js [--force] [--symbols AAPL,MSFT]
import "../db/index.js";        // ensure DB is set up
import { runMigrations } from "../db/index.js";
import { loadUniverse }  from "../data/universe.js";
import { loadSICache }   from "../data/enrichment.js";
import { runEODCollection } from "../data/eod.js";
import { log } from "../logger.js";

const args    = process.argv.slice(2);
const force   = args.includes("--force");
const symIdx  = args.indexOf("--symbols");
const symbols = symIdx >= 0 ? args[symIdx + 1]?.split(",") : null;

(async () => {
  log.info("Manual EOD collection starting…");
  runMigrations();
  loadSICache();
  await loadUniverse();
  const result = await runEODCollection({ force, symbols });
  log.ok(`Done: ${JSON.stringify(result)}`);
  process.exit(0);
})();
