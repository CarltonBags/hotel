import { Pool } from "pg";
import { migrateControl } from "../control/migrate-control";
import { controlMigrations, tenantMigrations } from "../migrations/load";
import { provisionTenant } from "../tenant/provision";
import { directDatabaseUrl } from "./env";

/** Usage: pnpm db:provision <slug> "<name>" */
const [slug, name] = process.argv.slice(2);
if (!slug || !name) {
  console.error('usage: pnpm db:provision <slug> "<tenant name>"');
  process.exit(2);
}
const pool = new Pool({ connectionString: directDatabaseUrl(), max: 1 });
try {
  await migrateControl(pool, controlMigrations());
  const tenant = await provisionTenant(pool, { slug, name }, tenantMigrations());
  console.log(`provisioned ${tenant.slug} -> schema ${tenant.schemaName} (id ${tenant.id})`);
} finally {
  await pool.end();
}
