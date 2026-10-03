import { invoiceDocument, invoiceFiles, keepInvoiceFile } from "@hoteloftware/db";
import { invoicePdf, invoiceXml } from "@hoteloftware/invoices";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

/**
 * An issued invoice as its ZUGFeRD PDF (/invoices/<id>/pdf) or XRechnung XML
 * (/invoices/<id>/xml). Rendered once from its frozen document and kept, so
 * the invoice is handed out identically for good. The invoice's own property
 * decides the right to see folios.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; format: string }> }) {
  const { id, format } = await params;
  const { tenant } = await requirePrincipal();
  let doc;
  try {
    doc = await invoiceDocument(pool(), tenant.schemaName, id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  try {
    await authorize("view_folio", doc.propertyId);
  } catch {
    return new Response("Not allowed", { status: 403 });
  }
  const kept = await invoiceFiles(pool(), tenant.schemaName, id);
  if (format === "pdf") {
    if (!kept.pdf) await keepInvoiceFile(pool(), tenant.schemaName, id, { pdf: await invoicePdf(doc) });
    const pdf = kept.pdf ?? (await invoiceFiles(pool(), tenant.schemaName, id)).pdf!;
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${doc.number}.pdf"`, "cache-control": "private, no-store" } });
  }
  if (format === "xml") {
    if (!kept.xml) {
      try {
        await keepInvoiceFile(pool(), tenant.schemaName, id, { xml: await invoiceXml(doc) });
      } catch (err) {
        return new Response(err instanceof Error ? err.message : "Cannot create the XRechnung", { status: 409 });
      }
    }
    const xml = kept.xml ?? (await invoiceFiles(pool(), tenant.schemaName, id)).xml!;
    return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${doc.number}.xml"`, "cache-control": "private, no-store" } });
  }
  return new Response("Not found", { status: 404 });
}
