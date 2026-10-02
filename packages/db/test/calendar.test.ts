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
import { setRates, setRestrictions } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking, findReservation } from "../src/tenant/reservations";
import { assignRoom, moveRoom, previewReservationChange, reservationHistory, restoreAssignments } from "../src/tenant/reservation-changes";
import { loadCalendar } from "../src/tenant/calendar";
import { resetTestDatabase, testPool } from "./helpers";

/** Seams: the Calendar's data for a date range; dry-run price preview of a drag; restoring assignments for Undo. */
describe("calendar", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let dbl: string;
  let sgl: string;
  let rooms: Room[];
  let r1: string;
  let r2: string;
  const fd = "user_frida";
  const nights = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const s = tenant.schemaName;
    const le = await createLegalEntity(pool, s, { name: "Alpha GmbH", country: "DE" });
    berlin = (await createProperty(pool, s, { name: "Berlin", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, s, { propertyId: berlin, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    sgl = (await createRoomType(pool, s, { propertyId: berlin, code: "SGL", name: "Single", maxOccupancy: 1, maxAdults: 1, bedPlaces: 1, extraBeds: 0 })).id;
    rooms = await createRooms(pool, s, { propertyId: berlin, roomTypeId: dbl, numbers: ["101", "102"], floor: "1" });
    await createRooms(pool, s, { propertyId: berlin, roomTypeId: sgl, numbers: ["201"], floor: "2" });
    const pay = await createPaymentPolicy(pool, s, { propertyId: berlin, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s, { propertyId: berlin, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const bar = await createRatePlan(pool, s, { propertyId: berlin, code: "BAR", name: "Flexible", kind: "base", roomTypeIds: [dbl, sgl], baseOccupancy: 1, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    const nr = await createRatePlan(pool, s, { propertyId: berlin, code: "NR", name: "Saver", kind: "derived", basePlanId: bar.id, derivation: { kind: "percent", value: -10 }, roomTypeIds: [dbl], paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    void nr;
    await setRates(pool, s, berlin, fd, nights("2026-12-01", 20).flatMap((date) => [
      { ratePlanId: bar.id, roomTypeId: dbl, date, price: 100 },
      { ratePlanId: bar.id, roomTypeId: sgl, date, price: 80 },
    ]));
    const g = (await createGuest(pool, s, { firstName: "Aiko", lastName: "Tanaka" }, { userId: fd, propertyId: berlin })).id;
    const b = await createBooking(pool, s, berlin, fd, {
      booker: { guestId: g },
      walkIn: false,
      notes: "",
      reservations: [
        { arrival: "2026-12-07", departure: "2026-12-10", roomTypeId: dbl, ratePlanId: bar.id, adults: 2, childAges: [], primaryGuestId: g },
        { arrival: "2026-12-08", departure: "2026-12-09", roomTypeId: dbl, ratePlanId: bar.id, adults: 1, childAges: [], primaryGuestId: g },
      ],
    });
    [r1, r2] = b.reservations.map((x) => x.id) as [string, string];
    await assignRoom(pool, s, r1, fd, rooms[0]!.id);
    await setRestrictions(pool, s, berlin, fd, [{ ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-08", patch: { minStayArrival: 2 } }]);
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("loads rooms by type with free rooms and the lowest price per day, and the reservations in range", async () => {
    const cal = await loadCalendar(pool, tenant.schemaName, berlin, "2026-12-07", 3);
    const d = cal.roomTypes.find((t) => t.code === "DBL")!;
    expect(d.rooms.map((r) => r.number)).toEqual(["101", "102"]);
    expect(d.days.map((x) => x.free)).toEqual([1, 0, 1]);
    // lowest public price: Saver at -10 %
    expect(d.days.map((x) => x.lowestPrice)).toEqual([90, 90, 90]);
    expect(d.days[1]!.minStay).toBe(2);
    const res = cal.reservations.find((r) => r.id === r1)!;
    expect(res).toMatchObject({ guestLastName: "Tanaka", guests: 2, status: "confirmed", arrival: "2026-12-07", departure: "2026-12-10" });
    expect(res.segments).toEqual([{ roomId: rooms[0]!.id, from: "2026-12-07", to: "2026-12-10" }]);
    expect(cal.reservations.find((r) => r.id === r2)!.segments).toEqual([]);
  });

  it("previews a date change with old and new dates and the price difference, without changing anything", async () => {
    const p = await previewReservationChange(pool, tenant.schemaName, r2, { arrival: "2026-12-12", departure: "2026-12-13" });
    expect(p).toMatchObject({ before: { arrival: "2026-12-08", departure: "2026-12-09", total: 100 }, after: { arrival: "2026-12-12", departure: "2026-12-13", total: 100 }, difference: 0, needsOverbooking: false });
    const t = await previewReservationChange(pool, tenant.schemaName, r2, { roomTypeId: sgl });
    expect(t).toMatchObject({ after: { roomTypeId: sgl, total: 80 }, difference: -20 });
    expect((await findReservation(pool, tenant.schemaName, r2))!.arrival).toBe("2026-12-08");
    expect(await reservationHistory(pool, tenant.schemaName, r2)).toEqual([]);
  });

  it("undo restores the assignments a drag replaced", async () => {
    const before = (await findReservation(pool, tenant.schemaName, r1))!.assignments.map((a) => ({ roomId: a.roomId, from: a.from, to: a.to }));
    await moveRoom(pool, tenant.schemaName, r1, fd, rooms[1]!.id, "2026-12-07");
    const afterMove = [{ roomId: rooms[1]!.id, from: "2026-12-07", to: "2026-12-10" }];
    await expect(restoreAssignments(pool, tenant.schemaName, r1, fd, before, before)).rejects.toThrow(/changed since/);
    await expect(restoreAssignments(pool, tenant.schemaName, r1, fd, [{ roomId: rooms[0]!.id, from: "2026-12-08", to: "2026-12-10" }], afterMove)).rejects.toThrow(/do not fit/);
    await restoreAssignments(pool, tenant.schemaName, r1, fd, before, afterMove);
    expect((await findReservation(pool, tenant.schemaName, r1))!.assignments.map((a) => a.roomName)).toEqual(["101"]);
    expect((await reservationHistory(pool, tenant.schemaName, r1))[0]).toMatchObject({ action: "assign_room" });
  });

  it("handles 400 rooms over 30 days in one load", async () => {
    const big = (await createRoomType(pool, tenant.schemaName, { propertyId: berlin, code: "BIG", name: "Big", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, tenant.schemaName, { propertyId: berlin, roomTypeId: big, numbers: Array.from({ length: 397 }, (_, i) => String(1000 + i)) });
    const started = Date.now();
    const cal = await loadCalendar(pool, tenant.schemaName, berlin, "2026-12-01", 30);
    expect(cal.roomTypes.reduce((n, t) => n + t.rooms.length, 0)).toBe(400);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
