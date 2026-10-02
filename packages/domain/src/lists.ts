/** Operational list rules: arrivals, departures, in-house, house list, breakfast list. */
import type { MealPlan } from "./rates";

const WITH_BREAKFAST: readonly MealPlan[] = ["breakfast", "half_board", "full_board"];

export function includesBreakfast(mealPlan: MealPlan): boolean {
  return WITH_BREAKFAST.includes(mealPlan);
}

export type PersonsByMealPlan = Record<MealPlan, { adults: number; children: number }>;

/** Persons per Meal Plan, for the kitchen's breakfast count. */
export function personsByMealPlan(rows: { mealPlan: MealPlan; adults: number; children: number }[]): PersonsByMealPlan {
  const out: PersonsByMealPlan = { none: { adults: 0, children: 0 }, breakfast: { adults: 0, children: 0 }, half_board: { adults: 0, children: 0 }, full_board: { adults: 0, children: 0 } };
  for (const r of rows) {
    out[r.mealPlan].adults += r.adults;
    out[r.mealPlan].children += r.children;
  }
  return out;
}

/** Occupancy (figure): rooms taken over rooms, rounded to a whole percent; above 100 when overbooked. */
export function occupancyPercent(taken: number, rooms: number): number {
  return rooms > 0 ? Math.round((taken / rooms) * 100) : 0;
}

/** Sort list rows by a column: numeric strings by value, text by locale, empty values last. */
export function sortRows<T extends Record<string, unknown>>(rows: T[], key: keyof T, direction: "asc" | "desc"): T[] {
  const sign = direction === "asc" ? 1 : -1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === null || x === undefined || x === "") return y === null || y === undefined || y === "" ? 0 : 1;
    if (y === null || y === undefined || y === "") return -1;
    if (typeof x === "number" && typeof y === "number") return sign * (x - y);
    return sign * collator.compare(String(x), String(y));
  });
}
