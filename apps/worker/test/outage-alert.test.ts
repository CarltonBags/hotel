import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createLegalEntity, createProperty, migrateControl, provisionTenant, reportIncident, setPropertyRoles, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { alertMajorIncidents } from "../src/outage-alert";

/** Seam: a major incident on our side reaches every customer's Property Managers once, in the app and by queued email. */
describe("outage alerts", () => {
  let pool: Pool;
  let alpha: Tenant;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ nspname: string }>("select nspname from pg_namespace where nspname like 't\\_%' or nspname = 'control'");
    for (const { nspname } of rows) await pool.query(`drop schema "${nspname}" cascade`);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    await provisionTenant(pool, { slug: "platform", name: "Platform" }, tenantMigrations());
    const le = (await createLegalEntity(pool, alpha.schemaName, { name: "Alpha GmbH", country: "DE", addressLine1: "Str. 1", postalCode: "10117", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    const berlin = (await createProperty(pool, alpha.schemaName, { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    await pool.query(`insert into control."user" (id, tenant_id, name, email) values ('u_pm', $1, 'Pia Manager', 'pia@alpha.example'), ('u_fd', $1, 'Fred Desk', 'fred@alpha.example'), ('u_sam', (select id from control.tenants where slug = 'platform'), 'Sam', 'sam@platform.example')`, [alpha.id]);
    await setPropertyRoles(pool, { tenantId: alpha.id, userId: "u_pm", propertyId: berlin, roles: ["property_manager"] });
    await setPropertyRoles(pool, { tenantId: alpha.id, userId: "u_fd", propertyId: berlin, roles: ["front_desk"] });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a major incident alerts the Property Managers once; a minor one nobody", async () => {
    await reportIncident(pool, { title: "Database down", impact: "major", message: "We are on it." }, "u_sam");
    await reportIncident(pool, { title: "Slow pages", impact: "minor", message: "Slower than usual." }, "u_sam");
    const opts = { platformSlug: "platform", statusUrl: "http://localhost/status" };
    expect(await alertMajorIncidents(pool, opts)).toBe(1);
    expect(await alertMajorIncidents(pool, opts)).toBe(0);
    const mails = (await pool.query(`select to_email, subject from ${alpha.schemaName}.mail_outbox`)).rows;
    expect(mails).toEqual([{ to_email: "pia@alpha.example", subject: "Service outage: Database down" }]);
    const notes = (await pool.query("select user_id, title from control.notifications where kind = 'service.outage'")).rows;
    expect(notes).toEqual([{ user_id: "u_pm", title: "Service outage: Database down" }]);
  });
});
