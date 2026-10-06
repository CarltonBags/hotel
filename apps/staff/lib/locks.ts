import type { LockDeps } from "@hoteloftware/db";
import { env } from "./env";

/** Door-lock credentials and door PINs are sealed with LOCK_SECRET, as in the worker (ticket 67); the auth secret stands in outside production. Server only. */
export function lockDeps(): LockDeps {
  const secret = process.env.LOCK_SECRET ?? (process.env.NODE_ENV === "production" ? "" : env.authSecret);
  if (!secret) throw new Error("LOCK_SECRET is not set");
  return { sealKey: secret };
}
