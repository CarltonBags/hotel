import { tillGuests } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { bearer, json, tillOf } from "@/lib/till-api";

export const dynamic = "force-dynamic";

/** Guest lookup (docs/room-charge-interface.md): Checked-in guests the till may charge, by surname or room. */
export async function GET(request: Request): Promise<Response> {
  const auth = await tillOf(bearer(request), "api");
  if (auth instanceof Response) return auth;
  const term = new URL(request.url).searchParams.get("term") ?? "";
  const guests = await tillGuests(pool(), auth.tenant.schemaName, auth.till, term);
  return json({ guests: guests.map((g) => ({ reservationId: g.reservationId, room: g.room, lastName: g.name, firstName: g.firstName, remainingLimit: g.remaining })) });
}
