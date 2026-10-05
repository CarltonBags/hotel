import { applyOutletOps, receiptByToken, signOutletOrders, type OutletOp } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { fiscalDeps, signIssuedReceipt } from "@/lib/fiscal";
import { authorizeOutlet } from "@/lib/outlets";

export const dynamic = "force-dynamic";

/**
 * What the device did offline (ticket 62), applied once each and in order;
 * then the TSE signs the bills' orders and the Receipts of cash taken
 * (the worker signs whatever is left).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let auth;
  try {
    auth = await authorizeOutlet("outlet_cash", { outletId: id });
  } catch {
    return new Response("Not allowed", { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { device?: unknown; ops?: unknown } | null;
  if (!body || !Array.isArray(body.ops)) return new Response("Bad request", { status: 400 });
  const { tenant, viewer } = auth;
  const results = await applyOutletOps(pool(), tenant.schemaName, id, String(body.device ?? ""), body.ops as OutletOp[], viewer);
  const bills = [...new Set((body.ops as OutletOp[]).map((o) => o.billId))];
  for (const billId of bills) await signOutletOrders(pool(), tenant.schemaName, fiscalDeps(), { billId }).catch((err) => console.error("[fiscal] orders", err));
  for (const r of results.filter((x) => x.receiptToken && !x.repeated)) {
    const receipt = await receiptByToken(pool(), tenant.schemaName, r.receiptToken!);
    if (receipt) await signIssuedReceipt(tenant, receipt.id).catch((err) => console.error("[fiscal] receipt", err));
  }
  return Response.json({ results });
}
