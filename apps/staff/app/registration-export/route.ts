import { tessinExport } from "@hoteloftware/db";
import { tessinCsv, tessinXml } from "@hoteloftware/domain";
import { can } from "@hoteloftware/domain";
import { requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Tessin's export (ticket 47): the CSV of completed forms by arrival day, or one form's XML, for upload to the police portal (the desk's daily work, as the forms themselves). */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const propertyId = url.searchParams.get("propertyId") ?? "";
  const { tenant, actor } = await requirePrincipal();
  if (!can(actor, "check_in", propertyId) && !can(actor, "manage_property_settings", propertyId)) return new Response(null, { status: 404 });
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return new Response("Choose the days", { status: 400 });
  const { records } = await tessinExport(pool(), tenant.schemaName, propertyId, from, to).catch(() => ({ records: null }));
  if (!records) return new Response("No Tessin export for this property", { status: 400 });
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (url.searchParams.get("format") === "xml") {
    const r = records.find((x) => x.personId === url.searchParams.get("person"));
    if (!r || r.problems.length) return new Response(null, { status: 404 });
    return new Response(tessinXml(r), { headers: { ...headers, "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="notifica-${r.reference}.xml"` } });
  }
  return new Response(tessinCsv(records), { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="notifiche-${from}-${to}.csv"` } });
}
