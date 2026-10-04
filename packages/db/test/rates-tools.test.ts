import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType } from "../src/tenant/rooms";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan } from "../src/tenant/rate-plans";
import { PRICE_HORIZON_DAYS, applyRatesTool, createEventMarker, deleteEventMarker, listEventMarkers, listPriceEnds, listRates, listRestrictions, setRates, setRestrictions, undoLastChange } from "../src/tenant/rates";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the grid tools write through applyRatesTool as one undoable change,
 * planned from the stored state; Event Markers are kept per property.
 */
describe("rates grid tools", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId: string;
  const types: string[] = [];
  const plans: { id: string; base: boolean }[] = [];
  const rita = "user_rita";
  const s = () => tenant.schemaName;
  const BD = "2026-10-20";

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE" });
    propertyId = (await createProperty(pool, s(), { name: "Berlin", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    await pool.query(`update ${s()}.properties set business_date = $2 where id = $1`, [propertyId, BD]);
    for (const code of ["SGL", "DBL", "TWN", "STE", "APT"]) types.push((await createRoomType(pool, s(), { propertyId, code, name: code, maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id);
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const bar = await createRatePlan(pool, s(), { propertyId, code: "BAR", name: "Flexible", kind: "base", roomTypeIds: types, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    plans.push({ id: bar.id, base: true });
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  const rows = () => types.map((t) => ({ ratePlanId: plans[0]!.id, roomTypeId: t }));

  it("a 7 by 5 paste lands on the right cells and is undoable", async () => {
    const block = Array.from({ length: 5 }, (_, i) => Array.from({ length: 7 }, (_, j) => 100 + i * 10 + j));
    // a stale preview count is refused
    expect((await applyRatesTool(pool, s(), propertyId, rita, { kind: "paste", block, rows: rows(), anchorDate: "2026-10-29" }, 30)).stale).toBe(true);
    const r = await applyRatesTool(pool, s(), propertyId, rita, { kind: "paste", block, rows: rows(), anchorDate: "2026-10-29" }, 35);
    expect(r.stale).toBe(false);
    const cells = await listRates(pool, s(), propertyId, { from: "2026-10-28", to: "2026-11-05" });
    expect(cells).toHaveLength(35);
    expect(cells.find((c) => c.roomTypeId === types[2] && c.date === "2026-11-04")?.price).toBe(126);
    expect(cells.some((c) => c.date === "2026-10-28" || c.date === "2026-11-05")).toBe(false);
    await undoLastChange(pool, s(), propertyId, rita);
    expect(await listRates(pool, s(), propertyId, { from: "2026-10-28", to: "2026-11-05" })).toHaveLength(0);
  });

  it("copies a period by weekday across a month boundary, prices and restrictions", async () => {
    // Monday 26 Oct to Sunday 1 Nov: weekdays 100, Friday 150, Saturday 180 with a two-night minimum
    const week = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
    await setRates(pool, s(), propertyId, rita, week.map((date, i) => ({ ratePlanId: plans[0]!.id, roomTypeId: types[0]!, date, price: i === 4 ? 150 : i === 5 ? 180 : 100 })));
    await setRestrictions(pool, s(), propertyId, rita, [{ ratePlanId: plans[0]!.id, roomTypeId: types[0]!, date: "2026-10-31", patch: { minStayArrival: 2 } }]);
    // to Wednesday 25 Nov … Tuesday 1 Dec
    const tool = { kind: "copy" as const, rows: [rows()[0]!], source: { from: week[0]!, to: week[6]! }, targetFrom: "2026-11-25" };
    const r = await applyRatesTool(pool, s(), propertyId, rita, tool, 7);
    expect(r.stale).toBe(false);
    const after = await listRates(pool, s(), propertyId, { from: "2026-11-25", to: "2026-12-01", roomTypeId: types[0] });
    expect(Object.fromEntries(after.map((c) => [c.date, c.price]))).toEqual({ "2026-11-25": 100, "2026-11-26": 100, "2026-11-27": 150, "2026-11-28": 180, "2026-11-29": 100, "2026-11-30": 100, "2026-12-01": 100 });
    const restr = await listRestrictions(pool, s(), propertyId, { from: "2026-11-28", to: "2026-11-28" });
    expect(restr.find((x) => x.roomTypeId === types[0])?.own.minStayArrival).toBe(2);
  });

  it("fill to the horizon removes the horizon banner", async () => {
    const horizon = addDays(BD, PRICE_HORIZON_DAYS);
    expect((await listPriceEnds(pool, s(), propertyId, horizon)).length).toBe(5);
    // the first row repeats its last full week; the others start from a base price
    const repeat = await applyRatesTool(pool, s(), propertyId, rita, { kind: "fill", rows: [rows()[0]!], mode: { kind: "repeat_week" } }, -1);
    expect(repeat.stale).toBe(true);
    await applyRatesTool(pool, s(), propertyId, rita, { kind: "fill", rows: [rows()[0]!], mode: { kind: "repeat_week" } }, repeat.preview.cells);
    const others = rows().slice(1);
    const base = await applyRatesTool(pool, s(), propertyId, rita, { kind: "fill", rows: others, mode: { kind: "base", price: 90, weekendFactor: 1.25 } }, -1);
    await applyRatesTool(pool, s(), propertyId, rita, { kind: "fill", rows: others, mode: { kind: "base", price: 90, weekendFactor: 1.25 } }, base.preview.cells);
    expect(await listPriceEnds(pool, s(), propertyId, horizon)).toEqual([]);
    const fri = await listRates(pool, s(), propertyId, { from: "2027-01-08", to: "2027-01-08", roomTypeId: types[3] });
    expect(fri[0]?.price).toBe(112.5);
  });

  it("keeps Event Markers per property with date range and name", async () => {
    const fair = await createEventMarker(pool, s(), propertyId, rita, { name: " ITB Berlin ", from: "2027-03-02", to: "2027-03-04" });
    await createEventMarker(pool, s(), propertyId, rita, { name: "New Year", from: "2026-12-31", to: "" });
    expect(await listEventMarkers(pool, s(), propertyId, { from: "2027-03-04", to: "2027-03-10" })).toEqual([{ id: fair.id, name: "ITB Berlin", from: "2027-03-02", to: "2027-03-04" }]);
    expect((await listEventMarkers(pool, s(), propertyId, { from: "2026-12-01", to: "2027-12-31" })).map((m) => m.name)).toEqual(["New Year", "ITB Berlin"]);
    await expect(createEventMarker(pool, s(), propertyId, rita, { name: "x", from: "2027-01-05", to: "2027-01-01" })).rejects.toThrow(/before/);
    await deleteEventMarker(pool, s(), propertyId, fair.id);
    expect((await listEventMarkers(pool, s(), propertyId, { from: "2027-03-01", to: "2027-03-10" }))).toEqual([]);
  });
});
