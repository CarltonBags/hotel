import { postTillCharge } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { bearer, body, json, refused, tillOf } from "@/lib/till-api";

export const dynamic = "force-dynamic";

interface ChargeBody {
  id?: unknown;
  reservationId?: unknown;
  receiptNumber?: unknown;
  fiscalId?: unknown;
  items?: unknown;
  totals?: unknown;
  tip?: unknown;
}

const list = <T>(v: unknown): T[] | undefined => (Array.isArray(v) ? (v as T[]) : undefined);

/** Post a bill to a room (docs/room-charge-interface.md): 201 posted, 200 the same id again, 422 refused. */
export async function POST(request: Request): Promise<Response> {
  const auth = await tillOf(bearer(request), ["api", "fias"]);
  if (auth instanceof Response) return auth;
  const b = (await body(request)) as ChargeBody | null;
  if (!b || typeof b !== "object") return json({ error: "invalid", message: "The body is not JSON" }, 400);
  try {
    const r = await postTillCharge(pool(), auth.tenant.schemaName, auth.till, {
      externalId: String(b.id ?? ""),
      corrects: null,
      reservationId: String(b.reservationId ?? ""),
      receiptNumber: String(b.receiptNumber ?? ""),
      fiscalId: String(b.fiscalId ?? ""),
      items: list<{ description: string; quantity: number; amount: number; taxRate: number }>(b.items) ?? [],
      totals: list<{ taxRate: number; amount: number }>(b.totals),
      tip: Number(b.tip ?? 0),
    });
    return json({ postingId: r.postingId, chargeIds: r.chargeIds }, r.duplicate ? 200 : 201);
  } catch (err) {
    return refused(err, (error, message) => ({ error, message }));
  }
}
