import type { IncomingMessage, ServerResponse } from "node:http";
import type { Pool } from "pg";
import { bridgeByToken, bridgeCheckIn, bridgePluginCode, listTenantUsers, lostSiteBridges, type BridgePluginReport, type Tenant } from "@hoteloftware/db";
import { rolesAt } from "@hoteloftware/domain";
import { publishNotification } from "@hoteloftware/events";

/**
 * The Site Bridge's way in (ticket 68, ADR 0014): it only ever calls out to
 * us. A call reports and answers, and is held open up to 20 seconds until
 * there is something to do, so commands reach the hotel at once without any
 * port open there.
 */
const HOLD_MS = 20_000;

function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

const json = (res: ServerResponse, status: number, body: unknown): void => void res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));

/** Tell the property's Property Managers about their Bridge (lost, or back). */
async function tellManagers(pool: Pool, tenantId: string, propertyId: string, title: string, body: string): Promise<void> {
  for (const u of await listTenantUsers(pool, tenantId)) {
    if (rolesAt({ propertyRoles: u.propertyRoles }, propertyId).includes("property_manager") || u.tenantRole === "owner") {
      await publishNotification(pool, { tenantId, userId: u.id, kind: "bridge.health", title, body, href: "/settings/site-bridge" });
    }
  }
}

export async function bridgePoll(pool: Pool, req: IncomingMessage, res: ServerResponse, readBody: () => Promise<string>): Promise<void> {
  const auth = await bridgeByToken(pool, bearer(req));
  if (!auth) return json(res, 401, { error: "unknown or revoked token" });
  let body: { version?: unknown; plugins?: unknown; results?: unknown };
  try {
    body = JSON.parse(await readBody()) as typeof body;
  } catch {
    return json(res, 400, { error: "not JSON" });
  }
  const report = { version: String(body.version ?? ""), plugins: (Array.isArray(body.plugins) ? body.plugins : []) as BridgePluginReport[], results: (Array.isArray(body.results) ? body.results : []) as { id: string; ok: boolean; result?: unknown; error?: string }[] };
  let r = await bridgeCheckIn(pool, auth.schema, auth.bridgeId, report);
  if (r.wasAlerted) await tellManagers(pool, auth.tenantId, r.propertyId, `Site Bridge "${r.name}" is back`, "Locks and tills on the hotel's network work again.");
  // nothing to do yet: hold the call a while, so a command reaches the Bridge as soon as there is one
  const end = Date.now() + HOLD_MS;
  let open = true;
  req.on("close", () => (open = false));
  while (!r.commands.length && open && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    r = await bridgeCheckIn(pool, auth.schema, auth.bridgeId, { ...report, results: [] });
  }
  if (open) json(res, 200, { commands: r.commands });
}

export async function bridgePluginDownload(pool: Pool, req: IncomingMessage, res: ServerResponse, name: string, version: string): Promise<void> {
  const auth = await bridgeByToken(pool, bearer(req));
  if (!auth) return json(res, 401, { error: "unknown or revoked token" });
  const p = await bridgePluginCode(pool, auth.schema, auth.bridgeId, name, version);
  if (!p) return json(res, 404, { error: "not pushed to this Bridge" });
  json(res, 200, p);
}

/** Every minute: Bridges gone quiet three minutes ago alert their Property Managers, once. */
export async function alertLostBridges(pool: Pool, tenant: Tenant): Promise<number> {
  const lost = await lostSiteBridges(pool, tenant.schemaName);
  for (const b of lost) await tellManagers(pool, tenant.id, b.propertyId, `Site Bridge "${b.name}" is not reachable`, "Key cards and the till on the hotel's network may not work. Check the lock PC is on and online.");
  return lost.length;
}
