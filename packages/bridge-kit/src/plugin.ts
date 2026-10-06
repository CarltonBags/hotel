import type { LockCapabilities } from "@hoteloftware/domain";
import type { LockPlugin } from "@hoteloftware/locks";

/**
 * A Site Bridge plugin (ADR 0014, ticket 68): one ES module per vendor,
 * versioned and pushed to the Bridge from our side, loaded without a
 * reinstall. Its default export describes it and makes the plugin from the
 * settings the hotel's Bridge keeps (the lock server's address, a user …).
 */
/** A till plugin's instance (FIAS): it serves the till on the hotel's network by itself; the Bridge only asks its health and stops it for a new version. */
export interface TillPluginInstance {
  name: string;
  health(): Promise<{ ok: boolean; detail: string }>;
  stop?(): Promise<void>;
}

export type BridgePluginInstance = (LockPlugin & { stop?(): Promise<void> }) | TillPluginInstance;

export interface BridgePluginModule {
  name: string;
  version: string;
  kind: "lock" | "till";
  /** For a lock plugin: what it can do (the desk offers only these). */
  capabilities?: LockCapabilities;
  create(config: Record<string, string>): BridgePluginInstance;
}

/** A module's default export, checked before the Bridge uses it. */
export function asPluginModule(m: unknown): BridgePluginModule {
  const p = (m as { default?: unknown })?.default as Partial<BridgePluginModule> | undefined;
  if (!p || typeof p.name !== "string" || !/^[a-z0-9-]{2,40}$/.test(p.name)) throw new Error("A plugin names itself (a-z, 0-9, -)");
  if (typeof p.version !== "string" || !/^\d+\.\d+\.\d+$/.test(p.version)) throw new Error("A plugin has a version x.y.z");
  if (p.kind !== "lock" && p.kind !== "till") throw new Error("A plugin is a lock or a till plugin");
  if (typeof p.create !== "function") throw new Error("A plugin makes its instance with create(config)");
  return p as BridgePluginModule;
}
