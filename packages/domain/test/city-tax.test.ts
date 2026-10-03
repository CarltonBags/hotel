import { describe, expect, it } from "vitest";
import { CITY_TAX_PRESETS, cityTax, formatCityTaxFlat, formatCityTaxSteps, parseCityTaxFlat, parseCityTaxSteps, stepAmount, versionFor, type CityTaxRuleSpec, type CityTaxVersion } from "../src/city-tax";

const nights = (from: string, n: number, base: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), base };
  });
const sum = (xs: { tax: number }[]) => Math.round(xs.reduce((s, x) => s + x.tax, 0) * 100) / 100;

/** Seam: the City Tax of a stay per night, from the rule's versions, the base and the persons with their exemptions. */
describe("city tax", () => {
  it("Berlin preset on a 25-night stay taxes 21 nights", () => {
    const result = cityTax(CITY_TAX_PRESETS.berlin, { bookedOn: "2026-09-01", nights: nights("2026-10-01", 25, 100), persons: [{ age: null }, { age: null }] });
    expect(result.filter((n) => n.tax > 0)).toHaveLength(21);
    // 7.5 % of 100 net per night
    expect(result[0]).toMatchObject({ persons: 2, taxable: 2, tax: 7.5 });
    expect(result[21]).toMatchObject({ taxable: 0, tax: 0, exempt: { night_cap: 2 } });
    expect(sum(result)).toBe(157.5);
  });

  it("Hamburg step table picks the band from the net room price", () => {
    const hh = CITY_TAX_PRESETS.hamburg.versions.at(-1)!;
    // per person-night on the net price per person
    expect(stepAmount(hh, 8)).toBe(0);
    expect(stepAmount(hh, 25)).toBe(0.6);
    expect(stepAmount(hh, 25.01)).toBe(1.2);
    expect(stepAmount(hh, 100)).toBe(2.4);
    expect(stepAmount(hh, 200)).toBe(4.8);
    // + 1.20 for each further started 50
    expect(stepAmount(hh, 200.01)).toBe(6);
    expect(stepAmount(hh, 260)).toBe(7.2);
    // two persons in a room at 160 net: 80 each, band up to 100: 2.40 each
    const [night] = cityTax(CITY_TAX_PRESETS.hamburg, { bookedOn: "2026-09-01", nights: nights("2026-10-01", 1, 160), persons: [{ age: null }, { age: null }] });
    expect(night).toMatchObject({ taxable: 2, tax: 4.8 });
  });

  it("a percentage is shared by the persons: an exempt guest's share is not taxed", () => {
    const rule: CityTaxRuleSpec = { ...CITY_TAX_PRESETS.berlin, reasons: [{ reason: "disability", evidence: "document", param: null }] };
    const [night] = cityTax(rule, { bookedOn: "2026-09-01", nights: nights("2026-10-01", 1, 100), persons: [{ age: null }, { age: null, exemption: "disability" }] });
    expect(night).toMatchObject({ persons: 2, taxable: 1, tax: 3.75, exempt: { disability: 1 } });
  });

  it("a reason the rule does not enable exempts no one", () => {
    const [night] = cityTax(CITY_TAX_PRESETS.berlin, { bookedOn: "2026-09-01", nights: nights("2026-10-01", 1, 100), persons: [{ age: null, exemption: "student" }] });
    expect(night).toMatchObject({ taxable: 1, tax: 7.5 });
  });

  it("flat amounts by season and age; children under the age limit are exempt automatically", () => {
    const rule: CityTaxRuleSpec = {
      versions: [
        {
          validFrom: "2020-01-01",
          bookedFrom: null,
          kind: "flat",
          percent: null,
          nightCap: null,
          stepBasis: "per_person",
          steps: [],
          beyondEvery: null,
          beyondAmount: null,
          flat: [
            { from: "06-01", to: "09-30", minAge: 16, maxAge: null, amount: 3 },
            { from: "06-01", to: "09-30", minAge: 6, maxAge: 15, amount: 1.5 },
            { from: null, to: null, minAge: 16, maxAge: null, amount: 2 },
            { from: null, to: null, minAge: 6, maxAge: 15, amount: 1 },
          ],
        },
      ],
      reasons: [{ reason: "age", evidence: "none", param: 6 }],
    };
    const persons = [{ age: null }, { age: 10 }, { age: 4 }];
    const [summer] = cityTax(rule, { bookedOn: "2026-01-01", nights: nights("2026-09-30", 1, 0), persons });
    const [autumn] = cityTax(rule, { bookedOn: "2026-01-01", nights: nights("2026-10-01", 1, 0), persons });
    expect(summer).toMatchObject({ taxable: 2, tax: 4.5, exempt: { age: 1 } });
    expect(autumn).toMatchObject({ taxable: 2, tax: 3 });
  });

  it("a version applies to nights from its date, and with a booking cut-off only to bookings made from then", () => {
    const v = (validFrom: string, bookedFrom: string | null, percent: number): CityTaxVersion => ({ ...CITY_TAX_PRESETS.berlin.versions[0]!, validFrom, bookedFrom, percent });
    const versions = [v("2020-01-01", null, 5), v("2026-07-01", "2026-03-01", 10)];
    expect(versionFor(versions, "2026-06-30", "2026-04-01")?.percent).toBe(5);
    expect(versionFor(versions, "2026-07-01", "2026-04-01")?.percent).toBe(10);
    // booked before the cut-off: the earlier version still applies
    expect(versionFor(versions, "2026-07-01", "2026-02-01")?.percent).toBe(5);
    expect(versionFor(versions, "2019-12-31", "2019-01-01")).toBeUndefined();
  });

  it("a long stay beyond N nights is exempt automatically", () => {
    const [night] = cityTax(CITY_TAX_PRESETS.wien, { bookedOn: "2026-01-01", nights: nights("2026-01-01", 91, 100), persons: [{ age: null }] }).slice(90);
    expect(night).toMatchObject({ taxable: 0, tax: 0, exempt: { long_stay: 1 } });
  });

  it("step and flat tables round-trip through their text form", () => {
    expect(parseCityTaxSteps("10 0\n25 0,60\n* 4.80")).toEqual([
      { upTo: 10, amount: 0 },
      { upTo: 25, amount: 0.6 },
      { upTo: null, amount: 4.8 },
    ]);
    const flat = parseCityTaxFlat("06-01..09-30 16+ 3\n* 6-15 1.50\n* * 2");
    expect(flat).toEqual([
      { from: "06-01", to: "09-30", minAge: 16, maxAge: null, amount: 3 },
      { from: null, to: null, minAge: 6, maxAge: 15, amount: 1.5 },
      { from: null, to: null, minAge: null, maxAge: null, amount: 2 },
    ]);
    expect(parseCityTaxFlat(formatCityTaxFlat(flat))).toEqual(flat);
    expect(formatCityTaxSteps(CITY_TAX_PRESETS.hamburg.versions[0]!.steps).split("\n")[1]).toBe("25.00 0.60");
    expect(() => parseCityTaxSteps("25")).toThrow(/upper bound/);
    expect(() => parseCityTaxFlat("summer 16+ 3")).toThrow(/season/);
  });
});
