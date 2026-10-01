import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms, saveAgeBands } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates, setRestrictions } from "../src/tenant/rates";
import { createGuest, mergeGuests } from "../src/tenant/guests";
import { createCompany } from "../src/tenant/companies";
import { createBooking, findReservation, listGuestReservations, quoteStays } from "../src/tenant/reservations";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: availability per room type and quotes per rate plan for a stay;
 * creating a Booking with Reservations that store their nightly prices.
 */
describe("bookings and reservations", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let dbl: string;
  let bar: RatePlan;
  let corp: RatePlan;
  let aiko: string;
  let ben: string;
  let acme: string;
  const fd = "user_frida";
  const stay = { arrival: "2026-12-07", departure: "2026-12-10" };
  const dates = ["2026-12-07", "2026-12-08", "2026-12-09"];

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const s = tenant.schemaName;
    const le = await createLegalEntity(pool, s, { name: "Alpha GmbH", country: "DE" });
    berlin = (await createProperty(pool, s, { name: "Berlin", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, s, { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 4, maxAdults: 3, bedPlaces: 2, extraBeds: 1 })).id;
    await createRooms(pool, s, { propertyId: berlin, roomTypeId: dbl, numbers: ["101", "102"] });
    const bands = await saveAgeBands(pool, s, berlin, [
      { name: "Baby", minAge: 0, maxAge: 2 },
      { name: "Kind", minAge: 3, maxAge: 11 },
      { name: "Jugend", minAge: 12, maxAge: null },
    ]);
    await applyTaxPreset(pool, s, le.id, "DE");
    const food = (await listTaxCodes(pool, s, le.id)).find((c) => c.code === "FOOD")!;
    const brk = await createService(pool, s, { propertyId: berlin, code: "BRK", name: "Frühstück", defaultPrice: 18, taxCodeId: food.id, revenueAccount: "8400", postingRhythm: "per_person_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s, { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s, { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const common = { propertyId: berlin, roomTypeIds: [dbl], paymentPolicyId: pay.id, cancellationPolicyId: cxl.id };
    bar = await createRatePlan(pool, s, {
      ...common,
      code: "BAR",
      name: "Flexible",
      kind: "base",
      supplements: [
        { kind: "single", amount: -20 },
        { kind: "extra_adult", amount: 35 },
        { kind: "child", ageBandId: bands[1]!.id, amount: 15 },
      ],
      includedServices: [{ serviceId: brk.id, componentPrice: 12 }],
    });
    acme = (await createCompany(pool, s, { name: "Acme AG" }, { userId: fd })).id;
    corp = await createRatePlan(pool, s, { ...common, code: "ACME", name: "Acme corporate", kind: "derived", basePlanId: bar.id, derivation: { kind: "percent", value: -15 }, public: false, rateCode: "ACME26", companyId: acme });
    await setRates(pool, s, berlin, fd, dates.map((date) => ({ ratePlanId: bar.id, roomTypeId: dbl, date, price: date === "2026-12-09" ? 150 : 120 })));
    aiko = (await createGuest(pool, s, { firstName: "Aiko", lastName: "Tanaka" }, { userId: fd, propertyId: berlin })).id;
    ben = (await createGuest(pool, s, { firstName: "Ben", lastName: "Weber" }, { userId: fd, propertyId: berlin })).id;
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("quotes availability per room type with the public plans, and hidden plans only for their Rate Code", async () => {
    const q = await quoteStays(pool, tenant.schemaName, berlin, { ...stay, adults: 2, childAges: [] });
    const row = q.roomTypes.find((t) => t.roomTypeId === dbl)!;
    expect(row.available).toBe(2);
    expect(row.plans.map((p) => p.code)).toEqual(["BAR"]);
    expect(row.plans[0]!.quote.total).toBe(390);
    const coded = await quoteStays(pool, tenant.schemaName, berlin, { ...stay, adults: 2, childAges: [], rateCode: "acme26" });
    expect(coded.rateCode).toEqual({ code: "ACME26", companyId: acme, companyName: "Acme AG" });
    expect(coded.roomTypes[0]!.plans.map((p) => p.code)).toEqual(["BAR", "ACME"]);
    expect(coded.roomTypes[0]!.plans[1]!.quote.total).toBe(331.5);
  });

  it("Supplements for 3 adults and one child match the plan", async () => {
    const q = await quoteStays(pool, tenant.schemaName, berlin, { ...stay, adults: 3, childAges: [7] });
    expect(q.roomTypes[0]!.plans[0]!.quote.nights.map((n) => n.total)).toEqual([170, 170, 200]);
  });

  it("a Booking with two Reservations shares Booker and confirmation number; each Reservation has its own guest and stored prices", async () => {
    const booking = await createBooking(pool, tenant.schemaName, berlin, fd, {
      booker: { companyId: acme },
      walkIn: false,
      notes: "Late arrival",
      rateCode: "ACME26",
      reservations: [
        { ...stay, roomTypeId: dbl, ratePlanId: corp.id, adults: 2, childAges: [], primaryGuestId: aiko },
        { ...stay, roomTypeId: dbl, ratePlanId: bar.id, adults: 1, childAges: [], primaryGuestId: ben },
      ],
    });
    expect(booking.confirmationNumber).toMatch(/^\d{6,}$/);
    expect(booking.reservations).toHaveLength(2);
    const [r1, r2] = await Promise.all(booking.reservations.map((r) => findReservation(pool, tenant.schemaName, r.id)));
    expect(r1!.booking).toMatchObject({ confirmationNumber: booking.confirmationNumber, bookerCompanyId: acme, source: "direct", walkIn: false, rateCode: "ACME26", rateCodeCompanyId: acme, rateCodeCompanyName: "Acme AG" });
    expect(r2!.booking.confirmationNumber).toBe(booking.confirmationNumber);
    expect([r1!.primaryGuest.id, r2!.primaryGuest.id]).toEqual([aiko, ben]);
    expect(r1!.status).toBe("confirmed");
    expect(r1!.nights.map((n) => n.total)).toEqual([102, 102, 127.5]);
    expect(r2!.nights.map((n) => n.total)).toEqual([100, 100, 130]); // single occupancy
    expect(r2!.nights[0]!.components).toEqual([
      { kind: "room", serviceId: null, serviceCode: null, persons: null, unitPrice: 88, amount: 88 },
      { kind: "service", serviceId: expect.any(String), serviceCode: "BRK", persons: 1, unitPrice: 12, amount: 12 },
    ]);
  });

  it("a room type with zero availability on any night of the stay cannot be booked", async () => {
    const q = await quoteStays(pool, tenant.schemaName, berlin, { ...stay, adults: 2, childAges: [] });
    expect(q.roomTypes[0]!.available).toBe(0);
    expect(q.roomTypes[0]!.plans[0]!.quote.reasons).toContain("sold_out");
    await expect(
      createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: aiko }, walkIn: false, notes: "", reservations: [{ arrival: "2026-12-09", departure: "2026-12-10", roomTypeId: dbl, ratePlanId: bar.id, adults: 2, childAges: [], primaryGuestId: aiko }] }),
    ).rejects.toThrow(/sold out/i);
    // one free room left on the 10th: two rooms in one booking for that night must fail as a whole
    await setRates(pool, tenant.schemaName, berlin, fd, [{ ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-10", price: 120 }]);
    const one = { arrival: "2026-12-10", departure: "2026-12-11", roomTypeId: dbl, ratePlanId: bar.id, adults: 2, childAges: [], primaryGuestId: aiko };
    await createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: aiko }, walkIn: false, notes: "", reservations: [one] });
    await expect(createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: ben }, walkIn: false, notes: "", reservations: [{ ...one, primaryGuestId: ben }, { ...one, primaryGuestId: ben }] })).rejects.toThrow(/sold out/i);
  });

  it("refuses hidden plans without their Rate Code, Restrictions and occupancy beyond the room type", async () => {
    const base = { arrival: "2026-12-07", departure: "2026-12-08", roomTypeId: dbl, adults: 2, childAges: [] as number[], primaryGuestId: aiko };
    await setRates(pool, tenant.schemaName, berlin, fd, [{ ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-20", price: 120 }]);
    const free = { ...base, arrival: "2026-12-20", departure: "2026-12-21" };
    await expect(createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: aiko }, walkIn: false, notes: "", reservations: [{ ...free, ratePlanId: corp.id }] })).rejects.toThrow(/Rate Code/);
    await expect(createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: aiko }, walkIn: false, notes: "", reservations: [{ ...free, ratePlanId: bar.id, adults: 4 }] })).rejects.toThrow(/adults/i);
    await setRestrictions(pool, tenant.schemaName, berlin, fd, [{ ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-20", patch: { closedToArrival: true } }]);
    await expect(createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: aiko }, walkIn: false, notes: "", reservations: [{ ...free, ratePlanId: bar.id }] })).rejects.toThrow(/closed to arrival/i);
  });

  it("refuses past arrivals, walk-ins on another day, and a price that changed since it was shown", async () => {
    const r = { roomTypeId: dbl, ratePlanId: bar.id, adults: 2, childAges: [] as number[], primaryGuestId: aiko };
    await expect(createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: aiko }, walkIn: false, notes: "", reservations: [{ ...r, arrival: "2020-01-01", departure: "2020-01-02" }] })).rejects.toThrow(/past/);
    await expect(createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: aiko }, walkIn: true, notes: "", reservations: [{ ...r, arrival: "2026-12-20", departure: "2026-12-21" }] })).rejects.toThrow(/walk-in arrives today/);
    await setRates(pool, tenant.schemaName, berlin, fd, [{ ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-22", price: 130 }]);
    await expect(createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: aiko }, walkIn: false, notes: "", reservations: [{ ...r, arrival: "2026-12-22", departure: "2026-12-23", expectedTotal: 120 }] })).rejects.toThrow(/price changed/);
  });

  it("a rate change after booking does not change the stored nightly prices", async () => {
    const [stayRow] = await listGuestReservations(pool, tenant.schemaName, ben);
    await setRates(pool, tenant.schemaName, berlin, fd, dates.map((date) => ({ ratePlanId: bar.id, roomTypeId: dbl, date, price: 999 })));
    const r = await findReservation(pool, tenant.schemaName, stayRow!.reservationId);
    expect(r!.nights.map((n) => n.total)).toEqual([100, 100, 130]);
    expect(r!.total).toBe(330);
  });

  it("stays are listed across properties and move with a guest merge", async () => {
    const stays = await listGuestReservations(pool, tenant.schemaName, aiko);
    expect(stays.length).toBe(2);
    expect(stays[0]).toMatchObject({ propertyName: "Berlin", status: "confirmed", roomTypeCode: "DBL" });
    await mergeGuests(pool, tenant.schemaName, { keepId: ben, mergeId: aiko }, { userId: fd });
    expect((await listGuestReservations(pool, tenant.schemaName, ben)).length).toBe(3);
  });
});
