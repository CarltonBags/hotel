import { signEventsToken } from "@hoteloftware/events";
import { currentSession } from "@/lib/tenant";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** A short-lived token for the worker's live-update stream, bound to the signed-in user and tenant. */
export async function GET(): Promise<Response> {
  const current = await currentSession();
  if (!current) return new Response(null, { status: 401 });
  const token = signEventsToken({ tenantId: current.tenant.id, userId: current.session.user.id }, env.authSecret, 600);
  return Response.json({ token, expiresInSeconds: 600 }, { headers: { "cache-control": "no-store" } });
}
