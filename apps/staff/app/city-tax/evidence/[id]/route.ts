import { cityTaxEvidence } from "@hoteloftware/db";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

/** A City Tax exemption's evidence document, for whoever may see the reservation's folio or the filing report at its property. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant } = await requirePrincipal();
  let doc;
  try {
    doc = await cityTaxEvidence(pool(), tenant.schemaName, id);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const allowed = await authorize("check_in", doc.propertyId)
    .then(() => true)
    .catch(() => authorize("view_financial_reports", doc.propertyId).then(() => true).catch(() => false));
  if (!allowed) return new Response("Not allowed", { status: 403 });
  return new Response(new Uint8Array(doc.bytes), {
    headers: {
      // only the stored types are served; never rendered as HTML
      "content-type": doc.type,
      "content-disposition": `inline; filename="${doc.name.replace(/[^\w.\- ]/g, "_")}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      "cache-control": "private, no-store",
    },
  });
}
