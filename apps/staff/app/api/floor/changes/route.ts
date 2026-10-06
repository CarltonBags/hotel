import { cookies } from "next/headers";
import { DEVICE_COOKIE, changeKeyUser, deviceByToken } from "@hoteloftware/auth";
import { FileRefused, applyPhoneChange, decodePhoto, loadActor, phoneChangeSeen, storeFile, type PhoneChangeOutcome } from "@hoteloftware/db";
import { fileServices } from "@hoteloftware/storage";
import { can, parsePhoneOp } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { floorContext } from "@/lib/floor";
import { notifyFixed } from "@/lib/maintenance";
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
  // ten changes with a photo each at most; the phone sends in batches of ten
  if (Number(request.headers.get("content-length") ?? "0") > 25_000_000) return new Response(null, { status: 413 });
  const body = (await request.json().catch(() => null)) as { key?: unknown; changes?: unknown } | null;
  if (!body || !Array.isArray(body.changes) || body.changes.length > 10) return new Response(null, { status: 400 });

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
    let photoNote = "";
    // a Maintenance photo goes to file storage first (virus scan, tenant prefix): from someone who may report or fix, once per change
    const photoKind = op.kind === "problem" ? "issue_photo" : op.kind === "issue" && op.step === "fixed" ? "fix_photo" : null;
    const photoRight = photoKind === "issue_photo" ? "report_maintenance_issues" : "work_maintenance";
    if (photoKind && (op.kind === "problem" || op.kind === "issue") && op.photo && can(actor, photoRight, propertyId) && !(await phoneChangeSeen(pool(), tenant.schemaName, op.id))) {
      const photo = decodePhoto(op.photo);
      try {
        op.photoFileId = await storeFile(pool(), tenant.schemaName, fileServices(), { tenantId: tenant.id, kind: photoKind, bytes: new Uint8Array(photo.bytes!), contentType: photo.type!, propertyId, userId });
      } catch (err) {
        // the photo itself refused: the report or fix is kept without it; scanning or storage down: the phone keeps the batch and sends it again
        if (!(err instanceof FileRefused)) {
          console.error(err);
          return new Response(null, { status: 503, headers: { "retry-after": "60" } });
        }
        photoNote = ` (without the photo: ${err.message})`;
      }
    }
    try {
      const outcome = await applyPhoneChange(pool(), tenant.schemaName, propertyId, op, { userId, actor });
      if (outcome.fixed) await notifyFixed(tenant, outcome.fixed);
      results.push({ id, outcome: outcome.outcome, message: outcome.message + (outcome.outcome === "applied" ? photoNote : "") });
    } catch (err) {
      // a database failure on one change must not hold back the others or be retried for ever
      console.error(err);
      results.push({ id, outcome: "refused", message: "Could not be saved" });
    }
  }
  return Response.json({ results }, { headers: { "cache-control": "no-store" } });
}
