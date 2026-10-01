import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrateControl, provisionTenant, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { receiveWebhook, type WebhookSource } from "../src/webhooks";

/**
 * Seam: inbound webhook intake. The raw event is stored and acknowledged
 * first; the tenant is resolved through control.external_ids; processing is a
 * job keyed by (source, external id), so a replay is accepted and ignored.
 */
describe("webhook intake", () => {
  let pool: Pool;
  let alpha: Tenant;
  const enqueued: { name: string; data: unknown; key: string | undefined }[] = [];
  const queue = {
    send: async (name: string, data: object, options?: { singletonKey?: string }) => {
      enqueued.push({ name, data, key: options?.singletonKey });
      return "job-id";
    },
  };
  const source: WebhookSource = {
    name: "test",
    externalId: (headers, body) => (body as { id?: string }).id ?? headers["x-event-id"] ?? null,
    externalRef: (body) => (body as { property?: string }).property ?? null,
    verify: (headers) => headers["x-webhook-secret"] === "s3cret",
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ nspname: string }>("select nspname from pg_namespace where nspname like 't\\_%' or nspname = 'control'");
    for (const { nspname } of rows) await pool.query(`drop schema "${nspname}" cascade`);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    await pool.query("insert into control.external_ids (provider, external_id, tenant_id) values ('test', 'prop-123', $1)", [alpha.id]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("stores the raw event, resolves the tenant and enqueues one job", async () => {
    const result = await receiveWebhook(pool, queue, source, {
      headers: { "x-webhook-secret": "s3cret", "content-type": "application/json" },
      rawBody: JSON.stringify({ id: "evt-1", property: "prop-123", hello: "world" }),
    });
    expect(result).toEqual({ status: 202, duplicate: false });
    const { rows } = await pool.query<{ source: string; external_id: string; tenant_id: string; status: string; body: { hello: string } }>(
      "select source, external_id, tenant_id, status, body from control.webhook_events",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "test", external_id: "evt-1", tenant_id: alpha.id, status: "received" });
    expect(rows[0]!.body.hello).toBe("world");
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ name: "webhook.process", key: "test:evt-1" });
  });

  it("a replay of the same event id is acknowledged but not stored or enqueued again", async () => {
    const result = await receiveWebhook(pool, queue, source, {
      headers: { "x-webhook-secret": "s3cret" },
      rawBody: JSON.stringify({ id: "evt-1", property: "prop-123", hello: "again" }),
    });
    expect(result).toEqual({ status: 200, duplicate: true });
    const { rows } = await pool.query("select count(*)::int as n from control.webhook_events");
    expect(rows[0]!.n).toBe(1);
    expect(enqueued).toHaveLength(1);
  });

  it("rejects an event that fails verification without storing it", async () => {
    const result = await receiveWebhook(pool, queue, source, { headers: {}, rawBody: JSON.stringify({ id: "evt-2" }) });
    expect(result.status).toBe(401);
    const { rows } = await pool.query("select count(*)::int as n from control.webhook_events");
    expect(rows[0]!.n).toBe(1);
  });

  it("stores an event whose tenant is unknown, marked ignored, and enqueues nothing", async () => {
    const result = await receiveWebhook(pool, queue, source, {
      headers: { "x-webhook-secret": "s3cret" },
      rawBody: JSON.stringify({ id: "evt-3", property: "nobody" }),
    });
    expect(result).toEqual({ status: 202, duplicate: false });
    const { rows } = await pool.query<{ status: string; tenant_id: string | null }>("select status, tenant_id from control.webhook_events where external_id = 'evt-3'");
    expect(rows[0]).toEqual({ status: "ignored", tenant_id: null });
    expect(enqueued).toHaveLength(1);
  });

  it("refuses an event without an external id", async () => {
    const result = await receiveWebhook(pool, queue, source, { headers: { "x-webhook-secret": "s3cret" }, rawBody: "{}" });
    expect(result.status).toBe(400);
  });
});
