import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createLegalEntity, createProperty, createReportSchedule, listReportSchedules, migrateControl, provisionTenant, setPropertyRoles, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { sendScheduledReports } from "../src/reports";

/** Seam: a scheduled weekly report is queued as PDF to its own user, only while that user may see it at the property. */
describe("scheduled reports", () => {
  let pool: Pool;
  let alpha: Tenant;
  let berlin: string;
  let munich: string;
  // Monday 2026-10-05, 07:00 in Berlin
  const monday = new Date("2026-10-05T05:00:00Z");

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ nspname: string }>("select nspname from pg_namespace where nspname like 't\\_%' or nspname = 'control'");
    for (const { nspname } of rows) await pool.query(`drop schema "${nspname}" cascade`);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, alpha.schemaName, { name: "Alpha GmbH", country: "DE", addressLine1: "Str. 1", postalCode: "10117", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    berlin = (await createProperty(pool, alpha.schemaName, { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    munich = (await createProperty(pool, alpha.schemaName, { name: "München", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    await pool.query(`insert into control."user" (id, tenant_id, name, email) values ('u_rev', $1, 'Rita Revenue', 'rita@alpha.example'), ('u_fd', $1, 'Fred Desk', 'fred@alpha.example')`, [alpha.id]);
    await setPropertyRoles(pool, { tenantId: alpha.id, userId: "u_rev", propertyId: berlin, roles: ["revenue"] });
    await setPropertyRoles(pool, { tenantId: alpha.id, userId: "u_fd", propertyId: munich, roles: ["revenue"] });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a weekly report goes as PDF to its user on Monday, once", async () => {
    await createReportSchedule(pool, alpha.schemaName, { userId: "u_rev", kind: "occupancy", propertyIds: [berlin], frequency: "weekly", options: {}, language: "de" });
    expect(await sendScheduledReports(pool, alpha, new Date("2026-10-06T05:00:00Z"))).toBe(0); // Tuesday
    expect(await sendScheduledReports(pool, alpha, monday)).toBe(1);
    expect(await sendScheduledReports(pool, alpha, new Date("2026-10-05T09:00:00Z"))).toBe(0);
    const { rows } = await pool.query("select to_email, subject, attachment_name, attachment_type, substring(attachment from 1 for 5) as head from t_alpha.mail_outbox");
    expect(rows).toEqual([
      { to_email: "rita@alpha.example", subject: "Belegung und Umsatz · 2026-09-28 – 2026-10-04", attachment_name: "occupancy-2026-09-28-2026-10-04.pdf", attachment_type: "application/pdf", head: Buffer.from("%PDF-") },
    ]);
  });

  it("a user without the right at a property in it gets nothing; the schedule stops with the reason", async () => {
    // Fred has Revenue in München only, but scheduled Berlin
    await createReportSchedule(pool, alpha.schemaName, { userId: "u_fd", kind: "occupancy", propertyIds: [berlin], frequency: "daily", options: {}, language: "en" });
    await sendScheduledReports(pool, alpha, new Date("2026-10-07T05:00:00Z"));
    expect((await pool.query("select 1 from t_alpha.mail_outbox where to_user_id = 'u_fd'")).rowCount).toBe(0);
    const [s] = await listReportSchedules(pool, alpha.schemaName, "u_fd");
    expect(s!.stoppedReason).toMatch(/no longer see this report/);
  });
});
