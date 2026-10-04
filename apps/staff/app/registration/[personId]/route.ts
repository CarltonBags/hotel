import { findReservation, registrationDocument, registrationPdf } from "@hoteloftware/db";
import { renderMeldescheinPdf } from "@hoteloftware/invoices";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

/** A person's Meldeschein: the stored form once complete, else the current one to print for signing at the desk (ticket 45). */
export async function GET(_req: Request, { params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const { tenant } = await requirePrincipal();
  const stored = await registrationPdf(pool(), tenant.schemaName, personId);
  let doc;
  try {
    doc = stored ? null : await registrationDocument(pool(), tenant.schemaName, personId);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const propertyId = stored?.propertyId ?? (await findReservation(pool(), tenant.schemaName, doc!.reservationId))?.propertyId;
  if (!propertyId) return new Response("Not found", { status: 404 });
  try {
    await authorize("check_in", propertyId);
  } catch {
    return new Response("Not allowed", { status: 403 });
  }
  const bytes = stored ? stored.pdf : await renderMeldescheinPdf({ ...doc!, signature: doc!.signature ? new Uint8Array(doc!.signature) : null });
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="meldeschein-${personId.slice(0, 8)}.pdf"`, "cache-control": "private, no-store" } });
}
