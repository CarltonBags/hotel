import { describe, expect, it } from "vitest";
import { localizedName, mergeNames } from "../src/names";
import { expandRoomNumbers } from "../src/room-numbers";

describe("localized names", () => {
  it("falls back to the main name and marks it", () => {
    expect(localizedName("Doppelzimmer", { en: "Double room" }, "en")).toEqual({ text: "Double room", missing: false });
    expect(localizedName("Doppelzimmer", { en: "Double room" }, "fr")).toEqual({ text: "Doppelzimmer", missing: true });
    expect(localizedName("Doppelzimmer", { en: "  " }, "en")).toEqual({ text: "Doppelzimmer", missing: true });
  });

  it("merges edited versions and removes emptied ones", () => {
    expect(mergeNames({ de: "Doppel", en: "Double" }, { en: "", fr: "Chambre double" })).toEqual({ de: "Doppel", fr: "Chambre double" });
  });
});

describe("room number ranges", () => {
  it("expands ranges and keeps padding and extra numbers", () => {
    expect(expandRoomNumbers("001-003, 2A 101")).toEqual(["001", "002", "003", "2A", "101"]);
  });

  it("refuses inverted or huge ranges", () => {
    expect(() => expandRoomNumbers("140-101")).toThrow(/not valid/);
    expect(() => expandRoomNumbers("1-1000")).toThrow(/not valid/);
  });
});
