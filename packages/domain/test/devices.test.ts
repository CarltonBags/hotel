import { describe, expect, it } from "vitest";
import { canUsePin, pinProblem } from "../src/devices";

describe("PIN Sign-in rules", () => {
  it("refuses simple PINs", () => {
    for (const p of ["1234", "0000", "4321", "121212", "1987", "2001", "123456"]) expect(pinProblem(p)).toBe("simple");
    expect(pinProblem("12a4")).toBe("format");
    expect(pinProblem("123")).toBe("format");
    expect(pinProblem("4719")).toBeNull();
    expect(pinProblem("830264")).toBeNull();
  });

  it("only floor roles use PIN Sign-in", () => {
    expect(canUsePin({ propertyRoles: [{ propertyId: "p", role: "housekeeper" }] }, "p")).toBe(true);
    expect(canUsePin({ propertyRoles: [{ propertyId: "p", role: "maintenance" }] }, "q")).toBe(false);
    // a full-credential role anywhere rules it out
    expect(canUsePin({ propertyRoles: [{ propertyId: "p", role: "housekeeper" }, { propertyId: "q", role: "front_desk" }] }, "p")).toBe(false);
    expect(canUsePin({ propertyRoles: [{ propertyId: "p", role: "front_desk" }] }, "p")).toBe(false);
    expect(canUsePin({ tenantRole: "owner", propertyRoles: [] }, "p")).toBe(false);
  });
});
