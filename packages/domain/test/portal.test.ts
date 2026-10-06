import { describe, expect, it } from "vitest";
import { extrasOpen, isArrivalTime, portalLanguage, portalLinkOpen, sameLastName } from "../src/portal";

describe("Guest Portal", () => {
  it("a link opens until 30 days after departure", () => {
    expect(portalLinkOpen("2026-11-03", "2026-12-03")).toBe(true);
    expect(portalLinkOpen("2026-11-03", "2026-12-04")).toBe(false);
  });

  it("last names compare without case, accents and spaces; extras until the arrival day", () => {
    expect(sameLastName("Müller-Lüdenscheidt", "mueller")).toBe(false);
    expect(sameLastName("Müller", " muller ")).toBe(true);
    expect(sameLastName("", "")).toBe(false);
    expect(extrasOpen("confirmed", "2026-11-03", "2026-11-03")).toBe(true);
    expect(extrasOpen("confirmed", "2026-11-03", "2026-11-04")).toBe(false);
    expect(extrasOpen("checked_in", "2026-11-03", "2026-11-03")).toBe(false);
    expect(isArrivalTime("21:30")).toBe(true);
    expect(isArrivalTime("25:00")).toBe(false);
  });

  it("the portal speaks the asked language, else the guest's, else English", () => {
    expect(portalLanguage("de", "en")).toBe("de");
    expect(portalLanguage(null, "de-AT")).toBe("de");
    expect(portalLanguage("fr", "ja")).toBe("en");
  });
});
