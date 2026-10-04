import { floorDay } from "@hoteloftware/db";
import { floorContext } from "@/lib/floor";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The phone's day, fetched again whenever it is online. */
export async function GET(): Promise<Response> {
  const ctx = await floorContext();
  if (!ctx) return new Response(null, { status: 401 });
  const day = await floorDay(pool(), ctx.tenant.schemaName, ctx.propertyId, { userId: ctx.session.user.id, actor: ctx.actor });
  return Response.json(day, { headers: { "cache-control": "no-store" } });
}
