import { visibleFile } from "@hoteloftware/db";
import { belongsTo, fileStore } from "@hoteloftware/storage";
import { requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";
import { validFileLink } from "@/lib/files";

export const dynamic = "force-dynamic";

/**
 * A tenant file through its signed link (ticket 36): the link must be valid
 * for this tenant and user, and the user must still have the right to the
 * file. The bucket's own presigned URL (one minute) or the bytes follow.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const { tenant, session, actor } = await requirePrincipal();
  const url = new URL(request.url);
  if (!validFileLink(tenant.id, session.user.id, id, url.searchParams.get("e"), url.searchParams.get("s"))) return new Response(null, { status: 403 });
  const file = await visibleFile(pool(), tenant.schemaName, id, { userId: session.user.id, actor });
  if (!file || !belongsTo(file.key, tenant.id)) return new Response(null, { status: 404 });
  const store = fileStore();
  const direct = store.signedUrl(file.key, 60);
  if (direct) return Response.redirect(direct, 302);
  const bytes = await store.get(file.key);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": file.contentType, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox", "content-disposition": "inline" },
  });
}
