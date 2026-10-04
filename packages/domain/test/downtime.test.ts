import { describe, expect, it } from "vitest";
import { ageMinutes, catchUpProblem, downtimeOptions, downtimeReminderDue, sortGuestRows } from "../src/downtime";

describe("downtime reports", () => {
  it("options fall back to defaults; malformed values are ignored", () => {
    expect(downtimeOptions(null)).toMatchObject({ sort: "room", reminderAt: null, show: { balance: true } });
    expect(downtimeOptions({ sort: "name", reminderAt: "06:30", show: { balance: false }, blankForms: 4 })).toMatchObject({ sort: "name", reminderAt: "06:30", show: { balance: false, notes: true }, blankForms: 4 });
    expect(downtimeOptions({ reminderAt: "25:00", blankForms: 99 })).toMatchObject({ reminderAt: null, blankForms: 2 });
  });

  it("sorts by room number (unassigned last) or by surname", () => {
    const rows = [
      { room: "12", guestLastName: "Weber", guestFirstName: "A" },
      { room: null, guestLastName: "Adler", guestFirstName: "B" },
      { room: "3", guestLastName: "Zorn", guestFirstName: "C" },
    ];
    expect(sortGuestRows(rows, "room").map((r) => r.room)).toEqual(["3", "12", null]);
    expect(sortGuestRows(rows, "name").map((r) => r.guestLastName)).toEqual(["Adler", "Weber", "Zorn"]);
  });

  it("the shift reminder shows from its time until printed", () => {
    expect(downtimeReminderDue("06:00", "05:59", false)).toBe(false);
    expect(downtimeReminderDue("06:00", "06:00", false)).toBe(true);
    expect(downtimeReminderDue("06:00", "09:00", true)).toBe(false);
    expect(downtimeReminderDue(null, "09:00", false)).toBe(false);
    expect(ageMinutes("2026-10-05T10:00:00Z", new Date("2026-10-05T10:47:30Z"))).toBe(47);
  });

  it("a Catch-up Entry happened inside a logged outage, never in the future", () => {
    const now = new Date("2026-10-05T12:00:00Z");
    const outages = [{ startedAt: new Date("2026-10-05T08:00:00Z"), endedAt: new Date("2026-10-05T10:00:00Z") }, { startedAt: new Date("2026-10-05T11:30:00Z"), endedAt: null }];
    expect(catchUpProblem(new Date("2026-10-05T09:15:00Z"), outages, now)).toBeNull();
    expect(catchUpProblem(new Date("2026-10-05T11:45:00Z"), outages, now)).toBeNull();
    expect(catchUpProblem(new Date("2026-10-05T10:30:00Z"), outages, now)).toBe("outside_outage");
    expect(catchUpProblem(new Date("2026-10-05T12:30:00Z"), outages, now)).toBe("future");
  });
});
