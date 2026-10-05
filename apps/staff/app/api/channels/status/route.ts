import { channelOverview } from "@hoteloftware/db";
import { channelStatusText, isLanguage } from "@hoteloftware/domain";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The rates grid header's line (ticket 37), fetched again while the grid is open. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const propertyId = url.searchParams.get("property") ?? "";
  const language = url.searchParams.get("lang") ?? "en";
  const timeZone = url.searchParams.get("tz") ?? "Europe/Berlin";
  let tenant;
  try {
    ({ tenant } = await authorize("manage_rates", propertyId));
  } catch {
    return new Response(null, { status: 403 });
  }
  const { status } = await channelOverview(pool(), tenant.schemaName, propertyId);
  const lang = isLanguage(language) ? language : "en";
  let at: string | null = null;
  try {
    at = status.lastSentAt ? new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", { timeStyle: "short", timeZone }).format(status.lastSentAt) : null;
  } catch {
    at = null;
  }
  return Response.json({ text: channelStatusText(status, lang, at), failing: status.failing, pending: status.pending, error: status.lastError }, { headers: { "cache-control": "no-store" } });
}
