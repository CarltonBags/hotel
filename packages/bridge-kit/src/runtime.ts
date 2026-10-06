import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { KeyRequest, LockPlugin } from "@hoteloftware/locks";
import { asPluginModule, type BridgePluginModule } from "./plugin";

/** The Bridge program's own version (the plugins have theirs). */
export const BRIDGE_VERSION = "1.0.0";

export interface BridgeCommandIn {
  id: string;
  kind: "lock" | "plugin_install";
  payload: Record<string, unknown>;
}

export interface BridgeResult {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

const versionOrder = (v: string) => v.split(".").map((n) => n.padStart(6, "0")).join(".");

/**
 * What runs on the hotel's PC (ticket 68): the installed plugins, each made
 * with the settings the hotel's Bridge keeps for it, commands carried out
 * on them, and new plugin versions fetched, checked and activated without
 * a reinstall.
 */
export class BridgeRuntime {
  private readonly active = new Map<string, { module: BridgePluginModule; plugin: LockPlugin }>();

  constructor(
    private readonly opts: {
      pluginsDir: string;
      /** Per plugin: its settings on this site (the lock server's address …). */
      config: Record<string, Record<string, string>>;
      fetchPlugin: (name: string, version: string) => Promise<{ code: string; sha256: string }>;
    },
  ) {}

  private async activate(file: string): Promise<BridgePluginModule> {
    // a file URL per version: a new version is a new module, the old one is left behind
    const module = asPluginModule(await import(pathToFileURL(file).href));
    this.active.set(module.name, { module, plugin: module.create(this.opts.config[module.name] ?? {}) });
    return module;
  }

  /** At start: the newest installed version of each plugin. */
  async loadInstalled(): Promise<void> {
    await mkdir(this.opts.pluginsDir, { recursive: true });
    const newest = new Map<string, string>();
    for (const f of await readdir(this.opts.pluginsDir)) {
      const m = /^([a-z0-9-]+)@(\d+\.\d+\.\d+)\.mjs$/.exec(f);
      if (m && (!newest.has(m[1]!) || versionOrder(m[2]!) > versionOrder(newest.get(m[1]!)!))) newest.set(m[1]!, m[2]!);
    }
    for (const [name, version] of newest) await this.activate(join(this.opts.pluginsDir, `${name}@${version}.mjs`));
  }

  /** A plugin version pushed from the service: fetched, its hash checked, kept and activated. */
  async install(name: string, version: string, sha256: string): Promise<string> {
    const { code } = await this.opts.fetchPlugin(name, version);
    if (createHash("sha256").update(code).digest("hex") !== sha256) throw new Error("The plugin's hash does not match: not installed");
    const file = join(this.opts.pluginsDir, `${name}@${version}.mjs`);
    await mkdir(this.opts.pluginsDir, { recursive: true });
    await writeFile(file, code, "utf8");
    const m = await this.activate(file);
    if (m.name !== name || m.version !== version) throw new Error("The plugin is not the version asked for");
    return `${name} ${version} active`;
  }

  /** What the Bridge reports with each call: its plugins, what they can do and how they are. */
  async report(): Promise<{ version: string; plugins: { name: string; version: string; kind: "lock" | "till"; capabilities?: BridgePluginModule["capabilities"]; health: { ok: boolean; detail: string } }[] }> {
    const plugins = [];
    for (const { module, plugin } of this.active.values()) {
      const health = await plugin.health().catch((err: unknown) => ({ ok: false, detail: err instanceof Error ? err.message : String(err) }));
      plugins.push({ name: module.name, version: module.version, kind: module.kind, capabilities: module.capabilities, health });
    }
    return { version: BRIDGE_VERSION, plugins };
  }

  /** One command carried out; a plugin's refusal is told apart from the lock system being away. */
  async execute(c: BridgeCommandIn): Promise<BridgeResult> {
    try {
      if (c.kind === "plugin_install") return { id: c.id, ok: true, result: await this.install(String(c.payload.name), String(c.payload.version), String(c.payload.sha256)) };
      const p = this.active.get(String(c.payload.plugin));
      if (!p) throw new Error(`No plugin ${String(c.payload.plugin)} on this Bridge`);
      const op = String(c.payload.op) as keyof LockPlugin;
      const args = (c.payload.args as unknown[]) ?? [];
      // a key request crosses as JSON: its dates come back to life
      const revived = args.map((a) => (a && typeof a === "object" && "validUntil" in a ? { ...(a as KeyRequest), validFrom: new Date((a as KeyRequest).validFrom), validUntil: new Date((a as KeyRequest).validUntil) } : a));
      const fn = p.plugin[op] as unknown;
      if (typeof fn !== "function" || op === "capabilities" || op === "name") throw new Error(`No operation ${op}`);
      return { id: c.id, ok: true, result: (await (fn as (...a: unknown[]) => Promise<unknown>).apply(p.plugin, revived)) ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { id: c.id, ok: false, error: err instanceof Error && err.name === "LockRefused" ? `refused: ${message}` : message };
    }
  }
}
