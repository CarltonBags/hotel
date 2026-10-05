import { describe, expect, it } from "vitest";
import { groupStatusAllowed, releaseDateFor, releaseWarningDue, seriesArrivals, tentativeShortfall, unsoldHeld } from "../src";

describe("groups", () => {
  it("a Series of 8 Saturdays has 8 arrivals", () => {
    const a = seriesArrivals("2026-10-01", "2026-11-21", 6);
    expect(a).toHaveLength(8);
    expect(a[0]).toBe("2026-10-03");
    expect(a.at(-1)).toBe("2026-11-21");
  });

  it("held rooms, tentative shortfall, release dates and warnings", () => {
    expect(unsoldHeld(10, 6)).toBe(4);
    expect(unsoldHeld(10, 12)).toBe(0);
    expect(tentativeShortfall(3, 10)).toBe(7);
    expect(tentativeShortfall(-2, 10)).toBe(10);
    expect(tentativeShortfall(12, 10)).toBe(0);
    expect(releaseDateFor("2026-10-20", 14, "2026-10-05")).toBe("2026-10-06");
    expect(releaseDateFor("2026-10-20", 30, "2026-10-05")).toBe("2026-10-05");
    expect(releaseWarningDue("2026-10-08", "2026-10-05")).toBe(true);
    expect(releaseWarningDue("2026-10-09", "2026-10-05")).toBe(false);
    expect(releaseWarningDue("2026-10-05", "2026-10-05")).toBe(false);
  });

  it("a lapsed or cancelled group is closed; only a tentative one lapses", () => {
    expect(groupStatusAllowed("tentative", "definite")).toBe(true);
    expect(groupStatusAllowed("definite", "lapsed")).toBe(false);
    expect(groupStatusAllowed("definite", "cancelled")).toBe(true);
    expect(groupStatusAllowed("cancelled", "definite")).toBe(false);
  });
});
