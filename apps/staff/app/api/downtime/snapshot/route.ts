import { emergencyReport } from "@hoteloftware/db";
import { allowedAmong } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { downtimeKey } from "@/lib/downtime";
import { loadShell } from "@/lib/shell";

export const dynamic = "force-dynamic";

/** The lists the desk keeps for an outage, with the key to keep them encrypted (ticket 86). */
export async function GET(): Promise<Response> {
  const shell = await loadShell();
  const { tenant, session } = shell.principal;
  const scope = shell.properties.find((p) => p.id === shell.scope);
  const [property] = scope ? await allowedAmong("use_downtime", [scope]) : [];
  if (!property) return new Response(null, { status: 204 });
  const report = await emergencyReport(pool(), tenant.schemaName, property.id);
  return Response.json({ key: downtimeKey(tenant.id, session.user.id), userId: session.user.id, report }, { headers: { "cache-control": "private, no-store" } });
}
