import { describe, expect, it } from "vitest";
import { cancellationFee, nightsNeedingRoom, nightsToReprice, splitAssignment, zonedInstant } from "../src/reservation-edit";

/** Seams: which nights an edit reprices, the Cancellation Policy fee, and room moves as assignment segments. */
describe("reservation edits", () => {
  const stay = { arrival: "2026-12-07", departure: "2026-12-10", adults: 2, childAges: [] as number[], roomTypeId: "dbl" };

  it("extending by one night reprices only the added night", () => {
    expect(nightsToReprice(stay, { ...stay, departure: "2026-12-11" })).toEqual(["2026-12-10"]);
    expect(nightsToReprice(stay, { ...stay, arrival: "2026-12-06" })).toEqual(["2026-12-06"]);
    expect(nightsToReprice(stay, { ...stay, departure: "2026-12-09" })).toEqual([]);
  });

  it("only nights needing a room of the type count for Availability: occupancy changes take no extra room", () => {
    expect(nightsNeedingRoom(stay, { ...stay, adults: 1 })).toEqual([]);
    expect(nightsNeedingRoom(stay, { ...stay, departure: "2026-12-11" })).toEqual(["2026-12-10"]);
    expect(nightsNeedingRoom(stay, { ...stay, roomTypeId: "sgl" })).toHaveLength(3);
    expect(nightsToReprice(stay, { ...stay, childAges: [] })).toEqual([]);
  });

  it("an occupancy or room type change reprices every night", () => {
    expect(nightsToReprice(stay, { ...stay, adults: 3 })).toEqual(["2026-12-07", "2026-12-08", "2026-12-09"]);
    expect(nightsToReprice(stay, { ...stay, childAges: [5] })).toHaveLength(3);
    expect(nightsToReprice(stay, { ...stay, roomTypeId: "sgl", departure: "2026-12-08" })).toEqual(["2026-12-07"]);
  });
});

describe("cancellation fee", () => {
  const nights = [
    { date: "2026-12-07", total: 120 },
    { date: "2026-12-08", total: 120 },
    { date: "2026-12-09", total: 150 },
  ];
  // free until 1 day before arrival at 18:00 Berlin = 2026-12-06 17:00 UTC
  const policy = { freeUntilDays: 1, freeUntilTime: "18:00", feeKind: "first_night" as const, feePercent: null };
  const at = (iso: string) => new Date(iso);

  it("is free before the deadline in the property's time zone", () => {
    expect(cancellationFee(policy, { arrival: "2026-12-07", nights, timeZone: "Europe/Berlin" }, at("2026-12-06T16:59:00Z"))).toEqual({ amount: 0, deadline: "2026-12-06T17:00:00.000Z" });
  });

  it("charges the policy fee after the deadline", () => {
    const after = at("2026-12-06T17:01:00Z");
    expect(cancellationFee(policy, { arrival: "2026-12-07", nights, timeZone: "Europe/Berlin" }, after).amount).toBe(120);
    expect(cancellationFee({ ...policy, feeKind: "percent", feePercent: 50 }, { arrival: "2026-12-07", nights, timeZone: "Europe/Berlin" }, after).amount).toBe(195);
    expect(cancellationFee({ ...policy, feeKind: "full_stay" }, { arrival: "2026-12-07", nights, timeZone: "Europe/Berlin" }, after).amount).toBe(390);
    expect(cancellationFee({ ...policy, feeKind: "none" }, { arrival: "2026-12-07", nights, timeZone: "Europe/Berlin" }, after).amount).toBe(0);
  });

  it("a never-free policy charges at once", () => {
    expect(cancellationFee({ ...policy, freeUntilDays: null }, { arrival: "2026-12-07", nights, timeZone: "Europe/Berlin" }, at("2026-10-01T00:00:00Z"))).toEqual({ amount: 120, deadline: null });
  });
});

describe("property clock", () => {
  it("resolves wall-clock times on daylight-saving change days", () => {
    // Berlin leaves summer time on 2026-10-25 at 03:00 CEST -> 02:00 CET
    expect(zonedInstant("2026-10-24", "18:00", "Europe/Berlin").toISOString()).toBe("2026-10-24T16:00:00.000Z");
    expect(zonedInstant("2026-10-25", "18:00", "Europe/Berlin").toISOString()).toBe("2026-10-25T17:00:00.000Z");
    expect(zonedInstant("2026-10-25", "01:30", "Europe/Berlin").toISOString()).toBe("2026-10-24T23:30:00.000Z");
    // Berlin enters summer time on 2026-03-29 at 02:00 CET -> 03:00 CEST
    expect(zonedInstant("2026-03-29", "01:30", "Europe/Berlin").toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(zonedInstant("2026-03-29", "18:00", "Europe/Berlin").toISOString()).toBe("2026-03-29T16:00:00.000Z");
    expect(zonedInstant("2026-03-08", "03:30", "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });
});

describe("room moves", () => {
  it("a mid-stay move ends the current segment and adds a second one", () => {
    const segments = [{ roomId: "101", from: "2026-12-07", to: "2026-12-10" }];
    expect(splitAssignment(segments, "102", "2026-12-08")).toEqual([
      { roomId: "101", from: "2026-12-07", to: "2026-12-08" },
      { roomId: "102", from: "2026-12-08", to: "2026-12-10" },
    ]);
  });

  it("a move on the first night replaces the segment; moves outside the stay are refused", () => {
    expect(splitAssignment([{ roomId: "101", from: "2026-12-07", to: "2026-12-10" }], "102", "2026-12-07")).toEqual([{ roomId: "102", from: "2026-12-07", to: "2026-12-10" }]);
    expect(() => splitAssignment([{ roomId: "101", from: "2026-12-07", to: "2026-12-10" }], "102", "2026-12-10")).toThrow(/inside the stay/);
  });
});
