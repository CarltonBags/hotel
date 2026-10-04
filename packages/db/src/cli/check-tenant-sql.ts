import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findSchemaQualifiedNames } from "../tenant/check-tenant-sql";

/**
 * CI guard for the schema-per-tenant rules (research constraints 2 and 8):
 * 1. tenant migrations never name a schema;
 * 2. application code never sets the search path for a session, only per transaction.
 */
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
let bad = 0;

const migrationsDir = resolve(here, "../../migrations/tenant");
for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
  for (const f of findSchemaQualifiedNames(readFileSync(join(migrationsDir, file), "utf8"))) {
    console.error(`migrations/tenant/${file}:${f.line}: schema-qualified name ${f.match} in tenant SQL`);
    bad++;
  }
}

// `SET search_path` without LOCAL, or set_config(..., false), would stick to the pooled connection.
const SESSION_SEARCH_PATH = /\bset\s+search_path\b(?!\s*=?\s*local)|set_config\(\s*'search_path'\s*,[^,]+,\s*false\s*\)/i;
const SET_LOCAL_OK = /\bset\s+local\s+search_path\b/i;
// a function's own `set search_path from current` applies only while the function runs (trigger functions find their tenant's tables)
const FUNCTION_SEARCH_PATH_OK = /\bcreate\s+(or\s+replace\s+)?function\b.*\bset\s+search_path\s+from\s+current\b/i;
function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx|sql)$/.test(entry)) yield full;
  }
}
for (const scope of ["packages", "apps"]) {
  for (const file of sourceFiles(join(repoRoot, scope))) {
    if (file.includes("staff-shell-prototype")) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
        if (SESSION_SEARCH_PATH.test(line) && !SET_LOCAL_OK.test(line) && !FUNCTION_SEARCH_PATH_OK.test(line)) {
          console.error(`${file.slice(repoRoot.length + 1)}:${i + 1}: session-level search_path (use SET LOCAL or set_config(..., true))`);
          bad++;
        }
      });
  }
}

if (bad) {
  console.error(`${bad} problem(s) found.`);
  process.exit(1);
}
console.log("tenant SQL clean: no schema-qualified names, no session-level search_path");
