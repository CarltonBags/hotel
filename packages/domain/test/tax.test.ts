import { describe, expect, it } from "vitest";
import { can, type Actor } from "../src/permissions";
import { TAX_PRESETS, splitGross, taxRateOn } from "../src/tax";

/** Seam: VAT arithmetic on gross amounts (ADR 0010) and dated rates. */
describe("tax", () => {
  const rates = [
    { validFrom: "2020-01-01", rate: 19 },
    { validFrom: "2026-01-01", rate: 7 },
  ];

  it("picks the rate valid on a date; earlier dates keep the earlier rate", () => {
    expect(taxRateOn(rates, "2025-12-31")).toBe(19);
    expect(taxRateOn(rates, "2026-01-01")).toBe(7);
    expect(taxRateOn(rates, "2027-06-15")).toBe(7);
    expect(taxRateOn(rates, "2019-01-01")).toBeNull();
  });

  it("derives net and VAT from gross, rounded to cents, summing back to gross", () => {
    expect(splitGross(119, 19)).toEqual({ gross: 119, net: 100, vat: 19 });
    expect(splitGross(107, 7)).toEqual({ gross: 107, net: 100, vat: 7 });
    expect(splitGross(10, 7)).toEqual({ gross: 10, net: 9.35, vat: 0.65 });
    expect(splitGross(0.01, 19)).toEqual({ gross: 0.01, net: 0.01, vat: 0 });
    expect(splitGross(50, 0)).toEqual({ gross: 50, net: 50, vat: 0 });
  });

  it("ships presets for Germany, Austria and Switzerland", () => {
    expect(TAX_PRESETS.DE.map((t) => `${t.code} ${t.rate}`)).toEqual(["ACC 7", "FOOD 7", "STD 19", "ZERO 0"]);
    expect(TAX_PRESETS.DE.find((t) => t.code === "FOOD")?.rates).toEqual([
      { validFrom: "2000-01-01", rate: 19 },
      { validFrom: "2026-01-01", rate: 7 },
    ]);
    expect(TAX_PRESETS.AT.map((t) => t.code)).toContain("SPA");
    expect(TAX_PRESETS.CH.find((t) => t.code === "ACC")?.rate).toBe(3.8);
  });
});

describe("catalogue permissions", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const at = (role: Actor["propertyRoles"][number]["role"]): Actor => ({ propertyRoles: [{ propertyId: A, role }] });

  it("prices: Property Manager and Revenue; Tax Codes and accounts: Property Manager and Accounting", () => {
    expect(can(at("property_manager"), "manage_service_prices", A)).toBe(true);
    expect(can(at("revenue"), "manage_service_prices", A)).toBe(true);
    expect(can(at("accounting"), "manage_service_prices", A)).toBe(false);
    expect(can(at("property_manager"), "manage_tax_codes", A)).toBe(true);
    expect(can(at("accounting"), "manage_tax_codes", A)).toBe(true);
    expect(can(at("revenue"), "manage_tax_codes", A)).toBe(false);
    expect(can(at("front_desk"), "manage_service_prices", A)).toBe(false);
    expect(can(at("front_desk"), "manage_tax_codes", A)).toBe(false);
  });
});
