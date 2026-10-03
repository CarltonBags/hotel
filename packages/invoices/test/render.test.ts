import { describe, expect, it } from "vitest";
import { invoicePdf, invoiceXml } from "../src/index";
import { finalInvoice } from "./fixture";

/** Seam: an invoice renders as a Factur-X PDF carrying its EN16931 XML, and as XRechnung XML. (Full validation: scripts/validate-invoice.sh with Mustang.) */
describe("invoice rendering", () => {
  it("the PDF is PDF/A-3 with the factur-x.xml attachment", async () => {
    const pdf = Buffer.from(await invoicePdf(finalInvoice));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const raw = pdf.toString("latin1");
    expect(raw).toContain("factur-x.xml");
    expect(raw).toContain("pdfaid:part");
  });

  it("the XRechnung XML carries number, totals and the deposit reference", async () => {
    const xml = await invoiceXml(finalInvoice);
    expect(xml).toContain("RE-2026-00042");
    expect(xml).toContain("AZ-2026-00007");
    expect(xml).toMatch(/DuePayableAmount>99\.50</);
  });
});
