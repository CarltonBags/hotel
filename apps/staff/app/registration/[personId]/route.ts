import { registrationDocument, registrationPdf, registrationPersonProperty, renderRegistration } from "@hoteloftware/db";
import { authorize, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

/** A person's Meldeschein: the stored form once complete, else the current one to print for signing at the desk (ticket 45). */
export async function GET(_req: Request, { params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const { tenant } = await requirePrincipal();
  // the right first, from the property alone: nothing of the person is read before
  const propertyId = await registrationPersonProperty(pool(), tenant.schemaName, personId);
  try {
    if (!propertyId) throw new Error();
    await authorize("check_in", propertyId);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const stored = await registrationPdf(pool(), tenant.schemaName, personId);
  const bytes = stored ? stored.pdf : await renderRegistration(await registrationDocument(pool(), tenant.schemaName, personId));
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="meldeschein-${personId.slice(0, 8)}.pdf"`, "cache-control": "private, no-store" } });
}
