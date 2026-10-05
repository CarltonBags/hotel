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
import { checkIn } from "../src/tenant/folios";
import { createCashRegister, setCashDesk } from "../src/tenant/cash";
import { createOutlet, saveMenuItem } from "../src/tenant/outlets";
import { addSpaHours, bookAppointment, saveSpaRoom, saveTherapist, saveTreatment, setSpaCancelHours, spaDay } from "../src/tenant/spa";
import { bookPortalAppointment, cancelPortalAppointment, portalSpa } from "../src/tenant/portal-spa";
import { portalKeys } from "../src/tenant/portal";
import { switchModuleOn } from "../src/tenant/modules";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a guest with a Portal Link sees only released slots and cannot book
 * a taken one; the booking is on the spa's book; a cancellation past the
 * spa's deadline is refused with the rule.
 */
describe("Spa self-booking in the Guest Portal", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let spa = "";
  let massage = "";
  let anna = "";
  let reservation = "";
  let key = "";
  let ben = "";
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
    ben = await saveTherapist(pool, s(), spa, { name: "Ben", active: true }, pm);
    // Anna's morning is released to guests, her afternoon and Ben's day are not
    await addSpaHours(pool, s(), anna, { startsAt: at("09:00"), endsAt: at("12:00"), released: true }, sp);
    await addSpaHours(pool, s(), anna, { startsAt: at("13:00"), endsAt: at("17:00"), released: false }, sp);
    await addSpaHours(pool, s(), ben, { startsAt: at("09:00"), endsAt: at("17:00"), released: false }, sp);
    await switchModuleOn(pool, s(), propertyId, "point_of_sale", pm.userId, today);
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
    key = (await portalKeys(pool, s(), reservation))!.reservation;
  });
  afterAll(() => pool.end());

  const times = async () => (await portalSpa(pool, s(), key, day))!.slots.filter((x) => x.treatmentId === massage).map((x) => x.startsAt);

  it("the guest sees only released slots and cannot book a taken one", async () => {
    const view = (await portalSpa(pool, s(), key, day))!;
    expect(view.spas.map((x) => [x.name, x.treatments.map((t) => [t.name, t.minutes, t.price])])).toEqual([["Spa", [["Massage 60", 60, 89]]]]);
    expect(view.days).toContain(day);
    // the departure day is not offered: the room is no longer charged then
    expect(view.days).not.toContain(addDays(today, 2));
    await expect(bookPortalAppointment(pool, s(), key, { outletId: spa, treatmentId: massage, startsAt: new Date(Date.now() - 60_000) })).rejects.toThrow(/passed/);
    expect(await times()).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"].map((h) => at(h).toISOString()));
    // the spa books 09:00 itself; the guest takes 10:30
    await bookAppointment(pool, s(), spa, { treatmentId: massage, therapistId: anna, startsAt: at("09:00"), guestName: "Frau Klein" }, sp);
    await bookPortalAppointment(pool, s(), key, { outletId: spa, treatmentId: massage, startsAt: at("10:30") });
    expect(await times()).toEqual([]);
    await expect(bookPortalAppointment(pool, s(), key, { outletId: spa, treatmentId: massage, startsAt: at("09:00") })).rejects.toThrow(/taken/);
    // Ben works, but not for guests: his hours are not released
    await expect(bookPortalAppointment(pool, s(), key, { outletId: spa, treatmentId: massage, startsAt: at("14:00") })).rejects.toThrow(/taken/);
    const d = await spaDay(pool, s(), spa, day, sp);
    expect(d.appointments.filter((a) => a.bookedVia === "portal").map((a) => [a.startsAt, a.therapistId, a.reservationId])).toEqual([[at("10:30").toISOString(), anna, reservation]]);
    expect((await portalSpa(pool, s(), key, day))!.appointments.map((a) => [a.treatment, a.startsAt, a.status])).toEqual([["Massage 60", at("10:30").toISOString(), "booked"]]);
  });

  it("a cancellation past the spa's deadline is refused with the rule; before it the slot is free again", async () => {
    await setSpaCancelHours(pool, s(), spa, 12, pm);
    const [a] = (await portalSpa(pool, s(), key, day))!.appointments;
    expect(a).toMatchObject({ cancelUntil: new Date(at("10:30").getTime() - 12 * 3_600_000).toISOString() });
    await expect(cancelPortalAppointment(pool, s(), key, a!.id, new Date(at("10:30").getTime() - 11 * 3_600_000))).rejects.toThrow(/12 hours before/);
    await cancelPortalAppointment(pool, s(), key, a!.id, new Date(at("10:30").getTime() - 13 * 3_600_000));
    expect((await portalSpa(pool, s(), key, day))!.appointments).toEqual([]);
    expect(await times()).toEqual(["10:00", "10:30", "11:00"].map((h) => at(h).toISOString()));
    // one treatment at a time for the guest
    await bookPortalAppointment(pool, s(), key, { outletId: spa, treatmentId: massage, startsAt: at("10:00") });
    await expect(bookPortalAppointment(pool, s(), key, { outletId: spa, treatmentId: massage, startsAt: at("10:30") })).rejects.toThrow(/clash/);
  });
});
