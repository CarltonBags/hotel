import { portalPhoto } from "@hoteloftware/db";
import { fileStore } from "@hoteloftware/storage";
import { pool } from "@/lib/db";
import { currentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** The property's portal photo behind the glass card (ticket 40), for anyone holding an open link of it. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const tenant = await currentTenant();
  const photo = tenant ? await portalPhoto(pool(), tenant.schemaName, key) : null;
  if (!photo) return new Response(null, { status: 404 });
  const bytes = await fileStore().get(photo.key);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "content-type": photo.contentType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
}
