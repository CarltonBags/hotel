import { describe, expect, it } from "vitest";
import { OPEN_RESTRICTION, type Restriction } from "../src/rates";
import type { GridRow, GridState } from "../src/rates-grid";
import { copySourceDate, parsePaste, planCopyPeriod, planFill, planPaste } from "../src/rates-tools";

const row = (plan: string, type: string, extra: Partial<GridRow> = {}): GridRow => ({ ratePlanId: plan, roomTypeId: type, basePlanId: null, derivation: null, inherits: null, priceFloor: null, ...extra });
const stateOf = (prices: Record<string, number>, restr: Record<string, Partial<Restriction>> = {}): GridState => ({
  price: (p, r, d) => prices[`${p}|${r}|${d}`] ?? null,
  restriction: (p, r, d) => ({ ...OPEN_RESTRICTION, ...restr[`${p}|${r}|${d}`] }),
});

describe("rates grid tools", () => {
  it("reads a block pasted from a spreadsheet, with decimal commas and empty cells", () => {
    expect(parsePaste("120\t130,50\t\n1.234,5\t99.90\t140\n")).toEqual([
      [120, 130.5, null],
      [1234.5, 99.9, 140],
    ]);
    expect(() => parsePaste("120\tabc")).toThrow(/row 1, column 2/);
    // thousands or decimals? refused rather than guessed
    expect(() => parsePaste("1,234")).toThrow(/clear price/);
    expect(() => parsePaste("1.234")).toThrow(/clear price/);
    expect(parsePaste("1.234,00\t1,234.00")).toEqual([[1234, 1234]]);
  });

  it("a 7 by 5 paste lands on the cells from the focused one; derived rows are skipped", () => {
    const rows = [row("A", "x"), row("A", "y"), row("D", "x", { basePlanId: "A", derivation: { kind: "percent", value: -10 } }), row("B", "x"), row("B", "y"), row("C", "x")];
    const block = Array.from({ length: 5 }, (_, i) => Array.from({ length: 7 }, (_, j) => 100 + i * 10 + j));
    // focus on row A|y, 2026-10-29: five rows down are A|y, D|x (derived), B|x, B|y, C|x
    const plan = planPaste(block, rows, 1, "2026-10-29", stateOf({ "A|y|2026-10-29": 100 }));
    expect(plan.preview).toMatchObject({ cells: 27, rows: 4, skippedDerived: 7, outside: 0 });
    expect(plan.prices.find((p) => p.ratePlanId === "B" && p.roomTypeId === "x" && p.date === "2026-10-29")?.price).toBe(120);
    expect(plan.prices.find((p) => p.ratePlanId === "C" && p.date === "2026-11-04")?.price).toBe(146);
    // a block running past the last row counts the cells left out
    expect(planPaste(block, rows, 3, "2026-10-29", stateOf({})).preview.outside).toBe(14);
  });

  it("copies by weekday across a month boundary", () => {
    // source: Monday 26 Oct to Sunday 8 Nov; target from Wednesday 25 Nov
    expect(copySourceDate({ from: "2026-10-26", to: "2026-11-08" }, "2026-11-25", "2026-11-25")).toBe("2026-10-28");
    expect(copySourceDate({ from: "2026-10-26", to: "2026-11-08" }, "2026-11-25", "2026-11-30")).toBe("2026-11-02");
    const state = stateOf({ "A|x|2026-10-30": 150, "A|x|2026-10-31": 180, "A|x|2026-11-02": 99 }, { "A|x|2026-10-31": { minStayArrival: 2 } });
    const plan = planCopyPeriod({ rows: [row("A", "x")], source: { from: "2026-10-26", to: "2026-11-08" }, targetFrom: "2026-11-25" }, state);
    const at = (d: string) => plan.prices.find((p) => p.date === d)?.price;
    // Friday and Saturday take Friday's and Saturday's prices, Monday Monday's
    expect([at("2026-11-27"), at("2026-11-28"), at("2026-11-30")]).toEqual([150, 180, 99]);
    expect(plan.restrictions.find((r) => r.date === "2026-11-28")?.patch).toMatchObject({ minStayArrival: 2 });
  });

  it("copies a range onto itself shifted by a week from the values before the copy; inherited fields stay with the base", () => {
    const prices: Record<string, number> = {};
    for (let i = 0; i < 14; i++) prices[`A|x|2026-11-${String(2 + i).padStart(2, "0")}`] = 100 + i;
    const derived = row("D", "x", { basePlanId: "A", derivation: { kind: "percent", value: -10 }, inherits: { stopSell: true, closedToArrival: true, closedToDeparture: true, minStayArrival: false, minStayThrough: true, maxStay: true } });
    const state = stateOf(prices, { "D|x|2026-11-02": { minStayArrival: 3, stopSell: true } });
    const plan = planCopyPeriod({ rows: [row("A", "x"), derived], source: { from: "2026-11-02", to: "2026-11-15" }, targetFrom: "2026-11-09" }, state);
    // 9 Nov takes 2 Nov's old price, 15 Nov takes 8 Nov's: the overlap copies values from before
    expect(plan.prices.find((p) => p.date === "2026-11-09")?.price).toBe(100);
    expect(plan.prices.find((p) => p.date === "2026-11-15")?.price).toBe(106);
    expect(plan.prices).toHaveLength(14);
    // only the derived row's own field is copied, not the inherited stop sell
    expect(plan.restrictions.find((r) => r.ratePlanId === "D" && r.date === "2026-11-09")?.patch).toEqual({ minStayArrival: 3 });
  });

  it("fills to the horizon by repeating the last full week, or base price with weekend factor", () => {
    const week: Record<string, number> = {};
    // Monday 2 Nov … Sunday 8 Nov 2026
    [100, 101, 102, 103, 150, 160, 104].forEach((p, i) => (week[`A|x|2026-11-0${i + 2}`] = p));
    const repeat = planFill({ rows: [{ ratePlanId: "A", roomTypeId: "x", lastDate: "2026-11-08" }], from: "2026-10-01", horizon: "2026-11-22", mode: { kind: "repeat_week" } }, stateOf(week));
    expect(repeat.prices.length).toBe(14);
    expect(repeat.prices.find((p) => p.date === "2026-11-13")?.price).toBe(150);
    expect(repeat.prices.find((p) => p.date === "2026-11-22")?.price).toBe(104);
    const base = planFill({ rows: [{ ratePlanId: "A", roomTypeId: "x", lastDate: null }], from: "2026-11-02", horizon: "2026-11-08", mode: { kind: "base", price: 100, weekendFactor: 1.2 } }, stateOf({}));
    expect(base.prices.map((p) => p.price)).toEqual([100, 100, 100, 100, 120, 120, 100]);
    // no full last week: the row is left out and named
    const short = planFill({ rows: [{ ratePlanId: "A", roomTypeId: "x", lastDate: "2026-11-08" }], from: "2026-10-01", horizon: "2026-11-22", mode: { kind: "repeat_week" } }, stateOf({ "A|x|2026-11-08": 1 }));
    expect(short.skipped).toEqual([{ ratePlanId: "A", roomTypeId: "x" }]);
  });
});
