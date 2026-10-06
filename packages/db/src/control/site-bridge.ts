import { createHash } from "node:crypto";
import type { Pool } from "pg";

/**
 * The Site Bridge's control-side records (ticket 68): a Bridge's token names
 * its tenant; the plugin versions we publish are kept for every Bridge.
 */

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A Bridge's token as stored. */
export const bridgeTokenHash = hash;

/** Whose Bridge a token is: tenant schema and Bridge; null for a wrong or revoked token. */
export async function bridgeByToken(pool: Pool, token: string): Promise<{ tenantId: string; schema: string; bridgeId: string } | null> {
  if (!/^hsb_[0-9a-f]{64}$/.test(token)) return null;
  const r = (await pool.query<{ tenant_id: string; schema_name: string; bridge_id: string }>("select b.tenant_id, t.schema_name, b.bridge_id from control.bridge_tokens b join control.tenants t on t.id = b.tenant_id where b.token_hash = $1", [hash(token)])).rows[0];
  return r ? { tenantId: r.tenant_id, schema: r.schema_name, bridgeId: r.bridge_id } : null;
}

/** A plugin version published for Bridges (our side; checked by the CLI before it gets here). */
export async function publishBridgePlugin(pool: Pool, p: { name: string; version: string; kind: "lock" | "till"; code: string }): Promise<string> {
  const sha256 = createHash("sha256").update(p.code).digest("hex");
  await pool.query("insert into control.bridge_plugin_versions (name, version, kind, code, sha256) values ($1, $2, $3, $4, $5)", [p.name, p.version, p.kind, p.code, sha256]);
  return sha256;
}

/** Every published version, by name and then version number (a hotfix 1.0.1 published after 1.1.0 still sorts before it). */
export async function bridgePluginVersions(pool: Pool): Promise<{ name: string; version: string; kind: string; publishedAt: string }[]> {
  const rows = (await pool.query<{ name: string; version: string; kind: string; published_at: Date }>("select name, version, kind, published_at from control.bridge_plugin_versions")).rows;
  const order = (v: string) => v.split(".").map((n) => n.padStart(6, "0")).join(".");
  return rows
    .sort((a, b) => a.name.localeCompare(b.name) || order(a.version).localeCompare(order(b.version)))
    .map((r) => ({ name: r.name, version: r.version, kind: r.kind, publishedAt: r.published_at.toISOString() }));
}

