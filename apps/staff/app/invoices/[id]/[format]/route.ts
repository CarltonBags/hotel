import { invoiceDocument } from "@hoteloftware/db";
import { invoicePdf, invoiceXml } from "@hoteloftware/invoices";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

/**
 * An issued invoice as its ZUGFeRD PDF (/invoices/<id>/pdf) or XRechnung XML
 * (/invoices/<id>/xml), rendered from its frozen document. The invoice's own
 * property decides the right to see folios.
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
  if (format === "pdf") {
    const pdf = await invoicePdf(doc);
    return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${doc.number}.pdf"`, "cache-control": "private, no-store" } });
  }
  if (format === "xml") {
    return new Response(await invoiceXml(doc), { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${doc.number}.xml"`, "cache-control": "private, no-store" } });
  }
  return new Response("Not found", { status: 404 });
}
