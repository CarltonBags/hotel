import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomFeature, createRoomType, createRooms, updateRoom, type Room } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom, listRoomChoices, moveRoomInHouse, reservationHistory } from "../src/tenant/reservation-changes";
import { RoomNotReady, checkIn } from "../src/tenant/folios";
import { checkOut } from "../src/tenant/invoices";
import { loadCalendar } from "../src/tenant/calendar";
import { closeNightAudit } from "../src/tenant/night-audit";
import { assignHousekeeping, createRoomBlock, endRoomBlock, listRoomStates, setCleanliness } from "../src/tenant/room-state";
import { publishHousekeeping } from "../src/tenant/housekeeping";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: Out of Order takes rooms out of sale and refuses assignment;
 * automatic Dirty (check-out, in-house move, block end, Night Audit); a
 * check-in into a room not ready needs a reason; the room picker puts the
 * guest's preferred rooms first; a Housekeeper sees and sets own rooms only.
 */
describe("room state", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let dbl: string;
  let rooms: Room[];
  let plan: RatePlan;
  let guest: string;
  const pm: Actor = { tenantRole: "owner", propertyRoles: [] };
  const fd = "user_frida";
  const hk = "user_hanna";
  const today = todayIn("Europe/Berlin");
  const day = (n: number) => addDays(today, n);
  const s = () => tenant.schemaName;
  const asPm = { userId: "user_paula", actor: pm };
  let asHk: { userId: string; actor: Actor };
  const room = (n: string) => rooms.find((r) => r.number === n)!;
  const book = async (arrival: string, departure: string, roomNumber?: string) => {
    const res = (await createBooking(pool, s(), berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival, departure, roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: guest }] }))
      .reservations[0]!.id;
    if (roomNumber) await assignRoom(pool, s(), res, fd, room(roomNumber).id);
    return res;
  };
  const cleanliness = async (n: string) => (await pool.query(`select cleanliness from ${s()}.rooms where id = $1`, [room(n).id])).rows[0].cleanliness as string;

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE", addressLine1: "Unter den Linden 1", postalCode: "10117", city: "Berlin", vatId: "DE123456789", taxNumber: "27/123/45678" })).id;
    berlin = (await createProperty(pool, s(), { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    asHk = { userId: hk, actor: { propertyRoles: [{ propertyId: berlin, role: "housekeeper" }] } };
    dbl = (await createRoomType(pool, s(), { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    rooms = await createRooms(pool, s(), { propertyId: berlin, roomTypeId: dbl, numbers: Array.from({ length: 10 }, (_, i) => String(101 + i)) });
    const balcony = await createRoomFeature(pool, s(), { propertyId: berlin, code: "BALC", name: "Balkon" });
    await updateRoom(pool, s(), berlin, room("108").id, { featureIds: [balcony.id] });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const roomService = await createService(pool, s(), { propertyId: berlin, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    plan = await createRatePlan(pool, s(), { propertyId: berlin, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: roomService.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), berlin, fd, Array.from({ length: 10 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: day(n), price: 100 })));
    guest = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", preferences: "Gern ein Zimmer mit Balkon", addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", countryOfResidence: "JP" }, { userId: fd, propertyId: berlin })).id;
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("Out of Order on 2 of 10 rooms lowers availability to 8 for those nights, and refuses assignment into them", async () => {
    const assigned = await book(day(3), day(4), "110");
    const block = await createRoomBlock(pool, s(), { roomId: room("110").id, kind: "out_of_order", from: day(3), to: day(5), reason: "Water damage" }, asPm);
    expect(block.conflicts.map((c) => c.reservationId)).toEqual([assigned]);
    await createRoomBlock(pool, s(), { roomId: room("109").id, kind: "out_of_order", from: day(3), to: day(5), reason: "Painting" }, asPm);
    // Out of Service keeps the room for sale
    await createRoomBlock(pool, s(), { roomId: room("107").id, kind: "out_of_service", from: day(3), to: day(5), reason: "TV broken" }, asPm);
    const cal = await loadCalendar(pool, s(), berlin, day(2), 4);
    const free = cal.roomTypes[0]!.days.map((d) => d.free);
    // the stay assigned to 110 is a conflict to move: one room, counted once
    expect(free).toEqual([10, 8, 8, 10]);
    const other = await book(day(4), day(5));
    await expect(assignRoom(pool, s(), other, fd, room("109").id)).rejects.toThrow(/Out of Order/);
    await expect(createRoomBlock(pool, s(), { roomId: room("109").id, kind: "out_of_service", from: day(4), to: day(6), reason: "x" }, asPm)).rejects.toThrow(/already blocked/);
    await expect(createRoomBlock(pool, s(), { roomId: room("101").id, kind: "out_of_order", from: day(4), to: day(6), reason: "x" }, { userId: fd, actor: { propertyRoles: [{ propertyId: berlin, role: "front_desk" }] } })).rejects.toThrow(/Not allowed/);
    // a block cancelled before it began takes nothing out of sale
    const future = await createRoomBlock(pool, s(), { roomId: room("104").id, kind: "out_of_order", from: day(6), to: day(8), reason: "Paint" }, asPm);
    await endRoomBlock(pool, s(), future.id, asPm);
    const later = await book(day(5), day(7));
    await assignRoom(pool, s(), later, fd, room("104").id);
  });

  it("the room picker puts rooms the guest's preferences match first and shows blocks and the next stay", async () => {
    const res = await book(day(1), day(2));
    await book(day(2), day(3), "102");
    const choices = await listRoomChoices(pool, s(), res);
    expect(choices[0]).toMatchObject({ number: "108", preferred: ["Balkon"], free: true });
    expect(choices.find((c) => c.number === "102")?.nextStay).toMatchObject({ arrival: day(2) });
  });

  it("check-out sets Dirty; a check-in into a room not ready needs a reason, which is logged", async () => {
    const stay = await book(today, day(1), "101");
    await checkIn(pool, s(), stay, fd);
    await checkOut(pool, s(), stay, fd, { override: true });
    expect(await cleanliness("101")).toBe("dirty");
    const next = await book(today, day(1), "101");
    await expect(checkIn(pool, s(), next, fd)).rejects.toBeInstanceOf(RoomNotReady);
    await checkIn(pool, s(), next, fd, { notReadyReason: "Guest waits in the lobby, room being cleaned" });
    const log = (await reservationHistory(pool, s(), next)).find((h) => h.action === "check_in")!;
    expect(log.after).toMatchObject({ roomNotReady: "dirty", reason: "Guest waits in the lobby, room being cleaned" });
  });

  it("a Housekeeper sees and sets only own rooms, and never Inspected", async () => {
    await assignHousekeeping(pool, s(), room("103").id, hk, asPm);
    await assignHousekeeping(pool, s(), room("104").id, hk, asPm);
    // nothing to see before the plan is published
    expect((await listRoomStates(pool, s(), berlin, asHk)).rooms).toEqual([]);
    await publishHousekeeping(pool, s(), berlin, asPm);
    const seen = await listRoomStates(pool, s(), berlin, asHk);
    expect(seen.rooms.map((r) => r.number)).toEqual(["103", "104"]);
    await setCleanliness(pool, s(), room("103").id, "dirty", asHk);
    await setCleanliness(pool, s(), room("103").id, "clean", asHk);
    expect(await cleanliness("103")).toBe("clean");
    await expect(setCleanliness(pool, s(), room("103").id, "inspected", asHk)).rejects.toThrow(/Not allowed/);
    await expect(setCleanliness(pool, s(), room("105").id, "dirty", asHk)).rejects.toThrow(/Not one of your rooms/);
    // Front Desk may inspect
    await setCleanliness(pool, s(), room("103").id, "inspected", { userId: fd, actor: { propertyRoles: [{ propertyId: berlin, role: "front_desk" }] } });
    expect((await listRoomStates(pool, s(), berlin, asPm)).rooms.find((r) => r.number === "103")).toMatchObject({ cleanliness: "inspected", ready: true, task: { assigneeId: hk } });
  });

  it("an in-house move, a block's end and the Night Audit turn rooms Dirty", async () => {
    const stay = await book(today, day(3), "105");
    await checkIn(pool, s(), stay, fd);
    // ending a block in force leaves its room Dirty
    const b = await createRoomBlock(pool, s(), { roomId: room("106").id, kind: "out_of_service", from: today, to: day(2), reason: "Noise" }, asPm);
    await endRoomBlock(pool, s(), b.id, asPm);
    expect(await cleanliness("106")).toBe("dirty");
    // moving from tonight: the room left needs cleaning (a guest who arrived yesterday)
    await pool.query(`update ${s()}.reservations set arrival = arrival - 1 where id = $1`, [stay]);
    await pool.query(`update ${s()}.room_assignments set from_date = from_date - 1 where reservation_id = $1`, [stay]);
    await moveRoomInHouse(pool, s(), stay, fd, room("108").id, today);
    expect(await cleanliness("105")).toBe("dirty");
    await setCleanliness(pool, s(), room("108").id, "inspected", asPm);
    await pool.query(`update ${s()}.properties set night_audit_from = '00:00' where id = $1`, [berlin]);
    // the day's missing arrivals are decided first (none of this test's concern)
    await pool.query(`update ${s()}.reservations set status = 'cancelled' where property_id = $1 and status = 'confirmed' and arrival <= $2`, [berlin, today]);
    await closeNightAudit(pool, s(), berlin, fd, { now: new Date(`${day(1)}T03:00:00Z`) });
    // the room the guest sleeps in tonight is Dirty after the audit
    expect(await cleanliness("108")).toBe("dirty");
  });

  it("a stay assigned into a room put Out of Order cannot check in there", async () => {
    // the Business Date is tomorrow by now (the audit above closed today)
    const stay = await book(day(1), day(2), "107");
    await createRoomBlock(pool, s(), { roomId: room("107").id, kind: "out_of_order", from: day(1), to: day(2), reason: "Leak" }, asPm);
    await expect(checkIn(pool, s(), stay, fd)).rejects.toThrow(/Out of Order/);
  });
});
