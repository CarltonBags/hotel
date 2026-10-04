import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { REPORT_KINDS, addDays, todayIn, type ReportTable } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms, type Room } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { assignRoom } from "../src/tenant/reservation-changes";
import { checkIn } from "../src/tenant/folios";
import { createCityTaxRule } from "../src/tenant/city-tax";
import { createRoomBlock } from "../src/tenant/room-state";
import { runReport, type ReportRequest } from "../src/tenant/reports";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the fixed reports as tables. Occupancy against a hand calculation
 * with two rooms Out of Order; Net Room Revenue without breakfast and City
 * Tax; a consolidated report converting CHF at the stated rate; every report
 * kind runs.
 */
describe("fixed reports", () => {
  let pool: Pool;
  let tenant: Tenant;
  let berlin: string;
  let zurich: string;
  let rooms: Room[];
  const pm = "user_pm";
  const owner = { userId: pm, actor: { tenantRole: "owner" as const, propertyRoles: [] } };
  const today = todayIn("Europe/Berlin");
  // a whole month well ahead: the stays in it are on the books
  const ahead = addDays(today, 45);
  const monthStart = `${ahead.slice(0, 7)}-01`;
  const days = new Date(Date.UTC(Number(ahead.slice(0, 4)), Number(ahead.slice(5, 7)), 0)).getUTCDate();
  const monthEnd = `${ahead.slice(0, 7)}-${String(days).padStart(2, "0")}`;
  const s = () => tenant.schemaName;
  const req = (r: Partial<ReportRequest>): ReportRequest => ({ kind: "occupancy", from: monthStart, to: monthEnd, propertyIds: [berlin], grain: "month", compare: { previous: false, lastYear: false }, language: "en", ...r });
  const total = (t: ReportTable) => t.rows.at(-1)!.cells;
  let book: (propertyId: string, arrival: string, nights: number) => Promise<string>;

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const setup = async (country: "DE" | "CH", name: string, currency: string, price: number, withBreakfast: boolean) => {
      const le = (await createLegalEntity(pool, s(), { name: `${name} AG`, country, addressLine1: "Str. 1", postalCode: "1000", city: name, vatId: `${country}123456789`, taxNumber: "1" })).id;
      const id = (await createProperty(pool, s(), { name, legalEntityId: le, country, timeZone: "Europe/Berlin", currency })).id;
      const dbl = (await createRoomType(pool, s(), { propertyId: id, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
      const made = await createRooms(pool, s(), { propertyId: id, roomTypeId: dbl, numbers: Array.from({ length: 10 }, (_, i) => String(101 + i)) });
      await applyTaxPreset(pool, s(), le, country);
      const codes = await listTaxCodes(pool, s(), le);
      const code = (c: string) => codes.find((x) => x.code === c)!.id;
      const room = await createService(pool, s(), { propertyId: id, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: code("ACC"), revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
      const brk = withBreakfast ? await createService(pool, s(), { propertyId: id, code: "BRK", name: "Breakfast", defaultPrice: 12, taxCodeId: code("FOOD"), revenueAccount: "8400", postingRhythm: "per_person_night", bookableOnline: false }) : null;
      const pay = await createPaymentPolicy(pool, s(), { propertyId: id, name: "Card", kind: "card_guarantee" });
      const cxl = await createCancellationPolicy(pool, s(), { propertyId: id, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
      const plan = await createRatePlan(pool, s(), { propertyId: id, code: "P", name: "Plan", kind: "base", roomTypeIds: [dbl], mealPlan: brk ? "breakfast" : "none", accommodationServiceId: room.id, ...(brk ? { includedServices: [{ serviceId: brk.id, componentPrice: 12 }] } : {}), paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
      await setRates(pool, s(), id, pm, Array.from({ length: 120 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price })));
      if (country === "DE") await createCityTaxRule(pool, s(), id, { preset: "berlin", taxCodeId: code("ZERO") }, pm);
      return { id, dbl, plan: plan.id, rooms: made };
    };
    // Berlin: 131 a night with two breakfasts of 12 included, so the room is 107 gross, 100 net (7 %)
    const b = await setup("DE", "Berlin", "EUR", 131, true);
    // Zürich: room only, 103.80 CHF gross, 100 net (3.8 %)
    const z = await setup("CH", "Zürich", "CHF", 103.8, false);
    berlin = b.id;
    zurich = z.id;
    rooms = b.rooms;
    const guest = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka", addressLine1: "1-2-3 Shibuya", postalCode: "150-0002", city: "Tokyo", countryOfResidence: "JP" }, { userId: pm, propertyId: berlin })).id;
    book = async (propertyId, arrival, nights) => {
      const x = propertyId === berlin ? b : z;
      return (await createBooking(pool, s(), propertyId, pm, { booker: { guestId: guest }, walkIn: false, notes: "", reservations: [{ arrival, departure: addDays(arrival, nights), roomTypeId: x.dbl, ratePlanId: x.plan, adults: 2, childAges: [], primaryGuestId: guest }] })).reservations[0]!.id;
    };
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("occupancy of a month matches the hand calculation with two rooms Out of Order", async () => {
    // rooms 109 and 110 are Out of Order all month: 8 rooms a night are available
    for (const r of rooms.slice(8)) await createRoomBlock(pool, s(), { roomId: r.id, kind: "out_of_order", from: monthStart, to: addDays(monthEnd, 1), reason: "Renovation" }, owner);
    await book(berlin, monthStart, 4);
    await book(berlin, addDays(monthStart, 10), 5);
    await book(berlin, monthEnd, 2); // its second night falls in the next month
    const r = total(await runReport(pool, s(), req({})));
    const available = 8 * days;
    // 4 + 5 + 1 room nights; 100 net room revenue each (breakfast and City Tax outside)
    expect(r).toMatchObject({ available, occupied: 10, netRoomRevenue: 1000, adr: 100 });
    expect(r.occupancy).toBe(Math.round((10 / available) * 1000) / 10);
    expect(r.revpar).toBe(Math.round((1000 / available) * 100) / 100);
  });

  it("Net Room Revenue of posted stays leaves out breakfast and City Tax; total revenue keeps breakfast", async () => {
    const res = await book(berlin, today, 2);
    await assignRoom(pool, s(), res, pm, rooms[0]!.id);
    await checkIn(pool, s(), res, pm);
    const r = total(await runReport(pool, s(), req({ from: today, to: addDays(today, 1), grain: "day" })));
    // 2 nights × 100 net room; breakfast 2 × 24 gross at 7 % = 44.86 net
    expect(r).toMatchObject({ occupied: 2, netRoomRevenue: 200, totalRevenue: 244.86 });
  });

  it("a consolidated report converts CHF at the stated rate and keeps a line per property", async () => {
    await book(zurich, addDays(monthStart, 3), 1);
    await expect(runReport(pool, s(), req({ propertyIds: [berlin, zurich], currency: "EUR" }))).rejects.toThrow(/rate for CHF/);
    // also when the period holds no CHF amount: the report states its base either way
    await expect(runReport(pool, s(), req({ kind: "cash", propertyIds: [berlin, zurich], currency: "EUR" }))).rejects.toThrow(/rate for CHF/);
    const t = await runReport(pool, s(), req({ propertyIds: [berlin, zurich], currency: "EUR", rates: { CHF: 1.06 } }));
    const line = (label: string) => t.rows.find((x) => x.cells.label === label)!.cells;
    expect(line("Zürich")).toMatchObject({ occupied: 1, netRoomRevenue: 106 });
    expect(line("Berlin")).toMatchObject({ occupied: 10, netRoomRevenue: 1000 });
    expect(total(t)).toMatchObject({ occupied: 11, netRoomRevenue: 1106 });
    expect(t.notes.join(" ")).toContain("1 CHF = 1.06 EUR");
  });

  it("every report kind runs and ends in a total line", async () => {
    for (const kind of REPORT_KINDS) {
      const t = await runReport(pool, s(), req({ kind, from: addDays(today, -30), to: addDays(today, 30), compare: { previous: true, lastYear: true } }));
      expect(t.columns.length, kind).toBeGreaterThan(2);
      expect(t.notes.length, kind).toBeGreaterThan(0);
    }
    const mix = await runReport(pool, s(), req({ kind: "source_mix" }));
    expect(total(mix)).toMatchObject({ nights: 10, revenue: 1000 });
  });
});
