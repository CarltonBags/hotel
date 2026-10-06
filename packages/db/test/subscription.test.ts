import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms } from "../src/tenant/rooms";
import { propertyModules, switchModuleOff, switchModuleOn, setModuleStep } from "../src/tenant/modules";
import { issueSubscriptionInvoices, listSubscriptionInvoices, recordUsage, setDirectDebit, setPrice, setYearly, subscriptionInvoiceFile } from "../src/control/subscription";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: Modules switched on and off per property (readable after the month's
 * end, checklist on); the monthly invoice per Legal Entity of a two-property
 * tenant: rooms on the 1st, Modules billed, usage at cost plus handling.
 */
describe("Modules and subscription billing", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let zurich: string;
  const owner = "user_owner";
  const s = () => tenant.schemaName;

  beforeAll(async () => {
    pool = testPool(6);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE", addressLine1: "Unter den Linden 1", postalCode: "10117", city: "Berlin", vatId: "DE123456789", taxNumber: "27/123/45678" })).id;
    berlin = (await createProperty(pool, s(), { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    zurich = (await createProperty(pool, s(), { name: "Potsdam", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    for (const [p, n] of [[berlin, 22], [zurich, 40]] as const) {
      const t = (await createRoomType(pool, s(), { propertyId: p, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
      await createRooms(pool, s(), { propertyId: p, roomTypeId: t, numbers: Array.from({ length: n }, (_, i) => String(100 + i)) });
    }
    await pool.query("insert into control.platform_seller (name, address_line1, postal_code, city, country, vat_id, iban, email, phone) values ('Hoteloftware GmbH', 'Torstraße 1', '10119', 'Berlin', 'DE', 'DE999999999', 'DE89370400440532013000', 'billing@hoteloftware.example', '+49 30 1234567')");
    for (const [key, unit, amount] of [["base_room", "room", 4], ["module:channel", "room", 1.5], ["module:guest_portal", "room", 1], ["module:point_of_sale", "property", 49], ["module:groups", "property", 19], ["module:whatsapp", "property", 29], ["usage_handling", "percent", 10], ["yearly_discount", "percent", 10], ["vat", "percent", 19]] as const) {
      await setPrice(pool, { key, unit, amount, validFrom: "2026-01-01" }, "user_sam", "2026-01-01");
    }
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("switching the point of sale on starts its checklist; off, it runs to the month's end and stays readable", async () => {
    await switchModuleOn(pool, s(), berlin, "point_of_sale", owner, "2026-10-05");
    let pos = (await propertyModules(pool, s(), berlin, "2026-10-05")).find((m) => m.module === "point_of_sale")!;
    expect(pos).toMatchObject({ state: "on", onSince: "2026-10-05" });
    expect(pos.checklist.map((c) => c.step)).toEqual(["outlet", "cash_register", "printer", "menu"]);
    await setModuleStep(pool, s(), berlin, "point_of_sale", "outlet", true);
    await switchModuleOff(pool, s(), berlin, "point_of_sale", owner, "2026-11-10");
    pos = (await propertyModules(pool, s(), berlin, "2026-11-20")).find((m) => m.module === "point_of_sale")!;
    expect(pos).toMatchObject({ state: "ending", offAt: "2026-11-30" });
    expect(pos.checklist[0]).toEqual({ step: "outlet", done: true });
    expect((await propertyModules(pool, s(), berlin, "2026-12-01")).find((m) => m.module === "point_of_sale")!.state).toBe("readable");
  });

  it("the monthly invoice of a two-property tenant lists rooms, Modules and usage", async () => {
    await switchModuleOn(pool, s(), zurich, "channel", owner, "2026-10-20");
    await setDirectDebit(pool, tenant.id, { accountHolder: "Alpha GmbH", mandateReference: "HS-MANDATE-1", last4: "3000" }, owner);
    await recordUsage(pool, tenant.id, "SMS", 120, 9, new Date("2026-10-15T10:00:00Z"));
    await recordUsage(pool, tenant.id, "SMS", 5, 1, new Date("2026-11-02T10:00:00Z"));
    const issued = await issueSubscriptionInvoices(pool, tenant, "2026-11-01");
    expect(issued).toEqual(["HS-2026-00001"]);
    // once per month
    expect(await issueSubscriptionInvoices(pool, tenant, "2026-11-01")).toEqual([]);
    const doc = (await pool.query("select document from control.subscription_invoices where number = 'HS-2026-00001'")).rows[0].document;
    expect(doc.totals.lines.map((l: { description: string; quantity: number; net: number }) => [l.description.split(" · ")[0], l.quantity, l.net])).toEqual([
      ["Berlin: rooms on 2026-11-01", 22, 88],
      ["Berlin: Point of sale with spa", 1, 49],
      ["Potsdam: rooms on 2026-11-01", 40, 160],
      ["Potsdam: Channel connection", 40, 60],
      ["SMS × 120", 1, 9.9],
    ]);
    expect(doc.totals).toMatchObject({ net: 366.9, vat: 69.71, gross: 436.61 });
    expect(doc.notes[0]).toMatch(/SEPA direct debit, mandate HS-MANDATE-1/);
    const [row] = await listSubscriptionInvoices(pool, tenant.id);
    expect(row).toMatchObject({ number: "HS-2026-00001", month: "2026-11", gross: 436.61 });
    expect(String(await subscriptionInvoiceFile(pool, tenant.id, row!.id, "xml"))).toContain("HS-2026-00001");
    expect((await subscriptionInvoiceFile(pool, tenant.id, row!.id, "pdf") as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("prices: unit by kind, an amount, from today on", async () => {
    await expect(setPrice(pool, { key: "vat", unit: "room", amount: 19, validFrom: "2027-01-01" }, "user_sam", "2026-10-05")).rejects.toThrow(/priced percent/);
    await expect(setPrice(pool, { key: "base_room", unit: "room", amount: Number.NaN, validFrom: "2027-01-01" }, "user_sam", "2026-10-05")).rejects.toThrow(/amount/);
    await expect(setPrice(pool, { key: "base_room", unit: "room", amount: 5, validFrom: "2026-09-01" }, "user_sam", "2026-10-05")).rejects.toThrow(/today or later/);
  });

  it("account details: a mandate and the last digits only; yearly prepayment runs a whole year", async () => {
    await expect(setDirectDebit(pool, tenant.id, { accountHolder: "Alpha GmbH", mandateReference: "M1", last4: "DE89 3704" }, owner)).rejects.toThrow(/Last four/);
    await setYearly(pool, tenant.id, true, "2026-11-15", owner);
    expect((await pool.query("select to_char(yearly_from, 'YYYY-MM-DD') as f from control.subscriptions where tenant_id = $1", [tenant.id])).rows[0].f).toBe("2026-12-01");
    await expect(setYearly(pool, tenant.id, false, "2027-03-10", owner)).rejects.toThrow(/runs to its end/);
    await setYearly(pool, tenant.id, false, "2027-11-10", owner);
  });
});
