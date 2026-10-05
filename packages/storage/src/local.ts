import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { FileStore } from "./store";

/** Files in a local directory, for development and tests; the app serves them under its own signed links. */
export class LocalFileStore implements FileStore {
  readonly name = "local";
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(`${this.root}/`)) throw new Error("Invalid file key");
    return p;
  }

  async put(key: string, bytes: Uint8Array, _contentType: string): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<number> {
    const dir = this.path(prefix.replace(/\/$/, ""));
    const files = (await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])).filter((e) => e.isFile());
    await rm(dir, { recursive: true, force: true });
    return files.length;
  }

  signedUrl(): null {
    return null;
  }
}
