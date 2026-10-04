import { cookies } from "next/headers";
import { DEVICE_COOKIE, changeKeyUser, deviceByToken } from "@hoteloftware/auth";
import { applyPhoneChange, loadActor, type PhoneChangeOutcome } from "@hoteloftware/db";
import { parsePhoneOp } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { floorContext } from "@/lib/floor";
import { currentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Changes a phone made, perhaps offline, sent now. Each batch belongs to one
 * user: on an enrolled Device the change key the phone kept says whose they
 * are (also when someone else signed in since, or the Device is locked);
 * elsewhere the signed-in user. Each change is applied once.
 */
export async function POST(request: Request): Promise<Response> {
  const tenant = await currentTenant();
  if (!tenant) return new Response(null, { status: 404 });
  const body = (await request.json().catch(() => null)) as { key?: unknown; changes?: unknown } | null;
  if (!body || !Array.isArray(body.changes) || body.changes.length > 50) return new Response(null, { status: 400 });

  let userId: string;
  let propertyId: string;
  if (typeof body.key === "string" && body.key) {
    const device = await deviceByToken(pool(), (await cookies()).get(DEVICE_COOKIE)?.value);
    if (!device || device.revoked || device.kind !== "staff" || device.tenantId !== tenant.id) return new Response(null, { status: 403 });
    const owner = await changeKeyUser(pool(), device.id, body.key);
    if (!owner) return new Response(null, { status: 403 });
    userId = owner;
    propertyId = device.propertyId;
  } else {
    const ctx = await floorContext();
    if (!ctx) return new Response(null, { status: 401 });
    userId = ctx.session.user.id;
    propertyId = ctx.propertyId;
  }
  // the user's roles now: someone whose role was taken away cannot send any more
  const actor = await loadActor(pool(), tenant.id, userId);
  const results: ({ id: string } & PhoneChangeOutcome)[] = [];
  for (const raw of body.changes) {
    const id = String((raw as { id?: unknown })?.id ?? "");
    let op;
    try {
      op = parsePhoneOp(raw);
    } catch (err) {
      results.push({ id, outcome: "refused", message: err instanceof Error ? err.message : "Bad change" });
      continue;
    }
    results.push({ id, ...(await applyPhoneChange(pool(), tenant.schemaName, propertyId, op, { userId, actor })) });
  }
  return Response.json({ results }, { headers: { "cache-control": "no-store" } });
}
