import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Lock-system credentials and door PINs, sealed (AES-256-GCM) with the
 * platform's lock secret (LOCK_SECRET). Rotating it makes what is sealed
 * unreadable: the credentials are entered again and PINs reissued.
 */
const keyOf = (secret: string) => createHmac("sha256", secret).update("hoteloftware lock seal").digest();

export function sealLockSecret(secret: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unsealLockSecret(secret: string, sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", keyOf(secret), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(body!), d.final()]).toString("utf8");
}
