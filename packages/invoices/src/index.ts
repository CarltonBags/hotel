import type { InvoiceDocument } from "./document";
import { facturX, xrechnung } from "./einvoice";
import { renderInvoicePdf } from "./pdf";

export type { InvoiceDocument, InvoiceKind, Party, ReminderDocument } from "./document";
export { renderReminderPdf } from "./reminder";
export { toEn16931 } from "./einvoice";

/** The invoice as handed to the guest: a ZUGFeRD / Factur-X PDF (EN16931). */
export async function invoicePdf(doc: InvoiceDocument): Promise<Uint8Array> {
  return facturX(doc, await renderInvoicePdf(doc));
}

/** The XRechnung XML (CII), on request. */
export function invoiceXml(doc: InvoiceDocument): Promise<string> {
  return xrechnung(doc);
}
export { cityTaxReportCsv, renderCityTaxReportPdf, type CityTaxReportDocument } from "./city-tax-report";
export { renderNightAuditPdf, type NightAuditReportDocument } from "./night-audit-report";
