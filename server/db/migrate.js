// server/db/migrate.js — standalone migration runner
// Usage: node server/db/migrate.js
import { runMigrations } from "./index.js";
runMigrations();
console.log("Done.");
process.exit(0);
