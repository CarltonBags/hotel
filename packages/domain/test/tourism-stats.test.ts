import { describe, expect, it } from "vitest";
import { countMonth, statsRowFor, statsRows, statsVariant } from "../src/tourism-stats";

describe("official tourism statistics", () => {
  it("knows the variant by the property's country", () => {
    expect(statsVariant("DE")).toBe("DE");
    expect(statsVariant("AT")).toBe("AT");
    expect(statsVariant("CH")).toBe("CH");
    expect(statsVariant("LI")).toBeNull();
  });

  it("German form: residence by country, other groups by continent, unknown last", () => {
    expect(statsRowFor("DE", "DE", null)).toBe("DE");
    expect(statsRowFor("DE", "LI", null)).toBe("CH");
    expect(statsRowFor("DE", "MX", null)).toBe("other_central_america");
    expect(statsRowFor("DE", "AE", null)).toBe("gulf");
    expect(statsRowFor("DE", "HK", null)).toBe("CN");
    expect(statsRowFor("DE", "AL", null)).toBe("other_europe");
    expect(statsRowFor("DE", null, null)).toBe("unknown");
    expect(statsRows("DE").at(-1)!.key).toBe("unknown");
  });

  it("Austrian form splits Austria by federal state and Germany by region from the postal code", () => {
    expect(statsRowFor("AT", "AT", "1010")).toBe("at_wien");
    expect(statsRowFor("AT", "AT", "6900")).toBe("at_vorarlberg");
    expect(statsRowFor("AT", "AT", "6020")).toBe("at_tirol");
    expect(statsRowFor("AT", "DE", "80331")).toBe("de_bayern");
    expect(statsRowFor("AT", "DE", "10115")).toBe("de_berlin");
    expect(statsRowFor("AT", "DE", "20095")).toBe("de_nord");
    expect(statsRowFor("AT", "DE", "01067")).toBe("de_ost");
    expect(statsRowFor("AT", "DE", "60311")).toBe("de_mitte");
    expect(statsRowFor("AT", "DE", "70173")).toBe("de_bw");
    expect(statsRowFor("AT", "DE", "50667")).toBe("de_nrw");
    // without a postal code the state or region cannot be told
    expect(statsRowFor("AT", "DE", null)).toBe("de_unknown_region");
    expect(statsRowFor("AT", "KZ", null)).toBe("cis");
    expect(statsRowFor("AT", "AT", "5280")).toBe("at_ooe");
    expect(statsRowFor("AT", "DE", "63739")).toBe("de_bayern");
  });

  it("counts persons: arrivals in the month and every night in it (the official example)", () => {
    // three persons arriving 25 July, leaving 6 August
    const stays = [{ arrival: "2026-07-25", departure: "2026-08-06", persons: 3, row: "NL" }];
    expect(countMonth(stays, "2026-07")).toEqual({ rows: { NL: { arrivals: 3, nights: 21 } }, arrivals: 3, nights: 21 });
    expect(countMonth(stays, "2026-08")).toEqual({ rows: { NL: { arrivals: 0, nights: 15 } }, arrivals: 0, nights: 15 });
    expect(countMonth(stays, "2026-09")).toEqual({ rows: {}, arrivals: 0, nights: 0 });
    // day use without a night is not counted
    expect(countMonth([{ arrival: "2026-07-10", departure: "2026-07-10", persons: 2, row: "NL" }], "2026-07").arrivals).toBe(0);
  });
});
