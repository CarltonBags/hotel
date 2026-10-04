import { describe, expect, it } from "vitest";
import { auditOpen, auditOverdue, daysBehind, noShowFee, undecidedArrivals } from "../src/night-audit";

const berlin = { businessDate: "2026-10-03", timeZone: "Europe/Berlin", windowFrom: "22:00", deadline: "06:00" };

describe("night audit clock", () => {
  it("opens at the window on the Business Date, in the property's time zone", () => {
    // 22:00 in Berlin (CEST) is 20:00 UTC
    expect(auditOpen(berlin, new Date("2026-10-03T19:59:00Z"))).toBe(false);
    expect(auditOpen(berlin, new Date("2026-10-03T20:00:00Z"))).toBe(true);
    expect(auditOpen(berlin, new Date("2026-10-05T10:00:00Z"))).toBe(true);
  });

  it("is overdue from the deadline the next morning", () => {
    expect(auditOverdue(berlin, new Date("2026-10-04T03:59:00Z"))).toBe(false);
    expect(auditOverdue(berlin, new Date("2026-10-04T04:00:00Z"))).toBe(true);
  });

  it("counts the days the Business Date is behind", () => {
    expect(daysBehind("2026-10-03", "2026-10-03")).toBe(0);
    expect(daysBehind("2026-10-01", "2026-10-03")).toBe(2);
  });

  it("a missing arrival is decided as No-show (a waived fee with its reason) or Late Arrival", () => {
    expect(
      undecidedArrivals(["a", "b", "c", "d"], {
        a: { kind: "no_show", fee: "confirm" },
        b: { kind: "no_show", fee: "waive", waiveReason: " " },
        c: { kind: "late_arrival" },
      }),
    ).toEqual(["b", "d"]);
  });

  it("the No-show fee follows the Cancellation Policy", () => {
    expect(noShowFee("first_night", null, [120, 100])).toBe(120);
    expect(noShowFee("percent", 50, [120, 100])).toBe(110);
    expect(noShowFee("full_stay", null, [120, 100])).toBe(220);
    expect(noShowFee("none", null, [120])).toBe(0);
  });
});
