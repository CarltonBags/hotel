import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { controlSchema } from "./control/schema";
import { tenantSchema } from "./tenant/schema";
import { withTenant } from "./tenant/with-tenant";

export { migrateControl } from "./control/migrate-control";
export { assertContiguous, type Migration } from "./migrations/versions";
export { findSchemaQualifiedNames, type Finding } from "./tenant/check-tenant-sql";
export { migrateTenants, type MigrateResult } from "./tenant/migrate-tenants";
export { findTenantBySlug, provisionTenant, type NewTenant, type Tenant } from "./tenant/provision";
export { assertTenantSlug, isTenantSlug, resolveTenantSlug, tenantSchemaFromSlug } from "@hoteloftware/domain";
export { assertTenantSchemaName, inTenantTransaction, isTenantSchemaName, withTenant } from "./tenant/with-tenant";
export { controlSchema } from "./control/schema";
export {
  countOwners,
  emailForUsername,
  findTenantUser,
  inControlTransaction,
  listTenantUsers,
  loadActor,
  setPropertyRoles,
  setTenantRole,
  setUsername,
  type TenantUser,
} from "./control/roles";
export { createLegalEntity, findLegalEntity, listLegalEntities, updateLegalEntity, type LegalEntity, type LegalEntityInput } from "./tenant/legal-entities";
export { createProperty, findProperty, listProperties, updateProperty, type Property, type PropertyInput } from "./tenant/properties";
export { tenantSchema } from "./tenant/schema";

export type ControlDb = NodePgDatabase<typeof controlSchema>;
export type TenantDb = NodePgDatabase<typeof tenantSchema>;

export function createPool(connectionString: string, max = 10): Pool {
  return new Pool({ connectionString, max });
}

/** Drizzle over the control schema; tables are schema-qualified, no search path needed. */
export function controlDb(pool: Pool): ControlDb {
  return drizzle(pool, { schema: controlSchema });
}

/**
 * Run a Drizzle callback against one tenant. The client is the transaction
 * from withTenant, so every query inside runs in the tenant's schema.
 * The neon-http driver cannot be used here (no transactions); see research.
 */
export function withTenantDb<T>(pool: Pool, schema: string, fn: (db: TenantDb, tx: PoolClient) => Promise<T>): Promise<T> {
  return withTenant(pool, schema, (tx) => fn(drizzle(tx, { schema: tenantSchema }), tx));
}
