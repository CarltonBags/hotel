import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import {
  addSupportStaff,
  endSupportAccess,
  listSupportAccesses,
  reportIncident,
  scheduleMaintenance,
  startSupportAccess,
  statusPage,
  supportSessionFor,
  updateIncident,
} from "../src/control/support";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: support access (always with a reason, logged, listed for the
 * customer's Owner, lasting one session) and the status page (state,
 * incidents, maintenance rules, monthly availability).
 */
describe("support access and status page", () => {
  let pool: Pool;
  let platform: Tenant;
  let hotel: Tenant;
  const sam = "user_sam";
  const bob = "user_bob";

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    platform = await provisionTenant(pool, { slug: "platform", name: "Hoteloftware" }, tenantMigrations());
    hotel = await provisionTenant(pool, { slug: "alpha", name: "Alpha Hotels" }, tenantMigrations());
    await pool.query(`insert into control."user" (id, tenant_id, name, email) values ($1, $2, 'Sam Support', 'sam@hoteloftware.eu'), ($3, $4, 'Bob', 'bob@alpha.example')`, [sam, platform.id, bob, hotel.id]);
    await addSupportStaff(pool, sam, null);
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("support access without a reason is impossible; the Owner sees the entry", async () => {
    await expect(startSupportAccess(pool, { staffUserId: sam, tenantId: hotel.id, reason: "" })).rejects.toThrow(/reason/);
    await expect(startSupportAccess(pool, { staffUserId: sam, tenantId: hotel.id, reason: "help" })).rejects.toThrow(/reason/);
    // the database refuses it too
    await expect(pool.query("insert into control.support_accesses (staff_user_id, tenant_id, reason, token_hash, expires_at) values ($1, $2, ' ', 'x', now())", [sam, hotel.id])).rejects.toThrow(/reason_check/);
    // only support staff
    await expect(startSupportAccess(pool, { staffUserId: bob, tenantId: hotel.id, reason: "Ticket 4711: invoice numbers" })).rejects.toThrow(/support staff/);

    const access = await startSupportAccess(pool, { staffUserId: sam, tenantId: hotel.id, reason: "Ticket 4711: invoice numbers" });
    expect(access.slug).toBe("alpha");
    expect(await supportSessionFor(pool, access.token, hotel.id)).toMatchObject({ staffName: "Sam Support", reason: "Ticket 4711: invoice numbers" });
    // the token opens this tenant only
    expect(await supportSessionFor(pool, access.token, platform.id)).toBeNull();
    const list = await listSupportAccesses(pool, hotel.id);
    expect(list).toEqual([expect.objectContaining({ staffName: "Sam Support", reason: "Ticket 4711: invoice numbers", endedAt: null })]);
    await endSupportAccess(pool, access.accessId);
    expect(await supportSessionFor(pool, access.token, hotel.id)).toBeNull();
    expect((await listSupportAccesses(pool, hotel.id))[0]!.endedAt).not.toBeNull();
  });

  it("the status page reflects an injected incident and the monthly figure", async () => {
    const now = new Date("2026-10-04T12:30:00Z");
    expect((await statusPage(pool, now)).state).toBe("operational");
    const id = await reportIncident(pool, { title: "Payments delayed", impact: "major", message: "Card payments time out", startedAt: new Date("2026-10-04T12:00:00Z") }, sam);
    let page = await statusPage(pool, now);
    expect(page.state).toBe("outage");
    expect(page.open.map((i) => i.title)).toEqual(["Payments delayed"]);
    // 30 minutes down so far this month
    expect(page.availability[0]).toMatchObject({ month: "2026-10", downMinutes: 30 });
    await updateIncident(pool, id, { state: "resolved", message: "Fixed at the provider", at: new Date("2026-10-04T12:20:00Z") }, sam);
    page = await statusPage(pool, now);
    expect(page.state).toBe("operational");
    expect(page.recent[0]!.updates.map((u) => u.state)).toEqual(["resolved", "investigating"]);
    expect(page.availability[0]).toMatchObject({ month: "2026-10", downMinutes: 20 });
    expect(page.availability.map((a) => a.month)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });

  it("planned maintenance is announced 7 days ahead, between 02:00 and 05:00 property time", async () => {
    const now = new Date("2026-10-01T09:00:00Z");
    await expect(scheduleMaintenance(pool, { title: "Database upgrade", description: "", startsAt: new Date("2026-10-05T00:30:00Z"), endsAt: new Date("2026-10-05T01:00:00Z") }, sam, now)).rejects.toThrow(/7 days/);
    await expect(scheduleMaintenance(pool, { title: "Database upgrade", description: "", startsAt: new Date("2026-10-10T05:00:00Z"), endsAt: new Date("2026-10-10T06:00:00Z") }, sam, now)).rejects.toThrow(/02:00 and 05:00/);
    await scheduleMaintenance(pool, { title: "Database upgrade", description: "A few seconds of switch-over", startsAt: new Date("2026-10-10T00:30:00Z"), endsAt: new Date("2026-10-10T01:00:00Z") }, sam, now);
    expect((await statusPage(pool, now)).maintenance.map((m) => m.title)).toEqual(["Database upgrade"]);
  });
});
