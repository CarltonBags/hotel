import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Short-lived signed links to tenant files (ticket 36): a link names the
 * file and is bound to the tenant and the user it was made for; it lasts
 * five minutes. The route also checks the session and the user's right to
 * the file, so a link passed on or a key guessed opens nothing.
 */
const LINK_SECONDS = 300;

function signature(tenantId: string, userId: string, fileId: string, expires: number): string {
  return createHmac("sha256", env.authSecret).update(`file|${tenantId}|${userId}|${fileId}|${expires}`).digest("base64url");
}

export function fileLink(tenantId: string, userId: string, fileId: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + LINK_SECONDS;
  return `/files/${fileId}?e=${expires}&s=${signature(tenantId, userId, fileId, expires)}`;
}

export function validFileLink(tenantId: string, userId: string, fileId: string, expires: string | null, sig: string | null, now = Date.now()): boolean {
  const e = Number(expires);
  if (!sig || !Number.isInteger(e) || e < Math.floor(now / 1000)) return false;
  const given = Buffer.from(sig);
  const expected = Buffer.from(signature(tenantId, userId, fileId, e));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
