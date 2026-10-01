import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrateControl, provisionTenant, withTenant, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { runTenantJob, type TenantJobHandler } from "../src/jobs";

/**
 * Seam: a job carries a tenant id and identifiers only; the handler runs
 * inside that tenant's schema like any request and cannot reach another tenant.
 */
describe("tenant jobs", () => {
  let pool: Pool;
  let alpha: Tenant;
  let beta: Tenant;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ nspname: string }>("select nspname from pg_namespace where nspname like 't\\_%' or nspname = 'control'");
    for (const { nspname } of rows) await pool.query(`drop schema "${nspname}" cascade`);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    beta = await provisionTenant(pool, { slug: "beta", name: "Beta" }, tenantMigrations());
    await withTenant(pool, alpha.schemaName, (tx) => tx.query("insert into tenant_settings (key, value) values ('owner', 'alpha')"));
    await withTenant(pool, beta.schemaName, (tx) => tx.query("insert into tenant_settings (key, value) values ('owner', 'beta')"));
  });

  afterAll(async () => {
    await pool.end();
  });

  const readOwner: TenantJobHandler<{ note: string }> = async ({ tx, tenant, data }) => {
    const { rows } = await tx.query<{ value: string; schema: string }>("select value, current_schema() as schema from tenant_settings where key = 'owner'");
    return { value: rows[0]?.value, schema: rows[0]?.schema, tenant: tenant.slug, note: data.note };
  };

  it("runs the handler inside the job's tenant schema", async () => {
    expect(await runTenantJob(pool, { tenantId: alpha.id, note: "a" }, readOwner)).toEqual({ value: "alpha", schema: "t_alpha", tenant: "alpha", note: "a" });
    expect(await runTenantJob(pool, { tenantId: beta.id, note: "b" }, readOwner)).toEqual({ value: "beta", schema: "t_beta", tenant: "beta", note: "b" });
  });

  it("unqualified names in a job for tenant A never reach tenant B", async () => {
    // Isolation is the search path plus the CI lint that forbids schema-qualified names in app code.
    const peek: TenantJobHandler<object> = async ({ tx }) => (await tx.query<{ value: string }>("select value from tenant_settings")).rows.map((r) => r.value);
    expect(await runTenantJob(pool, { tenantId: alpha.id }, peek)).toEqual(["alpha"]);
    expect(await runTenantJob(pool, { tenantId: beta.id }, peek)).toEqual(["beta"]);
  });

  it("refuses a job without a known tenant", async () => {
    await expect(runTenantJob(pool, { tenantId: "00000000-0000-4000-8000-000000000000", note: "x" }, readOwner)).rejects.toThrow(/unknown tenant/i);
  });
});
