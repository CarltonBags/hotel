import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms, type Room } from "../src/tenant/rooms";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking, findReservation } from "../src/tenant/reservations";
import {
  assignRoom,
  cancelBooking,
  cancelReservation,
  listFreeRooms,
  listOverbooked,
  moveRoom,
  previewBookingCancellation,
  previewCancellation,
  reservationHistory,
  setCancellationFeeStatus,
  updateReservation,
} from "../src/tenant/reservation-changes";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: in-place edits reprice only changed nights and log before/after;
 * forced overbooking; cancellation with the policy fee; Room Assignments
 * with mid-stay moves as segments.
 */
describe("reservation changes", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let dbl: string;
  let sgl: string;
  let rooms: Room[];
  let bar: RatePlan;
  let guest: string;
  const fd = "user_frida";
  const nights = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  let resId: string;

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const s = tenant.schemaName;
    const le = await createLegalEntity(pool, s, { name: "Alpha GmbH", country: "DE" });
    berlin = (await createProperty(pool, s, { name: "Berlin", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, s, { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 3, maxAdults: 3, bedPlaces: 2, extraBeds: 1 })).id;
    sgl = (await createRoomType(pool, s, { propertyId: berlin, code: "SGL", name: "Single", maxOccupancy: 1, maxAdults: 1, bedPlaces: 1, extraBeds: 0 })).id;
    rooms = await createRooms(pool, s, { propertyId: berlin, roomTypeId: dbl, numbers: ["101", "102"] });
    await createRooms(pool, s, { propertyId: berlin, roomTypeId: sgl, numbers: ["201"] });
    const pay = await createPaymentPolicy(pool, s, { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s, { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    bar = await createRatePlan(pool, s, { propertyId: berlin, code: "BAR", name: "Flexible", kind: "base", roomTypeIds: [dbl, sgl], baseOccupancy: 1, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id, supplements: [{ kind: "extra_adult", amount: 30 }] });
    await setRates(pool, s, berlin, fd, nights("2026-12-01", 30).flatMap((date) => [
      { ratePlanId: bar.id, roomTypeId: dbl, date, price: 100 },
      { ratePlanId: bar.id, roomTypeId: sgl, date, price: 80 },
    ]));
    guest = (await createGuest(pool, s, { firstName: "Aiko", lastName: "Tanaka" }, { userId: fd, propertyId: berlin })).id;
    const b = await createBooking(pool, s, berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival: "2026-12-07", departure: "2026-12-10", roomTypeId: dbl, ratePlanId: bar.id, adults: 1, childAges: [], primaryGuestId: guest }] });
    resId = b.reservations[0]!.id;
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("extending by one night reprices only the added night and logs one entry with before and after", async () => {
    // rates rise after booking: kept nights stay at 100, the added night gets the current 140
    await setRates(pool, tenant.schemaName, berlin, fd, nights("2026-12-07", 4).map((date) => ({ ratePlanId: bar.id, roomTypeId: dbl, date, price: 140 })));
    await updateReservation(pool, tenant.schemaName, resId, fd, { departure: "2026-12-11" });
    const r = (await findReservation(pool, tenant.schemaName, resId))!;
    expect(r.nights.map((n) => n.total)).toEqual([100, 100, 100, 140]);
    const history = await reservationHistory(pool, tenant.schemaName, resId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ action: "edit", userId: fd, before: { departure: "2026-12-10", total: 300 }, after: { departure: "2026-12-11", total: 440 } });
  });

  it("an occupancy change reprices every night; an edit that changes nothing logs nothing", async () => {
    await updateReservation(pool, tenant.schemaName, resId, fd, { adults: 2 });
    expect((await findReservation(pool, tenant.schemaName, resId))!.nights.map((n) => n.total)).toEqual([170, 170, 170, 170]);
    await updateReservation(pool, tenant.schemaName, resId, fd, { adults: 2 });
    expect(await reservationHistory(pool, tenant.schemaName, resId)).toHaveLength(2);
  });

  it("a room move mid-stay creates a second Room Assignment segment on the same reservation", async () => {
    expect((await listFreeRooms(pool, tenant.schemaName, resId)).map((x) => x.name)).toEqual(["101", "102"]);
    await assignRoom(pool, tenant.schemaName, resId, fd, rooms[0]!.id);
    await moveRoom(pool, tenant.schemaName, resId, fd, rooms[1]!.id, "2026-12-09");
    const r = (await findReservation(pool, tenant.schemaName, resId))!;
    expect(r.assignments.map((a) => `${a.roomName} ${a.from}..${a.to}`)).toEqual(["101 2026-12-07..2026-12-09", "102 2026-12-09..2026-12-11"]);
    expect((await reservationHistory(pool, tenant.schemaName, resId))[0]).toMatchObject({ action: "move_room" });
  });

  it("a room taken by another reservation on those nights cannot be assigned", async () => {
    const b = await createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival: "2026-12-08", departure: "2026-12-09", roomTypeId: dbl, ratePlanId: bar.id, adults: 1, childAges: [], primaryGuestId: guest }] });
    const other = b.reservations[0]!.id;
    await expect(assignRoom(pool, tenant.schemaName, other, fd, rooms[0]!.id)).rejects.toThrow(/taken/);
    await assignRoom(pool, tenant.schemaName, other, fd, rooms[1]!.id).catch(() => undefined);
    expect((await listFreeRooms(pool, tenant.schemaName, other)).map((x) => x.name)).toEqual([]);
    await cancelReservation(pool, tenant.schemaName, other, fd, { now: new Date("2026-11-01T00:00:00Z") });
  });

  it("a stay past Availability needs the explicit force and is flagged as overbooked", async () => {
    // one SGL room; book it, then a second SGL on the same night
    const one = { arrival: "2026-12-20", departure: "2026-12-21", roomTypeId: sgl, ratePlanId: bar.id, adults: 1, childAges: [], primaryGuestId: guest };
    await createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [one] });
    await expect(createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [one] })).rejects.toThrow(/sold out/);
    const forced = await createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ ...one, force: true }] });
    expect((await findReservation(pool, tenant.schemaName, forced.reservations[0]!.id))!.overbooked).toBe(true);
    // editing into a sold-out room type also needs the force
    await expect(updateReservation(pool, tenant.schemaName, resId, fd, { roomTypeId: sgl, adults: 1, departure: "2026-12-08" })).resolves.toBeTruthy();
    await expect(updateReservation(pool, tenant.schemaName, resId, fd, { arrival: "2026-12-20", departure: "2026-12-21" })).rejects.toThrow(/sold out/);
    await updateReservation(pool, tenant.schemaName, resId, fd, { arrival: "2026-12-20", departure: "2026-12-21" }, { force: true });
    expect((await listOverbooked(pool, tenant.schemaName, berlin, "2026-10-01")).map((x) => x.reservationId).sort()).toEqual([forced.reservations[0]!.id, resId].sort());
  });

  it("a Rate Plan without date changes refuses moving the dates; a lost room assignment shows in the history", async () => {
    const pay = await createPaymentPolicy(pool, tenant.schemaName, { propertyId: berlin, name: "None", kind: "none" });
    const cxl = await createCancellationPolicy(pool, tenant.schemaName, { propertyId: berlin, name: "Strict", freeUntilDays: null, feeKind: "full_stay", noShowFeeKind: "full_stay" });
    const nr = await createRatePlan(pool, tenant.schemaName, { propertyId: berlin, code: "NR", name: "Fixed", kind: "base", roomTypeIds: [dbl, sgl], baseOccupancy: 1, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id, dateChangeAllowed: false });
    await setRates(pool, tenant.schemaName, berlin, fd, nights("2026-12-14", 3).flatMap((date) => [
      { ratePlanId: nr.id, roomTypeId: dbl, date, price: 90 },
      { ratePlanId: nr.id, roomTypeId: sgl, date, price: 70 },
    ]));
    const b = await createBooking(pool, tenant.schemaName, berlin, fd, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival: "2026-12-14", departure: "2026-12-16", roomTypeId: dbl, ratePlanId: nr.id, adults: 1, childAges: [], primaryGuestId: guest }] });
    const id = b.reservations[0]!.id;
    await expect(updateReservation(pool, tenant.schemaName, id, fd, { departure: "2026-12-17" })).rejects.toThrow(/does not allow date changes/);
    await assignRoom(pool, tenant.schemaName, id, fd, rooms[0]!.id);
    await updateReservation(pool, tenant.schemaName, id, fd, { roomTypeId: sgl });
    const edit = (await reservationHistory(pool, tenant.schemaName, id)).find((h) => h.action === "edit")!;
    expect(edit.before.rooms).toHaveLength(1);
    expect(edit.after.rooms).toEqual([]);
    expect((await findReservation(pool, tenant.schemaName, id))!.nights.map((n) => n.total)).toEqual([70, 70]);
  });

  it("cancelling shows the Cancellation Policy fee for staff to confirm or waive later", async () => {
    // free until 1 day before arrival 18:00 Berlin (2026-12-19 17:00 UTC)
    expect((await previewCancellation(pool, tenant.schemaName, resId, new Date("2026-12-19T16:00:00Z"))).amount).toBe(0);
    expect((await previewCancellation(pool, tenant.schemaName, resId, new Date("2026-12-19T18:00:00Z"))).amount).toBe(80);
    await cancelReservation(pool, tenant.schemaName, resId, fd, { now: new Date("2026-12-19T18:00:00Z") });
    let r = (await findReservation(pool, tenant.schemaName, resId))!;
    expect(r).toMatchObject({ status: "cancelled", cancellationFee: 80, cancellationFeeStatus: "open", assignments: [] });
    await setCancellationFeeStatus(pool, tenant.schemaName, resId, fd, "waived");
    r = (await findReservation(pool, tenant.schemaName, resId))!;
    expect(r.cancellationFeeStatus).toBe("waived");
    await expect(updateReservation(pool, tenant.schemaName, resId, fd, { adults: 1 })).rejects.toThrow(/cancelled/i);
    expect((await reservationHistory(pool, tenant.schemaName, resId)).map((h) => h.action).slice(0, 2)).toEqual(["fee_waived", "cancel"]);
  });

  it("cancelling a whole booking cancels each of its reservations", async () => {
    const b = await createBooking(pool, tenant.schemaName, berlin, fd, {
      booker: { guestId: guest },
      walkIn: false,
      notes: "",
      reservations: [
        { arrival: "2026-12-24", departure: "2026-12-26", roomTypeId: dbl, ratePlanId: bar.id, adults: 1, childAges: [], primaryGuestId: guest },
        { arrival: "2026-12-24", departure: "2026-12-26", roomTypeId: dbl, ratePlanId: bar.id, adults: 1, childAges: [], primaryGuestId: guest },
      ],
    });
    expect(await previewBookingCancellation(pool, tenant.schemaName, b.id, new Date("2026-12-24T00:00:00Z"))).toEqual({ amount: 200, reservations: 2 });
    const result = await cancelBooking(pool, tenant.schemaName, b.id, fd, { now: new Date("2026-11-01T00:00:00Z") });
    expect(result.cancelled).toBe(2);
    for (const r of b.reservations) expect((await findReservation(pool, tenant.schemaName, r.id))!).toMatchObject({ status: "cancelled", cancellationFee: null });
  });
});
