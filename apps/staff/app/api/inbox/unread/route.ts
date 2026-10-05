import { modulePeriods, unreadConversations } from "@hoteloftware/db";
import { can, moduleState, moduleVisible, todayIn } from "@hoteloftware/domain";
import { accessibleProperties, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The navbar badge (ticket 42): unread Conversations at the property in view, or with "All properties" at every one whose inbox the user works (ticket 43). */
export async function GET(request: Request): Promise<Response> {
  const { tenant, actor } = await requirePrincipal();
  const scope = new URL(request.url).searchParams.get("scope") ?? "";
  const inView = (await accessibleProperties()).filter((p) => (!scope || scope === "all" || scope === p.id) && can(actor, "use_guest_inbox", p.id));
  // only where the Guest Portal Module is on, as the inbox itself
  const periods = await modulePeriods(pool(), tenant.schemaName, inView.map((p) => p.id));
  const ids = inView.filter((p) => moduleVisible(moduleState(periods.get(p.id) ?? [], "guest_portal", todayIn(p.timeZone)))).map((p) => p.id);
  const unread = await unreadConversations(pool(), tenant.schemaName, ids);
  return Response.json({ unread }, { headers: { "cache-control": "no-store" } });
}
