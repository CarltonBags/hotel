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
import { createService, updateService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom } from "../src/tenant/reservation-changes";
import { checkIn } from "../src/tenant/folios";
import { checkOut } from "../src/tenant/invoices";
import { listRoomStates } from "../src/tenant/room-state";
import { randomUUID } from "node:crypto";
import { generateHousekeepingTasks, housekeepingBoard, moveHousekeepingTask, publishHousekeeping, setHousekeepingRules, setRoomTypeHousekeeping } from "../src/tenant/housekeeping";
import { addHousekeepingNote, applyPhoneChange, floorDay, floorPhoto, listLostItems } from "../src/tenant/floor";
import { loadFolios } from "../src/tenant/folios";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: what the phone shows (floorDay) and the changes it sends, possibly
 * much later (applyPhoneChange): applied once, supervisor's newer change
 * wins, minibar onto the stay's folio, problems and found items with photo.
 */
describe("phone view", () => {
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
  let water: string;
  let staying: string;
  const asMax = () => ({ userId: "user_max", actor: { propertyRoles: [{ propertyId: berlin, role: "maintenance" as const }] } });
  const at = "2026-10-04T08:00:00.000Z";
  const PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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


  it("shows a housekeeper their own rooms once published, with the guest's floor view and notes", async () => {
    const leaving = await book(d0, day(3), "101");
    staying = await book(d0, day(6), "102");
    await checkIn(pool, s(), leaving, fd);
    await checkIn(pool, s(), staying, fd);
    await addHousekeepingNote(pool, s(), staying, { code: "feather_allergy" }, asSup);
    await addHousekeepingNote(pool, s(), staying, { text: "Extra towels" }, asSup);
    await setBusinessDate(day(3));
    await generateHousekeepingTasks(pool, s(), berlin, asSup);
    const ids = (await board()).tasks;
    for (const t of ids) await moveHousekeepingTask(pool, s(), t.id, anna, asSup);
    expect((await floorDay(pool, s(), berlin, asAnna)).tasks).toEqual([]);
    await publishHousekeeping(pool, s(), berlin, asSup);
    const mine = await floorDay(pool, s(), berlin, asAnna);
    const stay = mine.tasks.find((t) => t.roomNumber === "102" && t.kind === "stayover")!;
    expect(stay).toMatchObject({ section: "1st floor", guest: { surname: "Tanaka", people: 2, departure: day(6), vip: false } });
    expect(stay.notes).toEqual([{ code: "feather_allergy", text: null }, { code: null, text: "Extra towels" }]);
    expect(mine.tasks.map((t) => `${t.roomNumber}:${t.kind}`).sort()).toEqual(["101:departure", "102:linen", "102:stayover"]);
  });

  it("applies a change once, however often it is sent; Undo puts the room back", async () => {
    const dep = (await floorDay(pool, s(), berlin, asAnna)).tasks.find((t) => t.kind === "departure")!;
    // the guest has left early
    await pool.query(`update ${s()}.rooms set cleanliness = 'dirty' where id = $1`, [room("101").id]);
    const start = { id: randomUUID(), at, kind: "task" as const, taskId: dep.id, step: "start" as const, seen: dep.version };
    const done = { id: randomUUID(), at, kind: "task" as const, taskId: dep.id, step: "done" as const, seen: dep.version };
    // made offline one after the other against the same version: both are the housekeeper's own
    expect(await applyPhoneChange(pool, s(), berlin, start, asAnna)).toEqual({ outcome: "applied", message: "" });
    expect(await applyPhoneChange(pool, s(), berlin, done, asAnna)).toEqual({ outcome: "applied", message: "" });
    expect(await applyPhoneChange(pool, s(), berlin, done, asAnna)).toEqual({ outcome: "applied", message: "" });
    const rooms101 = async () => (await listRoomStates(pool, s(), berlin, asSup)).rooms.find((r) => r.number === "101")!.cleanliness;
    expect(await rooms101()).toBe("clean");
    const undo = { id: randomUUID(), at, kind: "task" as const, taskId: dep.id, step: "undo" as const, seen: dep.version };
    expect((await applyPhoneChange(pool, s(), berlin, undo, asAnna)).outcome).toBe("applied");
    expect(await rooms101()).toBe("dirty");
    expect((await floorDay(pool, s(), berlin, asAnna)).tasks.find((t) => t.id === dep.id)?.status).toBe("in_progress");
  });

  it("a supervisor's newer change wins and the housekeeper is told", async () => {
    const lin = (await floorDay(pool, s(), berlin, asAnna)).tasks.find((t) => t.kind === "linen")!;
    // the supervisor moves the room away and back while the phone is offline
    await moveHousekeepingTask(pool, s(), lin.id, bea, asSup);
    await moveHousekeepingTask(pool, s(), lin.id, anna, asSup);
    const r = await applyPhoneChange(pool, s(), berlin, { id: randomUUID(), at, kind: "task", taskId: lin.id, step: "declined", seen: lin.version }, asAnna);
    expect(r.outcome).toBe("conflict");
    expect(r.message).toMatch(/Room 102 was changed by your supervisor/);
    // with the version it sees now, it goes through
    const now = (await floorDay(pool, s(), berlin, asAnna)).tasks.find((t) => t.id === lin.id)!;
    expect((await applyPhoneChange(pool, s(), berlin, { id: randomUUID(), at, kind: "task", taskId: lin.id, step: "declined", seen: now.version }, asAnna)).outcome).toBe("applied");
    expect((await floorDay(pool, s(), berlin, asAnna)).tasks.find((t) => t.id === lin.id)).toMatchObject({ status: "skipped", skipReason: "declined" });
  });

  it("posts the minibar as Charges to the stay in the room, once", async () => {
    const codes = await listTaxCodes(pool, s(), (await pool.query(`select legal_entity_id from ${s()}.properties where id = $1`, [berlin])).rows[0].legal_entity_id);
    water = (await createService(pool, s(), { propertyId: berlin, code: "MB-WATER", name: "Water", defaultPrice: 3.5, taxCodeId: codes[0]!.id, revenueAccount: "8400", postingRhythm: "once", bookableOnline: false })).id;
    const op = { id: randomUUID(), at, kind: "minibar" as const, roomId: room("102").id, items: [{ serviceId: water, quantity: 2 }] };
    expect((await applyPhoneChange(pool, s(), berlin, op, asAnna)).message).toMatch(/not found/);
    await updateService(pool, s(), berlin, water, { minibar: true });
    expect((await floorDay(pool, s(), berlin, asAnna)).minibar.map((m) => m.name)).toEqual(["Water"]);
    const again = { ...op, id: randomUUID() };
    expect((await applyPhoneChange(pool, s(), berlin, again, asAnna)).outcome).toBe("applied");
    expect((await applyPhoneChange(pool, s(), berlin, again, asAnna)).outcome).toBe("applied");
    const charges = (await loadFolios(pool, s(), staying)).folios.flatMap((f) => f.charges).filter((c) => c.description === "Water");
    expect(charges.map((c) => c.amount)).toEqual([7]);
    // nobody checked in to 103
    expect((await applyPhoneChange(pool, s(), berlin, { ...op, id: randomUUID(), roomId: room("103").id }, asAnna)).message).toMatch(/No guest is checked in to room 103/);
  });

  it("a problem report reaches Maintenance's queue by urgency; a found item is kept with its photo", async () => {
    await applyPhoneChange(pool, s(), berlin, { id: randomUUID(), at, kind: "problem", roomId: room("103").id, pick: "electrical", urgency: "later", note: "Lamp" }, asAnna);
    await applyPhoneChange(pool, s(), berlin, { id: randomUUID(), at, kind: "problem", roomId: room("101").id, pick: "plumbing", urgency: "now", note: "Drain", photo: PHOTO }, asAnna);
    const queue = (await floorDay(pool, s(), berlin, asMax())).issues!;
    expect(queue.map((i) => [i.roomNumber, i.urgency, i.hasPhoto])).toEqual([["101", "now", true], ["103", "later", false]]);
    expect((await floorDay(pool, s(), berlin, asAnna)).issues).toBeNull();
    expect(await floorPhoto(pool, s(), "issue", queue[0]!.id, asMax())).toMatchObject({ type: "image/png" });
    expect(await floorPhoto(pool, s(), "issue", queue[0]!.id, asAnna)).toBeNull();
    await applyPhoneChange(pool, s(), berlin, { id: randomUUID(), at, kind: "issue", issueId: queue[0]!.id, step: "take", note: "" }, asMax());
    await applyPhoneChange(pool, s(), berlin, { id: randomUUID(), at, kind: "issue", issueId: queue[0]!.id, step: "fixed", note: "Cleared" }, asMax());
    expect((await floorDay(pool, s(), berlin, asMax())).issues!.map((i) => i.roomNumber)).toEqual(["103"]);
    // a housekeeper cannot work the queue
    expect((await applyPhoneChange(pool, s(), berlin, { id: randomUUID(), at, kind: "issue", issueId: queue[1]!.id, step: "fixed", note: "" }, asAnna)).outcome).toBe("refused");

    await applyPhoneChange(pool, s(), berlin, { id: randomUUID(), at, kind: "lost", roomId: room("101").id, pick: "electronics", note: "Charger", photo: PHOTO }, asAnna);
    expect((await listLostItems(pool, s(), berlin)).map((l) => [l.roomNumber, l.pick, l.hasPhoto, l.foundBy])).toEqual([["101", "electronics", true, anna]]);
  });
});
