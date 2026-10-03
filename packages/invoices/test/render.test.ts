import { describe, expect, it } from "vitest";
import { invoicePdf, invoiceXml, renderReminderPdf } from "../src/index";
import { cancellationInvoice, finalInvoice, reminder } from "./fixture";

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

  it("a Cancellation Invoice is type 381 and references the invoice it cancels", async () => {
    const xml = await invoiceXml(cancellationInvoice);
    expect(xml).toMatch(/TypeCode>381</);
    expect(xml).toMatch(/InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>RE-2026-00042</);
    // same amounts as the original: the type reverses them
    expect(xml).toMatch(/DuePayableAmount>99\.50</);
  });

  it("a reminder letter renders as a PDF", async () => {
    const pdf = Buffer.from(await renderReminderPdf(reminder));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
