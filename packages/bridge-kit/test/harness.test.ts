import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OnPremLockSimulator, asPluginModule, runLockHarness } from "../src";

/**
 * Seam: the plugin kit's harness takes a Lock Plugin through issue, read,
 * update and revoke against the simulated on-premises lock system; the
 * template plugin passes, a faulty one is caught.
 */
describe("plugin kit harness", () => {
  const sim = new OnPremLockSimulator();
  let server = "";
  beforeAll(async () => {
    server = await sim.start();
  });
  afterAll(() => sim.stop());
  const template = async () => asPluginModule(await import(pathToFileURL(resolve(import.meta.dirname, "../template/simulated-onprem.mjs")).href));

  it("the template plugin passes end to end: a card issued, read, extended and blocked at the lock server", async () => {
    const report = await runLockHarness(await template(), { server });
    expect(report.passed).toBe(true);
    expect(report.steps.map((s) => [s.step, s.ok])).toEqual([
      ["describes itself", true],
      ["health", true],
      ["lists encoders", true],
      ["issues a key", true],
      ["reads the card back", true],
      ["changes validity", true],
      ["revokes", true],
    ]);
    expect([...sim.keys.values()].some((k) => k.blocked)).toBe(true);
  });

  it("a plugin that reads back the wrong door fails", async () => {
    const good = await template();
    const faulty = { ...good, create: (c: Record<string, string>) => ({ ...good.create(c), readCard: async () => ({ lockRef: "wrong", validUntil: new Date(), externalId: null }) }) };
    const report = await runLockHarness(faulty, { server });
    expect(report.passed).toBe(false);
    expect(report.steps.find((s) => !s.ok)?.step).toBe("reads the card back");
  });
});
