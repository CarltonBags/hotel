import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations } from "../src/migrations/load";
import { provisionTenant } from "../src/tenant/provision";
import { migrateTenants, type Migration } from "../src/tenant/migrate-tenants";
import { withTenant } from "../src/tenant/with-tenant";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: migrateControl, provisionTenant, migrateTenants.
 * The runner rolls every tenant schema forward, records the version per tenant
 * in the control schema inside the same transaction, stops on the first
 * failure, and is re-runnable.
 */
const m1: Migration = { version: 1, name: "settings", sql: "create table tenant_settings (key text primary key, value text)" };
const m2: Migration = { version: 2, name: "marker", sql: "create table marker (name text not null)" };

describe("control and tenant migrations", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = testPool(4);
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("provisions a tenant: control row, schema and all migrations applied", async () => {
    const tenant = await provisionTenant(pool, { slug: "alpha-hotels", name: "Alpha Hotels GmbH" }, [m1, m2]);
    expect(tenant.schemaName).toBe("t_alpha_hotels");

    const versions = await pool.query<{ version: number }>(
      "select version from control.tenant_migrations where tenant_id = $1 order by version",
      [tenant.id],
    );
    expect(versions.rows.map((r) => r.version)).toEqual([1, 2]);

    const n = await withTenant(pool, tenant.schemaName, async (tx) => {
      await tx.query("insert into marker values ('x')");
      const { rows } = await tx.query<{ n: number }>("select count(*)::int as n from marker");
      return rows[0]!.n;
    });
    expect(n).toBe(1);
  });

  it("refuses a slug that is already taken", async () => {
    await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, [m1]);
    await expect(provisionTenant(pool, { slug: "alpha", name: "Alpha again" }, [m1])).rejects.toThrow(/already exists/i);
  });

  it("rolls all tenants forward and records versions", async () => {
    await provisionTenant(pool, { slug: "a", name: "A" }, [m1]);
    await provisionTenant(pool, { slug: "b", name: "B" }, [m1]);
    await provisionTenant(pool, { slug: "c", name: "C" }, [m1]);

    const result = await migrateTenants(pool, [m1, m2]);
    expect(result.applied).toEqual([
      { schema: "t_a", version: 2 },
      { schema: "t_b", version: 2 },
      { schema: "t_c", version: 2 },
    ]);
    expect(result.failure).toBeUndefined();

    // running again is a no-op
    const again = await migrateTenants(pool, [m1, m2]);
    expect(again.applied).toEqual([]);
  });

  it("stops on the first failure, leaves that tenant unchanged, and resumes after the fix", async () => {
    await provisionTenant(pool, { slug: "a", name: "A" }, [m1]);
    await provisionTenant(pool, { slug: "b", name: "B" }, [m1]);
    await provisionTenant(pool, { slug: "c", name: "C" }, [m1]);
    // make the broken migration fail only for tenant b
    await withTenant(pool, "t_b", (tx) => tx.query("insert into tenant_settings values ('break', 'yes')"));
    const m2conditional: Migration = {
      version: 2,
      name: "marker",
      sql: `create table marker (name text not null);
            do $$ begin if exists (select 1 from tenant_settings where key = 'break') then raise exception 'boom'; end if; end $$;`,
    };

    const first = await migrateTenants(pool, [m1, m2conditional]);
    expect(first.applied).toEqual([{ schema: "t_a", version: 2 }]);
    expect(first.failure).toMatchObject({ schema: "t_b", version: 2 });
    expect(first.failure?.error).toMatch(/boom/);

    // tenant b: nothing half-applied, version not recorded
    await expect(withTenant(pool, "t_b", (tx) => tx.query("select * from marker"))).rejects.toThrow(/does not exist/);
    const vb = await pool.query<{ version: number }>(
      "select version from control.tenant_migrations tm join control.tenants t on t.id = tm.tenant_id where t.schema_name = 't_b' order by version",
    );
    expect(vb.rows.map((r) => r.version)).toEqual([1]);

    // tenant c: untouched because the runner stopped
    await expect(withTenant(pool, "t_c", (tx) => tx.query("select * from marker"))).rejects.toThrow(/does not exist/);

    // fix and resume: a is skipped, b and c are applied
    const second = await migrateTenants(pool, [m1, m2]);
    expect(second.applied).toEqual([
      { schema: "t_b", version: 2 },
      { schema: "t_c", version: 2 },
    ]);
    expect(second.failure).toBeUndefined();
  });

  it("refuses a migration list with gaps or duplicates", async () => {
    await expect(migrateTenants(pool, [m1, { ...m2, version: 3 }])).rejects.toThrow(/version/);
    await expect(migrateTenants(pool, [m1, m1])).rejects.toThrow(/version/);
  });

});
