import { describe, expect, it } from "vitest";
import { ageBandFor, validateAgeBands } from "../src/age-bands";

/** Seam: Age Bands per property must be contiguous from age 0 and must not overlap; the last one is open-ended. */
describe("Age Bands", () => {
  const good = [
    { name: "Infant", minAge: 0, maxAge: 2 },
    { name: "Child", minAge: 3, maxAge: 11 },
    { name: "Adult", minAge: 12, maxAge: null },
  ];

  it("accepts a contiguous set from 0 ending open", () => {
    expect(validateAgeBands(good)).toEqual([]);
  });

  it("reports a gap", () => {
    const bands = [good[0]!, { name: "Child", minAge: 4, maxAge: 11 }, good[2]!];
    expect(validateAgeBands(bands)).toEqual([{ index: 1, problem: "gap" }]);
  });

  it("reports an overlap", () => {
    const bands = [good[0]!, { name: "Child", minAge: 2, maxAge: 11 }, good[2]!];
    expect(validateAgeBands(bands)).toEqual([{ index: 1, problem: "overlap" }]);
  });

  it("requires the first band to start at 0 and the last to be open-ended", () => {
    expect(validateAgeBands([{ name: "Child", minAge: 1, maxAge: 11 }, { name: "Adult", minAge: 12, maxAge: null }])).toEqual([{ index: 0, problem: "start" }]);
    expect(validateAgeBands([{ name: "Child", minAge: 0, maxAge: 11 }, { name: "Adult", minAge: 12, maxAge: 99 }])).toEqual([{ index: 1, problem: "end" }]);
  });

  it("refuses an inverted band and an empty set", () => {
    expect(validateAgeBands([{ name: "X", minAge: 5, maxAge: 2 }])).toContainEqual({ index: 0, problem: "inverted" });
    expect(validateAgeBands([])).toEqual([{ index: -1, problem: "empty" }]);
  });

  it("finds the band for an age", () => {
    expect(ageBandFor(good, 0)?.name).toBe("Infant");
    expect(ageBandFor(good, 11)?.name).toBe("Child");
    expect(ageBandFor(good, 40)?.name).toBe("Adult");
  });
});
