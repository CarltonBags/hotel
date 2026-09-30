import { Pool } from "pg";

export function testPool(max = 8): Pool {
  return new Pool({ connectionString: process.env.TEST_DATABASE_URL, max });
}

/** Drop every schema the tests create so each file starts clean. */
export async function resetTestDatabase(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ nspname: string }>(
    `select nspname from pg_namespace
     where nspname like 't\\_%' or nspname = 'control' or nspname like 'test\\_%'`,
  );
  for (const { nspname } of rows) {
    await pool.query(`drop schema "${nspname}" cascade`);
  }
}
