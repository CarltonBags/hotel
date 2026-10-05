import { exitExport, logReportExport } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The exit export as one zip file (ticket 89): the Owner's, open through every stage of non-payment; logged. */
export async function GET(): Promise<Response> {
  let p;
  try {
    p = await authorize("delete_tenant");
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (p.session.support) return new Response("Not found", { status: 404 });
  const { zip, counts } = await exitExport(pool(), p.tenant.schemaName, p.tenant.name);
  await logReportExport(pool(), p.tenant.schemaName, { userId: p.session.user.id, kind: "exit", propertyIds: [], format: "csv", rowCount: Object.values(counts).reduce((a, b) => a + b, 0) });
  return new Response(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${p.tenant.slug}-export-${new Date().toISOString().slice(0, 10)}.zip"`, "cache-control": "private, no-store" } });
}
