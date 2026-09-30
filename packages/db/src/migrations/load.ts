import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type Migration } from "./versions";

export type { Migration } from "./versions";

const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** Load `NNNN_name.sql` files from a directory, sorted by version. */
export function loadMigrationsFromDir(dir: string): Migration[] {
  const files = readdirSync(dir).filter((f) => FILE.test(f)).sort();
  return files.map((f) => {
    const [, v, name] = FILE.exec(f)!;
    return { version: Number(v), name: name!, sql: readFileSync(join(dir, f), "utf8") };
  });
}

/** Node-only: resolved lazily so bundlers that lack import.meta.dirname never evaluate it at import time. */
function migrationsRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");
}

export function controlMigrations(): Migration[] {
  return loadMigrationsFromDir(join(migrationsRoot(), "control"));
}

export function tenantMigrations(): Migration[] {
  return loadMigrationsFromDir(join(migrationsRoot(), "tenant"));
}

