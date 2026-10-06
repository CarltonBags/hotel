import { describe, expect, it } from "vitest";
import { cardLabel, depositDue, expressCheckoutOpen, extrasOpen, isArrivalTime, portalLanguage, portalLinkOpen, sameLastName } from "../src/portal";

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

describe("Paying before arrival and Express Checkout", () => {
  const nights = [120, 100, 100];
  it("asks before arrival what the Payment Policy wants, less what came in", () => {
    expect(depositDue({ kind: "full", depositPercent: null }, nights, 0)).toBe(320);
    expect(depositDue({ kind: "deposit_percent", depositPercent: 30 }, nights, 0)).toBe(96);
    expect(depositDue({ kind: "deposit_percent", depositPercent: 30 }, nights, 50)).toBe(46);
    expect(depositDue({ kind: "deposit_first_night", depositPercent: null }, nights, 0)).toBe(120);
    expect(depositDue({ kind: "deposit_first_night", depositPercent: null }, nights, 200)).toBe(0);
    expect(depositDue({ kind: "card_guarantee", depositPercent: null }, nights, 0)).toBe(0);
    expect(depositDue({ kind: "none", depositPercent: null }, nights, 0)).toBe(0);
  });

  it("opens Express Checkout on the departure eve and day by the Business Date, while checked in", () => {
    expect(expressCheckoutOpen("checked_in", "2026-10-06", "2026-10-05")).toBe(true);
    expect(expressCheckoutOpen("checked_in", "2026-10-06", "2026-10-06")).toBe(true);
    expect(expressCheckoutOpen("checked_in", "2026-10-06", "2026-10-04")).toBe(false);
    expect(expressCheckoutOpen("confirmed", "2026-10-06", "2026-10-05")).toBe(false);
  });

  it("names a card by brand and last four digits only", () => {
    expect(cardLabel("visa", "4242")).toBe("visa •••• 4242");
    expect(cardLabel(null, null)).toBe("");
  });
});
