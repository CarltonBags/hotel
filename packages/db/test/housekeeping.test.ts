import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms, createSection, updateRoom, type Room } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom } from "../src/tenant/reservation-changes";
import { checkIn } from "../src/tenant/folios";
import { checkOut } from "../src/tenant/invoices";
import { listRoomStates } from "../src/tenant/room-state";
import {
  TaskStarted,
  failInspection,
  generateHousekeepingTasks,
  housekeepingBoard,
  moveHousekeepingTask,
  proposeHousekeeping,
  publishHousekeeping,
  setHousekeepingRules,
  setRoomTypeHousekeeping,
  setWaitingForRoom,
  workHousekeepingTask,
} from "../src/tenant/housekeeping";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the day's tasks by the rhythms and the stays; Publish makes them
 * the housekeepers' and later moves are marked Changed; minutes against the
 * shift; a failed inspection returns the room to the housekeeper.
 */
describe("housekeeping tasks", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let dbl: string;
  let rooms: Room[];
  let plan: RatePlan;
  let guest: string;
  const fd = "user_frida";
  const anna = "user_anna";
  const bea = "user_bea";
  const sup: Actor = { tenantRole: "owner", propertyRoles: [] };
  const asSup = { userId: "user_sara", actor: sup };
  let asAnna: { userId: string; actor: Actor };
  // the property is three days behind, so stays already in house can be set up
  const today = todayIn("Europe/Berlin");
  const d0 = addDays(today, -3);
  const day = (n: number) => addDays(d0, n);
  const s = () => tenant.schemaName;
  const room = (n: string) => rooms.find((r) => r.number === n)!;
  const book = async (arrival: string, departure: string, roomNumber: string) => {
    const res = (await createBooking(pool, s(), berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival, departure, roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: guest }] }))
      .reservations[0]!.id;
    await assignRoom(pool, s(), res, fd, room(roomNumber).id);
    return res;
  };
  const setBusinessDate = (d: string) => pool.query(`update ${s()}.properties set business_date = $2 where id = $1`, [berlin, d]);
  const board = () => housekeepingBoard(pool, s(), berlin, [anna, bea], asSup);
  const tasks = async () => (await board()).tasks.map((t) => `${t.roomNumber}:${t.kind}`).sort();

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE", addressLine1: "Unter den Linden 1", postalCode: "10117", city: "Berlin", vatId: "DE123456789", taxNumber: "27/123/45678" })).id;
    berlin = (await createProperty(pool, s(), { name: "Berlin", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    asAnna = { userId: anna, actor: { propertyRoles: [{ propertyId: berlin, role: "housekeeper" }] } };
    await setBusinessDate(d0);
    dbl = (await createRoomType(pool, s(), { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    rooms = await createRooms(pool, s(), { propertyId: berlin, roomTypeId: dbl, numbers: ["101", "102", "103", "201", "202", "203"] });
    const first = await createSection(pool, s(), { propertyId: berlin, name: "1st floor" });
    const second = await createSection(pool, s(), { propertyId: berlin, name: "2nd floor" });
    for (const r of rooms) await updateRoom(pool, s(), berlin, r.id, { sectionId: r.number.startsWith("1") ? first.id : second.id });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const svc = await createService(pool, s(), { propertyId: berlin, code: "ROOM", name: "Übernachtung", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    plan = await createRatePlan(pool, s(), { propertyId: berlin, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: svc.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), berlin, fd, Array.from({ length: 10 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: day(n), price: 100 })));
    guest = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", countryOfResidence: "JP" }, { userId: fd, propertyId: berlin })).id;
    await setHousekeepingRules(pool, s(), berlin, { stayover: "daily", linenEvery: 3, shiftMinutes: 120 }, asSup);
    await setRoomTypeHousekeeping(pool, s(), dbl, { stayover: null, linenEvery: null, minutes: { departure: 40, stayover: 25, arrival: 10, linen: 15 } }, asSup);
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("the tasks of a demo day match the rhythm rules and the arrivals", async () => {
    // in house since d0: 101 leaves on d3, 102 stays on (third night on d3: stayover and linen)
    const leaving = await book(d0, day(3), "101");
    const staying = await book(d0, day(6), "102");
    await checkIn(pool, s(), leaving, fd);
    await checkIn(pool, s(), staying, fd);
    // arrives on d3 in 201
    await book(day(3), day(5), "201");
    await setBusinessDate(day(3));
    await generateHousekeepingTasks(pool, s(), berlin, asSup);
    expect(await tasks()).toEqual(["101:departure", "102:linen", "102:stayover", "201:arrival"]);
    expect((await board()).tasks.find((t) => t.kind === "departure")?.minutes).toBe(40);
  });

  it("minutes per person sum against the shift; the proposal balances by Section", async () => {
    await proposeHousekeeping(pool, s(), berlin, [anna, bea], asSup);
    const b = await board();
    const per = Object.fromEntries(b.workload.map((w) => [w.assigneeId, [w.minutes, w.left]]));
    // 90 minutes in all; a room's tasks stay with one housekeeper; each total is set against the 120-minute shift
    expect(Object.values(per).reduce((sum, [m]) => sum + m!, 0)).toBe(90);
    const of102 = b.tasks.filter((t) => t.roomNumber === "102").map((t) => t.assigneeId);
    expect(new Set(of102).size).toBe(1);
    for (const [id, [m, left]] of Object.entries(per)) if (id) expect(m! + left!).toBe(120);
    expect(b.tasks.every((t) => t.assigneeId)).toBe(true);
  });

  it("Publish makes the plan visible to the housekeepers; changes after Publish are marked Changed", async () => {
    // the 1st floor goes to Anna, the 2nd to Bea, for this test
    for (const t of (await board()).tasks) await moveHousekeepingTask(pool, s(), t.id, t.roomNumber.startsWith("1") ? anna : bea, asSup);
    expect((await listRoomStates(pool, s(), berlin, asAnna)).rooms).toEqual([]);
    await publishHousekeeping(pool, s(), berlin, asSup);
    expect((await listRoomStates(pool, s(), berlin, asAnna)).rooms.map((r) => r.number)).toEqual(["101", "102"]);
    expect((await board()).tasks.every((t) => !t.changed)).toBe(true);
    const arrival = (await board()).tasks.find((t) => t.kind === "arrival")!;
    await moveHousekeepingTask(pool, s(), arrival.id, anna, asSup);
    expect((await board()).tasks.find((t) => t.id === arrival.id)).toMatchObject({ assigneeId: anna, changed: true });
    await moveHousekeepingTask(pool, s(), arrival.id, bea, asSup);
    // a started task moves only with confirmation
    const departure = (await board()).tasks.find((t) => t.kind === "departure")!;
    await workHousekeepingTask(pool, s(), departure.id, "start", asAnna);
    await expect(moveHousekeepingTask(pool, s(), departure.id, bea, asSup)).rejects.toBeInstanceOf(TaskStarted);
    await moveHousekeepingTask(pool, s(), departure.id, bea, asSup, { confirm: true });
    await moveHousekeepingTask(pool, s(), departure.id, anna, asSup, { confirm: true });
  });

  it("an inspection failure returns the room to the housekeeper's list", async () => {
    // the guest of 101 leaves: the room is Dirty, then cleaned by Anna
    const leaving = (await pool.query(`select r.id from ${s()}.reservations r join ${s()}.room_assignments a on a.reservation_id = r.id where a.room_id = $1 and r.status = 'checked_in'`, [room("101").id])).rows[0].id;
    await checkOut(pool, s(), leaving, fd, { override: true });
    const departure = (await board()).tasks.find((t) => t.kind === "departure" && t.roomNumber === "101")!;
    await workHousekeepingTask(pool, s(), departure.id, "done", asAnna);
    expect((await board()).toInspect.map((r) => r.roomNumber)).toContain("101");
    await failInspection(pool, s(), room("101").id, "Bathroom not done", asSup);
    const t = (await board()).tasks.find((x) => x.id === departure.id)!;
    expect(t).toMatchObject({ status: "open", assigneeId: anna, changed: true, note: "Bathroom not done" });
    expect((await listRoomStates(pool, s(), berlin, asAnna)).rooms.find((r) => r.number === "101")).toMatchObject({ cleanliness: "dirty" });
  });

  it("an early departure turns the day's stayover into a departure clean", async () => {
    const staying = (await board()).tasks.find((t) => t.roomNumber === "102" && t.kind === "stayover")!;
    const res = (await pool.query(`select reservation_id from ${s()}.housekeeping_tasks where id = $1`, [staying.id])).rows[0].reservation_id;
    await checkOut(pool, s(), res, fd, { override: true });
    // the plan is published and the tasks were Anna's: they are called off visibly, not dropped
    const of102 = (await board()).tasks.filter((t) => t.roomNumber === "102").map((t) => `${t.kind}:${t.status}:${t.changed}`).sort();
    expect(of102).toEqual(["departure:open:true", "linen:skipped:true", "stayover:skipped:true"]);
  });

  it("a guest waiting for the room makes its preparation a priority", async () => {
    const arriving = (await pool.query(`select reservation_id from ${s()}.housekeeping_tasks where kind = 'arrival' and business_date = $1`, [day(3)])).rows[0].reservation_id;
    await setWaitingForRoom(pool, s(), arriving, true, asSup);
    const first = (await board()).tasks[0]!;
    expect(first).toMatchObject({ kind: "arrival", priority: true, changed: true });
  });
});
