import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty, findProperty } from "../src/tenant/properties";
import { createRoomType, createRooms, type Room } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom } from "../src/tenant/reservation-changes";
import { findReservation } from "../src/tenant/reservations";
import { checkIn, loadFolios, postServiceCharge, voidCharge } from "../src/tenant/folios";
import { checkOut } from "../src/tenant/invoices";
import { closeNightAudit, listNightAuditReports, markAuditAlerted, nightAuditReport, nightAuditView, overdueAudits, saveArrivalDecision } from "../src/tenant/night-audit";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the Night Audit of a property's Business Date: missing arrivals
 * decided as No-show or Late Arrival, overdue departures blocking; the close
 * all-or-nothing; catching up missed days in order, one report each; a
 * Charge of a closed day corrected, never voided.
 */
describe("night audit", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let dbl: string;
  let rooms: Room[];
  let plan: RatePlan;
  let guest: string;
  let minibar: string;
  let nextRoom = 0;
  const fd = "user_frida";
  // the property starts three days behind the calendar: the audits catch up
  const d0 = addDays(todayIn("Europe/Berlin"), -3);
  const day = (n: number) => addDays(d0, n);
  const s = () => tenant.schemaName;
  const book = async (arrival: string, departure: string) => {
    const res = (await createBooking(pool, s(), berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival, departure, roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: guest }] }))
      .reservations[0]!.id;
    await assignRoom(pool, s(), res, fd, rooms[nextRoom++]!.id);
    return res;
  };
  const businessDate = async () => (await findProperty(pool, s(), berlin))!.businessDate;
  let inHouse: string;
  let dueOut: string;
  let missing: string;
  let late: string;

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE", addressLine1: "Unter den Linden 1", postalCode: "10117", city: "Berlin", vatId: "DE123456789", taxNumber: "27/123/45678" })).id;
    berlin = (await createProperty(pool, s(), { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    await pool.query(`update ${s()}.properties set business_date = $2 where id = $1`, [berlin, d0]);
    dbl = (await createRoomType(pool, s(), { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    rooms = await createRooms(pool, s(), { propertyId: berlin, roomTypeId: dbl, numbers: Array.from({ length: 10 }, (_, i) => String(101 + i)) });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const id = (c: string) => codes.find((x) => x.code === c)!.id;
    const room = await createService(pool, s(), { propertyId: berlin, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: id("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    minibar = (await createService(pool, s(), { propertyId: berlin, code: "MINI", name: "Minibar", defaultPrice: 9.5, taxCodeId: id("STD"), revenueAccount: "8410", postingRhythm: "once", bookableOnline: false })).id;
    const pay = await createPaymentPolicy(pool, s(), { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    plan = await createRatePlan(pool, s(), { propertyId: berlin, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), berlin, fd, Array.from({ length: 10 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: day(n), price: 100 })));
    guest = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", countryOfResidence: "JP" }, { userId: fd, propertyId: berlin })).id;
    inHouse = await book(d0, day(3));
    await checkIn(pool, s(), inHouse, fd);
    dueOut = await book(d0, day(1));
    await checkIn(pool, s(), dueOut, fd);
    missing = await book(d0, day(2));
    late = await book(day(1), day(3));
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("an overdue audit is alerted once per Business Date", async () => {
    expect((await overdueAudits(pool, s())).map((o) => [o.propertyId, o.businessDate, o.behind])).toEqual([[berlin, d0, 3]]);
    await markAuditAlerted(pool, s(), berlin, d0);
    expect(await overdueAudits(pool, s())).toEqual([]);
  });

  it("shows the day's missing arrivals; the close needs every one decided", async () => {
    const view = await nightAuditView(pool, s(), berlin);
    expect(view.businessDate).toBe(d0);
    expect(view.behind).toBe(3);
    expect(view.missingArrivals.map((a) => [a.reservationId, a.noShowFee])).toEqual([[missing, 100]]);
    expect(view.overdueDepartures).toEqual([]);
    await expect(closeNightAudit(pool, s(), berlin, fd)).rejects.toThrow(/missing arrival/);
  });

  it("the close fails as a whole when a step fails, leaving the date open", async () => {
    await saveArrivalDecision(pool, s(), berlin, missing, { kind: "no_show", fee: "confirm" }, fd);
    await expect(
      closeNightAudit(pool, s(), berlin, fd, {
        inject: (step) => {
          if (step === "advance") throw new Error("injected failure");
        },
      }),
    ).rejects.toThrow(/injected failure/);
    expect(await businessDate()).toBe(d0);
    expect((await findReservation(pool, s(), missing))!.status).toBe("confirmed");
    expect(await listNightAuditReports(pool, s(), berlin)).toEqual([]);
    expect((await loadFolios(pool, s(), missing)).folios.flatMap((f) => f.charges)).toEqual([]);
    // the draft decision survived: the audit resumes where it stopped
    expect((await nightAuditView(pool, s(), berlin)).decisions[missing]).toEqual({ kind: "no_show", fee: "confirm" });
  });

  it("closing marks the No-show with its fee, releases its room and advances the date", async () => {
    await closeNightAudit(pool, s(), berlin, fd);
    expect(await businessDate()).toBe(day(1));
    const ns = (await findReservation(pool, s(), missing))!;
    expect(ns.status).toBe("no_show");
    expect(ns.assignments).toEqual([]);
    const fee = (await loadFolios(pool, s(), missing)).folios.flatMap((f) => f.charges);
    expect(fee.map((c) => [c.origin, c.amount])).toEqual([["fee", 100]]);
  });

  it("an overdue departure blocks the close; a Late Arrival stays Confirmed and is proposed again", async () => {
    const view = await nightAuditView(pool, s(), berlin);
    expect(view.overdueDepartures.map((d) => d.reservationId)).toEqual([dueOut]);
    expect(view.missingArrivals.map((a) => a.reservationId)).toEqual([late]);
    await saveArrivalDecision(pool, s(), berlin, late, { kind: "late_arrival" }, fd);
    await expect(closeNightAudit(pool, s(), berlin, fd)).rejects.toThrow(/departure/);
    await checkOut(pool, s(), dueOut, fd, { override: true });
    await closeNightAudit(pool, s(), berlin, fd);
    const r = (await findReservation(pool, s(), late))!;
    expect(r.status).toBe("confirmed");
    expect(r.lateArrival).toBe(true);
    // the next audit proposes it again
    expect((await nightAuditView(pool, s(), berlin)).missingArrivals.map((a) => a.reservationId)).toEqual([late]);
  });

  it("a Late Arrival checked in later gets every night posted, the missed one included", async () => {
    await checkIn(pool, s(), late, fd);
    const nights = (await loadFolios(pool, s(), late)).folios.flatMap((f) => f.charges).map((c) => c.serviceDate).sort();
    expect(nights).toEqual([day(1), day(2)]);
    expect((await findReservation(pool, s(), late))!.lateArrival).toBe(false);
  });

  it("a Charge of a closed day is corrected by a new entry in the open day, never voided", async () => {
    // the in-house guest's first night (service date d0) belongs to a closed Business Date
    const first = (await loadFolios(pool, s(), inHouse)).folios[0]!.charges.find((c) => c.serviceDate === d0)!;
    await voidCharge(pool, s(), inHouse, first.id, "goodwill", fd);
    const charges = (await loadFolios(pool, s(), inHouse)).folios[0]!.charges;
    expect(charges.find((c) => c.id === first.id)!.voidedAt).toBeNull();
    expect(charges.find((c) => c.origin === "correction")).toMatchObject({ amount: -first.amount, serviceDate: d0, correctsId: first.id });
    // an open day's Charge is voided as before
    await postServiceCharge(pool, s(), inHouse, { serviceId: minibar, quantity: 1 }, fd);
    const mini = (await loadFolios(pool, s(), inHouse)).folios[0]!.charges.find((c) => c.description === "Minibar")!;
    await voidCharge(pool, s(), inHouse, mini.id, "not consumed", fd);
    expect((await loadFolios(pool, s(), inHouse)).folios[0]!.charges.find((c) => c.id === mini.id)!.voidedAt).not.toBeNull();
  });

  it("catching up closes each missed day in order, one report each, with the listed sections", async () => {
    await closeNightAudit(pool, s(), berlin, fd);
    expect(await businessDate()).toBe(todayIn("Europe/Berlin"));
    const reports = await listNightAuditReports(pool, s(), berlin);
    expect(reports.map((r) => r.businessDate)).toEqual([day(2), day(1), d0]);
    const first = await nightAuditReport(pool, s(), reports.at(-1)!.id);
    expect(Object.keys(first.report).sort()).toEqual(
      ["arrivals", "businessDate", "cityTax", "changes", "closedAt", "closedBy", "departures", "expiringHolds", "lateArrivals", "noShows", "occupancy", "openBalances", "payments", "property", "revenue", "warnings"].sort(),
    );
    expect(first.report.noShows.map((n: { reservationId: string }) => n.reservationId)).toEqual([missing]);
    expect(first.report.occupancy).toMatchObject({ rooms: 10, occupied: 2 });
    // a closed Business Date cannot be reopened
    await expect(pool.query(`update ${s()}.night_audits set status = 'draft' where id = $1`, [first.id])).rejects.toThrow(/reopened/);
  });

  it("the Business Date never runs ahead of the calendar", async () => {
    await expect(closeNightAudit(pool, s(), berlin, fd, { now: new Date(`${todayIn("Europe/Berlin")}T10:00:00Z`) })).rejects.toThrow(/opens at/);
  });
});
