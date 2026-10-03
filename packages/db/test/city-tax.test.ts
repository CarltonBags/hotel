import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms, type Room } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom } from "../src/tenant/reservation-changes";
import { checkIn, loadFolios } from "../src/tenant/folios";
import { invoiceDocument, issueInvoice, setInvoiceNumberRange } from "../src/tenant/invoices";
import {
  addCityTaxVersion,
  cityTaxEvidence,
  cityTaxReport,
  createCityTaxRule,
  getCityTaxRule,
  setCityTaxExemption,
  setCityTaxPassOn,
  updateCityTaxRule,
} from "../src/tenant/city-tax";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the City Tax Charge posted per night at check-in from the property's
 * rule (or only recorded when absorbed); exemptions with their evidence; a new
 * rule version recalculating uninvoiced nights; the filing report.
 */
describe("city tax", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let dbl: string;
  let rooms: Room[];
  let plan: RatePlan;
  let guest: string;
  let zero: string;
  let nextRoom = 0;
  const pm = "user_paula";
  const today = todayIn("Europe/Berlin");
  const day = (n: number) => addDays(today, n);
  const s = () => tenant.schemaName;
  const stay = async (nights: number, adults = 2, childAges: number[] = []) => {
    const res = (await createBooking(pool, s(), berlin, pm, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: day(nights), roomTypeId: dbl, ratePlanId: plan.id, adults, childAges, primaryGuestId: guest }] }))
      .reservations[0]!.id;
    await assignRoom(pool, s(), res, pm, rooms[nextRoom++]!.id);
    return res;
  };
  const cityTaxCharges = async (res: string) => (await loadFolios(pool, s(), res)).folios.flatMap((f) => f.charges).filter((c) => c.category === "city_tax" && !c.voidedAt);

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE", addressLine1: "Unter den Linden 1", postalCode: "10117", city: "Berlin", vatId: "DE123456789", taxNumber: "27/123/45678" })).id;
    berlin = (await createProperty(pool, s(), { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, s(), { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 3, maxAdults: 3, bedPlaces: 3, extraBeds: 0 })).id;
    rooms = await createRooms(pool, s(), { propertyId: berlin, roomTypeId: dbl, numbers: Array.from({ length: 20 }, (_, i) => String(101 + i)) });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const id = (c: string) => codes.find((x) => x.code === c)!.id;
    zero = id("ZERO");
    const room = await createService(pool, s(), { propertyId: berlin, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: id("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    plan = await createRatePlan(pool, s(), { propertyId: berlin, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    // 107 gross, 7 % VAT: 100 net per night
    await setRates(pool, s(), berlin, pm, Array.from({ length: 30 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: day(n), price: 107 })));
    guest = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", countryOfResidence: "JP" }, { userId: pm, propertyId: berlin })).id;
    await setInvoiceNumberRange(pool, s(), le, "final", "RE-{YYYY}-{NNNNN}");
    await createCityTaxRule(pool, s(), berlin, { preset: "berlin", taxCodeId: zero }, pm);
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("the Berlin preset posts a City Tax Charge for the first 21 nights of a 25-night stay", async () => {
    const res = await stay(25);
    await checkIn(pool, s(), res, pm);
    const charges = await cityTaxCharges(res);
    expect(charges).toHaveLength(21);
    // 7.5 % of 100 net, for two persons
    expect(charges[0]).toMatchObject({ amount: 7.5, quantity: 2, unitPrice: 3.75, description: "Berlin Übernachtungsteuer" });
  });

  it("charged on top, the City Tax is its own line on the invoice", async () => {
    const res = await stay(1);
    await checkIn(pool, s(), res, pm);
    const folio = (await loadFolios(pool, s(), res)).folios[0]!;
    const inv = await issueInvoice(pool, s(), folio.id, pm);
    const doc = await invoiceDocument(pool, s(), inv.id);
    expect(doc.totals.lines.map((l) => [l.description, l.gross])).toEqual([
      ["Übernachtung", 107],
      ["Berlin Übernachtungsteuer", 7.5],
    ]);
  });

  it("absorbed: no line on the folio or invoice, but the filing report carries the tax", async () => {
    await setCityTaxPassOn(pool, s(), berlin, "absorbed");
    const res = await stay(2);
    await checkIn(pool, s(), res, pm);
    expect(await cityTaxCharges(res)).toEqual([]);
    const report = await cityTaxReport(pool, s(), berlin, { from: today, to: day(1) });
    const row = report.stays.find((r) => r.reservationId === res)!;
    expect(row).toMatchObject({ nights: 2, tax: 15, absorbed: true });
    // switching back applies to later check-ins: the stay in house stays absorbed
    await setCityTaxPassOn(pool, s(), berlin, "on_top");
    expect(await cityTaxCharges(res)).toEqual([]);
    expect((await cityTaxReport(pool, s(), berlin, { from: today, to: day(1) })).stays.find((r) => r.reservationId === res)).toMatchObject({ absorbed: true });
  });

  it("an exemption with document evidence stores the upload and shows its reason on the report", async () => {
    await updateCityTaxRule(pool, s(), berlin, { reasons: [{ reason: "disability", evidence: "document", param: null }] }, pm);
    const res = await stay(1);
    await expect(setCityTaxExemption(pool, s(), res, { person: 1, reason: "disability", note: "" }, pm)).rejects.toThrow(/document/);
    await expect(setCityTaxExemption(pool, s(), res, { person: 1, reason: "student", note: "" }, pm)).rejects.toThrow(/not enabled/);
    const ex = await setCityTaxExemption(pool, s(), res, { person: 1, reason: "disability", note: "GdB 80", document: { name: "ausweis.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4 test") } }, pm);
    expect(Buffer.from((await cityTaxEvidence(pool, s(), ex.id)).bytes).toString()).toBe("%PDF-1.4 test");
    await checkIn(pool, s(), res, pm);
    expect((await cityTaxCharges(res))[0]).toMatchObject({ amount: 3.75, quantity: 1 });
    const report = await cityTaxReport(pool, s(), berlin, { from: today, to: today });
    expect(report.exempt.disability).toBeGreaterThanOrEqual(1);
    expect(report.exemptions.find((e) => e.reservationId === res)).toMatchObject({ reason: "disability", note: "GdB 80", documentName: "ausweis.pdf", nights: 1 });
  });

  it("a new version recalculates uninvoiced nights and lists the changed reservations; invoiced nights stay", async () => {
    const res = await stay(3);
    await checkIn(pool, s(), res, pm);
    const invoiced = await stay(1);
    await checkIn(pool, s(), invoiced, pm);
    await issueInvoice(pool, s(), (await loadFolios(pool, s(), invoiced)).folios[0]!.id, pm);
    const berlinV = (await getCityTaxRule(pool, s(), berlin)).rule!.versions[0]!;
    const change = await addCityTaxVersion(pool, s(), berlin, { ...berlinV, validFrom: today, bookedFrom: null, percent: 10 }, pm);
    expect(change.changed.find((c) => c.reservationId === res)).toMatchObject({ before: 22.5, after: 30 });
    expect(change.changed.some((c) => c.reservationId === invoiced)).toBe(false);
    expect((await cityTaxCharges(res)).map((c) => c.amount)).toEqual([10, 10, 10]);
    expect((await cityTaxCharges(invoiced)).map((c) => c.amount)).toEqual([7.5]);
  });
});
