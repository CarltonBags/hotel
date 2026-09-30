import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { withTenant } from "../src/tenant/with-tenant";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seam: withTenant(pool, schemaName, fn). Every tenant query runs inside a
 * transaction whose search path is set for that transaction only, so a pooled
 * connection reused by the next caller never carries the previous tenant.
 */
describe("withTenant", () => {
  let pool: Pool;
  const schemas = ["t_alpha", "t_beta"] as const;

  beforeAll(async () => {
    pool = testPool(8);
    await resetTestDatabase(pool);
    for (const s of schemas) {
      await pool.query(`create schema "${s}"`);
      await pool.query(`create table "${s}".marker (name text not null)`);
      await pool.query(`insert into "${s}".marker values ($1)`, [s]);
    }
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("runs the callback inside the tenant schema", async () => {
    const name = await withTenant(pool, "t_alpha", async (tx) => {
      const { rows } = await tx.query<{ name: string }>("select name from marker");
      return rows[0]?.name;
    });
    expect(name).toBe("t_alpha");
  });

  it("does not leak the search path to the next use of the same connection", async () => {
    await withTenant(pool, "t_alpha", async (tx) => {
      await tx.query("select 1");
    });
    // A plain query on the pool must not see any tenant table.
    await expect(pool.query("select name from marker")).rejects.toThrow(/relation "marker" does not exist/);
  });

  it("isolates tenants under parallel load on a shared pool, and plain queries between them see no tenant", async () => {
    const clients = 8;
    const rounds = 25;
    const results = await Promise.all(
      Array.from({ length: clients }, async (_, c) => {
        let wrong = 0;
        for (let r = 0; r < rounds; r++) {
          const expected = schemas[(c + r) % 2]!;
          const seen = await withTenant(pool, expected, async (tx) => {
            const { rows } = await tx.query<{ name: string; schema: string }>(
              "select name, current_schema() as schema from marker",
            );
            return rows[0]!;
          });
          if (seen.name !== expected || seen.schema !== expected) wrong++;
          // A plain query on the same pool must land on a connection with the default search path.
          const { rows } = await pool.query<{ schema: string | null }>("select current_schema() as schema");
          if (rows[0]!.schema !== "public") wrong++;
        }
        return wrong;
      }),
    );
    expect(results.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("rolls back and rethrows when the callback throws", async () => {
    await expect(
      withTenant(pool, "t_beta", async (tx) => {
        await tx.query("insert into marker values ('oops')");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const { rows } = await pool.query(`select count(*)::int as n from "t_beta".marker`);
    expect(rows[0]?.n).toBe(1);
  });

  it("refuses schema names that are not valid tenant schemas", async () => {
    await expect(withTenant(pool, 'public"; drop schema t_alpha; --', async () => 1)).rejects.toThrow(
      /invalid tenant schema/i,
    );
  });
});
