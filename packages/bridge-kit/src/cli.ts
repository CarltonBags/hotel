import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { OnPremLockSimulator } from "./simulator";
import { asPluginModule } from "./plugin";
import { runLockHarness } from "./harness";

// pnpm --filter @hoteloftware/bridge-kit harness <plugin.mjs> [server]: without a server, the simulated on-premises lock system
const [file, server] = process.argv.slice(2);
if (!file) {
  console.error("usage: harness <plugin.mjs> [lock server address]");
  process.exit(2);
}
const sim = server ? null : new OnPremLockSimulator();
const address = server ?? (await sim!.start());
const report = await runLockHarness(asPluginModule(await import(pathToFileURL(resolve(file)).href)), { server: address });
for (const s of report.steps) console.log(`${s.ok ? "PASS" : "FAIL"} ${s.step} — ${s.detail}`);
await sim?.stop();
process.exit(report.passed ? 0 : 1);
