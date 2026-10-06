import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BridgeRuntime, type BridgeResult } from "@hoteloftware/bridge-kit";

/**
 * The Site Bridge (ticket 68, ADR 0014): runs on the PC that already runs
 * the hotel's lock software. It only ever calls out to the service (no port
 * is opened at the hotel): each call reports its plugins and their health,
 * hands back the answers to the last commands and waits for the next ones.
 *
 * Configuration (bridge.json beside it, or the path in BRIDGE_CONFIG):
 *   { "server": "https://worker.example", "token": "hsb_…", "pluginsDir": "plugins",
 *     "plugins": { "simulated-onprem": { "server": "http://127.0.0.1:7000" } } }
 */
interface Config {
  server: string;
  token: string;
  pluginsDir?: string;
  plugins?: Record<string, Record<string, string>>;
}

const configPath = resolve(process.env.BRIDGE_CONFIG ?? "bridge.json");
const config = JSON.parse(await readFile(configPath, "utf8")) as Config;
if (!config.server || !/^hsb_[0-9a-f]{64}$/.test(config.token ?? "")) throw new Error(`${configPath}: server and token are needed`);
const server = config.server.replace(/\/$/, "");
const headers = { authorization: `Bearer ${config.token}`, "content-type": "application/json" };

const runtime = new BridgeRuntime({
  pluginsDir: resolve(configPath, "..", config.pluginsDir ?? "plugins"),
  config: config.plugins ?? {},
  fetchPlugin: async (name, version) => {
    const res = await fetch(`${server}/bridge/v1/plugins/${name}/${version}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`plugin ${name} ${version}: ${res.status}`);
    return (await res.json()) as { code: string; sha256: string };
  },
});
await runtime.loadInstalled();

let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

let results: BridgeResult[] = [];
let wait = 1000;
console.log(`[bridge] calling ${server}`);
while (!stopping) {
  try {
    const res = await fetch(`${server}/bridge/v1/poll`, { method: "POST", headers, body: JSON.stringify({ ...(await runtime.report()), results }), signal: AbortSignal.timeout(40_000) });
    if (res.status === 401) throw new Error("the token was refused (revoked?)");
    if (!res.ok) throw new Error(`the service answered ${res.status}`);
    results = [];
    const { commands } = (await res.json()) as { commands: Parameters<BridgeRuntime["execute"]>[0][] };
    for (const c of commands) {
      const r = await runtime.execute(c);
      console.log(`[bridge] ${c.kind} ${String(c.payload.op ?? c.payload.name ?? "")}: ${r.ok ? "ok" : r.error}`);
      results.push(r);
    }
    wait = 1000;
  } catch (err) {
    // the service or the network is away: try again, waiting longer each time (at most a minute)
    console.error(`[bridge] ${err instanceof Error ? err.message : String(err)}; again in ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 60_000);
  }
}
console.log("[bridge] stopped");
