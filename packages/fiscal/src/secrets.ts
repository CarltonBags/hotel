import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * The TSS's admin secrets (ticket 51). The admin PIN is derived from the
 * platform's fiscal secret and the TSS id, so it is never stored; the PUK,
 * shown once at creation, is kept sealed with the same secret (AES-256-GCM).
 */
const keyOf = (secret: string) => createHmac("sha256", secret).update("hoteloftware fiscal seal").digest();

export function adminPinFor(secret: string, tssId: string): string {
  if (secret.length < 16) throw new Error("FISCAL_SECRET must be at least 16 characters");
  return createHmac("sha256", secret).update(`admin-pin:${tssId}`).digest("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
}

export function seal(secret: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function unseal(secret: string, sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", keyOf(secret), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(body!), d.final()]).toString("utf8");
}
