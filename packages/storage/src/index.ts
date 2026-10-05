import { LocalFileStore } from "./local";
import { S3FileStore } from "./s3";
import { ClamdScanner, FakeScanner, type VirusScanner } from "./scan";
import type { FileStore } from "./store";

export * from "./store";
export { S3FileStore, type S3Config } from "./s3";
export { LocalFileStore } from "./local";
export { ClamdScanner, FakeScanner, type VirusScanner } from "./scan";

/** The file store of this process: the EU bucket when S3_BUCKET is set, else a local directory (refused in production). */
export function fileStore(env: NodeJS.ProcessEnv = process.env): FileStore {
  const g = globalThis as { __hsFiles?: FileStore };
  if (g.__hsFiles) return g.__hsFiles;
  if (env.S3_BUCKET) {
    for (const k of ["S3_ENDPOINT", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) if (!env[k]) throw new Error(`${k} is needed with S3_BUCKET`);
    g.__hsFiles = new S3FileStore({ endpoint: env.S3_ENDPOINT!, region: env.S3_REGION!, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY!, pathStyle: env.S3_PATH_STYLE !== "false" });
  } else {
    if (env.NODE_ENV === "production") throw new Error("S3_BUCKET is not set");
    // both apps run from apps/<name>: one directory at the repo root
    g.__hsFiles = new LocalFileStore(env.FILES_DIR ?? `${process.cwd()}/../../.files`);
  }
  return g.__hsFiles;
}

/** The virus scanner: ClamAV at CLAMD_HOST, else the fake (refused in production). */
export function virusScanner(env: NodeJS.ProcessEnv = process.env): VirusScanner {
  if (env.CLAMD_HOST) return new ClamdScanner(env.CLAMD_HOST, Number(env.CLAMD_PORT ?? 3310));
  if (env.NODE_ENV === "production") throw new Error("CLAMD_HOST is not set");
  return new FakeScanner();
}
