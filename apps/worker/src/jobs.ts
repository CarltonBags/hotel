import type { Pool, PoolClient } from "pg";
import { findTenantById, withTenant, type Tenant } from "@hoteloftware/db";

/** Every job payload names its tenant; everything else is identifiers, never guest data (ADR 0007). */
export interface TenantJobData {
  tenantId: string;
}

export interface TenantJobContext<T extends TenantJobData> {
  /** Transaction with the search path set to the tenant's schema. */
  tx: PoolClient;
  tenant: Tenant;
  data: T;
  pool: Pool;
}

export type TenantJobHandler<T extends object> = (ctx: TenantJobContext<T & TenantJobData>) => Promise<unknown>;

/** Resolve the tenant from the control schema and run the handler inside that tenant's schema. */
export async function runTenantJob<T extends object>(pool: Pool, data: T & TenantJobData, handler: TenantJobHandler<T>): Promise<unknown> {
  const tenant = await findTenantById(pool, data.tenantId);
  if (!tenant) throw new Error(`Unknown tenant ${data.tenantId}`);
  return withTenant(pool, tenant.schemaName, (tx) => handler({ tx, tenant, data, pool }));
}
