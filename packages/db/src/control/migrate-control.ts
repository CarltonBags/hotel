import type { Pool } from "pg";
import { assertContiguous, type Migration } from "../migrations/versions";

/**
 * Apply pending control-schema migrations. Each migration runs in its own
 * transaction together with the row that records it, so a failure leaves
 * the control schema at the previous version.
 */
export async function migrateControl(pool: Pool, migrations: Migration[]): Promise<number[]> {
  assertContiguous(migrations);
  await pool.query("create schema if not exists control");
  await pool.query(`create table if not exists control.schema_migrations (
    version integer primary key,
    name text not null,
    applied_at timestamptz not null default now()
  )`);
  const { rows } = await pool.query<{ version: number }>("select version from control.schema_migrations");
  const done = new Set(rows.map((r) => r.version));
  const applied: number[] = [];
  const client = await pool.connect();
  try {
    for (const m of migrations) {
      if (done.has(m.version)) continue;
      await client.query("begin");
      try {
        await client.query("select set_config('lock_timeout', '5s', true)");
        await client.query(m.sql);
        await client.query("insert into control.schema_migrations (version, name) values ($1, $2)", [m.version, m.name]);
        await client.query("commit");
        applied.push(m.version);
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      }
    }
  } finally {
    client.release();
  }
  return applied;
}
