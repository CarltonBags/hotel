import type { Pool, PoolClient } from "pg";
import { assertContiguous, type Migration } from "../migrations/versions";
import { inTenantTransaction } from "./with-tenant";

export type { Migration } from "../migrations/versions";

/** DDL never queues behind live traffic for longer than this; the runner reports and stops instead. */
export const MIGRATION_LOCK_TIMEOUT = "5s";

export interface MigrateResult {
  /** Migrations applied in order, one entry per tenant and version. */
  applied: { schema: string; version: number }[];
  /** Set when the run stopped; every tenant after this one was left untouched. */
  failure?: { schema: string; version: number; error: string };
}

interface TenantRow {
  id: string;
  schema_name: string;
}

/**
 * Run one migration's SQL and record its version for the tenant. The caller
 * owns the transaction and has set the search path to the tenant schema.
 */
export async function runAndRecord(tx: PoolClient, tenantId: string, m: Migration): Promise<void> {
  await tx.query(m.sql);
  await tx.query("insert into control.tenant_migrations (tenant_id, version, name) values ($1, $2, $3)", [
    tenantId,
    m.version,
    m.name,
  ]);
}

/**
 * Apply one migration to one tenant: the DDL and the version row commit
 * together, so a tenant is never half-migrated.
 */
export async function applyTenantMigration(client: PoolClient, tenant: TenantRow, m: Migration): Promise<void> {
  await inTenantTransaction(client, tenant.schema_name, (tx) => runAndRecord(tx, tenant.id, m), {
    lockTimeout: MIGRATION_LOCK_TIMEOUT,
  });
}

/**
 * Roll every tenant schema forward to the last migration, in slug order.
 * Stops at the first failure and reports it; re-running resumes where it stopped.
 * Use a direct (non-pooled) connection in production; see ADR 0006.
 */
export async function migrateTenants(pool: Pool, migrations: Migration[]): Promise<MigrateResult> {
  assertContiguous(migrations);
  const target = migrations.length;
  const { rows: tenants } = await pool.query<TenantRow & { version: number }>(
    `select t.id, t.schema_name, coalesce(max(tm.version), 0)::int as version
       from control.tenants t
       left join control.tenant_migrations tm on tm.tenant_id = t.id
      group by t.id, t.schema_name, t.slug
      order by t.slug`,
  );
  const result: MigrateResult = { applied: [] };
  const client = await pool.connect();
  try {
    for (const tenant of tenants) {
      if (tenant.version > target) {
        throw new Error(`Tenant ${tenant.schema_name} is at version ${tenant.version}, newer than the code (${target})`);
      }
      for (const m of migrations) {
        if (m.version <= tenant.version) continue;
        try {
          await applyTenantMigration(client, tenant, m);
          result.applied.push({ schema: tenant.schema_name, version: m.version });
        } catch (err) {
          result.failure = {
            schema: tenant.schema_name,
            version: m.version,
            error: err instanceof Error ? err.message : String(err),
          };
          return result;
        }
      }
    }
    return result;
  } finally {
    client.release();
  }
}
