import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { OPEN_RESTRICTION, planBulkEdit, type GridRow } from "@hoteloftware/domain";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType } from "../src/tenant/rooms";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { applyBulkEdit, applyGridEdit, listBelowFloor, listPriceEnds, listRateChanges, listRates, listRestrictions, setRates, undoLastChange } from "../src/tenant/rates";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a grid edit is one change (prices, followers and restrictions under
 * one change id); undo restores every cell of the user's last change within
 * 10 minutes; prices below floor and prices ending inside the horizon are listed.
 */
describe("rates grid", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId: string;
  let dbl: string;
  let bar: RatePlan;
  let nr: RatePlan;
  const rita = "user_rita";
  const bob = "user_bob";
  const dates = ["2026-12-07", "2026-12-08", "2026-12-09"];

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = await createLegalEntity(pool, tenant.schemaName, { name: "Alpha GmbH", country: "DE" });
    propertyId = (await createProperty(pool, tenant.schemaName, { name: "Alpha Berlin", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, tenant.schemaName, { propertyId, code: "DBL", name: "Double", maxOccupancy: 3, maxAdults: 2, bedPlaces: 2, extraBeds: 1, priceFloor: 99 })).id;
    const pay = await createPaymentPolicy(pool, tenant.schemaName, { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, tenant.schemaName, { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    bar = await createRatePlan(pool, tenant.schemaName, { propertyId, code: "BAR", name: "Flexible", kind: "base", roomTypeIds: [dbl], paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    nr = await createRatePlan(pool, tenant.schemaName, { propertyId, code: "NR", name: "Saver", kind: "derived", basePlanId: bar.id, derivation: { kind: "percent", value: -10 }, roomTypeIds: [dbl], paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, tenant.schemaName, propertyId, bob, dates.map((date) => ({ ratePlanId: bar.id, roomTypeId: dbl, date, price: 120 })));
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  const gridRows = (): GridRow[] => [
    { ratePlanId: bar.id, roomTypeId: dbl, basePlanId: null, derivation: null, inherits: null, priceFloor: 99 },
    { ratePlanId: nr.id, roomTypeId: dbl, basePlanId: bar.id, derivation: nr.derivation, inherits: nr.inherits, priceFloor: 99 },
  ];

  async function currentState() {
    const rates = await listRates(pool, tenant.schemaName, propertyId, { from: dates[0]!, to: dates[2]! });
    const restr = await listRestrictions(pool, tenant.schemaName, propertyId, { from: dates[0]!, to: dates[2]! });
    return {
      price: (p: string, r: string, d: string) => rates.find((x) => x.ratePlanId === p && x.roomTypeId === r && x.date === d)?.price ?? null,
      restriction: (p: string, r: string, d: string) => restr.find((x) => x.ratePlanId === p && x.roomTypeId === r && x.date === d)?.own ?? OPEN_RESTRICTION,
    };
  }

  it("Apply changes exactly the cells the preview counted, under one change", async () => {
    const plan = planBulkEdit(
      { rows: [{ ratePlanId: bar.id, roomTypeId: dbl }], from: dates[0]!, to: dates[2]!, weekdays: [true, true, true, true, true, true, true], price: { action: "percent", value: -25 }, restriction: { field: "minStayArrival", value: 2 } },
      gridRows(),
      await currentState(),
    );
    expect(plan.preview.cells).toBe(3);
    expect(plan.preview.belowFloor).toBe(6); // 90 base and 81 derived, three days
    const result = await applyGridEdit(pool, tenant.schemaName, propertyId, rita, plan);
    const log = await listRateChanges(pool, tenant.schemaName, propertyId, { changeId: result.changeId });
    const edited = new Set(log.filter((c) => c.reason === "edit").map((c) => `${c.ratePlanId}|${c.roomTypeId}|${c.date}`));
    expect(edited.size).toBe(plan.preview.cells);
    expect(log.filter((c) => c.reason === "derived")).toHaveLength(3);
    expect((await listRates(pool, tenant.schemaName, propertyId, { from: dates[0]!, to: dates[0]!, ratePlanId: nr.id }))[0]!.price).toBe(81);
  });

  it("lists prices below the Price Floor for the Property Manager", async () => {
    const below = await listBelowFloor(pool, tenant.schemaName, propertyId, "2026-01-01");
    expect(below).toHaveLength(6);
    expect(below[0]).toMatchObject({ ratePlanCode: "BAR", roomTypeCode: "DBL", date: dates[0], price: 90, priceFloor: 99 });
  });

  it("undo within 10 minutes restores every cell of the user's last change, followers included", async () => {
    const undone = await undoLastChange(pool, tenant.schemaName, propertyId, rita);
    expect(undone.cells).toBe(9); // 3 base prices, 3 derived prices, 3 restrictions
    const rates = await listRates(pool, tenant.schemaName, propertyId, { from: dates[0]!, to: dates[2]! });
    expect(rates.filter((r) => r.ratePlanId === bar.id).map((r) => r.price)).toEqual([120, 120, 120]);
    expect(rates.filter((r) => r.ratePlanId === nr.id).map((r) => r.price)).toEqual([108, 108, 108]);
    const restr = await listRestrictions(pool, tenant.schemaName, propertyId, { from: dates[0]!, to: dates[2]! });
    expect(restr.filter((r) => r.ratePlanId === bar.id).every((r) => r.own.minStayArrival === null)).toBe(true);
    // nothing left to undo for Rita; Bob's setup change is his own
    await expect(undoLastChange(pool, tenant.schemaName, propertyId, rita)).rejects.toThrow(/nothing to undo/i);
  });

  it("undo deletes a price that did not exist before, and refuses after 10 minutes or when someone changed the cells since", async () => {
    await setRates(pool, tenant.schemaName, propertyId, rita, [{ ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-20", price: 140 }]);
    await undoLastChange(pool, tenant.schemaName, propertyId, rita);
    expect(await listRates(pool, tenant.schemaName, propertyId, { from: "2026-12-20", to: "2026-12-20" })).toEqual([]);

    await setRates(pool, tenant.schemaName, propertyId, rita, [{ ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-21", price: 150 }]);
    await setRates(pool, tenant.schemaName, propertyId, bob, [{ ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-21", price: 155 }]);
    await expect(undoLastChange(pool, tenant.schemaName, propertyId, rita)).rejects.toThrow(/changed again/i);

    await setRates(pool, tenant.schemaName, propertyId, rita, [{ ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-22", price: 150 }]);
    await expect(undoLastChange(pool, tenant.schemaName, propertyId, rita, { now: new Date(Date.now() + 11 * 60_000) })).rejects.toThrow(/nothing to undo/i);
  });

  it("bulk Apply plans inside the lock and refuses when the cells changed since the preview", async () => {
    const edit = { rows: [{ ratePlanId: bar.id, roomTypeId: dbl }], from: dates[0]!, to: dates[2]!, weekdays: [true, true, true, true, true, true, true], price: { action: "amount" as const, value: 5 }, restriction: null };
    const stale = await applyBulkEdit(pool, tenant.schemaName, propertyId, rita, edit, 2);
    expect(stale).toMatchObject({ stale: true, changeId: null });
    expect(stale.preview.cells).toBe(3);
    const done = await applyBulkEdit(pool, tenant.schemaName, propertyId, rita, edit, 3);
    expect(done.stale).toBe(false);
    expect((await listRates(pool, tenant.schemaName, propertyId, { from: dates[0]!, to: dates[0]!, ratePlanId: bar.id }))[0]!.price).toBe(125);
    await undoLastChange(pool, tenant.schemaName, propertyId, rita);
  });

  it("undo never reverts changes made in the plan settings", async () => {
    const { updateRatePlan } = await import("../src/tenant/rate-plans");
    await setRates(pool, tenant.schemaName, propertyId, bob, [{ ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-23", price: 100 }]);
    await updateRatePlan(pool, tenant.schemaName, propertyId, nr.id, { roomTypeIds: [dbl] }, { userId: bob });
    // bob's last grid edit is the 2026-12-23 price; the settings save logged nothing undoable
    const r = await undoLastChange(pool, tenant.schemaName, propertyId, bob);
    expect(r.cells).toBe(2); // base price and its follower
  });

  it("names plans and room types whose prices end inside the horizon", async () => {
    const ends = await listPriceEnds(pool, tenant.schemaName, propertyId, "2027-06-01");
    expect(ends).toEqual([{ ratePlanId: bar.id, ratePlanCode: "BAR", ratePlanName: "Flexible", roomTypeId: dbl, roomTypeCode: "DBL", lastDate: "2026-12-22" }]);
    expect(await listPriceEnds(pool, tenant.schemaName, propertyId, "2026-12-01")).toEqual([]);
  });
});
