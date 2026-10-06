import { postTillCharge } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { bearer, body, json, refused, tillOf } from "@/lib/till-api";

export const dynamic = "force-dynamic";

/** Take a whole posted bill back (docs/room-charge-interface.md): a Correction of each of its Charges. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await tillOf(bearer(request), "api");
  if (auth instanceof Response) return auth;
  const b = (await body(request)) as { id?: unknown; receiptNumber?: unknown; fiscalId?: unknown } | null;
  if (!b || typeof b !== "object") return json({ error: "invalid", message: "The body is not JSON" }, 400);
  try {
    const r = await postTillCharge(pool(), auth.tenant.schemaName, auth.till, {
      externalId: String(b.id ?? ""),
      corrects: decodeURIComponent((await params).id),
      reservationId: "",
      receiptNumber: String(b.receiptNumber ?? ""),
      fiscalId: String(b.fiscalId ?? ""),
      items: [],
      tip: 0,
    });
    return json({ postingId: r.postingId, chargeIds: r.chargeIds }, r.duplicate ? 200 : 201);
  } catch (err) {
    return refused(err, (error, message) => ({ error, message }));
  }
}
