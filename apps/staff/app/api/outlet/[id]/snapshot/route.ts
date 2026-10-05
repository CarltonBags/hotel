import { outletSnapshot } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { authorizeOutlet } from "@/lib/outlets";

export const dynamic = "force-dynamic";

/** What the outlet's device keeps for selling offline (ticket 62): menu, tables, printers, open bills, the in-house list with tonight's limits. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { tenant, viewer } = await authorizeOutlet("outlet_cash", { outletId: id });
    return Response.json(await outletSnapshot(pool(), tenant.schemaName, id, viewer), { headers: { "cache-control": "private, no-store" } });
  } catch {
    return new Response("Not allowed", { status: 403 });
  }
}
