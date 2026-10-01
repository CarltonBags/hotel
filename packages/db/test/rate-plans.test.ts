import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, listRoomTypes, saveAgeBands, updateRoomType } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy, listCancellationPolicies, listPaymentPolicies } from "../src/tenant/policies";
import { createRatePlan, findRatePlan, listRatePlans, updateRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { closeProperty, closeRoomType, listRateChanges, listRates, listRestrictions, setRates, setRestrictions } from "../src/tenant/rates";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: policies per property; Rate Plans spanning room types with Supplements
 * and included Services; one-level derivation with stored daily values; Rates
 * and Restrictions per plan, room type and date with a change log.
 */
describe("rate plans, rates and restrictions", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId: string;
  let dbl: string;
  let sgl: string;
  let childBand: string;
  let payId: string;
  let cxlId: string;
  let brk: string;
  let bar: RatePlan;
  let nr: RatePlan;
  const user = "user_rita";

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = await createLegalEntity(pool, tenant.schemaName, { name: "Alpha GmbH", country: "DE" });
    propertyId = (await createProperty(pool, tenant.schemaName, { name: "Alpha Berlin", legalEntityId: le.id, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, tenant.schemaName, { propertyId, code: "DBL", name: "Doppelzimmer", maxOccupancy: 4, maxAdults: 3, bedPlaces: 2, extraBeds: 1 })).id;
    sgl = (await createRoomType(pool, tenant.schemaName, { propertyId, code: "SGL", name: "Einzelzimmer", maxOccupancy: 2, maxAdults: 2, bedPlaces: 1, extraBeds: 0 })).id;
    const bands = await saveAgeBands(pool, tenant.schemaName, propertyId, [
      { name: "Baby", minAge: 0, maxAge: 2 },
      { name: "Kind", minAge: 3, maxAge: 11 },
      { name: "Jugend", minAge: 12, maxAge: null },
    ]);
    childBand = bands[1]!.id;
    await applyTaxPreset(pool, tenant.schemaName, le.id, "DE");
    const food = (await listTaxCodes(pool, tenant.schemaName, le.id)).find((c) => c.code === "FOOD")!;
    brk = (await createService(pool, tenant.schemaName, { propertyId, code: "BRK", name: "Frühstück", defaultPrice: 18.5, taxCodeId: food.id, revenueAccount: "8400", postingRhythm: "per_person_night", bookableOnline: false })).id;
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("creates reusable Payment and Cancellation Policies per property", async () => {
    payId = (await createPaymentPolicy(pool, tenant.schemaName, { propertyId, name: "Card guarantee", kind: "card_guarantee" })).id;
    await createPaymentPolicy(pool, tenant.schemaName, { propertyId, name: "30 % deposit", kind: "deposit_percent", depositPercent: 30 });
    await expect(createPaymentPolicy(pool, tenant.schemaName, { propertyId, name: "Bad", kind: "deposit_percent" })).rejects.toThrow(/percent/i);
    cxlId = (
      await createCancellationPolicy(pool, tenant.schemaName, {
        propertyId,
        name: "Free until 1 day before 18:00",
        freeUntilDays: 1,
        freeUntilTime: "18:00",
        feeKind: "first_night",
        noShowFeeKind: "full_stay",
      })
    ).id;
    expect((await listPaymentPolicies(pool, tenant.schemaName, propertyId)).map((p) => p.name)).toEqual(["30 % deposit", "Card guarantee"]);
    expect((await listCancellationPolicies(pool, tenant.schemaName, propertyId))[0]).toMatchObject({ freeUntilDays: 1, freeUntilTime: "18:00", feeKind: "first_night", feePercent: null });
  });

  it("creates a Base Rate Plan spanning room types with Supplements and an included Service", async () => {
    bar = await createRatePlan(pool, tenant.schemaName, {
      propertyId,
      code: "BAR",
      name: "Flexible Rate",
      names: { en: "Flexible Rate", de: "Flexible Rate" },
      kind: "base",
      roomTypeIds: [dbl, sgl],
      baseOccupancy: 2,
      mealPlan: "breakfast",
      paymentPolicyId: payId,
      cancellationPolicyId: cxlId,
      supplements: [
        { kind: "single", amount: -20 },
        { kind: "extra_adult", amount: 35 },
        { kind: "child", ageBandId: childBand, amount: 15 },
      ],
      includedServices: [{ serviceId: brk, componentPrice: 12 }],
    });
    expect(bar.roomTypeIds.sort()).toEqual([dbl, sgl].sort());
    expect(bar.supplements).toHaveLength(3);
    expect(bar.includedServices).toEqual([{ serviceId: brk, serviceCode: "BRK", componentPrice: 12 }]);
    expect(bar.kind).toBe("base");
    expect(bar.names).toEqual({ en: "Flexible Rate", de: "Flexible Rate" });
  });

  it("base occupancy never exceeds a spanned room type's max adults", async () => {
    await expect(
      createRatePlan(pool, tenant.schemaName, { propertyId, code: "TRIPLE", name: "Triple", kind: "base", roomTypeIds: [dbl, sgl], baseOccupancy: 3, paymentPolicyId: payId, cancellationPolicyId: cxlId }),
    ).rejects.toThrow(/above the max adults of SGL/);
  });

  it("a hidden plan needs a Rate Code; a derived plan follows exactly one base plan", async () => {
    await expect(createRatePlan(pool, tenant.schemaName, { propertyId, code: "HID", name: "Hidden", kind: "base", roomTypeIds: [dbl], paymentPolicyId: payId, cancellationPolicyId: cxlId, public: false })).rejects.toThrow(/Rate Code/);
    nr = await createRatePlan(pool, tenant.schemaName, {
      propertyId,
      code: "NR",
      name: "Non-refundable",
      kind: "derived",
      basePlanId: bar.id,
      derivation: { kind: "percent", value: -10 },
      inherits: { stopSell: true, closedToArrival: false, closedToDeparture: false, minStayArrival: true, minStayThrough: true, maxStay: true },
      roomTypeIds: [dbl],
      paymentPolicyId: payId,
      cancellationPolicyId: cxlId,
    });
    expect(nr.basePlanId).toBe(bar.id);
    await expect(
      createRatePlan(pool, tenant.schemaName, { propertyId, code: "NR2", name: "Twice derived", kind: "derived", basePlanId: nr.id, derivation: { kind: "amount", value: -5 }, roomTypeIds: [dbl], paymentPolicyId: payId, cancellationPolicyId: cxlId }),
    ).rejects.toThrow(/derived plan cannot be the parent/i);
    await expect(updateRatePlan(pool, tenant.schemaName, propertyId, bar.id, { kind: "derived", basePlanId: nr.id, derivation: { kind: "amount", value: -5 } })).rejects.toThrow(/parent|base/i);
    await expect(updateRatePlan(pool, tenant.schemaName, propertyId, nr.id, { roomTypeIds: [dbl, sgl, dbl] })).resolves.toBeTruthy();
    await updateRatePlan(pool, tenant.schemaName, propertyId, nr.id, { roomTypeIds: [dbl] });
    expect((await listRatePlans(pool, tenant.schemaName, propertyId)).map((p) => p.code)).toEqual(["BAR", "NR"]);
  });

  it("writes base prices, rewrites the derived plan's stored prices and logs both", async () => {
    const result = await setRates(pool, tenant.schemaName, propertyId, user, [
      { ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-01", price: 120 },
      { ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-02", price: 150 },
      { ratePlanId: bar.id, roomTypeId: sgl, date: "2026-12-01", price: 80 },
    ]);
    expect(result.written).toBe(3);
    expect(result.derived).toBe(2); // NR spans only DBL
    const barRates = await listRates(pool, tenant.schemaName, propertyId, { from: "2026-12-01", to: "2026-12-02" });
    expect(barRates.filter((r) => r.ratePlanId === nr.id).map((r) => [r.date, r.price])).toEqual([
      ["2026-12-01", 108],
      ["2026-12-02", 135],
    ]);
    const log = await listRateChanges(pool, tenant.schemaName, propertyId, { changeId: result.changeId });
    expect(log).toHaveLength(5);
    expect(log.filter((c) => c.reason === "derived")).toHaveLength(2);
    expect(log.find((c) => c.ratePlanId === bar.id && c.date === "2026-12-01" && c.roomTypeId === dbl)).toMatchObject({ field: "price", oldValue: null, newValue: "120.00", userId: user });

    // a second write records the old value
    const again = await setRates(pool, tenant.schemaName, propertyId, user, [{ ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-01", price: 130 }]);
    const log2 = await listRateChanges(pool, tenant.schemaName, propertyId, { changeId: again.changeId });
    expect(log2.find((c) => c.ratePlanId === nr.id)).toMatchObject({ oldValue: "108.00", newValue: "117.00", reason: "derived" });
  });

  it("refuses to write prices into a derived plan or into a room type the plan does not span", async () => {
    await expect(setRates(pool, tenant.schemaName, propertyId, user, [{ ratePlanId: nr.id, roomTypeId: dbl, date: "2026-12-01", price: 99 }])).rejects.toThrow(/derived/i);
    await expect(setRates(pool, tenant.schemaName, propertyId, user, [{ ratePlanId: nr.id, roomTypeId: sgl, date: "2026-12-01", price: 99 }])).rejects.toThrow(/derived|room type/i);
    await expect(setRates(pool, tenant.schemaName, propertyId, user, [{ ratePlanId: bar.id, roomTypeId: "00000000-0000-4000-8000-000000000000", date: "2026-12-01", price: 99 }])).rejects.toThrow(/room type/i);
  });

  it("changing the derivation rewrites every stored derived price", async () => {
    await updateRatePlan(pool, tenant.schemaName, propertyId, nr.id, { derivation: { kind: "amount", value: -30 } });
    const rates = await listRates(pool, tenant.schemaName, propertyId, { from: "2026-12-01", to: "2026-12-02", ratePlanId: nr.id });
    expect(rates.map((r) => r.price)).toEqual([100, 120]);
  });

  it("restrictions are stored per plan, room type and date; a derived plan inherits chosen fields", async () => {
    await setRestrictions(pool, tenant.schemaName, propertyId, user, [
      { ratePlanId: bar.id, roomTypeId: dbl, date: "2026-12-01", patch: { minStayArrival: 3, closedToArrival: true } },
      { ratePlanId: nr.id, roomTypeId: dbl, date: "2026-12-01", patch: { closedToArrival: false, maxStay: 5 } },
    ]);
    const eff = await listRestrictions(pool, tenant.schemaName, propertyId, { from: "2026-12-01", to: "2026-12-01" });
    const nrCell = eff.find((r) => r.ratePlanId === nr.id && r.roomTypeId === dbl)!;
    // minStayArrival and maxStay inherited from BAR (maxStay null there), closedToArrival own
    expect(nrCell.restriction).toEqual({ stopSell: false, closedToArrival: false, closedToDeparture: false, minStayArrival: 3, minStayThrough: null, maxStay: null });
    expect(nrCell.own.maxStay).toBe(5);
  });

  it("closing the property writes stop sell into every plan for the chosen dates", async () => {
    const r = await closeProperty(pool, tenant.schemaName, propertyId, user, { from: "2026-12-24", to: "2026-12-25" });
    expect(r.written).toBe(6); // BAR×DBL, BAR×SGL, NR×DBL over two dates
    const eff = await listRestrictions(pool, tenant.schemaName, propertyId, { from: "2026-12-24", to: "2026-12-25" });
    expect(eff).toHaveLength(6);
    expect(eff.every((c) => c.restriction.stopSell)).toBe(true);
    await closeRoomType(pool, tenant.schemaName, propertyId, user, sgl, { from: "2026-12-26", to: "2026-12-26" });
    const sglOnly = await listRestrictions(pool, tenant.schemaName, propertyId, { from: "2026-12-26", to: "2026-12-26" });
    expect(sglOnly.map((c) => c.roomTypeId)).toEqual([sgl]);
  });

  it("a derived plan spans only room types of its base; the base dropping one narrows the derived plan and logs the lost cells", async () => {
    await expect(updateRatePlan(pool, tenant.schemaName, propertyId, nr.id, { roomTypeIds: [dbl, "00000000-0000-4000-8000-000000000000"] })).rejects.toThrow(/belong to this property/);
    await updateRatePlan(pool, tenant.schemaName, propertyId, nr.id, { roomTypeIds: [dbl, sgl] });
    expect((await listRates(pool, tenant.schemaName, propertyId, { from: "2026-12-01", to: "2026-12-01", ratePlanId: nr.id })).map((r) => r.roomTypeId).sort()).toEqual([dbl, sgl].sort());
    await updateRatePlan(pool, tenant.schemaName, propertyId, bar.id, { roomTypeIds: [dbl] });
    expect((await findRatePlan(pool, tenant.schemaName, propertyId, nr.id))!.roomTypeIds).toEqual([dbl]);
    expect(await listRates(pool, tenant.schemaName, propertyId, { from: "2026-12-01", to: "2026-12-02", roomTypeId: sgl })).toEqual([]);
    const removed = (await listRateChanges(pool, tenant.schemaName, propertyId)).filter((c) => c.reason === "room_type_removed");
    expect(removed.some((c) => c.ratePlanId === bar.id && c.roomTypeId === sgl && c.field === "price" && c.oldValue === "80.00" && c.newValue === null)).toBe(true);
    expect(removed.some((c) => c.ratePlanId === nr.id && c.roomTypeId === sgl && c.field === "price")).toBe(true);
    await expect(updateRatePlan(pool, tenant.schemaName, propertyId, nr.id, { roomTypeIds: [dbl, sgl] })).rejects.toThrow(/only room types of its base/);
    await updateRatePlan(pool, tenant.schemaName, propertyId, bar.id, { roomTypeIds: [dbl, sgl] });
  });

  it("Price Floor is set per room type", async () => {
    await updateRoomType(pool, tenant.schemaName, propertyId, dbl, { priceFloor: 79 });
    expect((await listRoomTypes(pool, tenant.schemaName, propertyId)).find((t) => t.id === dbl)?.priceFloor).toBe(79);
    const plan = await findRatePlan(pool, tenant.schemaName, propertyId, bar.id);
    expect(plan?.roomTypeIds).toContain(dbl);
  });

  it("holds the channel limit of 20 room types per property", async () => {
    for (let i = 3; i <= 20; i++) await createRoomType(pool, tenant.schemaName, { propertyId, code: `T${i}`, name: `Type ${i}`, maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 });
    await expect(createRoomType(pool, tenant.schemaName, { propertyId, code: "T21", name: "Too many", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).rejects.toThrow(/20 room types/);
  });
});
