import { describe, expect, it } from "vitest";
import { OPEN_RESTRICTION, type Restriction } from "../src/rates";
import { addDays, planBulkEdit, weekdayIndex, type GridRow, type GridState } from "../src/rates-grid";

/** Seam: the bulk edit planner shared by the preview (browser) and Apply (server). */
describe("bulk edit planner", () => {
  const BAR = "bar", NR = "nr", DBL = "dbl", SGL = "sgl";
  const rows: GridRow[] = [
    { ratePlanId: BAR, roomTypeId: DBL, basePlanId: null, derivation: null, inherits: null, priceFloor: 99 },
    { ratePlanId: BAR, roomTypeId: SGL, basePlanId: null, derivation: null, inherits: null, priceFloor: null },
    {
      ratePlanId: NR,
      roomTypeId: DBL,
      basePlanId: BAR,
      derivation: { kind: "percent", value: -10 },
      inherits: { stopSell: true, closedToArrival: false, closedToDeparture: true, minStayArrival: true, minStayThrough: true, maxStay: true },
      priceFloor: 99,
    },
  ];
  // Mon 2026-12-07 .. Sun 2026-12-13
  const dates = ["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-13"];
  const prices = new Map<string, number>();
  for (const d of dates) {
    prices.set(`${BAR}|${DBL}|${d}`, 120);
    prices.set(`${BAR}|${SGL}|${d}`, 80);
  }
  const own = new Map<string, Restriction>([[`${BAR}|${DBL}|2026-12-09`, { ...OPEN_RESTRICTION, maxStay: 2 }]]);
  const state: GridState = { price: (p, r, d) => prices.get(`${p}|${r}|${d}`) ?? null, restriction: (p, r, d) => own.get(`${p}|${r}|${d}`) ?? OPEN_RESTRICTION };
  const all = [true, true, true, true, true, true, true];

  it("weekdays start on Monday and dates step in UTC", () => {
    expect(weekdayIndex("2026-12-07")).toBe(0);
    expect(weekdayIndex("2026-12-13")).toBe(6);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("a percentage on two base rows over weekdays only changes ten cells; derived rows follow", () => {
    const plan = planBulkEdit(
      { rows: [{ ratePlanId: BAR, roomTypeId: DBL }, { ratePlanId: BAR, roomTypeId: SGL }], from: dates[0]!, to: dates[6]!, weekdays: [true, true, true, true, true, false, false], price: { action: "percent", value: -25 }, restriction: null },
      rows,
      state,
    );
    expect(plan.preview.cells).toBe(10);
    expect(plan.preview.rows).toBe(2);
    expect(plan.preview.min).toBe(60);
    expect(plan.preview.max).toBe(90);
    expect(plan.preview.derivedFollowing).toBe(1);
    // DBL 90 < floor 99 on five days; NR follows at 81 < 99 on five days
    expect(plan.preview.belowFloor).toBe(10);
    expect(plan.prices).toHaveLength(10);
  });

  it("a selected derived row is changed through its base, counted once", () => {
    const plan = planBulkEdit(
      { rows: [{ ratePlanId: NR, roomTypeId: DBL }, { ratePlanId: BAR, roomTypeId: DBL }], from: dates[0]!, to: dates[1]!, weekdays: all, price: { action: "set", value: 150 }, restriction: null },
      rows,
      state,
    );
    expect(plan.preview.derivedSelected).toBe(1);
    expect(plan.preview.cells).toBe(2);
    expect(plan.prices.every((c) => c.ratePlanId === BAR)).toBe(true);
  });

  it("restrictions go to the base when the derived row inherits the field, else to the derived row", () => {
    const inherited = planBulkEdit(
      { rows: [{ ratePlanId: NR, roomTypeId: DBL }], from: dates[0]!, to: dates[0]!, weekdays: all, price: { action: "keep", value: 0 }, restriction: { field: "stopSell", value: true } },
      rows,
      state,
    );
    expect(inherited.restrictions).toEqual([{ ratePlanId: BAR, roomTypeId: DBL, date: dates[0], patch: { stopSell: true } }]);
    const own = planBulkEdit(
      { rows: [{ ratePlanId: NR, roomTypeId: DBL }], from: dates[0]!, to: dates[0]!, weekdays: all, price: { action: "keep", value: 0 }, restriction: { field: "closedToArrival", value: true } },
      rows,
      state,
    );
    expect(own.restrictions).toEqual([{ ratePlanId: NR, roomTypeId: DBL, date: dates[0], patch: { closedToArrival: true } }]);
  });

  it("counts only cells whose value changes, and flags minimum stay above maximum stay", () => {
    const plan = planBulkEdit(
      { rows: [{ ratePlanId: BAR, roomTypeId: DBL }], from: dates[0]!, to: dates[2]!, weekdays: all, price: { action: "set", value: 120 }, restriction: { field: "minStayArrival", value: 3 } },
      rows,
      state,
    );
    expect(plan.prices).toHaveLength(0); // already 120
    expect(plan.restrictions).toHaveLength(3);
    expect(plan.preview.cells).toBe(3);
    expect(plan.preview.rows).toBe(1); // a restriction-only change still names its row
    expect(plan.preview.minAboveMax).toBe(1); // 2026-12-09 has max stay 2
  });

  it("amount and percent leave empty cells empty; a negative result is refused", () => {
    const empty = planBulkEdit(
      { rows: [{ ratePlanId: BAR, roomTypeId: DBL }], from: "2026-12-14", to: "2026-12-14", weekdays: all, price: { action: "amount", value: 10 }, restriction: null },
      rows,
      state,
    );
    expect(empty.preview.cells).toBe(0);
    expect(empty.preview.derivedSelected).toBe(0);
    const neg = planBulkEdit(
      { rows: [{ ratePlanId: BAR, roomTypeId: SGL }], from: dates[0]!, to: dates[0]!, weekdays: all, price: { action: "amount", value: -100 }, restriction: null },
      rows,
      state,
    );
    expect(neg.preview.negative).toBe(1);
  });
});
