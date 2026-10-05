import { invoiceDocument, invoiceFiles, keepInvoiceFile, portalInvoice } from "@hoteloftware/db";
import { invoicePdf } from "@hoteloftware/invoices";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** An invoice of the guest's own stay, as issued (ticket 40). */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string; id: string }> }) {
  const { key, id } = await params;
  const tenant = await currentTenant();
  if (!tenant || !(await portalInvoice(pool(), tenant.schemaName, key, id))) return new Response("Not found", { status: 404 });
  const doc = await invoiceDocument(pool(), tenant.schemaName, id);
  const kept = await invoiceFiles(pool(), tenant.schemaName, id);
  if (!kept.pdf) await keepInvoiceFile(pool(), tenant.schemaName, id, { pdf: await invoicePdf(doc) });
  const pdf = kept.pdf ?? (await invoiceFiles(pool(), tenant.schemaName, id)).pdf!;
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${doc.number}.pdf"`, "cache-control": "private, no-store", "referrer-policy": "no-referrer" } });
}
