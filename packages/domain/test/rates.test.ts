import { describe, expect, it } from "vitest";
import {
  CHANNEL_LIMITS,
  checkPlanLimits,
  derivedPrice,
  effectiveRestriction,
  occupancyPrice,
  occupancyPrices,
  type Restriction,
} from "../src/rates";

/** Seam: pure rate rules (ADR 0012, "Rates and restrictions model"). */
describe("derived prices", () => {
  it("follows a base by amount or percentage, rounded to cents, never below zero", () => {
    expect(derivedPrice(100, { kind: "amount", value: -10 })).toBe(90);
    expect(derivedPrice(100, { kind: "percent", value: -15 })).toBe(85);
    expect(derivedPrice(99.99, { kind: "percent", value: 10 })).toBe(109.99);
    expect(derivedPrice(5, { kind: "amount", value: -10 })).toBe(0);
  });
});

describe("occupancy pricing", () => {
  // rate 120 at base occupancy 2; single -20; extra adult +35; child 0-2 free, 3-11 +15
  const bands = [
    { id: "baby", minAge: 0, maxAge: 2 },
    { id: "child", minAge: 3, maxAge: 11 },
    { id: "teen", minAge: 12, maxAge: null },
  ];
  const supplements = [
    { kind: "single" as const, amount: -20 },
    { kind: "extra_adult" as const, amount: 35 },
    { kind: "child" as const, ageBandId: "baby", amount: 0 },
    { kind: "child" as const, ageBandId: "child", amount: 15 },
    { kind: "child" as const, ageBandId: "teen", amount: 35 },
  ];
  const plan = { rate: 120, baseOccupancy: 2, supplements };

  it("matches the hand calculation for 1, 2, 3 adults and one child", () => {
    expect(occupancyPrice(plan, { adults: 1, childAges: [] }, bands)).toBe(100);
    expect(occupancyPrice(plan, { adults: 2, childAges: [] }, bands)).toBe(120);
    expect(occupancyPrice(plan, { adults: 3, childAges: [] }, bands)).toBe(155);
    expect(occupancyPrice(plan, { adults: 2, childAges: [7] }, bands)).toBe(135);
    expect(occupancyPrice(plan, { adults: 2, childAges: [1] }, bands)).toBe(120);
    expect(occupancyPrice(plan, { adults: 1, childAges: [14, 7] }, bands)).toBe(150);
  });

  it("a child outside every age band counts as an adult", () => {
    expect(occupancyPrice(plan, { adults: 2, childAges: [7] }, [])).toBe(155);
  });

  it("lists adult-only prices up to the room type's max adults for channels", () => {
    expect(occupancyPrices(plan, 4)).toEqual([
      { adults: 1, price: 100 },
      { adults: 2, price: 120 },
      { adults: 3, price: 155 },
      { adults: 4, price: 190 },
    ]);
  });
});

describe("restriction inheritance", () => {
  const base: Restriction = { stopSell: true, closedToArrival: false, closedToDeparture: true, minStayArrival: 3, minStayThrough: null, maxStay: 7 };
  const own: Restriction = { stopSell: false, closedToArrival: true, closedToDeparture: false, minStayArrival: null, minStayThrough: 2, maxStay: null };

  it("takes each field from the base when the derived plan inherits it, else its own", () => {
    const inherits = { stopSell: true, closedToArrival: false, closedToDeparture: true, minStayArrival: true, minStayThrough: false, maxStay: false };
    expect(effectiveRestriction(own, base, inherits)).toEqual({ stopSell: true, closedToArrival: true, closedToDeparture: true, minStayArrival: 3, minStayThrough: 2, maxStay: null });
  });
});

describe("channel limits", () => {
  it("counts projected rate plans as plan times room types and holds the limits", () => {
    expect(CHANNEL_LIMITS).toEqual({ roomTypes: 20, projectedRatePlans: 200 });
    expect(checkPlanLimits({ roomTypes: 20, projectedRatePlans: 200 })).toBeNull();
    expect(checkPlanLimits({ roomTypes: 21, projectedRatePlans: 10 })).toMatch(/20 room types/);
    expect(checkPlanLimits({ roomTypes: 5, projectedRatePlans: 201 })).toMatch(/200/);
  });
});
