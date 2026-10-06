import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BridgeRuntime } from "../src";

/** Seam: the Bridge runtime installs pushed versions by hash, keeps an older one sent back across a restart, and runs only lock operations. */
describe("Bridge runtime", () => {
  it("a version sent back stays active after a restart; a wrong hash or a foreign name is refused", async () => {
    const base = await readFile(resolve(import.meta.dirname, "../template/simulated-onprem.mjs"), "utf8");
    const code: Record<string, string> = { "1.0.0": base, "1.1.0": base.replace('version: "1.0.0"', 'version: "1.1.0"'), "2.0.0": base.replace('name: "simulated-onprem"', 'name: "other-plugin"').replace('version: "1.0.0"', 'version: "2.0.0"') };
    const sha = (v: string) => createHash("sha256").update(code[v]!).digest("hex");
    const pluginsDir = await mkdtemp(join(tmpdir(), "rt-"));
    const make = () => new BridgeRuntime({ pluginsDir, config: {}, fetchPlugin: async (_n, v) => ({ code: code[v]!, sha256: sha(v) }) });
    const rt = make();
    await rt.install("simulated-onprem", "1.1.0", sha("1.1.0"));
    await rt.install("simulated-onprem", "1.0.0", sha("1.0.0"));
    await expect(rt.install("simulated-onprem", "1.1.0", "0".repeat(64))).rejects.toThrow(/hash/);
    await expect(rt.install("simulated-onprem", "2.0.0", sha("2.0.0"))).rejects.toThrow(/not simulated-onprem/);
    const again = make();
    await again.loadInstalled();
    expect((await again.report()).plugins.map((p) => [p.name, p.version])).toEqual([["simulated-onprem", "1.0.0"]]);
    expect(await again.execute({ id: "c1", kind: "lock", payload: { plugin: "simulated-onprem", op: "constructor", args: [] } })).toMatchObject({ ok: false, error: "No operation constructor" });
    expect(await again.execute({ id: "c2", kind: "lock", payload: { plugin: "simulated-onprem", op: "health", args: [], expiresAt: new Date(Date.now() - 1000).toISOString() } })).toMatchObject({ ok: false, error: "expired before it arrived" });
  });
});
