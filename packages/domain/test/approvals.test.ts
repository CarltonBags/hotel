import { describe, expect, it } from "vitest";
import { approvalStatus, priceOverrideCheck } from "../src/approvals";

describe("approvals", () => {
  it("a pending or approved request expires after its time; a decided one keeps its status", () => {
    const at = new Date("2026-10-03T12:00:00Z");
    const later = new Date("2026-10-04T12:00:00Z");
    expect(approvalStatus("pending", later, at)).toBe("pending");
    expect(approvalStatus("approved", at, later)).toBe("expired");
    expect(approvalStatus("rejected", at, later)).toBe("rejected");
    expect(approvalStatus("used", at, later)).toBe("used");
  });

  it("a Price Override tells complimentary nights from nights below the floor", () => {
    expect(priceOverrideCheck([{ date: "2026-10-03", price: 0 }, { date: "2026-10-04", price: 70 }, { date: "2026-10-05", price: 80 }], 80)).toEqual({ complimentary: ["2026-10-03"], belowFloor: ["2026-10-04"] });
    expect(priceOverrideCheck([{ date: "2026-10-04", price: 10 }], null)).toEqual({ complimentary: [], belowFloor: [] });
  });
});
