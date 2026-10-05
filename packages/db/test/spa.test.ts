import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createCompany } from "../src/tenant/companies";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom } from "../src/tenant/reservation-changes";
import { checkIn, loadFolios } from "../src/tenant/folios";
import { createCashRegister, openShift, receiptByToken, setCashDesk } from "../src/tenant/cash";
import { chargeBillToRoom, createOutlet, payOutletBillCash, saveMenuItem } from "../src/tenant/outlets";
import { addSpaHours, appointmentsOfReservation, billAppointment, bookAppointment, cancelAppointment, saveSpaRoom, saveTherapist, saveTreatment, spaDay } from "../src/tenant/spa";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a therapist's slot is never booked twice; a hotel guest's treatment
 * is charged to the room within the limit; a day visitor pays directly with a
 * Receipt; the stay's appointments show on its reservation.
 */
describe("Spa", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let spa = "";
  let massage = "";
  let anna = "";
  let reservation = "";
  const s = () => tenant.schemaName;
  const today = todayIn("Europe/Berlin");
  const pm: { userId: string; actor: Actor; name: string } = { userId: "user_pm", actor: { propertyRoles: [] }, name: "Pia" };
  const sp: { userId: string; actor: Actor; name: string } = { userId: "user_lena", actor: { propertyRoles: [] }, name: "Lena" };
  // tomorrow in Berlin (any offset of the zone keeps these times within the day)
  const day = addDays(today, 1);
  const at = (hhmm: string) => new Date(`${day}T${hhmm}:00+02:00`);

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE123456789", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    pm.actor = { propertyRoles: [{ propertyId, role: "property_manager" }] };
    sp.actor = { propertyRoles: [{ propertyId, role: "spa_staff" }] };
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const code = (c: string) => codes.find((x) => x.code === c)!.id;
    const wellness = await createService(pool, s(), { propertyId, code: "SPA", name: "Wellness", defaultPrice: 0, taxCodeId: code("STD"), revenueAccount: "8500", postingRhythm: "once", bookableOnline: false });
    await setCashDesk(pool, s(), propertyId, { enabled: true, tolerance: 5, paidOutLimit: 100, differenceAccount: "1370" });
    const register = await createCashRegister(pool, s(), propertyId, "Spa till");
    spa = await createOutlet(pool, s(), propertyId, { name: "Spa", kind: "spa", cashRegisterId: register, active: true }, pm);
    const item = await saveMenuItem(pool, s(), spa, { serviceId: wellness.id, name: "Massage 60", category: "Treatments", price: 89, printerId: null, modifiers: [], active: true, sortOrder: 1 }, pm);
    massage = await saveTreatment(pool, s(), spa, { menuItemId: item, minutes: 60, needsRoom: true, active: true }, pm);
    anna = await saveTherapist(pool, s(), spa, { name: "Anna", active: true }, pm);
    await saveSpaRoom(pool, s(), spa, { name: "Raum 1", active: true }, pm);
    await addSpaHours(pool, s(), anna, { startsAt: at("09:00"), endsAt: at("17:00"), released: true }, sp);
    await openShift(pool, s(), { registerId: register, count: {} }, sp);
    // a hotel guest in house, covered by an on-account Company
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: code("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    const rooms = await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101"] });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, pm.userId, [0, 1, 2].map((n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
    const acme = (await createCompany(pool, s(), { name: "Acme AG", onAccount: true }, { userId: pm.userId })).id;
    const g = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka" }, { userId: pm.userId, propertyId })).id;
    reservation = (await createBooking(pool, s(), propertyId, pm.userId, { booker: { companyId: acme }, walkIn: false, notes: "", reservations: [{ arrival: today, departure: addDays(today, 2), roomTypeId: dbl, ratePlanId: plan.id, adults: 1, childAges: [], primaryGuestId: g }] })).reservations[0]!.id;
    await assignRoom(pool, s(), reservation, pm.userId, rooms[0]!.id);
    await checkIn(pool, s(), reservation, pm.userId);
  });
  afterAll(() => pool.end());

  it("a therapist's slot is never booked twice, nor outside the hours", async () => {
    const first = await bookAppointment(pool, s(), spa, { treatmentId: massage, therapistId: anna, startsAt: at("10:00"), reservationId: reservation }, sp);
    await expect(bookAppointment(pool, s(), spa, { treatmentId: massage, therapistId: anna, startsAt: at("10:30"), guestName: "Day visitor" }, sp)).rejects.toThrow(/another appointment/);
    await expect(bookAppointment(pool, s(), spa, { treatmentId: massage, therapistId: anna, startsAt: at("16:30"), guestName: "Day visitor" }, sp)).rejects.toThrow(/does not work/);
    // two at once for the same time: one wins
    const both = await Promise.allSettled([
      bookAppointment(pool, s(), spa, { treatmentId: massage, therapistId: anna, startsAt: at("12:00"), guestName: "A" }, sp),
      bookAppointment(pool, s(), spa, { treatmentId: massage, therapistId: anna, startsAt: at("12:00"), guestName: "B" }, sp),
    ]);
    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const d = await spaDay(pool, s(), spa, day, sp);
    expect(d.appointments.map((a) => [a.startsAt, a.guest])).toEqual([
      [at("10:00").toISOString(), "101 Tanaka"],
      [at("12:00").toISOString(), expect.stringMatching(/^[AB]$/)],
    ]);
    expect(first).toBeTruthy();
  });

  it("a hotel guest's treatment is charged to the room within the limit; it shows on the reservation", async () => {
    const [a] = await appointmentsOfReservation(pool, s(), reservation);
    expect(a).toMatchObject({ treatment: "Massage 60", room: "Raum 1", status: "booked" });
    const bill = await billAppointment(pool, s(), a!.id, sp);
    await chargeBillToRoom(pool, s(), bill, { reservationId: reservation, signature: null }, sp);
    const charges = (await loadFolios(pool, s(), reservation)).folios.flatMap((f) => f.charges).filter((c) => c.origin === "outlet");
    expect(charges.map((c) => [c.amount, c.taxRate, c.detail])).toEqual([[89, 19, [{ description: "Massage 60", quantity: 1, amount: 89 }]]]);
    expect((await appointmentsOfReservation(pool, s(), reservation))[0]).toMatchObject({ status: "done", billId: bill });
  });

  it("a day visitor pays directly with a Receipt; a cancelled appointment frees the slot", async () => {
    const id = await bookAppointment(pool, s(), spa, { treatmentId: massage, therapistId: anna, startsAt: at("14:00"), guestName: "Frau Klein" }, sp);
    const bill = await billAppointment(pool, s(), id, sp);
    const paid = await payOutletBillCash(pool, s(), bill, { customerName: "Frau Klein" }, sp);
    expect((await receiptByToken(pool, s(), paid.receiptToken))).toMatchObject({ amount: 89, guestName: "Frau Klein", outletSale: { outlet: "Spa", lines: [{ description: "Massage 60", amount: 89 }] } });
    const later = await bookAppointment(pool, s(), spa, { treatmentId: massage, therapistId: anna, startsAt: at("15:00"), guestName: "Herr Groß" }, sp);
    await cancelAppointment(pool, s(), later, sp);
    await bookAppointment(pool, s(), spa, { treatmentId: massage, therapistId: anna, startsAt: at("15:00"), guestName: "Frau Hahn" }, sp);
  });
});
