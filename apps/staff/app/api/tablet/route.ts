import { TabletProblem, tabletState, tabletStep, type TabletInput } from "@hoteloftware/db";
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
const STEPS = ["welcome", "draft", "details", "companions", "back", "review"];
// a signature image and a form's text: far below this
const MAX_BODY = 512 * 1024;

export async function POST(req: Request): Promise<Response> {
  const t = await currentTablet();
  if (!t) return new Response(null, { status: 401 });
  const text = await req.text();
  if (text.length > MAX_BODY) return Response.json({ error: "signature" }, { status: 413 });
  let body: { personId?: unknown; input?: Record<string, unknown> } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // answered below
  }
  if (!body || typeof body.personId !== "string" || !body.input || typeof body.input !== "object" || !STEPS.includes(String(body.input.step))) return new Response("Bad request", { status: 400 });
  const raw = body.input;
  const input = (raw.step === "review" ? { step: "review", signaturePng: typeof raw.signature === "string" ? Uint8Array.from(Buffer.from(raw.signature.replace(/^data:image\/png;base64,/, ""), "base64")) : null } : raw) as TabletInput;
  try {
    await tabletStep(pool(), t.tenant.schemaName, { id: t.device.id, name: t.device.name }, body.personId, input);
    return new Response(null, { status: 204 });
  } catch (err) {
    // the guest sees which field to check, never a database message
    if (err instanceof TabletProblem) return Response.json({ error: err.message }, { status: 422 });
    if (err instanceof Error && /Not on this tablet|done already/.test(err.message)) return Response.json({ error: "moved" }, { status: 409 });
    console.error("[tablet]", err);
    return Response.json({ error: "error" }, { status: 500 });
  }
}
