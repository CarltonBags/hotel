import { fiscalArchiveFile } from "@hoteloftware/db";
import { fileStore } from "@hoteloftware/storage";
import { requireAllowed, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** A DSFinV-K export or TSE archive of the property, for whoever manages its cash desk (ticket 51). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { tenant } = await requirePrincipal();
  const f = await fiscalArchiveFile(pool(), tenant.schemaName, fileStore(), (await params).id);
  if (!f) return new Response("Not found", { status: 404 });
  await requireAllowed("manage_cash_desk", f.propertyId);
  const name = `${f.kind === "tss" ? "tse-archiv" : "dsfinv-k"}_${f.periodFrom}_${f.periodTo}.tar`;
  return new Response(Buffer.from(f.bytes), { headers: { "content-type": "application/x-tar", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}
