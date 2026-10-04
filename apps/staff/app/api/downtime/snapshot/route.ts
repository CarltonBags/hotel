import { emergencyReport } from "@hoteloftware/db";
import { allowedAmong } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { downtimeKey } from "@/lib/downtime";
import { loadShell } from "@/lib/shell";
import { currentSession } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** The lists the desk keeps for an outage, with the key to keep them encrypted (ticket 86). */
export async function GET(): Promise<Response> {
  // signed out: answered plainly, so the browser wipes its copy (not redirected to the sign-in page)
  if (!(await currentSession())) return new Response(null, { status: 401 });
  const shell = await loadShell();
  const { tenant, session } = shell.principal;
  const scope = shell.properties.find((p) => p.id === shell.scope);
  const [property] = scope ? await allowedAmong("use_downtime", [scope]) : [];
  if (!property) return new Response(null, { status: 204 });
  const report = await emergencyReport(pool(), tenant.schemaName, property.id);
  return Response.json({ key: downtimeKey(tenant.id, session.user.id, session.session.id), userId: session.user.id, report }, { headers: { "cache-control": "private, no-store" } });
}
