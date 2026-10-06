import type { LockCapabilities } from "@hoteloftware/domain";
import type { LockPlugin } from "@hoteloftware/locks";

/**
 * A Site Bridge plugin (ADR 0014, ticket 68): one ES module per vendor,
 * versioned and pushed to the Bridge from our side, loaded without a
 * reinstall. Its default export describes it and makes the plugin from the
 * settings the hotel's Bridge keeps (the lock server's address, a user …).
 */
export interface BridgePluginModule {
  name: string;
  version: string;
  kind: "lock" | "till";
  /** For a lock plugin: what it can do (the desk offers only these). */
  capabilities?: LockCapabilities;
  create(config: Record<string, string>): LockPlugin;
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
