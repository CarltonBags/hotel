import { describe, expect, it } from "vitest";
import { cityTaxReportCsv, invoicePdf, invoiceXml, renderCityTaxReportPdf, renderNightAuditPdf, renderReminderPdf } from "../src/index";
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

  it("the City Tax filing report renders as PDF and as CSV", async () => {
    const report = {
      property: { name: "Alpha Berlin", currency: "EUR" },
      rule: { name: "Berlin Übernachtungsteuer" },
      from: "2026-10-01",
      to: "2026-12-31",
      totals: { nights: 3, personNights: 5, taxedPersonNights: 4, base: 300, tax: 18.75, charged: 11.25, absorbed: 7.5 },
      exempt: { disability: 1 },
      exemptions: [{ reservationId: "r1", confirmationNumber: "100031", guestName: "Aiko Tanaka", person: 1, reason: "disability", note: "GdB 80", documentName: "ausweis.pdf", nights: 1 }],
      stays: [
        { reservationId: "r1", confirmationNumber: "100031", guestName: "Aiko Tanaka", arrival: "2026-10-01", departure: "2026-10-02", nights: 1, persons: 2, base: 100, tax: 3.75, absorbed: false },
        // same booking, another room: its row lists only its own exemptions
        { reservationId: "r2", confirmationNumber: "100031", guestName: "=HYPERLINK(1)", arrival: "2026-10-01", departure: "2026-10-03", nights: 2, persons: 2, base: 200, tax: 15, absorbed: true },
      ],
    };
    const pdf = Buffer.from(await renderCityTaxReportPdf(report, "de"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const csv = cityTaxReportCsv(report);
    expect(csv.split("\r\n")[1]).toBe("100031;Aiko Tanaka;2026-10-01;2026-10-02;1;2;100.00;3.75;no;2:disability");
    // a guest name is never a formula in a spreadsheet
    expect(csv).toContain(";'=HYPERLINK(1);");
    expect(csv.split("\r\n")[2]!.endsWith(";yes;")).toBe(true);
  });

  it("a Night Audit report renders as PDF", async () => {
    const stay = { confirmationNumber: "100031", guestName: "Aiko Tanaka", roomNumber: "101" };
    const pdf = Buffer.from(
      await renderNightAuditPdf(
        {
          property: { name: "Alpha Berlin", currency: "EUR" },
          businessDate: "2026-10-03",
          closedAt: "2026-10-03T21:30:00Z",
          closedBy: "u1",
          occupancy: { rooms: 10, occupied: 4, percent: 40 },
          arrivals: [stay],
          departures: [],
          noShows: [{ ...stay, fee: 100, feeStatus: "confirmed", waiveReason: null }],
          lateArrivals: [],
          revenue: [{ service: "Übernachtung", taxCode: "ACC", taxRate: 7, gross: 400 }],
          latePostings: [{ confirmationNumber: "100030", description: "Frühstück", serviceDate: "2026-10-01", taxCode: "FOOD", amount: -12, correction: true }],
          payments: [{ tender: "card_terminal", amount: 250, count: 2 }],
          cityTax: { charged: 30, absorbed: 0, nights: 4 },
          openBalances: [{ ...stay, balance: 150 }],
          expiringHolds: [],
          changes: { voids: [], corrections: [], priceOverrides: [], refunds: [], cancellationInvoices: [], approvals: [] },
          warnings: { incompleteRegistrations: [{ ...stay, missing: ["nationality"] }], arrivalsWithoutRoom: [] },
        },
        "de",
        { u1: "Fiona Desk" },
      ),
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
