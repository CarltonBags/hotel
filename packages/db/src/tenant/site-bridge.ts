import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { bridgeAlertDue, bridgeOnline, can, type LockCapabilities } from "@hoteloftware/domain";
import { LockRefused, LockUnavailable, type CardRead, type IssuedKey, type KeyRequest, type LockPlugin } from "@hoteloftware/locks";
import { isUuid } from "./catalogue-common";
import type { Viewer } from "./room-state";
import { withTenant } from "./with-tenant";

/**
 * The Site Bridge (ticket 68, ADR 0014): our program on the hotel's lock PC.
 * It only ever calls out: each call reports its version, plugins and their
 * health and the answers to what it was asked, and takes the next commands.
 * Its token names the tenant. Plugins are versioned and pushed from our side.
 */

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export interface BridgePluginReport {
  name: string;
  version: string;
  kind: "lock" | "till";
  capabilities?: LockCapabilities | undefined;
  health?: { ok: boolean; detail: string } | undefined;
}

export interface BridgeCommand {
  id: string;
  kind: "lock" | "plugin_install";
  payload: Record<string, unknown>;
}

function needSettings(viewer: Viewer, propertyId: string): void {
  if (!can(viewer.actor, "manage_property_settings", propertyId)) throw new Error("Only the Property Manager sets up the Site Bridge");
}

/** A Bridge enrolled for the property: its token, shown this once, goes into the Bridge's configuration. */
export async function enrollSiteBridge(pool: Pool, schema: string, tenantId: string, propertyId: string, name: string, viewer: Viewer): Promise<{ id: string; token: string }> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  needSettings(viewer, propertyId);
  const label = name.trim();
  if (!label || label.length > 60) throw new Error("Name the Bridge (the PC it runs on)");
  const token = `hsb_${randomBytes(32).toString("hex")}`;
  const id = await withTenant(pool, schema, async (tx) => (await tx.query<{ id: string }>("insert into site_bridges (property_id, name, enrolled_by) values ($1, $2, $3) returning id", [propertyId, label, viewer.userId])).rows[0]!.id);
  await pool.query("insert into control.bridge_tokens (token_hash, tenant_id, bridge_id) values ($1, $2, $3)", [hash(token), tenantId, id]);
  return { id, token };
}

/** A Bridge no longer trusted: its token stops working at once. */
export async function revokeSiteBridge(pool: Pool, schema: string, bridgeId: string, viewer: Viewer): Promise<void> {
  if (!isUuid(bridgeId)) throw new Error("Bridge not found");
  await withTenant(pool, schema, async (tx) => {
    const b = (await tx.query<{ property_id: string }>("select property_id from site_bridges where id = $1", [bridgeId])).rows[0];
    if (!b) throw new Error("Bridge not found");
    needSettings(viewer, b.property_id);
    await tx.query("update site_bridges set revoked_at = clock_timestamp() where id = $1 and revoked_at is null", [bridgeId]);
  });
  await pool.query("delete from control.bridge_tokens where bridge_id = $1", [bridgeId]);
}

/** Whose Bridge a token is: tenant schema and Bridge; null for a wrong or revoked token. */
export async function bridgeByToken(pool: Pool, token: string): Promise<{ tenantId: string; schema: string; bridgeId: string } | null> {
  if (!/^hsb_[0-9a-f]{64}$/.test(token)) return null;
  const r = (await pool.query<{ tenant_id: string; schema_name: string; bridge_id: string }>("select b.tenant_id, t.schema_name, b.bridge_id from control.bridge_tokens b join control.tenants t on t.id = b.tenant_id where b.token_hash = $1", [hash(token)])).rows[0];
  return r ? { tenantId: r.tenant_id, schema: r.schema_name, bridgeId: r.bridge_id } : null;
}

/**
 * A Bridge's call: what it reports is kept, its answers close their commands,
 * and the commands waiting for it are handed over (a command handed over a
 * minute ago without an answer is handed over again). Says whether it was
 * offline (the Property Manager hears it is back).
 */
export async function bridgeCheckIn(
  pool: Pool,
  schema: string,
  bridgeId: string,
  report: { version: string; plugins: BridgePluginReport[]; results: { id: string; ok: boolean; result?: unknown; error?: string }[] },
): Promise<{ commands: BridgeCommand[]; wasAlerted: boolean; propertyId: string; name: string }> {
  return withTenant(pool, schema, async (tx) => {
    const b = (await tx.query<{ property_id: string; name: string; alerted_at: Date | null; last_seen_at: Date | null }>("select property_id, name, alerted_at, last_seen_at from site_bridges where id = $1 and revoked_at is null for update", [bridgeId])).rows[0];
    if (!b) throw new Error("Bridge not found");
    const wasAlerted = !!b.alerted_at;
    const plugins = report.plugins.slice(0, 50).map((p) => ({ name: String(p.name).slice(0, 40), version: String(p.version).slice(0, 20), kind: p.kind, capabilities: p.capabilities ?? null, health: p.health ?? null }));
    // back from an alerted silence: the alert is closed, the next silence alerts anew
    await tx.query("update site_bridges set last_seen_at = clock_timestamp(), version = $2, plugins = $3, alerted_at = null where id = $1", [bridgeId, String(report.version).slice(0, 20), JSON.stringify(plugins)]);
    for (const r of report.results.slice(0, 100)) {
      if (!isUuid(r.id)) continue;
      await tx.query("update bridge_commands set state = $3, result = $4, error = $5, done_at = clock_timestamp() where id = $1 and bridge_id = $2 and state in ('queued', 'sent')", [
        r.id,
        bridgeId,
        r.ok ? "done" : "failed",
        r.ok ? JSON.stringify(r.result ?? null) : null,
        r.ok ? null : String(r.error ?? "failed").slice(0, 300),
      ]);
    }
    const commands = (await tx.query<{ id: string; kind: BridgeCommand["kind"]; payload: Record<string, unknown> }>(
      `update bridge_commands set state = 'sent', sent_at = clock_timestamp()
       where id in (select id from bridge_commands where bridge_id = $1 and (state = 'queued' or (state = 'sent' and sent_at < clock_timestamp() - interval '1 minute')) order by created_at limit 20 for update skip locked)
       returning id, kind, payload`,
      [bridgeId],
    )).rows;
    return { commands, wasAlerted, propertyId: b.property_id, name: b.name };
  });
}

/** Something asked of a Bridge; the answer comes with one of its next calls. */
export async function sendBridgeCommand(pool: Pool, schema: string, bridgeId: string, kind: BridgeCommand["kind"], payload: Record<string, unknown>): Promise<string> {
  return withTenant(pool, schema, async (tx) => (await tx.query<{ id: string }>("insert into bridge_commands (bridge_id, kind, payload) values ($1, $2, $3) returning id", [bridgeId, kind, JSON.stringify(payload)])).rows[0]!.id);
}

/** The answer to a command, waited for; no answer in time: the lock system counts as unavailable (the command lapses). */
export async function awaitBridgeCommand(pool: Pool, schema: string, commandId: string, timeoutMs = 30_000): Promise<unknown> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const c = await withTenant(pool, schema, async (tx) => (await tx.query<{ state: string; result: unknown; error: string | null }>("select state, result, error from bridge_commands where id = $1", [commandId])).rows[0]);
    if (c?.state === "done") return c.result;
    if (c?.state === "failed") throw c.error?.startsWith("refused:") ? new LockRefused(c.error.slice(8).trim()) : new LockUnavailable(c.error ?? "The Bridge could not do it");
    if (Date.now() > end) {
      await withTenant(pool, schema, (tx) => tx.query("update bridge_commands set state = 'failed', error = 'no answer in time', done_at = clock_timestamp() where id = $1 and state in ('queued', 'sent')", [commandId]));
      throw new LockUnavailable("The Site Bridge did not answer in time");
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

const date = (v: unknown) => new Date(String(v));

/** A Lock Plugin on the Bridge, used from here like any other: each call a command it carries out and answers. */
export function bridgeLockPlugin(pool: Pool, schema: string, bridgeId: string, plugin: string, capabilities: LockCapabilities, timeoutMs = 30_000): LockPlugin {
  const run = async (op: string, args: unknown[]) => awaitBridgeCommand(pool, schema, await sendBridgeCommand(pool, schema, bridgeId, "lock", { plugin, op, args }), timeoutMs);
  return {
    name: `bridge:${plugin}`,
    capabilities,
    issueKey: async (r: KeyRequest) => (await run("issueKey", [r])) as IssuedKey,
    updateKey: async (externalId: string, r: KeyRequest) => {
      await run("updateKey", [externalId, r]);
    },
    revokeKey: async (externalId: string, lockRef: string) => {
      await run("revokeKey", [externalId, lockRef]);
    },
    revokeByKeyId: async (keyId: string, lockRef: string) => {
      await run("revokeByKeyId", [keyId, lockRef]);
    },
    readCard: async (encoderId: string) => {
      const c = (await run("readCard", [encoderId])) as { lockRef: string; validUntil: string; externalId: string | null } | null;
      return c ? ({ lockRef: c.lockRef, validUntil: date(c.validUntil), externalId: c.externalId } satisfies CardRead) : null;
    },
    listEncoders: async () => (await run("listEncoders", [])) as { id: string; name: string }[],
    health: async () => (await run("health", [])) as { ok: boolean; detail: string },
  };
}

export interface SiteBridgeView {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  version: string | null;
  plugins: { name: string; version: string; kind: string; capabilities: LockCapabilities | null; health: { ok: boolean; detail: string } | null }[];
  wanted: Record<string, string>;
}

/** The property's Bridges with their state, for the settings page. */
export async function siteBridges(pool: Pool, schema: string, propertyId: string, viewer: Viewer, now = new Date()): Promise<SiteBridgeView[]> {
  if (!isUuid(propertyId)) return [];
  needSettings(viewer, propertyId);
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; name: string; last_seen_at: Date | null; version: string | null; plugins: SiteBridgeView["plugins"]; wanted: Record<string, string> }>(
      "select id, name, last_seen_at, version, plugins, wanted from site_bridges where property_id = $1 and revoked_at is null order by enrolled_at",
      [propertyId],
    )).rows.map((b) => ({ id: b.id, name: b.name, online: bridgeOnline(b.last_seen_at, now), lastSeenAt: b.last_seen_at?.toISOString() ?? null, version: b.version, plugins: b.plugins, wanted: b.wanted })),
  );
}

// ── plugins ──

/** A plugin version published for Bridges (our side; checked by the CLI before it gets here). */
export async function publishBridgePlugin(pool: Pool, p: { name: string; version: string; kind: "lock" | "till"; code: string }): Promise<string> {
  const sha256 = createHash("sha256").update(p.code).digest("hex");
  await pool.query("insert into control.bridge_plugin_versions (name, version, kind, code, sha256) values ($1, $2, $3, $4, $5)", [p.name, p.version, p.kind, p.code, sha256]);
  return sha256;
}

export async function bridgePluginVersions(pool: Pool): Promise<{ name: string; version: string; kind: string; publishedAt: string }[]> {
  return (await pool.query<{ name: string; version: string; kind: string; published_at: Date }>("select name, version, kind, published_at from control.bridge_plugin_versions order by name, published_at")).rows.map((r) => ({ name: r.name, version: r.version, kind: r.kind, publishedAt: r.published_at.toISOString() }));
}

/** The code of a plugin version, for a Bridge that was told to install it. */
export async function bridgePluginCode(pool: Pool, schema: string, bridgeId: string, name: string, version: string): Promise<{ code: string; sha256: string } | null> {
  const wanted = await withTenant(pool, schema, async (tx) => (await tx.query<{ wanted: Record<string, string> }>("select wanted from site_bridges where id = $1 and revoked_at is null", [bridgeId])).rows[0]?.wanted);
  if (wanted?.[name] !== version) return null;
  return (await pool.query<{ code: string; sha256: string }>("select code, sha256 from control.bridge_plugin_versions where name = $1 and version = $2", [name, version])).rows[0] ?? null;
}

/** A plugin version pushed to a Bridge: it fetches, checks and activates it on its next call, without a reinstall. */
export async function pushBridgePlugin(pool: Pool, schema: string, bridgeId: string, name: string, version: string, viewer: Viewer): Promise<string> {
  if (!isUuid(bridgeId)) throw new Error("Bridge not found");
  const v = (await pool.query<{ sha256: string }>("select sha256 from control.bridge_plugin_versions where name = $1 and version = $2", [name, version])).rows[0];
  if (!v) throw new Error("No such plugin version");
  return withTenant(pool, schema, async (tx) => {
    const b = (await tx.query<{ property_id: string }>("select property_id from site_bridges where id = $1 and revoked_at is null for update", [bridgeId])).rows[0];
    if (!b) throw new Error("Bridge not found");
    needSettings(viewer, b.property_id);
    await tx.query("update site_bridges set wanted = wanted || jsonb_build_object($2::text, $3::text) where id = $1", [bridgeId, name, version]);
    return (await tx.query<{ id: string }>("insert into bridge_commands (bridge_id, kind, payload) values ($1, 'plugin_install', $2) returning id", [bridgeId, JSON.stringify({ name, version, sha256: v.sha256 })])).rows[0]!.id;
  });
}

// ── health ──

/** The Bridges gone quiet past the alert time, marked alerted: the worker tells their Property Managers. */
export async function lostSiteBridges(pool: Pool, schema: string, now = new Date()): Promise<{ id: string; propertyId: string; name: string; lastSeenAt: string }[]> {
  return withTenant(pool, schema, async (tx) => {
    const rows = (await tx.query<{ id: string; property_id: string; name: string; last_seen_at: Date | null; alerted_at: Date | null }>("select id, property_id, name, last_seen_at, alerted_at from site_bridges where revoked_at is null and last_seen_at is not null for update skip locked")).rows;
    const due = rows.filter((b) => bridgeAlertDue(b.last_seen_at, b.alerted_at, now));
    for (const b of due) await tx.query("update site_bridges set alerted_at = $2 where id = $1", [b.id, now]);
    return due.map((b) => ({ id: b.id, propertyId: b.property_id, name: b.name, lastSeenAt: b.last_seen_at!.toISOString() }));
  });
}
