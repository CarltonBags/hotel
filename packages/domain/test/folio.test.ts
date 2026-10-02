import { describe, expect, it } from "vitest";
import { earlyDepartureFee, folioTotals, routeCharge, staySync } from "../src/folio";

/** Seams: folio arithmetic (totals per Tax Code from gross), routing, early-departure fee, and syncing stay Charges after a change. */
describe("folio", () => {
  it("totals per Tax Code: net and VAT derived from the gross sum, voids left out", () => {
    const t = folioTotals([
      { amount: 100, taxCode: "ACC", taxRate: 7, voided: false },
      { amount: 100, taxCode: "ACC", taxRate: 7, voided: false },
      { amount: 24, taxCode: "FOOD", taxRate: 19, voided: false },
      { amount: 999, taxCode: "ACC", taxRate: 7, voided: true },
    ]);
    expect(t.byTaxCode).toEqual([
      { taxCode: "ACC", rate: 7, gross: 200, net: 186.92, vat: 13.08 },
      { taxCode: "FOOD", rate: 19, gross: 24, net: 20.17, vat: 3.83 },
    ]);
    expect(t.gross).toBe(224);
  });

  it("routes a Charge by category to its folio, else to the main folio", () => {
    const rules = [{ category: "accommodation" as const, folioId: "company" }];
    expect(routeCharge("accommodation", rules, "main")).toBe("company");
    expect(routeCharge("package", rules, "main")).toBe("main");
  });

  it("the early-departure fee follows the Rate Plan on the nights given up", () => {
    const given = [120, 150];
    expect(earlyDepartureFee("none", null, given)).toBe(0);
    expect(earlyDepartureFee("first_night", null, given)).toBe(120);
    expect(earlyDepartureFee("percent", 50, given)).toBe(135);
    expect(earlyDepartureFee("full_stay", null, given)).toBe(270);
  });

  it("after a change, voids posted Charges of nights that left or changed and posts the new ones", () => {
    const posted = [
      { id: "c7r", serviceDate: "2026-12-07", component: "room", amount: 100 },
      { id: "c7b", serviceDate: "2026-12-07", component: "svc:brk", amount: 24 },
      { id: "c8r", serviceDate: "2026-12-08", component: "room", amount: 100 },
      { id: "c9r", serviceDate: "2026-12-09", component: "room", amount: 100 },
    ];
    // stay shortened to 7-8 and night 8 repriced; night 7 unchanged
    const wanted = [
      { serviceDate: "2026-12-07", component: "room", amount: 100 },
      { serviceDate: "2026-12-07", component: "svc:brk", amount: 24 },
      { serviceDate: "2026-12-08", component: "room", amount: 90 },
    ];
    expect(staySync(posted, wanted)).toEqual({
      voids: ["c8r", "c9r"],
      posts: [{ serviceDate: "2026-12-08", component: "room", amount: 90 }],
      removedDates: ["2026-12-09"],
    });
  });
});
