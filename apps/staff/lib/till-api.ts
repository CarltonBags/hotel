import { tillByKey, TillRefusal, type TillConnection, type Tenant } from "@hoteloftware/db";
import { pool } from "./db";
import { currentTenant } from "./tenant";

/**
 * The room charge interface for external tills (ticket 65): no session; the
 * till's key is its only authority, checked on every request against the
 * tenant of the host it calls. Never cached.
 */
export const noStore = { "cache-control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStore });
}

/** The till of a key on this tenant's host, or the answer to send instead. */
export async function tillOf(key: string | null, kind: TillConnection["kind"]): Promise<{ tenant: Tenant; till: TillConnection } | Response> {
  const tenant = await currentTenant();
  const till = tenant && key ? await tillByKey(pool(), tenant.schemaName, key) : null;
  if (!tenant || !till || till.kind !== kind) return json({ error: "unauthorized", message: "Unknown or revoked key" }, 401);
  return { tenant, till };
}

export function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

const MAX_BODY = 256_000;

/** A JSON body of at most 256 KB, or null; a larger one is refused before it is read. */
export async function body(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY) return null;
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** A refusal as the till reads it; anything else is our fault. */
export function refused(err: unknown, shape: (code: string, message: string) => unknown, status = 422): Response {
  if (err instanceof TillRefusal) return json(shape(err.code, err.message), status);
  console.error("till posting failed", err);
  return json(shape("error", "Try again or post at the desk"), 500);
}
