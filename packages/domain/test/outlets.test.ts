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

  it("a split moves some of the lines, never none", () => {
    expect(splitIsValid(["a", "b", "c"], ["b"])).toBe(true);
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
