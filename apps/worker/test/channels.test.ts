import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { connectChannels, createLegalEntity, createProperty, createRoomType, createRooms, migrateControl, provisionTenant, setPropertyRoles, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { ChannelError, FakeChannelManager } from "@hoteloftware/channels";
import { pushTenantChannels } from "../src/channels";

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
    await connectChannels(pool, alpha.schemaName, berlin, ch, { email: "pm@alpha.example" }, "u_rev");
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
});
