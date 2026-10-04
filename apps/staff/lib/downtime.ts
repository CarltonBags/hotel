import { createHmac } from "node:crypto";
import { env } from "./env";

/**
 * The key the desk's browser encrypts its offline lists with (ticket 86):
 * derived per sign-in session from the app secret, handed only to that
 * session, kept by the browser in memory only. A copy on disk cannot be read
 * without that sign-in, and a key seen once opens nothing after sign-out.
 * Server only.
 */
export function downtimeKey(tenantId: string, userId: string, sessionId: string): string {
  return createHmac("sha256", env.authSecret).update(`downtime:${tenantId}:${userId}:${sessionId}`).digest("base64");
}
