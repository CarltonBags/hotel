import { unreadConversations } from "@hoteloftware/db";
import { can } from "@hoteloftware/domain";
import { accessibleProperties, requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The navbar badge (ticket 42): unread Conversations at the property in view, or with "All properties" at every one whose inbox the user works (ticket 43). */
export async function GET(request: Request): Promise<Response> {
  const { tenant, actor } = await requirePrincipal();
  const scope = new URL(request.url).searchParams.get("scope") ?? "";
  const ids = (await accessibleProperties()).map((p) => p.id).filter((id) => (!scope || scope === "all" || scope === id) && can(actor, "use_guest_inbox", id));
  const unread = await unreadConversations(pool(), tenant.schemaName, ids);
  return Response.json({ unread }, { headers: { "cache-control": "no-store" } });
}
