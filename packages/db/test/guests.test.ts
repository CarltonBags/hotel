import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { withTenant } from "../src/tenant/with-tenant";
import { createGuest, findGuest, findGuestDuplicates, guestHistory, listGuestMerges, mergeGuests, searchGuests, updateGuest, type GuestInput } from "../src/tenant/guests";
import { companyHistory, createCompany, findCompany, searchCompanies, updateCompany } from "../src/tenant/companies";
import { createRoomType } from "../src/tenant/rooms";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan } from "../src/tenant/rate-plans";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: tenant-wide Guest profiles with duplicate detection and a merge that
 * moves every record pointing at the merged profile; Companies with billing
 * data, payment terms and default Routing Rules.
 */
describe("guests and companies", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let munich: string;
  const bob = "user_bob";

  const aiko: GuestInput = { firstName: "Aiko", lastName: "Tanaka", dateOfBirth: "1990-04-02", nationality: "JP", countryOfResidence: "DE", postalCode: "10115", email: "Aiko@Example.com", phone: "+49 30 123456", preferences: "Quiet room" };

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = await createLegalEntity(pool, tenant.schemaName, { name: "Alpha GmbH", country: "DE" });
    berlin = (await createProperty(pool, tenant.schemaName, { name: "Berlin", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    munich = (await createProperty(pool, tenant.schemaName, { name: "München", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("creates a guest at one property that is found from another property of the tenant", async () => {
    const g = await createGuest(pool, tenant.schemaName, aiko, { userId: bob, propertyId: berlin });
    expect(g.email).toBe("Aiko@Example.com");
    const found = await searchGuests(pool, tenant.schemaName, "tanaka");
    expect(found.map((x) => x.id)).toEqual([g.id]);
    expect((await searchGuests(pool, tenant.schemaName, "aiko@example")).map((x) => x.id)).toEqual([g.id]);
    expect((await searchGuests(pool, tenant.schemaName, "30123456")).map((x) => x.id)).toEqual([g.id]);
    expect((await searchGuests(pool, tenant.schemaName, "0049 30 123456")).map((x) => x.id)).toEqual([g.id]);
    void munich;
  });

  it("finds possible duplicates on email, phone, and name plus date of birth", async () => {
    const byEmail = await findGuestDuplicates(pool, tenant.schemaName, { firstName: "A", lastName: "T", email: " aiko@example.COM " });
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0]!.reasons).toEqual(["email"]);
    const byPhone = await findGuestDuplicates(pool, tenant.schemaName, { firstName: "X", lastName: "Y", phone: "0049 30 123 456" });
    expect(byPhone[0]!.reasons).toEqual(["phone"]);
    const byName = await findGuestDuplicates(pool, tenant.schemaName, { firstName: "aiko", lastName: "TANAKA", dateOfBirth: "1990-04-02" });
    expect(byName[0]!.reasons).toEqual(["name_and_birth_date"]);
    expect(await findGuestDuplicates(pool, tenant.schemaName, { firstName: "Aiko", lastName: "Tanaka" })).toEqual([]);
  });

  it("refuses marketing consent without its proof", async () => {
    await expect(createGuest(pool, tenant.schemaName, { firstName: "N", lastName: "O", marketingConsent: true }, { userId: bob, propertyId: berlin })).rejects.toThrow(/proof/i);
  });

  it("records changes with old and new value", async () => {
    const [g] = await searchGuests(pool, tenant.schemaName, "tanaka");
    await updateGuest(pool, tenant.schemaName, g!.id, { city: "Berlin", vip: true }, { userId: bob });
    const history = await guestHistory(pool, tenant.schemaName, g!.id);
    expect(history.map((h) => `${h.field}:${h.oldValue ?? ""}>${h.newValue}`).sort()).toEqual(["city:>Berlin", "vip:false>true"]);
  });

  it("merging keeps the most complete data, moves every record of the merged profile and logs the merge", async () => {
    const [keep] = await searchGuests(pool, tenant.schemaName, "tanaka");
    const other = await createGuest(
      pool,
      tenant.schemaName,
      { firstName: "Aiko", lastName: "Tanaka-Sato", email: "aiko.sato@example.com", preferences: "Feather-free pillows", documentType: "passport", documentNumber: "TK1", documentCountry: "JP", documentExpiry: "2031-01-01" },
      { userId: bob, propertyId: munich },
    );
    // stand-in for reservations (ticket 21): any table pointing at guests moves with the merge
    await withTenant(pool, tenant.schemaName, async (tx) => {
      await tx.query("create table test_stays (id serial primary key, guest_id uuid not null references guests(id), property_id uuid not null)");
      await tx.query("insert into test_stays (guest_id, property_id) values ($1, $2), ($3, $4)", [keep!.id, berlin, other.id, munich]);
    });
    const merged = await mergeGuests(pool, tenant.schemaName, { keepId: keep!.id, mergeId: other.id }, { userId: bob });
    expect(merged.lastName).toBe("Tanaka");
    expect(merged.preferences).toBe("Quiet room\nFeather-free pillows");
    expect(merged.documentNumber).toBe("TK1");
    expect(await findGuest(pool, tenant.schemaName, other.id)).toBeNull();
    const stays = await withTenant(pool, tenant.schemaName, async (tx) => (await tx.query<{ guest_id: string }>("select guest_id from test_stays")).rows);
    expect(stays.every((s) => s.guest_id === keep!.id)).toBe(true);
    expect(stays).toHaveLength(2);
    const log = await listGuestMerges(pool, tenant.schemaName, keep!.id);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ keptId: keep!.id, mergedId: other.id, userId: bob, movedRecords: 1 });
    expect(log[0]!.filledFields).toEqual(expect.arrayContaining(["documentNumber"]));
    await expect(mergeGuests(pool, tenant.schemaName, { keepId: keep!.id, mergeId: keep!.id }, { userId: bob })).rejects.toThrow(/itself/);

    // a profile that already absorbed another brings that merge along
    const third = await createGuest(pool, tenant.schemaName, { firstName: "Aiko", lastName: "T." }, { userId: bob, propertyId: munich });
    const fourth = await createGuest(pool, tenant.schemaName, { firstName: "Aiko", lastName: "T" }, { userId: bob, propertyId: munich });
    await mergeGuests(pool, tenant.schemaName, { keepId: third.id, mergeId: fourth.id }, { userId: bob });
    await mergeGuests(pool, tenant.schemaName, { keepId: keep!.id, mergeId: third.id }, { userId: bob });
    expect(await listGuestMerges(pool, tenant.schemaName, keep!.id)).toHaveLength(3);
  });

  it("companies carry billing data, payment terms and default Routing Rules", async () => {
    const c = await createCompany(pool, tenant.schemaName, { name: "Acme AG", vatId: "DE123456789", addressLine1: "Hauptstr. 1", postalCode: "80331", city: "München", country: "DE", billingEmail: "invoices@acme.example", paymentTermsDays: 30, onAccount: true, routing: ["accommodation", "package"] }, { userId: bob });
    expect(c).toMatchObject({ paymentTermsDays: 30, onAccount: true, routing: ["accommodation", "package"] });
    await expect(createCompany(pool, tenant.schemaName, { name: "Bad", routing: ["minibar" as never] }, { userId: bob })).rejects.toThrow(/routing/i);
    await updateCompany(pool, tenant.schemaName, c.id, { paymentTermsDays: 14, routing: ["accommodation"] }, { userId: bob });
    expect(await findCompany(pool, tenant.schemaName, c.id)).toMatchObject({ paymentTermsDays: 14, routing: ["accommodation"] });
    expect((await companyHistory(pool, tenant.schemaName, c.id)).map((h) => `${h.field}:${h.oldValue}>${h.newValue}`).sort()).toEqual(["paymentTermsDays:30>14", "routing:accommodation,package>accommodation"]);
    await expect(updateCompany(pool, tenant.schemaName, "not-a-uuid", { name: "X" }, { userId: bob })).rejects.toThrow(/not found/);
    expect((await searchCompanies(pool, tenant.schemaName, "acme")).map((x) => x.name)).toEqual(["Acme AG"]);
  });

  it("a Rate Code may attach a Company", async () => {
    const [acme] = await searchCompanies(pool, tenant.schemaName, "acme");
    const rt = await createRoomType(pool, tenant.schemaName, { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 });
    const pay = await createPaymentPolicy(pool, tenant.schemaName, { propertyId: berlin, name: "None", kind: "none" });
    const cxl = await createCancellationPolicy(pool, tenant.schemaName, { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const base = { propertyId: berlin, kind: "base" as const, roomTypeIds: [rt.id], paymentPolicyId: pay.id, cancellationPolicyId: cxl.id };
    await expect(createRatePlan(pool, tenant.schemaName, { ...base, code: "X", name: "X", companyId: acme!.id })).rejects.toThrow(/through a Rate Code/);
    const corp = await createRatePlan(pool, tenant.schemaName, { ...base, code: "ACME", name: "Acme corporate", public: false, rateCode: "ACME26", companyId: acme!.id });
    expect(corp).toMatchObject({ rateCode: "ACME26", companyId: acme!.id, companyName: "Acme AG" });
  });
});
