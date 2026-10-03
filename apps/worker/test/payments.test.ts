import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { mapProviderAccount, migrateControl, provisionTenant, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { FakePaymentProvider } from "@hoteloftware/payments";
import { paymentWebhookSource } from "../src/payments";
import { receiveWebhook } from "../src/webhooks";

/** Seam: payment provider webhooks go through the common intake, verified by the provider and routed by connected account. */
describe("payment provider webhooks", () => {
  let pool: Pool;
  let alpha: Tenant;
  const provider = new FakePaymentProvider();
  const source = paymentWebhookSource(provider);
  const sent: unknown[] = [];
  const queue = { send: async (_name: string, data: object) => (sent.push(data), "job") };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ nspname: string }>("select nspname from pg_namespace where nspname like 't\\_%' or nspname = 'control'");
    for (const { nspname } of rows) await pool.query(`drop schema "${nspname}" cascade`);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    await mapProviderAccount(pool, "fake", "acct_fake_1", alpha.id);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a signed event of a mapped account is stored for its tenant and queued once", async () => {
    const rawBody = JSON.stringify({ id: "evt_1", accountId: "acct_fake_1", type: "intent", objectId: "pi_1" });
    expect(await receiveWebhook(pool, queue, source, { headers: { "x-fake-signature": "fake-signature" }, rawBody })).toEqual({ status: 202, duplicate: false });
    expect(sent).toEqual([expect.objectContaining({ source: "fake", externalId: "evt_1", tenantId: alpha.id })]);
  });

  it("an unsigned event is refused and nothing is stored", async () => {
    const rawBody = JSON.stringify({ id: "evt_2", accountId: "acct_fake_1", type: "intent", objectId: "pi_2" });
    expect((await receiveWebhook(pool, queue, source, { headers: {}, rawBody })).status).toBe(401);
    expect((await pool.query("select 1 from control.webhook_events where external_id = 'evt_2'")).rowCount).toBe(0);
  });
});
