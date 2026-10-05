import { groupView, listRoomTypes, roomingTemplate } from "@hoteloftware/db";
import { authorizeGroup } from "@/lib/groups";
import { pool } from "@/lib/db";

/** The Rooming List template for the organiser (ticket 59): CSV with the group's room types, opens in Excel. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let auth;
  try {
    auth = await authorizeGroup("view_groups", { groupId: id });
  } catch {
    return new Response("Not allowed", { status: 403 });
  }
  const viewer = { userId: auth.session.user.id, actor: auth.actor };
  const g = await groupView(pool(), auth.tenant.schemaName, id, viewer);
  const held = new Set(g.holdings.flatMap((h) => h.roomTypes.filter((t) => t.nights.some((n) => n.held > 0)).map((t) => t.id)));
  const codes = (await listRoomTypes(pool(), auth.tenant.schemaName, g.propertyId)).filter((t) => held.has(t.id)).map((t) => t.code);
  // a BOM so Excel reads the umlauts
  return new Response(`﻿${roomingTemplate(codes)}`, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="rooming-list-${g.name.replace(/[^\w-]+/g, "-").slice(0, 40)}.csv"`, "cache-control": "private, no-store" },
  });
}
