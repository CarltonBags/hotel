import { describe, expect, it } from "vitest";
import { canUsePin, mayLookAfterPinUser, pinRolesFor, pinProblem } from "../src/devices";

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

  it("service roles use PIN Sign-in too", () => {
    expect(canUsePin({ propertyRoles: [{ propertyId: "p", role: "service" }, { propertyId: "p", role: "spa_staff" }] }, "p")).toBe(true);
  });

  it("the Housekeeping Supervisor looks after Housekeepers of their own properties only", () => {
    const hs = { propertyRoles: [{ propertyId: "a", role: "housekeeping_supervisor" as const }] };
    const pm = { propertyRoles: [{ propertyId: "a", role: "property_manager" as const }] };
    const hkA = { propertyRoles: [{ propertyId: "a", role: "housekeeper" as const }] };
    const mtA = { propertyRoles: [{ propertyId: "a", role: "maintenance" as const }] };
    // a PIN works on every Device of the tenant: a role elsewhere puts the person out of reach
    const hkAmtB = { propertyRoles: [{ propertyId: "a", role: "housekeeper" as const }, { propertyId: "b", role: "maintenance" as const }] };
    const desk = { propertyRoles: [{ propertyId: "a", role: "front_desk" as const }] };
    expect(mayLookAfterPinUser(hs, hkA)).toBe(true);
    expect(mayLookAfterPinUser(hs, mtA)).toBe(false);
    expect(mayLookAfterPinUser(hs, hkAmtB)).toBe(false);
    expect(mayLookAfterPinUser(pm, mtA)).toBe(true);
    expect(mayLookAfterPinUser(pm, hkAmtB)).toBe(false);
    expect(mayLookAfterPinUser(pm, desk)).toBe(false);
    expect(pinRolesFor(hs, "a")).toEqual(["housekeeper"]);
    expect(pinRolesFor(pm, "a")).toContain("maintenance");
    expect(pinRolesFor(pm, "b")).toEqual([]);
  });
});
