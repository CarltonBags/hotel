import { selfCheckinLine } from "@hoteloftware/db";
import { can } from "@hoteloftware/domain";
import { accessibleProperties, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The desk's live line of Self Check-in (ticket 49): guests in it now, and how it ended lately, where the user checks guests in. */
export async function GET(request: Request): Promise<Response> {
  const { tenant, actor } = await requirePrincipal();
  const property = new URL(request.url).searchParams.get("property") ?? "";
  const ids = (await accessibleProperties()).filter((p) => p.id === property && can(actor, "check_in", p.id)).map((p) => p.id);
  const line = await selfCheckinLine(pool(), tenant.schemaName, ids);
  return Response.json({ line }, { headers: { "cache-control": "no-store" } });
}
