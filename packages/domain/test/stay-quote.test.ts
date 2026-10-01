import { describe, expect, it } from "vitest";
import { OPEN_RESTRICTION } from "../src/rates";
import { nightsOf, quoteStay, type QuoteInput } from "../src/stay-quote";

/** Seam: pricing and bookability of one stay on one room type and rate plan (the screen shows it, the save stores it). */
describe("stay quote", () => {
  const bands = [
    { id: "baby", minAge: 0, maxAge: 2 },
    { id: "child", minAge: 3, maxAge: 11 },
    { id: "teen", minAge: 12, maxAge: null },
  ];
  const base: QuoteInput = {
    arrival: "2026-12-07",
    departure: "2026-12-10",
    adults: 2,
    childAges: [],
    roomType: { maxAdults: 3, maxOccupancy: 4 },
    plan: {
      baseOccupancy: 2,
      supplements: [
        { kind: "single", amount: -20 },
        { kind: "extra_adult", amount: 35 },
        { kind: "child", ageBandId: "baby", amount: 0 },
        { kind: "child", ageBandId: "child", amount: 15 },
      ],
      includedServices: [{ serviceId: "brk", componentPrice: 12 }],
    },
    ageBands: bands,
    rate: (d) => ({ "2026-12-07": 120, "2026-12-08": 120, "2026-12-09": 150 })[d] ?? null,
    restriction: () => OPEN_RESTRICTION,
    available: () => 3,
  };

  it("lists the nights from arrival to the night before departure", () => {
    expect(nightsOf("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(() => nightsOf("2026-12-07", "2026-12-07")).toThrow(/after arrival/);
  });

  it("prices each night with Supplements and splits it into room and included services", () => {
    const q = quoteStay(base);
    expect(q.bookable).toBe(true);
    expect(q.nights.map((n) => n.total)).toEqual([120, 120, 150]);
    // breakfast 12 per person-night for 2 persons, the room gets the rest
    expect(q.nights[0]!.components).toEqual([
      { kind: "room", serviceId: null, persons: null, unitPrice: 96, amount: 96 },
      { kind: "service", serviceId: "brk", persons: 2, unitPrice: 12, amount: 24 },
    ]);
    expect(q.total).toBe(390);
  });

  it("Supplements for 3 adults and one child match the plan", () => {
    const q = quoteStay({ ...base, adults: 3, childAges: [7] });
    // 120 + 35 extra adult + 15 child = 170; 150 + 50 = 200
    expect(q.nights.map((n) => n.total)).toEqual([170, 170, 200]);
    expect(q.nights[0]!.components.find((c) => c.kind === "service")).toMatchObject({ persons: 4, amount: 48 });
    expect(q.nights[0]!.components.find((c) => c.kind === "room")!.amount).toBe(122);
  });

  it("validates occupancy against the room type; a child outside every Age Band counts as an adult", () => {
    expect(quoteStay({ ...base, adults: 4 }).reasons).toContain("too_many_adults");
    expect(quoteStay({ ...base, adults: 3, childAges: [5, 6] }).reasons).toContain("too_many_persons");
    expect(quoteStay({ ...base, adults: 3, childAges: [5], ageBands: [] }).reasons).toContain("too_many_adults");
    expect(quoteStay({ ...base, adults: 0 }).reasons).toContain("no_adult");
  });

  it("a room type with zero availability on any night cannot be booked", () => {
    const q = quoteStay({ ...base, available: (d) => (d === "2026-12-08" ? 0 : 5) });
    expect(q.bookable).toBe(false);
    expect(q.reasons).toEqual(["sold_out"]);
    expect(q.available).toBe(0);
  });

  it("a night without a price, and Restrictions, make the stay unbookable", () => {
    expect(quoteStay({ ...base, departure: "2026-12-11" }).reasons).toContain("no_price");
    const r = (over: Partial<typeof OPEN_RESTRICTION>, on?: string) => (d: string) => (on === undefined || d === on ? { ...OPEN_RESTRICTION, ...over } : OPEN_RESTRICTION);
    expect(quoteStay({ ...base, restriction: r({ stopSell: true }, "2026-12-08") }).reasons).toEqual(["stop_sell"]);
    expect(quoteStay({ ...base, restriction: r({ closedToArrival: true }, "2026-12-07") }).reasons).toEqual(["closed_to_arrival"]);
    expect(quoteStay({ ...base, restriction: r({ closedToArrival: true }, "2026-12-08") }).bookable).toBe(true);
    // closed to departure is read on the departure date
    expect(quoteStay({ ...base, restriction: r({ closedToDeparture: true }, "2026-12-10") }).reasons).toEqual(["closed_to_departure"]);
    expect(quoteStay({ ...base, restriction: r({ minStayArrival: 4 }, "2026-12-07") }).reasons).toEqual(["min_stay"]);
    expect(quoteStay({ ...base, restriction: r({ minStayThrough: 5 }, "2026-12-09") }).reasons).toEqual(["min_stay"]);
    expect(quoteStay({ ...base, restriction: r({ maxStay: 2 }, "2026-12-07") }).reasons).toEqual(["max_stay"]);
  });

  it("refuses included services worth more than the night", () => {
    const q = quoteStay({ ...base, plan: { ...base.plan, includedServices: [{ serviceId: "brk", componentPrice: 70 }] } });
    expect(q.reasons).toContain("components_exceed_price");
  });
});
