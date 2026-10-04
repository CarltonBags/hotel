import type { Pool } from "pg";
import { assertContiguous, type Migration } from "../migrations/versions";
import { runAndRecord } from "./migrate-tenants";
import { assertTenantSchemaName } from "./with-tenant";
import { TRIAL_DAYS, assertTenantSlug, demoDeletionDue, isAccentId, tenantSchemaFromSlug, type AccentId, type TrialKind } from "@hoteloftware/domain";

export interface NewTenant {
  slug: string;
  name: string;
  /** A self-service trial (ticket 87): 30 days in Test Mode, on demo data or the customer's own. */
  trial?: TrialKind;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  schemaName: string;
  accent: AccentId;
}

/**
 * Create a tenant: control row, its schema, and every tenant migration, in one
 * transaction. Either the tenant exists fully or not at all.
 */
export async function provisionTenant(pool: Pool, input: NewTenant, migrations: Migration[]): Promise<Tenant> {
  assertTenantSlug(input.slug);
  assertContiguous(migrations);
  const schemaName = tenantSchemaFromSlug(input.slug);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const existing = await client.query("select 1 from control.tenants where slug = $1 or schema_name = $2", [
      input.slug,
      schemaName,
    ]);
    if (existing.rowCount) throw new Error(`Tenant "${input.slug}" already exists`);
    const testMode = input.trial !== undefined;
    const { rows } = await client.query<{ id: string }>(
      `insert into control.tenants (slug, name, schema_name, trial_kind, trial_ends_at, live_at)
       values ($1, $2, $3, $4, case when $4::text is null then null else now() + make_interval(hours => 24 * $5) end, case when $6 then null else now() end) returning id`,
      [input.slug, input.name, schemaName, input.trial ?? null, TRIAL_DAYS, testMode],
    );
    const id = rows[0]!.id;
    await client.query(`create schema "${schemaName}"`);
    await client.query("select set_config('search_path', $1, true)", [schemaName]);
    await client.query("select set_config('lock_timeout', '5s', true)");
    for (const m of migrations) await runAndRecord(client, id, m);
    if (testMode) await client.query("insert into tenant_settings (key, value) values ('test_mode', 'on')");
    await client.query("commit");
    return { id, slug: input.slug, name: input.name, schemaName, accent: "ocean" };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  schema_name: string;
  accent: string;
}

function toTenant(r: TenantRow): Tenant {
  return { id: r.id, slug: r.slug, name: r.name, schemaName: r.schema_name, accent: isAccentId(r.accent) ? r.accent : "ocean" };
}

export async function findTenantBySlug(pool: Pool, slug: string): Promise<Tenant | null> {
  const { rows } = await pool.query<TenantRow>("select id, slug, name, schema_name, accent from control.tenants where slug = $1", [slug]);
  return rows[0] ? toTenant(rows[0]) : null;
}

export async function findTenantById(pool: Pool, id: string): Promise<Tenant | null> {
  const { rows } = await pool.query<TenantRow>("select id, slug, name, schema_name, accent from control.tenants where id = $1", [id]);
  return rows[0] ? toTenant(rows[0]) : null;
}

export async function setTenantAccent(pool: Pool, tenantId: string, accent: string): Promise<void> {
  if (!isAccentId(accent)) throw new Error(`Unknown accent: ${accent}`);
  await pool.query("update control.tenants set accent = $2 where id = $1", [tenantId, accent]);
}

/** Delete a tenant that never went live, with all its data: schema, users, sessions, roles (control rows cascade). A live tenant leaves by the exit process instead. */
export async function deleteTenant(pool: Pool, tenantId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const t = (await client.query<{ schema_name: string; live_at: Date | null }>("select schema_name, live_at from control.tenants where id = $1 for update", [tenantId])).rows[0];
    if (!t) throw new Error("Tenant not found");
    if (t.live_at) throw new Error("A live tenant is not deleted here");
    assertTenantSchemaName(t.schema_name);
    await client.query(`drop schema "${t.schema_name}" cascade`);
    await client.query("delete from control.tenants where id = $1", [tenantId]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** How many trials started in the last hour: the public signup is capped platform-wide. */
export async function trialsInLastHour(pool: Pool): Promise<number> {
  return (await pool.query<{ n: number }>("select count(*)::int as n from control.tenants where trial_kind is not null and created_at > now() - interval '1 hour'")).rows[0]!.n;
}

/** Delete the demo tenants whose trial ended 30 days ago (a daily worker job); returns their slugs. */
export async function deleteExpiredDemoTenants(pool: Pool, now = new Date()): Promise<string[]> {
  const { rows } = await pool.query<{ id: string; slug: string; trial_ends_at: Date }>("select id, slug, trial_ends_at from control.tenants where trial_kind = 'demo' and live_at is null");
  const deleted: string[] = [];
  for (const tenant of rows.filter((r) => demoDeletionDue(r.trial_ends_at, now))) {
    // one failure must not keep the others
    try {
      await deleteTenant(pool, tenant.id);
      deleted.push(tenant.slug);
    } catch (err) {
      console.error(`[demo] could not delete ${tenant.slug}`, err);
    }
  }
  return deleted;
}
