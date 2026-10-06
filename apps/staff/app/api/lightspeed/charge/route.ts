import { postTillCharge, recordTillRefusal } from "@hoteloftware/db";
import { fromLightspeed, type LightspeedAccount } from "@hoteloftware/domain";
import { pool } from "@/lib/db";
import { body, json, refused, tillOf } from "@/lib/till-api";

export const dynamic = "force-dynamic";

/**
 * Lightspeed Restaurant closes an account to a room: 200 posted (also for
 * the same account again), 400 with a message of at most 50 characters the
 * till shows. A void is a new account pointing to the first: its Correction.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const auth = await tillOf(url.searchParams.get("apiKey"), "lightspeed");
  if (auth instanceof Response) return auth;
  // the venue, where Lightspeed names it, must be this till's
  const venue = url.searchParams.get("businessExternalReference");
  if (venue !== null && venue !== auth.till.businessReference) return json({ customerErrorMessage: "Unknown venue" }, 403);
  const account = (await body(request)) as LightspeedAccount | null;
  if (!account || typeof account !== "object") return json({ customerErrorMessage: "Invalid request" }, 400);
  // the idempotency key stands in where the account carries no id of its own
  const idempotency = request.headers.get("x-lightspeed-idempotency-key");
  const uuid = account.uuid ?? idempotency;
  let posting;
  try {
    posting = fromLightspeed(uuid ? { ...account, uuid } : account);
  } catch (err) {
    // not postable (a split bill, no reservation): listed for staff, the till shows why
    const message = (err instanceof Error ? err.message : "Invalid request").slice(0, 50);
    const reservationId = account.payments?.find((p) => p.pmsReservationId)?.pmsReservationId ?? "";
    await recordTillRefusal(pool(), auth.tenant.schemaName, auth.till, { externalId: uuid ?? "", kind: account.initialAccountId && account.initialAccountId !== uuid ? "correction" : "bill", reservationId, receiptNumber: String(account.receiptId ?? ""), fiscalId: String(account.fiscId ?? "") }, message, account);
    return json({ customerErrorMessage: message }, 400);
  }
  try {
    await postTillCharge(pool(), auth.tenant.schemaName, auth.till, posting);
    return json({ status: "posted" });
  } catch (err) {
    return refused(err, (_code, message) => ({ customerErrorMessage: message.slice(0, 50) }), 400);
  }
}
