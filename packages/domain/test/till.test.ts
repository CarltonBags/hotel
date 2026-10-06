import { describe, expect, it } from "vitest";
import { fromLightspeed, taxCodeForRate, tillChargeGroups } from "../src";

describe("room charges from external tills", () => {
  it("a bill with items becomes one group per tax rate with its items; totals without items are accepted", () => {
    expect(
      tillChargeGroups({
        items: [
          { description: "Schnitzel", quantity: 2, amount: 39, taxRate: 7 },
          { description: "Pils", quantity: 3, amount: 13.5, taxRate: 19 },
          { description: "Salat", quantity: 1, amount: 8.4, taxRate: 7 },
        ],
      }),
    ).toEqual([
      { taxRate: 7, amount: 47.4, items: [{ description: "Schnitzel", quantity: 2, amount: 39 }, { description: "Salat", quantity: 1, amount: 8.4 }] },
      { taxRate: 19, amount: 13.5, items: [{ description: "Pils", quantity: 3, amount: 13.5 }] },
    ]);
    expect(tillChargeGroups({ totals: [{ taxRate: 19, amount: 20 }, { taxRate: 7, amount: 31.2 }] })).toEqual([
      { taxRate: 19, amount: 20, items: [] },
      { taxRate: 7, amount: 31.2, items: [] },
    ]);
    expect(() => tillChargeGroups({ items: [] })).toThrow(/nothing/);
    expect(() => tillChargeGroups({ items: [{ description: "x", quantity: 1, amount: Number.NaN, taxRate: 7 }] })).toThrow(/amount/);
  });

  it("a till's rate finds the Tax Code set for it, else the one code with that rate; two candidates need the setting", () => {
    const codes = [
      { id: "acc", rate: 7 },
      { id: "food", rate: 7 },
      { id: "std", rate: 19 },
    ];
    expect(taxCodeForRate(19, codes, {})).toBe("std");
    expect(taxCodeForRate(7, codes, {})).toBeNull();
    expect(taxCodeForRate(7, codes, { "7": "food" })).toBe("food");
    expect(taxCodeForRate(10, codes, {})).toBeNull();
  });

  it("Lightspeed's receipt: lines with tax multipliers, the tip apart, receipt and fiscal id; a void links to the first account", () => {
    const sale = fromLightspeed({
      uuid: "acc-1",
      receiptId: "R-4711",
      fiscId: "TSE-99",
      salesLines: [
        { description: "Pizza", quantity: 1, amount: "12.00", taxRate: 1.07 },
        { description: "Wein", quantity: 2, amount: "11.00", taxRate: 1.19 },
      ],
      payments: [{ code: "IKPMS", amount: "23.00", gratuity: "2.00", pmsReservationId: "res-1" }],
    });
    expect(sale).toEqual({
      externalId: "acc-1",
      corrects: null,
      reservationId: "res-1",
      receiptNumber: "R-4711",
      fiscalId: "TSE-99",
      items: [
        { description: "Pizza", quantity: 1, amount: 12, taxRate: 7 },
        { description: "Wein", quantity: 2, amount: 11, taxRate: 19 },
      ],
      tip: 2,
    });
    const voided = fromLightspeed({ uuid: "acc-2", initialAccountId: "acc-1", receiptId: "R-4712", salesLines: [{ description: "Pizza", quantity: -1, amount: "-12.00", taxRate: 1.07 }], payments: [{ code: "IKPMS", amount: "-12.00", pmsReservationId: "res-1" }] });
    expect(voided).toMatchObject({ externalId: "acc-2", corrects: "acc-1" });
    // only part of the bill to the room: not supported
    expect(() => fromLightspeed({ uuid: "acc-3", salesLines: [{ description: "Pizza", quantity: 1, amount: "12.00", taxRate: 1.07 }], payments: [{ code: "IKPMS", amount: "5.00", pmsReservationId: "res-1" }, { code: "CASH", amount: "7.00" }] })).toThrow(/whole bill/);
  });
});
