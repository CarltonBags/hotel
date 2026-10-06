import type { LockCapabilities } from "@hoteloftware/domain";
import { NukiLocks } from "./nuki";
import type { LockPlugin } from "./plugin";
import { SimulatedLocks } from "./simulated";

export { LockRefused, LockUnavailable, type CardRead, type IssuedKey, type KeyRequest, type LockPlugin } from "./plugin";
export { NukiLocks } from "./nuki";
export { SimulatedLocks } from "./simulated";
export { sealLockSecret, unsealLockSecret } from "./seal";

/** The lock systems; "other" is a system without a plugin yet: keys by its own software. */
export const LOCK_SYSTEMS = ["none", "simulated", "nuki", "other"] as const;
export type LockSystem = (typeof LOCK_SYSTEMS)[number];

/** The systems with a plugin (the database's queue trigger names the same). */
export const PLUGIN_SYSTEMS = ["simulated", "nuki"] as const;
export type PluginSystem = (typeof PLUGIN_SYSTEMS)[number];
export const hasPlugin = (system: string): system is PluginSystem => (PLUGIN_SYSTEMS as readonly string[]).includes(system);

/** The systems a property may choose here: the simulated one only outside production. */
export const selectableLockSystems = (): LockSystem[] => LOCK_SYSTEMS.filter((s) => s !== "simulated" || process.env.NODE_ENV !== "production");

/** What each plugin can do, known without connecting (the desk's buttons). */
export const LOCK_CAPABILITIES: Record<PluginSystem, LockCapabilities> = {
  simulated: new SimulatedLocks().capabilities,
  nuki: new NukiLocks("").capabilities,
};

// one simulated system per process: staff and worker each keep their own (tolerant of keys it never saw)
let simulated: SimulatedLocks | null = null;

/** The plugin of a property's lock system; null where there is none or no plugin (keys by the lock's own software). */
export function lockPlugin(system: string, secret: string | null): LockPlugin | null {
  if (system === "nuki") return secret ? new NukiLocks(secret) : null;
  if (system === "simulated") return process.env.NODE_ENV === "production" ? null : (simulated ??= new SimulatedLocks());
  return null;
}
