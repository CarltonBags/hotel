import { tillGuests } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { json, tillOf } from "@/lib/till-api";

export const dynamic = "force-dynamic";

/**
 * Lightspeed Restaurant's room charge search (research "Point-of-sale
 * systems and room charge interfaces"): the key comes in the query, as
 * Lightspeed sends it; only Checked-in guests the till may charge.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const auth = await tillOf(url.searchParams.get("apiKey"), ["lightspeed"]);
  if (auth instanceof Response) return auth;
  if (url.searchParams.get("businessExternalReference") !== auth.till.businessReference) return json({ customerErrorMessage: "Unknown venue" }, 403);
  const guests = await tillGuests(pool(), auth.tenant.schemaName, auth.till, url.searchParams.get("term") ?? "");
  return json({
    reservations: guests.map((g) => ({
      reservationId: g.reservationId,
      roomId: g.room ?? "",
      roomDescription: g.room ? `Room ${g.room}` : "",
      clientName: [g.name, g.firstName].filter(Boolean).join(", "),
      creditLimit: g.remaining,
      blocked: false,
    })),
  });
}
