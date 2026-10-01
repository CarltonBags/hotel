import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, formatNumber, localeFor, weekStartsOn } from "../src/formats";

/** Intl emits non-breaking spaces; the tests compare plain spaces. */
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

/**
 * Seam: dates, numbers and currency follow the user's language; Swiss
 * properties use the Swiss number format; the week starts on Monday.
 */
describe("formats", () => {
  const d = new Date(Date.UTC(2026, 9, 1, 12, 0));

  it("picks the locale from language and property country", () => {
    expect(localeFor("de", "DE")).toBe("de-DE");
    expect(localeFor("de", "AT")).toBe("de-AT");
    expect(localeFor("de", "CH")).toBe("de-CH");
    expect(localeFor("en", "CH")).toBe("en-CH");
    expect(localeFor("en", "DE")).toBe("en-GB");
  });

  it("formats numbers and currency per language", () => {
    expect(formatNumber(1234567.891, "de", "DE")).toBe("1.234.567,891");
    expect(formatNumber(1234567.891, "en", "DE")).toBe("1,234,567.891");
    expect(plain(formatCurrency(1234.5, "EUR", "de", "DE"))).toBe("1.234,50 €");
    expect(formatCurrency(1234.5, "EUR", "en", "DE")).toBe("€1,234.50");
  });

  it("uses the Swiss number format for Swiss properties", () => {
    expect(formatNumber(1234567.891, "de", "CH")).toBe("1’234’567.891");
    expect(plain(formatCurrency(1234.5, "CHF", "de", "CH"))).toBe("CHF 1’234.50");
  });

  it("formats dates per language in the property's zone", () => {
    expect(formatDate(d, "de", "DE", "Europe/Berlin")).toBe("01.10.2026");
    expect(formatDate(d, "en", "DE", "Europe/Berlin")).toBe("01/10/2026");
  });

  it("starts the week on Monday everywhere", () => {
    expect(weekStartsOn()).toBe(1);
  });
});
