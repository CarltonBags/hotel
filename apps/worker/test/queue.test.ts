import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type PgBoss from "pg-boss";
import { migrateControl, provisionTenant, withTenant, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { QUEUES, startQueue } from "../src/queue";
import { receiveWebhook, testSource } from "../src/webhooks";

/**
 * Seam: real pg-boss jobs end to end. A tenant.check job runs inside its
 * tenant's schema and writes the notification; a webhook job runs the
 * source's processor in the tenant and marks the stored event processed.
 */
async function until(fn: () => Promise<boolean>, ms = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("timed out");
}

describe("queue handlers", () => {
  let pool: Pool;
  let boss: PgBoss;
  let alpha: Tenant;
  const seen: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ nspname: string }>("select nspname from pg_namespace where nspname like 't\\_%' or nspname in ('control', 'pgboss')");
    for (const { nspname } of rows) await pool.query(`drop schema "${nspname}" cascade`);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    await withTenant(pool, alpha.schemaName, (tx) =>
      tx.query("insert into legal_entities (name, country) values ('Alpha GmbH', 'DE'); insert into properties (legal_entity_id, name, country, time_zone, currency) select id, 'P1', 'DE', 'Europe/Berlin', 'EUR' from legal_entities"),
    );
    await pool.query("insert into control.external_ids (provider, external_id, tenant_id) values ('test', 'prop-1', $1)", [alpha.id]);
    boss = await startQueue(pool, process.env.TEST_DATABASE_URL!, {
      tenantCheckCron: null,
      processors: {
        test: async ({ tx, tenant, data }) => {
          const { rows } = await tx.query<{ schema: string }>("select current_schema() as schema");
          seen.push(`${tenant.slug}:${rows[0]!.schema}:${data.externalId}`);
        },
      },
    });
  });

  afterAll(async () => {
    await boss.stop({ graceful: false, wait: false });
    await pool.end();
  });

  it("tenant.check runs in the tenant's schema and publishes a notification with its property count", async () => {
    await boss.send(QUEUES.tenantCheck, { tenantId: alpha.id });
    await until(async () => (await pool.query("select 1 from control.notifications where kind = 'tenant.check'")).rowCount === 1);
    const { rows } = await pool.query<{ tenant_id: string; user_id: string | null; body: string }>("select tenant_id, user_id, body from control.notifications");
    expect(rows[0]).toMatchObject({ tenant_id: alpha.id, user_id: null });
    expect(rows[0]!.body).toMatch(/^1 properties/);
  });

  it("a webhook job runs the source's processor in the tenant and marks the event processed", async () => {
    const source = testSource("s3cret");
    const result = await receiveWebhook(pool, boss, source, { headers: { "x-webhook-secret": "s3cret" }, rawBody: JSON.stringify({ id: "evt-q1", property: "prop-1" }) });
    expect(result.status).toBe(202);
    await until(async () => (await pool.query("select 1 from control.webhook_events where external_id = 'evt-q1' and status = 'processed'")).rowCount === 1);
    expect(seen).toEqual(["alpha:t_alpha:evt-q1"]);
  });
});
