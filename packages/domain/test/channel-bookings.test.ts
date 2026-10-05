import { describe, expect, it } from "vitest";
import { addVat, channelNights, splitCityTaxIncluded } from "../src/channel-bookings";

describe("channel prices", () => {
  it("a price including Berlin's 7.5 % City Tax on the net is split so the guest pays exactly the channel price", () => {
    // gross 100 at 7 % VAT: net 93.46, tax 7.01 → channel price 107.01
    const taxOf = (gross: number) => Math.round(((gross / 1.07) * 0.075) * 100) / 100;
    expect(splitCityTaxIncluded(107.01, taxOf)).toEqual({ gross: 100, cityTax: 7.01 });
    const odd = splitCityTaxIncluded(123.45, taxOf);
    expect(Math.round((odd.gross + odd.cityTax) * 100)).toBe(12345);
    expect(Math.abs(odd.cityTax - taxOf(odd.gross))).toBeLessThanOrEqual(0.01);
  });

  it("a step-table tax (Hamburg) on a price near a step", () => {
    const taxOf = (gross: number) => (gross / 1.07 <= 100 ? 2.4 : 3.6);
    const s = splitCityTaxIncluded(109.4, taxOf);
    expect(s).toEqual({ gross: 107, cityTax: 2.4 });
  });

  it("net channel prices get VAT", () => {
    expect(addVat(100, 7)).toBe(107);
  });

  it("a channel night: included breakfast at its component price, the room the rest", () => {
    expect(channelNights([{ date: "2026-11-01", gross: 130 }], [{ serviceId: "bf", componentPrice: 15 }], 2)[0]!.components.map((c) => [c.kind, c.amount])).toEqual([["room", 100], ["service", 30]]);
    expect(channelNights([{ date: "2026-11-01", gross: 20 }], [{ serviceId: "bf", componentPrice: 15 }], 2)[0]!.components.map((c) => [c.kind, c.amount])).toEqual([["room", 20]]);
  });
});
