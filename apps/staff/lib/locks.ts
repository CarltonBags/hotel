import type { LockDeps } from "@hoteloftware/db";
import { env } from "./env";

/** Door-lock credentials and door PINs are sealed with the platform's auth secret, as in the worker (ticket 67). Server only. */
export function lockDeps(): LockDeps {
  return { sealKey: env.authSecret };
}
