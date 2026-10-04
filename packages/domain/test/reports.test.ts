import { describe, expect, it } from "vitest";
import { addDays } from "../src/rates-grid";
import { convertAmount, datesIn, kpis, lastYearPeriod, occupancyRows, periodOf, previousPeriod, scheduleDue, scheduledRange, type NightFigures } from "../src/reports";

const night = (date: string, occupied: number, available = 10, nrr = occupied * 100): NightFigures => ({ date, available, occupied, netRoomRevenue: nrr, fees: 0, totalRevenue: nrr });

describe("occupancy and revenue figures", () => {
  it("follow the definitions: Occupancy over Available Rooms, ADR and RevPAR on Net Room Revenue", () => {
    // 2 nights, 10 rooms, 1 Out of Order the first night: 9 + 10 available, 6 + 8 occupied, 1,400 net room revenue
    const k = kpis([night("2026-09-01", 6, 9), night("2026-09-02", 8, 10)]);
    expect(k).toMatchObject({ available: 19, occupied: 14, occupancy: 73.7, adr: 100, revpar: 73.68, netRoomRevenue: 1400 });
    expect(kpis([])).toMatchObject({ occupancy: null, adr: null, revpar: null });
  });

  it("periods: weeks start on Monday, months by calendar", () => {
    expect(periodOf("2026-10-04", "week")).toBe("2026-09-28"); // a Sunday
    expect(periodOf("2026-09-28", "week")).toBe("2026-09-28");
    expect(periodOf("2026-10-04", "month")).toBe("2026-10");
    expect(datesIn({ from: "2026-09-29", to: "2026-10-01" })).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
  });

  it("last year is 364 days back, so weekdays align", () => {
    const ly = lastYearPeriod({ from: "2026-10-05", to: "2026-10-11" });
    expect(ly).toMatchObject({ from: "2025-10-06", to: "2025-10-12" });
    const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
    expect(dow(ly.from)).toBe(dow("2026-10-05"));
    expect(previousPeriod({ from: "2026-10-05", to: "2026-10-11" })).toMatchObject({ from: "2026-09-28", to: "2026-10-04", shift: 7 });
  });

  it("comparison nights land in the period they are compared with", () => {
    const week = datesIn({ from: "2026-10-05", to: "2026-10-11" });
    const ly = lastYearPeriod({ from: week[0]!, to: week[6]! });
    const rows = occupancyRows(week.map((d) => night(d, 5)), "week", {
      lastYear: { nights: datesIn(ly).map((d) => night(d, 4)), shift: ly.shift },
      previous: { nights: week.map((d) => night(addDays(d, -7), 2)), shift: 7 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period: "2026-10-05", occupancy: 50, lastYear: { occupancy: 40 }, previous: { occupancy: 20 } });
  });

  it("converts another currency at the stated rate and refuses without one", () => {
    expect(convertAmount(100, "CHF", "EUR", { CHF: 1.06 })).toBe(106);
    expect(convertAmount(100, "EUR", "EUR", {})).toBe(100);
    expect(() => convertAmount(100, "CHF", "EUR", {})).toThrow(/rate for CHF/);
  });
});

describe("scheduled reports", () => {
  it("daily every morning, weekly on Monday, monthly on the 1st, once a day", () => {
    expect(scheduleDue("daily", { date: "2026-10-06", hour: 6 }, null)).toBe(true);
    expect(scheduleDue("daily", { date: "2026-10-06", hour: 5 }, null)).toBe(false);
    expect(scheduleDue("daily", { date: "2026-10-06", hour: 9 }, "2026-10-06")).toBe(false);
    expect(scheduleDue("weekly", { date: "2026-10-05", hour: 7 }, null)).toBe(true); // Monday
    expect(scheduleDue("weekly", { date: "2026-10-06", hour: 7 }, null)).toBe(false);
    expect(scheduleDue("monthly", { date: "2026-11-01", hour: 7 }, null)).toBe(true);
    expect(scheduledRange("weekly", "2026-10-05")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(scheduledRange("monthly", "2026-11-01")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });
});
