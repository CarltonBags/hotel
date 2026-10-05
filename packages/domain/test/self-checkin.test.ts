import { describe, expect, it } from "vitest";
import { CANTON_PRESETS } from "../src/registration";
import { checkInConditions, selfRegistrationPath } from "../src/self-checkin";

const base = { arrival: "2026-10-05", businessDate: "2026-10-05", localTime: "15:30", checkinFrom: "15:00", readyRoom: true, registration: "done" as const, amountDue: 0, cardGuarantee: false };

describe("Self Check-in (ticket 49)", () => {
  it("all conditions met", () => {
    expect(checkInConditions(base)).toEqual([]);
  });

  it("names each failing condition", () => {
    expect(checkInConditions({ ...base, businessDate: "2026-10-04" })).toEqual(["arrival_day"]);
    expect(checkInConditions({ ...base, localTime: "14:59" })).toEqual(["too_early"]);
    expect(checkInConditions({ ...base, readyRoom: false })).toEqual(["room_not_ready"]);
    expect(checkInConditions({ ...base, registration: "reception" })).toEqual(["registration"]);
    expect(checkInConditions({ ...base, amountDue: 120 })).toEqual(["payment"]);
    expect(checkInConditions({ ...base, amountDue: 120, cardGuarantee: true })).toEqual([]);
  });

  it("registration by a legal path: Austria on screen; Germany's foreign guests at reception (the card path comes with ticket 46); Switzerland as its canton says", () => {
    const de = (nat: string) => [{ id: "a", role: "primary" as const, nationality: nat, dateOfBirth: "1980-01-01" }];
    expect(selfRegistrationPath("DE", de("DE"), "2026-10-05", null)).toBe("none");
    expect(selfRegistrationPath("DE", de("JP"), "2026-10-05", null)).toBe("reception");
    expect(selfRegistrationPath("AT", de("AT"), "2026-10-05", null)).toBe("on_screen");
    expect(selfRegistrationPath("CH", de("IT"), "2026-10-05", CANTON_PRESETS.TI)).toBe("reception");
    expect(selfRegistrationPath("CH", de("IT"), "2026-10-05", { ...CANTON_PRESETS.TI, signature: "tablet" })).toBe("on_screen");
    expect(selfRegistrationPath("FR", de("JP"), "2026-10-05", null)).toBe("none");
    // fellow guests with forms of their own: reception helps
    expect(selfRegistrationPath("AT", [...de("AT"), { id: "b", role: "other", nationality: "AT", dateOfBirth: "1981-01-01" }], "2026-10-05", null)).toBe("reception");
  });
});
