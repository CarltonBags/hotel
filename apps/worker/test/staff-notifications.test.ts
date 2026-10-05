import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createLegalEntity, createProperty, dispatchMessages, listTenantUsers, migrateControl, provisionTenant, setNotificationChannels, setPropertyRoles, type Tenant } from "@hoteloftware/db";
import { controlMigrations, tenantMigrations } from "@hoteloftware/db/migrations";
import { FakeMailProvider, FakeSmsProvider } from "@hoteloftware/messaging";
import { notifyStaff } from "@hoteloftware/events";

/** Seam: a staff Notification reaches the app always, email per user setting, SMS only for urgent kinds and only Property Managers (Tenant Roles count as one). */
describe("staff notifications", () => {
  let pool: Pool;
  let alpha: Tenant;
  let berlin = "";

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    const { rows } = await pool.query<{ nspname: string }>("select nspname from pg_namespace where nspname like 't\\_%' or nspname = 'control'");
    for (const { nspname } of rows) await pool.query(`drop schema "${nspname}" cascade`);
    await migrateControl(pool, controlMigrations());
    alpha = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, alpha.schemaName, { name: "Alpha GmbH", country: "DE", addressLine1: "Str. 1", postalCode: "10117", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    berlin = (await createProperty(pool, alpha.schemaName, { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    await pool.query(`insert into control."user" (id, tenant_id, name, email) values ('u_pm', $1, 'Pia Manager', 'pia@alpha.example'), ('u_fd', $1, 'Fred Desk', 'fred@alpha.example')`, [alpha.id]);
    await setPropertyRoles(pool, { tenantId: alpha.id, userId: "u_pm", propertyId: berlin, roles: ["property_manager"] });
    await setPropertyRoles(pool, { tenantId: alpha.id, userId: "u_fd", propertyId: berlin, roles: ["front_desk"] });
    await setNotificationChannels(pool, "u_pm", { email: false, sms: true, phone: "+49 170 1234567" });
    await setNotificationChannels(pool, "u_fd", { email: true, sms: true, phone: "+491709999999" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("a Night Audit overdue alert reaches the manager's phone, not the desk's", async () => {
    const users = await listTenantUsers(pool, alpha.id);
    await notifyStaff(pool, alpha, users, { kind: "night_audit.overdue", title: "Night Audit overdue · Berlin · 2026-10-04", href: "/night-audit", propertyId: berlin });
    await notifyStaff(pool, alpha, users, { kind: "card_hold.expiring", title: "Card Hold expiring · 100123", propertyId: berlin });
    const mail = new FakeMailProvider();
    const sms = new FakeSmsProvider();
    await dispatchMessages(pool, alpha.schemaName, alpha.id, { mail, sms }, { platformDomain: "mail.test" });
    expect(sms.sent.map((m) => [m.to, m.text])).toEqual([["+491701234567", "Hoteloftware: Night Audit overdue · Berlin · 2026-10-04"]]);
    // email per setting: the desk wants it, the manager does not
    expect(mail.sent.map((m) => [m.to, m.subject])).toEqual([
      ["fred@alpha.example", "Night Audit overdue · Berlin · 2026-10-04"],
      ["fred@alpha.example", "Card Hold expiring · 100123"],
    ]);
    const notes = (await pool.query("select user_id from control.notifications where kind = 'night_audit.overdue' order by user_id")).rows;
    expect(notes).toEqual([{ user_id: "u_fd" }, { user_id: "u_pm" }]);
  });
});
