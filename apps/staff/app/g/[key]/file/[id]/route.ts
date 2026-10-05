import { portalConversationFile } from "@hoteloftware/db";
import { belongsTo, fileStore } from "@hoteloftware/storage";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** An image or PDF of the guest's own Conversation (ticket 42): the Portal Link is the authority, Internal Notes' files never open. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string; id: string }> }): Promise<Response> {
  const { key, id } = await params;
  const tenant = await currentTenant();
  const file = tenant ? await portalConversationFile(pool(), tenant.schemaName, key, id) : null;
  if (!tenant || !file || !belongsTo(file.key, tenant.id)) return new Response(null, { status: 404 });
  const bytes = await fileStore().get(file.key);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": file.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "content-disposition": "inline", "referrer-policy": "no-referrer" },
  });
}
