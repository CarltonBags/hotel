import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { FakePaymentProvider } from "@hoteloftware/payments";
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
import { checkIn } from "../src/tenant/folios";
import { catchUp, downtimeSet, emergencyReport, logOutage, setDowntimeOptions } from "../src/tenant/downtime";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the Downtime Reports set (lists, Room Rack with vacant rooms,
 * sort); the emergency report's contacts; Catch-up Entry keeping the real
 * time inside a logged outage and the Business Date that was open.
 */
describe("downtime reports and catch-up entry", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let dbl: string;
  let rooms: Room[];
  let plan: RatePlan;
  const provider = new FakePaymentProvider();
  const fd = "user_frida";
  const today = todayIn("Europe/Berlin");
  const s = () => tenant.schemaName;
  const guest = async (lastName: string) => (await createGuest(pool, s(), { firstName: "A", lastName, addressLine1: "Str. 1", postalCode: "10115", city: "Berlin", countryOfResidence: "DE", phone: "+49 30 123456" }, { userId: fd, propertyId: berlin })).id;
  const book = async (lastName: string, arrival: string, nights: number, room?: Room) => {
    const g = await guest(lastName);
    const id = (await createBooking(pool, s(), berlin, fd, { booker: { guestId: g }, walkIn: false, notes: `note ${lastName}`, reservations: [{ arrival, departure: addDays(arrival, nights), roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: g }] })).reservations[0]!.id;
    if (room) await assignRoom(pool, s(), id, fd, room.id);
    return id;
  };

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE", addressLine1: "Unter den Linden 1", postalCode: "10117", city: "Berlin", vatId: "DE123456789", taxNumber: "27/123/45678" })).id;
    berlin = (await createProperty(pool, s(), { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, s(), { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    rooms = await createRooms(pool, s(), { propertyId: berlin, roomTypeId: dbl, numbers: ["101", "102", "201", "202"] });
    await pool.query(`update ${s()}.rooms set floor = case when number like '1%' then '1' else '2' end`);
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const room = await createService(pool, s(), { propertyId: berlin, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    plan = await createRatePlan(pool, s(), { propertyId: berlin, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), berlin, fd, Array.from({ length: 10 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("the set lists arrivals and guests in house; the Room Rack has every room by floor, vacant ones too", async () => {
    const stay = await book("Weber", today, 2, rooms[2]);
    await checkIn(pool, s(), stay, fd);
    await book("Adler", today, 1, rooms[0]);
    await book("Zorn", today, 1);
    await setDowntimeOptions(pool, s(), berlin, { show: { balance: true, notes: true, hkNotes: false }, sort: "name", reminderAt: "06:00", blankForms: 1 });
    const set = await downtimeSet(pool, s(), berlin);
    expect(set.arrivals.map((r) => r.guestLastName)).toEqual(["Adler", "Zorn"]);
    expect(set.arrivals[0]!.notes).toBe("note Adler");
    expect(set.inHouse.map((r) => [r.guestLastName, r.room])).toEqual([["Weber", "201"]]);
    expect(set.roomRack.map((r) => [r.floor, r.room, r.guest?.name ?? null, r.next?.name ?? null])).toEqual([
      ["1", "101", null, "Adler"],
      ["1", "102", null, null],
      ["2", "201", "Weber", null],
      ["2", "202", null, null],
    ]);
    expect(set.options).toMatchObject({ sort: "name", reminderAt: "06:00" });
  });

  it("the emergency report adds how to reach every guest in house", async () => {
    const r = await emergencyReport(pool, s(), berlin);
    expect(r.contacts).toEqual([{ name: "A Weber", room: "201", phone: "+49 30 123456", email: "" }]);
    expect(r.cardHolds).toEqual([]);
  });

  it("a Catch-up Entry keeps the real time, inside a logged outage, in the Business Date that was open", async () => {
    const arrival = await book("Kurz", today, 1, rooms[1]);
    const realAt = new Date(Date.now() - 30 * 60_000);
    // not before the outage is logged
    await expect(catchUp(pool, s(), provider, { kind: "check_in", reservationId: arrival, realAt }, fd)).rejects.toThrow(/Log the outage first/);
    await logOutage(pool, s(), berlin, { startedAt: new Date(Date.now() - 60 * 60_000), endedAt: new Date(Date.now() - 10 * 60_000), cause: "hotel", note: "Line down" }, fd);
    await catchUp(pool, s(), provider, { kind: "check_in", reservationId: arrival, realAt }, fd);
    const [res] = (await pool.query(`select checked_in_at, status from ${s()}.reservations where id = $1`, [arrival])).rows;
    expect(res).toMatchObject({ status: "checked_in" });
    expect(Math.abs(res.checked_in_at.getTime() - realAt.getTime())).toBeLessThan(1000);
    const [change] = (await pool.query(`select real_at, at, to_char(business_date, 'YYYY-MM-DD') as bd from ${s()}.reservation_changes where reservation_id = $1 and action = 'check_in'`, [arrival])).rows;
    expect(Math.abs(change.real_at.getTime() - realAt.getTime())).toBeLessThan(1000);
    expect(change.at.getTime()).toBeGreaterThan(realAt.getTime());
    expect(change.bd).toBe(today);
    // a payment taken during the outage: cash or transfer only
    await expect(catchUp(pool, s(), provider, { kind: "payment", reservationId: arrival, realAt, tender: "card_terminal", amount: 10 }, fd)).rejects.toThrow(/No card was charged offline/);
    await catchUp(pool, s(), provider, { kind: "payment", reservationId: arrival, realAt, tender: "bank_transfer", amount: 10, reference: "paper receipt 17" }, fd);
    const [pay] = (await pool.query(`select real_at, to_char(business_date, 'YYYY-MM-DD') as bd from ${s()}.payments where reservation_id = $1`, [arrival])).rows;
    expect(pay.bd).toBe(today);
    expect(Math.abs(pay.real_at.getTime() - realAt.getTime())).toBeLessThan(1000);
  });

  it("once the Business Date of the real time is closed, the entry is refused", async () => {
    const stay = (await pool.query(`select id from ${s()}.reservations where status = 'checked_in' limit 1`)).rows[0].id;
    // an audit closed after the outage: the day the payment belongs to is fixed
    await pool.query(`insert into ${s()}.night_audits (property_id, business_date, status, started_by, closed_at, closed_by, report) values ($1, $2, 'closed', 'x', now(), 'x', '{}')`, [berlin, addDays(today, -1)]);
    await expect(catchUp(pool, s(), provider, { kind: "payment", reservationId: stay, realAt: new Date(Date.now() - 30 * 60_000), tender: "cash", amount: 5 }, fd)).rejects.toThrow(/closed already/);
  });
});
