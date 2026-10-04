import { createHmac } from "node:crypto";
import { env } from "./env";

/**
 * The key the desk's browser encrypts its offline lists with (ticket 86):
 * derived per tenant and user from the app secret, handed only to that user
 * signed in, kept by the browser in memory only. A copy on disk cannot be read
 * without signing in again. Server only.
 */
export function downtimeKey(tenantId: string, userId: string): string {
  return createHmac("sha256", env.authSecret).update(`downtime:${tenantId}:${userId}`).digest("base64");
}
