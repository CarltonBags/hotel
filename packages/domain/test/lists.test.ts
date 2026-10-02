import { describe, expect, it } from "vitest";
import { includesBreakfast, occupancyPercent, personsByMealPlan, sortRows } from "../src/lists";

/** Seams: operational list rules (breakfast counts per Meal Plan, Occupancy figure, list sorting). */
describe("operational lists", () => {
  it("breakfast is part of breakfast, half board and full board", () => {
    expect(["none", "breakfast", "half_board", "full_board"].map((m) => includesBreakfast(m as never))).toEqual([false, true, true, true]);
  });

  it("counts persons per Meal Plan", () => {
    expect(
      personsByMealPlan([
        { mealPlan: "breakfast", adults: 2, children: 1 },
        { mealPlan: "breakfast", adults: 1, children: 0 },
        { mealPlan: "half_board", adults: 2, children: 0 },
        { mealPlan: "none", adults: 2, children: 2 },
      ]),
    ).toEqual({ none: { adults: 2, children: 2 }, breakfast: { adults: 3, children: 1 }, half_board: { adults: 2, children: 0 }, full_board: { adults: 0, children: 0 } });
  });

  it("Occupancy is occupied rooms over rooms, as a whole percent", () => {
    expect(occupancyPercent(17, 21)).toBe(81);
    expect(occupancyPercent(0, 0)).toBe(0);
    expect(occupancyPercent(22, 21)).toBe(105);
  });

  it("sorts rows by a column, numbers as numbers, missing values last", () => {
    const rows = [{ room: "110", n: 2 }, { room: "9", n: 10 }, { room: null, n: 1 }];
    expect(sortRows(rows, "room", "asc").map((r) => r.room)).toEqual(["9", "110", null]);
    expect(sortRows(rows, "n", "desc").map((r) => r.n)).toEqual([10, 2, 1]);
  });
});
