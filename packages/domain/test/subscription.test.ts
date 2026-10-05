import { describe, expect, it } from "vitest";
import { moduleBilled, moduleState, monthEnd, subscriptionLines, type PriceList } from "../src/subscription";

const prices: PriceList = {
  base_room: 4,
  modules: { channel: { unit: "room", amount: 1.5 }, guest_portal: { unit: "room", amount: 1 }, point_of_sale: { unit: "property", amount: 49 }, groups: { unit: "property", amount: 19 }, whatsapp: { unit: "property", amount: 29 } },
  handling: 10,
  yearlyDiscount: 10,
  vatRate: 19,
};

describe("Modules", () => {
  it("switched off, a Module runs to the month's end, then its data stays readable", () => {
    const p = [{ module: "point_of_sale" as const, onSince: "2026-09-10", offAt: monthEnd("2026-10-05") }];
    expect(monthEnd("2026-10-05")).toBe("2026-10-31");
    expect(moduleState(p, "point_of_sale", "2026-10-20")).toBe("ending");
    expect(moduleState(p, "point_of_sale", "2026-11-01")).toBe("readable");
    expect(moduleState(p, "groups", "2026-11-01")).toBe("never");
    expect(moduleState([{ module: "groups", onSince: "2026-10-01", offAt: null }], "groups", "2026-10-02")).toBe("on");
  });

  it("billed from the month after switching on, until the month it ends", () => {
    const p = { module: "channel" as const, onSince: "2026-10-05", offAt: "2026-12-31" };
    expect(moduleBilled(p, "2026-10-01")).toBe(false);
    expect(moduleBilled(p, "2026-11-01")).toBe(true);
    expect(moduleBilled(p, "2026-12-01")).toBe(true);
    expect(moduleBilled(p, "2027-01-01")).toBe(false);
  });
});

describe("the monthly invoice", () => {
  it("a two-property Legal Entity: rooms on the 1st, Modules per room or property, usage at cost plus handling", () => {
    const lines = subscriptionLines({
      monthStart: "2026-11-01",
      properties: [
        { name: "Berlin", rooms: 22, modules: [{ module: "channel", onSince: "2026-10-05", offAt: null }, { module: "point_of_sale", onSince: "2026-11-03", offAt: null }] },
        { name: "Zürich", rooms: 40, modules: [{ module: "groups", onSince: "2026-08-01", offAt: "2026-10-31" }] },
      ],
      usage: [{ kind: "SMS", quantity: 100, cost: 7.5 }, { kind: "SMS", quantity: 20, cost: 1.5 }],
      prices,
      yearly: false,
    });
    expect(lines.map((l) => [l.description.split(" · ")[0], l.quantity, l.unitNet, l.net])).toEqual([
      ["Berlin: rooms on 2026-11-01", 22, 4, 88],
      ["Berlin: Channel connection", 22, 1.5, 33],
      ["Zürich: rooms on 2026-11-01", 40, 4, 160],
      ["SMS × 120", 1, 9.9, 9.9],
    ]);
  });

  it("yearly prepayment: the discount on base and Modules, not on usage", () => {
    const lines = subscriptionLines({ monthStart: "2026-11-01", properties: [{ name: "Berlin", rooms: 10, modules: [] }], usage: [{ kind: "SMS", quantity: 10, cost: 1 }], prices, yearly: true });
    expect(lines.map((l) => l.net)).toEqual([40, -4, 1.1]);
  });
});
