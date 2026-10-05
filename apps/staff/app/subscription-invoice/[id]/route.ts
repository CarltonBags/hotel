import { subscriptionInvoiceFile } from "@hoteloftware/db";
import { authorize } from "@/lib/authorize";
import { pool } from "@/lib/db";

/** A subscription invoice as PDF (ZUGFeRD) or XRechnung, the Owner's alone (ticket 88). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let tenant;
  try {
    ({ tenant } = await authorize("manage_subscription"));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const { id } = await params;
  const kind = new URL(req.url).searchParams.get("f") === "xml" ? "xml" : "pdf";
  const file = /^[0-9a-f-]{36}$/.test(id) ? await subscriptionInvoiceFile(pool(), tenant.id, id, kind) : null;
  if (!file) return new Response("Not found", { status: 404 });
  return kind === "pdf"
    ? new Response(new Uint8Array(file as Buffer), { headers: { "content-type": "application/pdf", "content-disposition": "inline", "cache-control": "private, no-store" } })
    : new Response(file as string, { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": "attachment", "cache-control": "private, no-store" } });
}
