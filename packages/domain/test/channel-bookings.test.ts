import { describe, expect, it } from "vitest";
import { addVat, channelNight, channelNights, splitCityTaxIncluded } from "../src/channel-bookings";

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

  it("a channel night with breakfast: City Tax on the room's net price only, the guest pays the channel price", () => {
    const berlin = (net: number) => Math.round(net * 0.075 * 100) / 100;
    // room 100 gross (93.46 net) + breakfast 2 × 15 = 130; City Tax 7.01 on the room only → 137.01
    const n = channelNight({ date: "2026-11-01", price: 137.01, includesVat: true, includesCityTax: true, services: [{ serviceId: "bf", componentPrice: 15, vatPercent: 19 }], persons: 2, roomVatPercent: 7, cityTaxOnRoomNet: berlin });
    expect(n.total).toBe(130);
    expect(n.cityTax).toBe(7.01);
    expect(n.components.map((c) => [c.kind, c.amount])).toEqual([["room", 100], ["service", 30]]);
  });

  it("a net channel price with City Tax: the tax comes off before VAT is added", () => {
    const berlin = (net: number) => Math.round(net * 0.075 * 100) / 100;
    // net 100 + 7.50 City Tax = 107.50 → room 107.00 gross, City Tax 7.50
    const n = channelNight({ date: "2026-11-01", price: 107.5, includesVat: false, includesCityTax: true, services: [], persons: 2, roomVatPercent: 7, cityTaxOnRoomNet: berlin });
    expect(n).toMatchObject({ total: 107, cityTax: 7.5 });
  });
});
