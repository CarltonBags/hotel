import { createHash, createHmac } from "node:crypto";
import type { FileStore } from "./store";

export interface S3Config {
  /** e.g. https://s3.eu-central-1.amazonaws.com or a European S3-compatible provider. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Bucket in the path (most S3-compatible providers) or in the host name. */
  pathStyle: boolean;
}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
const amzDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// RFC 3986, as SigV4 wants it
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** S3 with Signature Version 4 over fetch; every object stored with server-side encryption. */
export class S3FileStore implements FileStore {
  readonly name = "s3";
  constructor(
    private readonly c: S3Config,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private target(key: string): { host: string; path: string; origin: string } {
    const u = new URL(this.c.endpoint);
    const objectPath = key.split("/").map(enc).join("/");
    return this.c.pathStyle
      ? { host: u.host, path: `/${enc(this.c.bucket)}/${objectPath}`, origin: `${u.protocol}//${u.host}` }
      : { host: `${this.c.bucket}.${u.host}`, path: `/${objectPath}`, origin: `${u.protocol}//${this.c.bucket}.${u.host}` };
  }

  private signingKey(day: string): Buffer {
    return hmac(hmac(hmac(hmac(`AWS4${this.c.secretAccessKey}`, day), this.c.region), "s3"), "aws4_request");
  }

  /** Signed request headers for a call with a body hash. */
  private signHeaders(method: string, key: string, headers: Record<string, string>, payloadHash: string, now: Date): { url: string; headers: Record<string, string> } {
    const t = this.target(key);
    const date = amzDate(now);
    const day = date.slice(0, 8);
    const all: Record<string, string> = { ...headers, host: t.host, "x-amz-content-sha256": payloadHash, "x-amz-date": date };
    const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
    const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), v.trim()]));
    const canonical = [method, t.path, "", names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), payloadHash].join("\n");
    const scope = `${day}/${this.c.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonical)].join("\n");
    const signature = createHmac("sha256", this.signingKey(day)).update(toSign).digest("hex");
    const { host: _host, ...sent } = lower;
    return { url: `${t.origin}${t.path}`, headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${this.c.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` } };
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const r = this.signHeaders("PUT", key, { "content-type": contentType, "x-amz-server-side-encryption": "AES256" }, sha256(bytes), new Date());
    const res = await this.fetcher(r.url, { method: "PUT", headers: r.headers, body: Buffer.from(bytes), signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Storage refused the file (${res.status})`);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const r = this.signHeaders("GET", key, {}, sha256(""), new Date());
    const res = await this.fetcher(r.url, { headers: r.headers, signal: AbortSignal.timeout(60_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage did not return the file (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const r = this.signHeaders("DELETE", key, {}, sha256(""), new Date());
    const res = await this.fetcher(r.url, { method: "DELETE", headers: r.headers, signal: AbortSignal.timeout(60_000) });
    if (!res.ok && res.status !== 404) throw new Error(`Storage did not delete the file (${res.status})`);
  }

  /** Every object under a prefix, listed a page at a time (ListObjectsV2), each deleted. */
  async deletePrefix(prefix: string): Promise<number> {
    let n = 0;
    for (;;) {
      const url = this.signedUrl("", 60, new Date(), { "list-type": "2", prefix, "max-keys": "1000" });
      const res = await this.fetcher(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Storage did not list the files (${res.status})`);
      const keys = [...(await res.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
      if (!keys.length) return n;
      for (const key of keys) await this.delete(key);
      n += keys.length;
    }
  }

  /** A presigned GET (query-string SigV4); with extra query parameters for a bucket listing. */
  signedUrl(key: string, seconds: number, now = new Date(), extra: Record<string, string> = {}): string {
    // an empty key is the bucket itself, for a listing
    const t = this.target(key);
    const date = amzDate(now);
    const day = date.slice(0, 8);
    const scope = `${day}/${this.c.region}/s3/aws4_request`;
    const params: [string, string][] = [
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${this.c.accessKeyId}/${scope}`],
      ["X-Amz-Date", date],
      ["X-Amz-Expires", String(seconds)],
      ["X-Amz-SignedHeaders", "host"],
      ...Object.entries(extra),
    ];
    const query = params.map(([k, v]) => `${enc(k)}=${enc(v)}`).sort().join("&");
    const canonical = ["GET", t.path, query, `host:${t.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const toSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonical)].join("\n");
    const signature = createHmac("sha256", this.signingKey(day)).update(toSign).digest("hex");
    return `${t.origin}${t.path}?${query}&X-Amz-Signature=${signature}`;
  }
}
