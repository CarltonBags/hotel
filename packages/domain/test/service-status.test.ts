import { describe, expect, it } from "vitest";
import { AVAILABILITY_TARGET, maintenanceProblem, monthlyAvailability, serviceState, supportReasonProblem } from "../src/service-status";

describe("service status", () => {
  it("availability of a month: outage minutes of major incidents against the minutes of the month", () => {
    // 30 days = 43,200 minutes; a 30-minute outage
    const a = monthlyAvailability("2026-09", [{ impact: "major", startedAt: "2026-09-10T10:00:00Z", resolvedAt: "2026-09-10T10:30:00Z" }], new Date("2026-10-01T00:00:00Z"));
    expect(a.downMinutes).toBe(30);
    expect(a.percent).toBe(99.93);
    expect(a.met).toBe(false);
    // minor incidents do not count; an outage crossing the month counts only within it
    const b = monthlyAvailability("2026-09", [{ impact: "minor", startedAt: "2026-09-10T10:00:00Z", resolvedAt: "2026-09-10T12:00:00Z" }, { impact: "major", startedAt: "2026-08-31T23:50:00Z", resolvedAt: "2026-09-01T00:10:00Z" }], new Date("2026-10-01T00:00:00Z"));
    expect(b.downMinutes).toBe(10);
    expect(b.met).toBe(true);
    expect(AVAILABILITY_TARGET).toBe(99.95);
    // the current month counts up to now; an open outage up to now
    const c = monthlyAvailability("2026-10", [{ impact: "major", startedAt: "2026-10-04T12:00:00Z", resolvedAt: null }], new Date("2026-10-04T12:20:00Z"));
    expect(c.downMinutes).toBe(20);
  });

  it("the service state follows the worst open incident", () => {
    expect(serviceState([])).toBe("operational");
    expect(serviceState([{ impact: "minor", resolvedAt: null }])).toBe("degraded");
    expect(serviceState([{ impact: "minor", resolvedAt: null }, { impact: "major", resolvedAt: null }])).toBe("outage");
    expect(serviceState([{ impact: "major", resolvedAt: "2026-10-01T00:00:00Z" }])).toBe("operational");
  });

  it("planned maintenance is announced 7 days ahead and lies between 02:00 and 05:00 property time", () => {
    const now = new Date("2026-10-01T09:00:00Z");
    // 02:30 to 04:00 in Berlin (CEST, UTC+2) on 10 October
    expect(maintenanceProblem({ startsAt: "2026-10-10T00:30:00Z", endsAt: "2026-10-10T02:00:00Z" }, now, "Europe/Berlin")).toBeNull();
    expect(maintenanceProblem({ startsAt: "2026-10-05T00:30:00Z", endsAt: "2026-10-05T02:00:00Z" }, now, "Europe/Berlin")).toBe("too_soon");
    // 05:30 Berlin
    expect(maintenanceProblem({ startsAt: "2026-10-10T03:30:00Z", endsAt: "2026-10-10T04:00:00Z" }, now, "Europe/Berlin")).toBe("outside_window");
    expect(maintenanceProblem({ startsAt: "2026-10-10T02:00:00Z", endsAt: "2026-10-10T00:30:00Z" }, now, "Europe/Berlin")).toBe("ends_before_start");
  });

  it("support access needs a reason", () => {
    expect(supportReasonProblem("")).toBe("missing");
    expect(supportReasonProblem("  hi ")).toBe("too_short");
    expect(supportReasonProblem("Ticket 4711: invoice numbering question")).toBeNull();
  });
});
