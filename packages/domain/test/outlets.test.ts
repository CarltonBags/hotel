import { describe, expect, it } from "vitest";
import { billTotal, eposPrintXml, lineFor, mayManageOutlet, splitIsValid, ticketsFor, ticketText } from "../src";

describe("outlets", () => {
  const item = { id: "i1", name: "Gin Tonic", price: 9.5, printerId: "bar", modifiers: [{ name: "no ice", price: 0 }, { name: "double", price: 4 }] };

  it("a line is priced with its modifiers; unknown modifiers are refused", () => {
    expect(lineFor(item, 2, ["double"], "")).toEqual({ description: "Gin Tonic", quantity: 2, unitPrice: 13.5, amount: 27, modifiers: [{ name: "double", price: 4 }], note: "" });
    expect(() => lineFor(item, 1, ["with cream"], "")).toThrow(/modifier/);
    expect(() => lineFor(item, 0, [], "")).toThrow(/quantity/);
  });

  it("the bill's total is the sum of its lines", () => {
    expect(billTotal([{ amount: 27 }, { amount: 4.2 }, { amount: 0.1 }])).toBe(31.3);
  });

  it("an order round makes one ticket per printer, with the table and modifiers; items without a printer print nowhere", () => {
    const tickets = ticketsFor({ outlet: "Bar", table: "T4", bill: 12, round: 2, waiter: "Mia", at: "2026-10-04T19:30:00Z" }, [
      { printerId: "bar", description: "Gin Tonic", quantity: 2, modifiers: [{ name: "no ice", price: 0 }], note: "" },
      { printerId: "kitchen", description: "Schnitzel", quantity: 1, modifiers: [], note: "well done" },
      { printerId: null, description: "Water", quantity: 1, modifiers: [], note: "" },
      { printerId: "bar", description: "Pils", quantity: 1, modifiers: [], note: "" },
    ]);
    expect(tickets.map((t) => [t.printerId, t.lines.map((l) => l.description)])).toEqual([
      ["bar", ["Gin Tonic", "Pils"]],
      ["kitchen", ["Schnitzel"]],
    ]);
    const text = ticketText(tickets[0]!);
    expect(text).toContain("T4");
    expect(text).toContain("2 x Gin Tonic");
    expect(text).toContain("  - no ice");
    expect(ticketText(tickets[1]!)).toContain("  ! well done");
  });

  it("a split moves some of the lines, never none and never all", () => {
    expect(splitIsValid(["a", "b", "c"], ["b"])).toBe(true);
    expect(splitIsValid(["a", "b"], ["a", "b"])).toBe(false);
    expect(splitIsValid(["a", "b"], [])).toBe(false);
    expect(splitIsValid(["a", "b"], ["x"])).toBe(false);
  });

  it("an Outlet Manager manages only own outlets; the Property Manager every one", () => {
    const om = { propertyRoles: [{ propertyId: "p", role: "outlet_manager" as const }] };
    const pm = { propertyRoles: [{ propertyId: "p", role: "property_manager" as const }] };
    expect(mayManageOutlet(om, "u1", { propertyId: "p", managers: ["u1"] })).toBe(true);
    expect(mayManageOutlet(om, "u1", { propertyId: "p", managers: ["u2"] })).toBe(false);
    expect(mayManageOutlet(pm, "u9", { propertyId: "p", managers: [] })).toBe(true);
  });

  it("a ticket goes to an ePOS printer as escaped text with a cut", () => {
    const xml = eposPrintXml("2 x Fish & Chips\n  - <no salt>");
    expect(xml).toContain("<text lang=\"de\">2 x Fish &amp; Chips&#10;  - &lt;no salt&gt;</text><cut type=\"feed\"/>");
  });
});

describe("outlet payments", () => {
  it("Room Charge: only for a guest in house, not blocked, covered; above the night's remaining limit it needs an Approval", async () => {
    const { roomChargeCheck } = await import("../src");
    const ok = { status: "checked_in", blocked: false, covered: true, chargedTonight: 100, limit: 150 };
    expect(roomChargeCheck({ ...ok, amount: 40 })).toEqual({ allowed: true, overLimit: false, remaining: 50, reason: null });
    expect(roomChargeCheck({ ...ok, amount: 60 })).toMatchObject({ allowed: true, overLimit: true });
    expect(roomChargeCheck({ ...ok, status: "checked_out", amount: 10 })).toMatchObject({ allowed: false, reason: "The guest is not checked in" });
    expect(roomChargeCheck({ ...ok, blocked: true, amount: 10 }).allowed).toBe(false);
    expect(roomChargeCheck({ ...ok, covered: false, amount: 10 }).reason).toMatch(/Card Hold/);
  });

  it("a bill becomes one Charge per Tax Code with its items as detail, the discount taken off per Tax Code", async () => {
    const { chargesPerTaxCode } = await import("../src");
    const lines = [
      { taxCode: "FOOD", taxRate: 7, revenueAccount: "8400", description: "Schnitzel", quantity: 2, amount: 38 },
      { taxCode: "STD", taxRate: 19, revenueAccount: "8410", description: "Pils", quantity: 3, amount: 13.5 },
      { taxCode: "FOOD", taxRate: 7, revenueAccount: "8400", description: "Suppe", quantity: 1, amount: 7 },
    ];
    expect(chargesPerTaxCode(lines, 0)).toEqual([
      { taxCode: "FOOD", taxRate: 7, revenueAccount: "8400", amount: 45, items: [{ description: "Schnitzel", quantity: 2, amount: 38 }, { description: "Suppe", quantity: 1, amount: 7 }], discount: 0 },
      { taxCode: "STD", taxRate: 19, revenueAccount: "8410", amount: 13.5, items: [{ description: "Pils", quantity: 3, amount: 13.5 }], discount: 0 },
    ]);
    expect(chargesPerTaxCode(lines, 10).map((c) => [c.amount, c.discount])).toEqual([
      [40.5, 4.5],
      [12.15, 1.35],
    ]);
  });

  it("a discount above the outlet's percentage needs an Approval for Service; tap to pay takes no girocard", async () => {
    const { discountNeedsApproval, tapToPayAccepts } = await import("../src");
    const sv = { propertyRoles: [{ propertyId: "p", role: "service" as const }] };
    const om = { propertyRoles: [{ propertyId: "p", role: "outlet_manager" as const }] };
    expect(discountNeedsApproval(sv, "p", 10, 10)).toBe(false);
    expect(discountNeedsApproval(sv, "p", 15, 10)).toBe(true);
    expect(discountNeedsApproval(om, "p", 50, 10)).toBe(false);
    expect(tapToPayAccepts("visa")).toBe(true);
    expect(tapToPayAccepts("girocard")).toBe(false);
  });
});
