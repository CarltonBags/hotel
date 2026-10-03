import { describe, expect, it } from "vitest";
import { allocateDeposit, formatInvoiceNumber, invoiceLines, invoiceTotals, isInvoiceNumberFormat } from "../src/index";

/** Seams: an invoice from Charges (lines, VAT per rate, nets that add up), a deposit's VAT, the final invoice net of deposits, numbering. */
describe("invoices", () => {
  const charges = [
    { description: "Übernachtung", serviceDate: "2026-10-02", amount: 96, unitPrice: 96, quantity: 1, taxCode: "ACC", taxRate: 7 },
    { description: "Übernachtung", serviceDate: "2026-10-03", amount: 96, unitPrice: 96, quantity: 1, taxCode: "ACC", taxRate: 7 },
    { description: "Frühstück", serviceDate: "2026-10-02", amount: 24, unitPrice: 12, quantity: 2, taxCode: "FOOD", taxRate: 7 },
    { description: "Frühstück", serviceDate: "2026-10-03", amount: 24, unitPrice: 12, quantity: 2, taxCode: "FOOD", taxRate: 7 },
    { description: "Minibar", serviceDate: "2026-10-03", amount: 9.5, unitPrice: 9.5, quantity: 1, taxCode: "STD", taxRate: 19 },
  ];

  it("groups Charges of the same Service, price and Tax Code into one line with its period", () => {
    expect(invoiceLines(charges).map((l) => [l.description, l.quantity, l.unitGross, l.gross, l.periodStart, l.periodEnd])).toEqual([
      ["Übernachtung", 2, 96, 192, "2026-10-02", "2026-10-03"],
      ["Frühstück", 4, 12, 48, "2026-10-02", "2026-10-03"],
      ["Minibar", 1, 9.5, 9.5, "2026-10-03", "2026-10-03"],
    ]);
  });

  it("nights with a gap become two lines, so no period claims a day without the service", () => {
    const gap = invoiceLines([
      { description: "Parking", serviceDate: "2026-10-02", amount: 10, unitPrice: 10, quantity: 1, taxCode: "STD", taxRate: 19 },
      { description: "Parking", serviceDate: "2026-10-04", amount: 10, unitPrice: 10, quantity: 1, taxCode: "STD", taxRate: 19 },
      { description: "Parking", serviceDate: "2026-10-05", amount: 10, unitPrice: 10, quantity: 1, taxCode: "STD", taxRate: 19 },
    ]);
    expect(gap.map((l) => [l.periodStart, l.periodEnd, l.quantity])).toEqual([
      ["2026-10-02", "2026-10-02", 1],
      ["2026-10-04", "2026-10-05", 2],
    ]);
  });

  it("splits gross once per Tax Code and rate; line nets add up to each rate's net exactly", () => {
    const lines = invoiceLines([...charges, { description: "Wasser", serviceDate: "2026-10-03", amount: 3.33, unitPrice: 3.33, quantity: 1, taxCode: "STD", taxRate: 19 }]);
    const t = invoiceTotals(lines);
    expect(t.byTax).toEqual([
      { taxCode: "ACC", rate: 7, gross: 192, net: 179.44, vat: 12.56 },
      { taxCode: "FOOD", rate: 7, gross: 48, net: 44.86, vat: 3.14 },
      { taxCode: "STD", rate: 19, gross: 12.83, net: 10.78, vat: 2.05 },
    ]);
    for (const tax of t.byTax) {
      const sum = t.lines.filter((l) => l.taxCode === tax.taxCode && l.rate === tax.rate).reduce((s, l) => s + l.net, 0);
      expect(Math.round(sum * 100) / 100).toBe(tax.net);
    }
    expect(t).toMatchObject({ gross: 252.83, net: 235.08, vat: 17.75 });
  });

  it("a deposit takes the VAT of the stay it pays for, in proportion", () => {
    expect(allocateDeposit(100, [{ taxCode: "ACC", rate: 7, gross: 192 }, { taxCode: "FOOD", rate: 7, gross: 48 }])).toEqual([
      { taxCode: "ACC", rate: 7, gross: 80, net: 74.77, vat: 5.23 },
      { taxCode: "FOOD", rate: 7, gross: 20, net: 18.69, vat: 1.31 },
    ]);
    // rounding remainders land so the parts add up to the deposit
    const odd = allocateDeposit(100, [{ taxCode: "A", rate: 7, gross: 1 }, { taxCode: "B", rate: 7, gross: 1 }, { taxCode: "C", rate: 19, gross: 1 }]);
    expect(Math.round(odd.reduce((s, x) => s + x.gross, 0) * 100) / 100).toBe(100);
  });

  it("the final invoice deducts deposits with their VAT and other payments; what remains is due", () => {
    const t = invoiceTotals(invoiceLines(charges), {
      deposits: [{ number: "A-1", byTax: allocateDeposit(100, [{ taxCode: "ACC", rate: 7, gross: 192 }, { taxCode: "FOOD", rate: 7, gross: 48 }]) }],
      paid: 50,
    });
    expect(t.depositsGross).toBe(100);
    expect(t.depositsVat).toBe(6.54);
    expect(t.paid).toBe(50);
    expect(t.due).toBe(99.5);
  });

  it("numbers follow the Legal Entity's format; the counter is padded", () => {
    expect(formatInvoiceNumber("RE-{YYYY}-{NNNNN}", 42, "2026-10-03")).toBe("RE-2026-00042");
    expect(formatInvoiceNumber("{YY}{MM}/{N}", 7, "2026-10-03")).toBe("2610/7");
    expect(isInvoiceNumberFormat("RE-{YYYY}")).toBe(false);
    expect(isInvoiceNumberFormat("RE-{NNNN}")).toBe(true);
    // only letters, digits and - _ / . besides the placeholders
    expect(isInvoiceNumberFormat("RÉ-{NNNN}")).toBe(false);
    expect(isInvoiceNumberFormat('R"E-{NNNN}')).toBe(false);
  });
});
