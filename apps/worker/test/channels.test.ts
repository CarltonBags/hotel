import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { connectChannels, createLegalEntity, createProperty, createRoomType, createRooms, migrateControl, provisionTenant, setPropertyRoles, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { ChannelError, FakeChannelManager } from "@hoteloftware/channels";
import { channelWebhookSource, pullChannelBookings, pushTenantChannels } from "../src/channels";
import { receiveWebhook } from "../src/webhooks";

/** Seam: a failing push tells Revenue and the Property Manager once per streak, not the desk. */
describe("channel push", () => {
  let pool: Pool;
  let alpha: Tenant;
  const ch = new FakeChannelManager();

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ nspname: string }>("select nspname from pg_namespace where nspname like 't\\_%' or nspname = 'control'");
    for (const { nspname } of rows) await pool.query(`drop schema "${nspname}" cascade`);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, alpha.schemaName, { name: "Alpha GmbH", country: "DE", addressLine1: "Str. 1", postalCode: "10117", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    const berlin = (await createProperty(pool, alpha.schemaName, { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    const dbl = (await createRoomType(pool, alpha.schemaName, { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, alpha.schemaName, { propertyId: berlin, roomTypeId: dbl, numbers: ["101"] });
    await pool.query(`insert into control."user" (id, tenant_id, name, email) values ('u_rev', $1, 'Rita Revenue', 'rita@alpha.example'), ('u_fd', $1, 'Fred Desk', 'fred@alpha.example')`, [alpha.id]);
    await setPropertyRoles(pool, { tenantId: alpha.id, userId: "u_rev", propertyId: berlin, roles: ["revenue"] });
    await setPropertyRoles(pool, { tenantId: alpha.id, userId: "u_fd", propertyId: berlin, roles: ["front_desk"] });
    await connectChannels(pool, alpha.schemaName, { tenantId: alpha.id, propertyId: berlin, email: "pm@alpha.example" }, ch, "u_rev");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("failure is told once to Revenue; the changes go when it works again", async () => {
    ch.failNext = new ChannelError("Channex refused (500)", true);
    expect(await pushTenantChannels(pool, alpha, ch)).toEqual({ sent: 0, failed: 1 });
    ch.failNext = new ChannelError("Channex refused (500)", true);
    await pushTenantChannels(pool, alpha, ch);
    const notes = (await pool.query("select user_id from control.notifications where kind = 'channels.failing'")).rows;
    expect(notes).toEqual([{ user_id: "u_rev" }]);
    expect((await pushTenantChannels(pool, alpha, ch)).sent).toBeGreaterThan(0);
  });

  it("a booking webhook with our secret is taken and finds the tenant; a refused channel booking is told to the desk", async () => {
    const source = channelWebhookSource(ch, "s3cret");
    const sent: object[] = [];
    const queue = { send: async (_n: string, d: object) => (sent.push(d), "job") };
    const ext = [...ch.properties.keys()][0]!;
    const body = JSON.stringify({ event: "booking_new", property_id: ext, payload: { booking_revision_id: "rev-9" } });
    expect((await receiveWebhook(pool, queue, source, { headers: {}, rawBody: body })).status).toBe(401);
    expect((await receiveWebhook(pool, queue, source, { headers: { "x-hoteloftware-secret": "s3cret" }, rawBody: body })).status).toBe(202);
    expect(sent).toEqual([expect.objectContaining({ tenantId: alpha.id, source: ch.name })]);
    ch.revisions.push({
      id: "rev-9", bookingId: "bk-9", propertyId: ext, status: "new", channel: "Booking.com", channelCode: "99", currency: "EUR",
      customer: { firstName: "A", lastName: "B", email: null, phone: null, country: null, language: null, address: null, city: null, postalCode: null },
      rooms: [{ key: "1", roomTypeId: "x", ratePlanId: "not-ours", arrival: "2026-12-01", departure: "2026-12-02", adults: 1, childAges: [], nights: [{ date: "2026-12-01", price: 80 }], guestName: null }],
      notes: "", collect: "property", virtualCard: null, receivedAt: "2026-10-05T10:00:00.000Z",
    });
    expect(await pullChannelBookings(pool, alpha, ch)).toEqual({ applied: 0, problems: 1 });
    expect(ch.acked.has("rev-9")).toBe(true);
    const notes = (await pool.query("select user_id, title from control.notifications where kind = 'channels.booking_problem'")).rows;
    expect(notes).toEqual([{ user_id: "u_fd", title: "Channel booking refused" }]);
  });
});
