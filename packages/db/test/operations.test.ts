import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms, type Room } from "../src/tenant/rooms";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom } from "../src/tenant/reservation-changes";
import { breakfastList, houseList, listArrivals, listDepartures, listInHouse, searchReservations, todaySummary } from "../src/tenant/operations";
import { withTenant } from "../src/tenant/with-tenant";
import { resetTestDatabase, testPool } from "./helpers";

/** Seams: the operational lists of a property for a date, the Today summary, cross-property reservation search. */
describe("operational lists", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let munich: string;
  let rooms: Room[];
  const fd = "user_frida";
  const nights = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const s = tenant.schemaName;
    const le = await createLegalEntity(pool, s, { name: "Alpha GmbH", country: "DE" });
    berlin = (await createProperty(pool, s, { name: "Berlin", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    munich = (await createProperty(pool, s, { name: "München", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    for (const [prop, prefix] of [[berlin, "1"], [munich, "5"]] as const) {
      const t = (await createRoomType(pool, s, { propertyId: prop, code: "DBL", name: "Double", maxOccupancy: 4, maxAdults: 3, bedPlaces: 2, extraBeds: 1 })).id;
      const created = await createRooms(pool, s, { propertyId: prop, roomTypeId: t, numbers: [`${prefix}01`, `${prefix}02`, `${prefix}03`, `${prefix}04`] });
      if (prop === berlin) rooms = created;
      const pay = await createPaymentPolicy(pool, s, { propertyId: prop, name: "Card", kind: "card_guarantee" });
      const cxl = await createCancellationPolicy(pool, s, { propertyId: prop, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
      const ro = await createRatePlan(pool, s, { propertyId: prop, code: "RO", name: "Room only", kind: "base", roomTypeIds: [t], mealPlan: "none", paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
      const bb = await createRatePlan(pool, s, { propertyId: prop, code: "BB", name: "Breakfast", kind: "base", roomTypeIds: [t], mealPlan: "breakfast", paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
      const hb = await createRatePlan(pool, s, { propertyId: prop, code: "HB", name: "Half board", kind: "base", roomTypeIds: [t], mealPlan: "half_board", paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
      await setRates(pool, s, prop, fd, nights("2026-12-01", 20).flatMap((date) => [ro, bb, hb].map((p) => ({ ratePlanId: p.id, roomTypeId: t, date, price: 100 }))));
      ids[`${prop}:type`] = t;
      ids[`${prop}:RO`] = ro.id;
      ids[`${prop}:BB`] = bb.id;
      ids[`${prop}:HB`] = hb.id;
    }
    const guest = async (first: string, last: string) => (await createGuest(pool, s, { firstName: first, lastName: last }, { userId: fd, propertyId: berlin })).id;
    const book = async (prop: string, last: string, plan: "RO" | "BB" | "HB", arrival: string, departure: string, adults: number, childAges: number[] = []) => {
      const g = await guest("X", last);
      const b = await createBooking(pool, s, prop, fd, { booker: { guestId: g }, walkIn: false, notes: "", reservations: [{ arrival, departure, roomTypeId: ids[`${prop}:type`]!, ratePlanId: ids[`${prop}:${plan}`]!, adults, childAges, primaryGuestId: g }] });
      return b.reservations[0]!.id;
    };
    // Berlin, business date 2026-12-10
    ids.arriving = await book(berlin, "Arriving", "BB", "2026-12-10", "2026-12-12", 2, [7]);
    ids.staying = await book(berlin, "Staying", "HB", "2026-12-08", "2026-12-12", 2);
    ids.leaving = await book(berlin, "Leaving", "BB", "2026-12-07", "2026-12-10", 1);
    ids.roomOnly = await book(berlin, "Roomonly", "RO", "2026-12-09", "2026-12-11", 2);
    ids.munich = await book(munich, "Faraway", "BB", "2026-12-10", "2026-12-11", 1);
    await assignRoom(pool, s, ids.staying!, fd, rooms[1]!.id);
    await assignRoom(pool, s, ids.arriving!, fd, rooms[0]!.id);
    // check-in arrives with ticket 26; the lists only read the status
    await withTenant(pool, s, (tx) => tx.query("update reservations set status = 'checked_in' where id = any($1::uuid[])", [[ids.staying, ids.leaving, ids.roomOnly]]));
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("lists arrivals, departures and in-house guests of a date with room, persons and plan", async () => {
    const arrivals = await listArrivals(pool, tenant.schemaName, berlin, "2026-12-10");
    expect(arrivals.map((r) => r.guestLastName)).toEqual(["Arriving"]);
    expect(arrivals[0]).toMatchObject({ room: "101", adults: 2, children: 1, nights: 2, mealPlan: "breakfast", status: "confirmed" });
    expect((await listDepartures(pool, tenant.schemaName, berlin, "2026-12-10")).map((r) => r.guestLastName)).toEqual(["Leaving"]);
    expect((await listInHouse(pool, tenant.schemaName, berlin, "2026-12-10")).map((r) => r.guestLastName).sort()).toEqual(["Leaving", "Roomonly", "Staying"]);
  });

  it("the house list shows who sleeps in the house tonight, by room", async () => {
    const house = await houseList(pool, tenant.schemaName, berlin, "2026-12-10");
    expect(house.map((r) => `${r.room ?? "-"} ${r.guestLastName}`)).toEqual(["101 Arriving", "102 Staying", "- Roomonly"]);
  });

  it("the breakfast list counts persons per Meal Plan for the morning of the date", async () => {
    const list = await breakfastList(pool, tenant.schemaName, berlin, "2026-12-10", "2026-12-10");
    // guests who slept the night before: Staying (HB, 2), Leaving (BB, 1), Roomonly (none, 2)
    expect(list.counts).toEqual({ none: { adults: 2, children: 0 }, breakfast: { adults: 1, children: 0 }, half_board: { adults: 2, children: 0 }, full_board: { adults: 0, children: 0 } });
    expect(list.rows.map((r) => r.guestLastName).sort()).toEqual(["Leaving", "Staying"]);
    // a morning ahead is a forecast: Arriving (confirmed, breakfast, 2 + 1 child) counts for the 11th
    const ahead = await breakfastList(pool, tenant.schemaName, berlin, "2026-12-11", "2026-12-10");
    expect(ahead.counts.breakfast).toEqual({ adults: 2, children: 1 });
    // today, a stay still Confirmed from last night (not arrived) is not counted
    const todayList = await breakfastList(pool, tenant.schemaName, berlin, "2026-12-11", "2026-12-11");
    expect(todayList.counts.breakfast).toEqual({ adults: 0, children: 0 });
  });

  it("summarises Today with Occupancy", async () => {
    const t = await todaySummary(pool, tenant.schemaName, berlin, "2026-12-10");
    expect(t).toMatchObject({ arrivals: 1, departures: 1, inHouse: 3, staying: 3, rooms: 4, occupancy: 75 });
  });

  it("finds reservations by confirmation number or guest name across the given properties only", async () => {
    const all = await searchReservations(pool, tenant.schemaName, "faraway", [berlin, munich]);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ propertyId: munich, propertyName: "München", guestLastName: "Faraway" });
    expect(await searchReservations(pool, tenant.schemaName, "faraway", [berlin])).toEqual([]);
    const byNumber = await searchReservations(pool, tenant.schemaName, all[0]!.confirmationNumber, [berlin, munich]);
    expect(byNumber.map((r) => r.id)).toEqual([ids.munich]);
  });
  it("a guest who has checked in leaves the arrivals list and Today's arrivals", async () => {
    const s = tenant.schemaName;
    const g = (await createGuest(pool, s, { firstName: "X", lastName: "Arrived" }, { userId: fd, propertyId: berlin })).id;
    const b = await createBooking(pool, s, berlin, fd, { booker: { guestId: g }, walkIn: false, notes: "", reservations: [{ arrival: "2026-12-10", departure: "2026-12-11", roomTypeId: ids[`${berlin}:type`]!, ratePlanId: ids[`${berlin}:RO`]!, adults: 1, childAges: [], primaryGuestId: g }] });
    await withTenant(pool, s, (tx) => tx.query("update reservations set status = 'checked_in' where id = $1", [b.reservations[0]!.id]));
    expect((await listArrivals(pool, s, berlin, "2026-12-10")).map((r) => r.guestLastName)).toEqual(["Arriving"]);
    expect((await todaySummary(pool, s, berlin, "2026-12-10")).arrivals).toBe(1);
  });
});
