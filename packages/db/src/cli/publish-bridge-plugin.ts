import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { asPluginModule } from "@hoteloftware/bridge-kit";
import { publishBridgePlugin } from "../control/site-bridge";
import { directDatabaseUrl } from "./env";

/**
 * Our side: a Site Bridge plugin version made available to every Bridge
 * (ticket 68). The file is loaded and checked first; a version once
 * published is never replaced (a fix is a new version).
 *   pnpm --filter @hoteloftware/db publish-bridge-plugin <plugin.mjs>
 */
const file = process.argv[2];
if (!file) {
  console.error("usage: publish-bridge-plugin <plugin.mjs>");
  process.exit(2);
}
const path = resolve(file);
const m = asPluginModule(await import(pathToFileURL(path).href));
const pool = new Pool({ connectionString: directDatabaseUrl(), max: 1 });
try {
  const sha = await publishBridgePlugin(pool, { name: m.name, version: m.version, kind: m.kind, code: await readFile(path, "utf8") });
  console.log(`published ${m.name} ${m.version} (${m.kind}), sha256 ${sha}`);
} finally {
  await pool.end();
}
