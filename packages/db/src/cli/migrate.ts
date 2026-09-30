import { Pool } from "pg";
import { migrateControl } from "../control/migrate-control";
import { controlMigrations, tenantMigrations } from "../migrations/load";
import { migrateTenants } from "../tenant/migrate-tenants";
import { directDatabaseUrl } from "./env";

/**
 * Deploy step: roll the control schema and then every tenant schema forward.
 * Uses a direct connection (not the pooler). Exits non-zero on the first failure.
 */
const pool = new Pool({ connectionString: directDatabaseUrl(), max: 1 });
try {
  const control = await migrateControl(pool, controlMigrations());
  console.log(`control: applied ${control.length} migration(s)`);
  const result = await migrateTenants(pool, tenantMigrations());
  for (const a of result.applied) console.log(`${a.schema}: version ${a.version}`);
  console.log(`tenants: applied ${result.applied.length} migration(s)`);
  if (result.failure) {
    console.error(`STOPPED at ${result.failure.schema} version ${result.failure.version}: ${result.failure.error}`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
