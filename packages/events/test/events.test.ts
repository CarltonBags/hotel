import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, Pool } from "pg";
import { migrateControl, provisionTenant, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { EVENTS_CHANNEL, isDataChange, notificationsAfter, publishDataChange, publishNotification, signEventsToken, verifyEventsToken } from "../src/index";

/**
 * Seams: the signed token a browser presents to the SSE endpoint, and the
 * notification publish/replay pair the endpoint is built on.
 */
describe("events tokens", () => {
  const secret = "test-secret-with-at-least-32-characters";

  it("round-trips tenant and user and expires", () => {
    const token = signEventsToken({ tenantId: "t1", userId: "u1" }, secret, 60);
    expect(verifyEventsToken(token, secret)).toMatchObject({ tenantId: "t1", userId: "u1" });
    expect(verifyEventsToken(token, secret)!.exp).toBeGreaterThan(Date.now() / 1000);
    const expired = signEventsToken({ tenantId: "t1", userId: "u1" }, secret, -1);
    expect(verifyEventsToken(expired, secret)).toBeNull();
  });

  it("rejects a tampered or foreign token", () => {
    const token = signEventsToken({ tenantId: "t1", userId: "u1" }, secret, 60);
    const [payload, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ p: "events", tenantId: "t2", userId: "u1", exp: Date.now() / 1000 + 60 })).toString("base64url")}.${sig}`;
    expect(verifyEventsToken(forged, secret)).toBeNull();
    expect(verifyEventsToken(`${payload}.${sig}`, "another-secret-also-32-characters-long")).toBeNull();
    expect(verifyEventsToken("garbage", secret)).toBeNull();
  });
});

describe("notifications", () => {
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
    await pool.query(`insert into control."user" (id, tenant_id, name, email) values ('u1', $1, 'Bob', 'bob@example.com'), ('u2', $1, 'Eve', 'eve@example.com'), ('u3', $2, 'Carol', 'carol@example.com')`, [alpha.id, beta.id]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("publishing stores the row and notifies listeners on the events channel", async () => {
    const listener = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await listener.connect();
    await listener.query(`listen ${EVENTS_CHANNEL}`);
    const received = new Promise<string>((resolve) => listener.on("notification", (n) => resolve(n.payload ?? "")));

    const id = await publishNotification(pool, { tenantId: alpha.id, userId: "u1", kind: "test", title: "Hello Bob", body: "first" });
    const payload = JSON.parse(await received) as { tenantId: string; userId: string | null; id: number };
    expect(payload).toEqual({ tenantId: alpha.id, userId: "u1", id });
    await listener.end();
  });

  it("replays notifications after a cursor for the user and tenant only", async () => {
    const first = await publishNotification(pool, { tenantId: alpha.id, userId: "u1", kind: "test", title: "A" });
    await publishNotification(pool, { tenantId: alpha.id, userId: "u2", kind: "test", title: "for Eve" });
    await publishNotification(pool, { tenantId: beta.id, userId: null, kind: "test", title: "for all of Beta" });
    const forAll = await publishNotification(pool, { tenantId: alpha.id, userId: null, kind: "test", title: "for all of Alpha" });
    const mine = await publishNotification(pool, { tenantId: alpha.id, userId: "u1", kind: "test", title: "B" });

    const rows = await notificationsAfter(pool, { tenantId: alpha.id, userId: "u1", afterId: first });
    expect(rows.map((r) => [r.id, r.title])).toEqual([
      [forAll, "for all of Alpha"],
      [mine, "B"],
    ]);
    expect(await notificationsAfter(pool, { tenantId: beta.id, userId: "u3", afterId: 0 })).toHaveLength(1);
  });

  it("a data change reaches every user of the tenant, names only kind and property, and is no toast", async () => {
    const before = await publishNotification(pool, { tenantId: alpha.id, userId: "u1", kind: "test", title: "cursor" });
    const id = await publishDataChange(pool, { tenantId: alpha.id, kind: "reservations", propertyId: "11111111-1111-4111-8111-111111111111" });
    const [row] = await notificationsAfter(pool, { tenantId: alpha.id, userId: "u2", afterId: before });
    expect(row).toMatchObject({ id, userId: null, kind: "data.reservations", title: "", body: "11111111-1111-4111-8111-111111111111" });
    expect(isDataChange(row!.kind)).toBe(true);
    expect(isDataChange("test")).toBe(false);
  });
});
