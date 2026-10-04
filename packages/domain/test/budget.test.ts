import { describe, expect, it } from "vitest";
import { daysOfMonth, parseBudgetCsv, spreadMonth, weekdayWeights } from "../src/budget";

describe("budget spreading", () => {
  it("a month spreads to days that sum back to the month", () => {
    const days = daysOfMonth(2026, 11);
    const available = Object.fromEntries(days.map((d) => [d, 40]));
    // last year: weekends twice as busy
    const ly = daysOfMonth(2025, 11).map((date) => ({ date, value: [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) ? 200 : 100 }));
    const w = weekdayWeights(ly);
    const spread = spreadMonth(2026, { month: 11, occupancy: 62.5, adr: 120, netRoomRevenue: 90_000.07, totalRevenue: 101_234.55 }, available, w);
    expect(spread).toHaveLength(30);
    const sum = (k: "occupiedRooms" | "netRoomRevenue" | "totalRevenue") => Math.round(spread.reduce((s, d) => s + d[k], 0) * 100) / 100;
    expect(sum("occupiedRooms")).toBe(Math.round(0.625 * 40 * 30));
    expect(sum("netRoomRevenue")).toBe(90_000.07);
    expect(sum("totalRevenue")).toBe(101_234.55);
    // a Saturday carries about twice a Tuesday
    const sat = spread.find((d) => d.date === "2026-11-07")!;
    const tue = spread.find((d) => d.date === "2026-11-03")!;
    expect(sat.netRoomRevenue / tue.netRoomRevenue).toBeCloseTo(2, 1);
  });

  it("without last year every day weighs the same", () => {
    expect(weekdayWeights([])).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
});

describe("budget import", () => {
  it("reads months and figures; decimal commas with semicolons", () => {
    const r = parseBudgetCsv("Monat;Belegung;Rate;Logis;Gesamt\n2027-01;55,5;110,00;60000;70000\n2027-02;60;115;65000,50;80000\n", 2027);
    expect(r.errors).toEqual([]);
    expect(r.months).toEqual([
      { month: 1, occupancy: 55.5, adr: 110, netRoomRevenue: 60000, totalRevenue: 70000 },
      { month: 2, occupancy: 60, adr: 115, netRoomRevenue: 65000.5, totalRevenue: 80000 },
    ]);
  });

  it("German thousands with a point: 12.000 is twelve thousand", () => {
    expect(parseBudgetCsv("2027-01;50;110;12.000;14.500,5", 2027).months[0]).toMatchObject({ netRoomRevenue: 12000, totalRevenue: 14500.5 });
  });

  it("a day without Available Rooms gets no room nights and no revenue", () => {
    const days = daysOfMonth(2026, 11);
    const available = Object.fromEntries(days.map((d) => [d, d <= "2026-11-10" ? 0 : 20]));
    const spread = spreadMonth(2026, { month: 11, occupancy: 50, adr: 100, netRoomRevenue: 20_000, totalRevenue: 25_000 }, available, weekdayWeights([]));
    expect(spread.filter((d) => d.date <= "2026-11-10").every((d) => d.occupiedRooms === 0 && d.netRoomRevenue === 0)).toBe(true);
    expect(spread.every((d) => d.occupiedRooms <= (available[d.date] ?? 0))).toBe(true);
    expect(Math.round(spread.reduce((s, d) => s + d.netRoomRevenue, 0) * 100) / 100).toBe(20_000);
  });

  it("names every bad line: wrong year, bad month, out-of-range occupancy, twice, negative", () => {
    const r = parseBudgetCsv("2026-01,50,100,1,2\n2027-13,50,100,1,2\n2027-03,120,100,1,2\n2027-04,50,100,1,2\n2027-04,50,100,1,2\n2027-05,50,-1,1,2\n", 2027);
    expect(r.errors).toEqual(["line 1: 2026-01 is not in 2027", "line 2: no month 13", "line 3: occupancy between 0 and 100", "line 5: 2027-04 twice", "line 6: figures as numbers, not negative"]);
    expect(r.months.map((m) => m.month)).toEqual([4]);
  });
});
