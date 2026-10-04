import { describe, expect, it } from "vitest";
import { cleanlinessScope, isReady, preferredFeatures, roomViewScope } from "../src/room-state";

const at = (role: string) => ({ propertyRoles: [{ propertyId: "p", role: role as never }] });

describe("room state", () => {
  it("a room is ready when Inspected, or Clean where the property does not inspect", () => {
    expect(isReady("inspected", true)).toBe(true);
    expect(isReady("clean", true)).toBe(false);
    expect(isReady("clean", false)).toBe(true);
    expect(isReady("dirty", false)).toBe(false);
  });

  it("follows the matrix: Front Desk sets Clean and Inspected, a Housekeeper only own rooms and never Inspected", () => {
    expect(cleanlinessScope(at("front_desk"), "p", "inspected")).toBe("all");
    expect(cleanlinessScope(at("housekeeper"), "p", "clean")).toBe("own");
    expect(cleanlinessScope(at("housekeeper"), "p", "inspected")).toBe("none");
    expect(cleanlinessScope(at("maintenance"), "p", "dirty")).toBe("none");
    expect(roomViewScope(at("housekeeper"), "p")).toBe("own");
    expect(roomViewScope(at("maintenance"), "p")).toBe("all");
    expect(roomViewScope(at("accounting"), "p")).toBe("none");
  });

  it("finds the Room Features a guest's preferences mention", () => {
    const features = [
      { code: "BALC", name: "Balkon" },
      { code: "QUIET", name: "Ruhige Lage" },
      { code: "ACC", name: "Barrierefrei" },
    ];
    expect(preferredFeatures("Möchte gern ein Zimmer mit Balkon, ruhige Lage!", features).map((f) => f.code)).toEqual(["BALC", "QUIET"]);
    expect(preferredFeatures("balc", features).map((f) => f.code)).toEqual(["BALC"]);
    expect(preferredFeatures("", features)).toEqual([]);
  });
});
