import { floorPhoto } from "@hoteloftware/db";
import { requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** A photo kept with a Maintenance Issue or a found item, for whoever may see it. */
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string; id: string }> }): Promise<Response> {
  const { kind, id } = await params;
  if (kind !== "issue" && kind !== "lost") return new Response(null, { status: 404 });
  const { tenant, session, actor } = await requirePrincipal();
  const photo = await floorPhoto(pool(), tenant.schemaName, kind, id, { userId: session.user.id, actor });
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo.bytes), { headers: { "content-type": photo.type, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
