import { tabletState, tabletStep, type TabletInput } from "@hoteloftware/db";
import { pool } from "@/lib/db";
import { currentTablet } from "@/lib/tablet";

export const dynamic = "force-dynamic";

/** What the guest tablet shows now (ticket 45): the person whose turn it is, or idle. */
export async function GET(): Promise<Response> {
  const t = await currentTablet();
  if (!t) return new Response(null, { status: 401 });
  const state = await tabletState(pool(), t.tenant.schemaName, t.device.id);
  return Response.json({ device: t.device.name, state }, { headers: { "cache-control": "no-store" } });
}

/** The guest moves one step; only the person whose turn it is on this tablet. */
export async function POST(req: Request): Promise<Response> {
  const t = await currentTablet();
  if (!t) return new Response(null, { status: 401 });
  const body = (await req.json().catch(() => null)) as { personId?: string; input?: TabletInput & { signature?: string } } | null;
  if (!body?.personId || !body.input) return new Response("Bad request", { status: 400 });
  const input: TabletInput =
    body.input.step === "review"
      ? { step: "review", signaturePng: body.input.signature ? Uint8Array.from(Buffer.from(body.input.signature.replace(/^data:image\/png;base64,/, ""), "base64")) : null }
      : body.input;
  try {
    await tabletStep(pool(), t.tenant.schemaName, { id: t.device.id, name: t.device.name }, body.personId, input);
    return new Response(null, { status: 204 });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "error" }, { status: 409 });
  }
}
