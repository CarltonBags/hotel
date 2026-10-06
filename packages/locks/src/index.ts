import type { LockCapabilities } from "@hoteloftware/domain";
import { NukiLocks } from "./nuki";
import type { LockPlugin } from "./plugin";
import { SimulatedLocks } from "./simulated";

export { LockUnavailable, type CardRead, type IssuedKey, type KeyRequest, type LockPlugin } from "./plugin";
export { NukiLocks } from "./nuki";
export { SimulatedLocks } from "./simulated";

/** The lock systems a property can choose; "other" is a system without a plugin yet: keys by its own software. */
export const LOCK_SYSTEMS = ["none", "simulated", "nuki", "other"] as const;
export type LockSystem = (typeof LOCK_SYSTEMS)[number];

/** What each plugin can do, known without connecting (the desk's buttons). */
export const LOCK_CAPABILITIES: Record<"simulated" | "nuki", LockCapabilities> = {
  simulated: new SimulatedLocks().capabilities,
  nuki: new NukiLocks("").capabilities,
};

let simulated: SimulatedLocks | null = null;

/** The plugin of a property's lock system; null where there is none or no plugin (keys by the lock's own software). */
export function lockPlugin(system: string, secret: string | null): LockPlugin | null {
  if (system === "nuki") return secret ? new NukiLocks(secret) : null;
  // one simulated system per process (development and tests only)
  if (system === "simulated") return process.env.NODE_ENV === "production" ? null : (simulated ??= new SimulatedLocks());
  return null;
}
