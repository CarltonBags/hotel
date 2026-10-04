import { cashMovementPhoto } from "@hoteloftware/db";
import { requirePrincipal } from "@/lib/authorize";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The photo of a Paid-out's paper receipt, for whoever may see that Cash Book. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const { tenant, session, actor } = await requirePrincipal();
  const photo = await cashMovementPhoto(pool(), tenant.schemaName, id, { userId: session.user.id, actor });
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo.bytes), { headers: { "content-type": photo.type, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
