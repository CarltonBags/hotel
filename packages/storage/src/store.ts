/**
 * Tenant file storage (ticket 36): an EU S3-compatible bucket, one prefix per
 * tenant, encrypted at rest, handed out only through short-lived signed URLs.
 * Development and tests use a local directory.
 */
export interface FileStore {
  readonly name: string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** A URL the browser fetches directly, valid for the given seconds; null when the app serves the file itself. */
  signedUrl(key: string, seconds: number, now?: Date): string | null;
}

/** Every key starts with the tenant's prefix; keys are made here, never taken from a request. */
export function tenantKey(tenantId: string, kind: string, id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(tenantId) || !/^[a-z_]+$/.test(kind) || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid file key part");
  return `${tenantId}/${kind}/${id}`;
}

export function belongsTo(key: string, tenantId: string): boolean {
  return key.startsWith(`${tenantId}/`);
}
