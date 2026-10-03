import { describe, expect, it } from "vitest";
import { AGEING_BUCKETS, ageing, daysOverdue, nextReminderLevel } from "../src/index";

/** Seams: days overdue, ageing buckets that add up to the open total, the next reminder level. */
describe("receivables", () => {
  const today = "2026-10-03";
  const rows = [
    { open: 100, dueDate: "2026-10-10" }, // not due
    { open: 50, dueDate: "2026-10-03" }, // due today: not overdue
    { open: 30.5, dueDate: "2026-09-20" }, // 13 days
    { open: 20, dueDate: "2026-08-20" }, // 44 days
    { open: 10, dueDate: "2026-07-20" }, // 75 days
    { open: 5.25, dueDate: "2026-05-01" }, // 155 days
  ];

  it("counts days past the due date", () => {
    expect(daysOverdue("2026-09-20", today)).toBe(13);
    expect(daysOverdue("2026-10-10", today)).toBe(0);
  });

  it("ageing buckets add up to the open total", () => {
    const a = ageing(rows, today);
    expect(AGEING_BUCKETS).toEqual(["current", "1_30", "31_60", "61_90", "over_90"]);
    expect(a).toEqual({ current: 150, "1_30": 30.5, "31_60": 20, "61_90": 10, over_90: 5.25, total: 215.75 });
    expect(a.current + a["1_30"] + a["31_60"] + a["61_90"] + a.over_90).toBe(a.total);
  });

  it("reminders go up one level at a time, to 3", () => {
    expect(nextReminderLevel([])).toBe(1);
    expect(nextReminderLevel([1])).toBe(2);
    expect(nextReminderLevel([1, 2])).toBe(3);
    expect(nextReminderLevel([1, 2, 3])).toBeNull();
  });
});
