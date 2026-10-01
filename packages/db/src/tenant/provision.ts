import type { Pool } from "pg";
import { assertContiguous, type Migration } from "../migrations/versions";
import { runAndRecord } from "./migrate-tenants";
import { assertTenantSlug, isAccentId, tenantSchemaFromSlug, type AccentId } from "@hoteloftware/domain";

export interface NewTenant {
  slug: string;
  name: string;
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
    const { rows } = await client.query<{ id: string }>(
      "insert into control.tenants (slug, name, schema_name) values ($1, $2, $3) returning id",
      [input.slug, input.name, schemaName],
    );
    const id = rows[0]!.id;
    await client.query(`create schema "${schemaName}"`);
    await client.query("select set_config('search_path', $1, true)", [schemaName]);
    await client.query("select set_config('lock_timeout', '5s', true)");
    for (const m of migrations) await runAndRecord(client, id, m);
    await client.query("commit");
    return { id, slug: input.slug, name: input.name, schemaName, accent: "ocean" };
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function findTenantBySlug(pool: Pool, slug: string): Promise<Tenant | null> {
  const { rows } = await pool.query<{ id: string; slug: string; name: string; schema_name: string; accent: string }>(
    "select id, slug, name, schema_name, accent from control.tenants where slug = $1",
    [slug],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, slug: r.slug, name: r.name, schemaName: r.schema_name, accent: isAccentId(r.accent) ? r.accent : "ocean" };
}

export async function setTenantAccent(pool: Pool, tenantId: string, accent: string): Promise<void> {
  if (!isAccentId(accent)) throw new Error(`Unknown accent: ${accent}`);
  await pool.query("update control.tenants set accent = $2 where id = $1", [tenantId, accent]);
}
