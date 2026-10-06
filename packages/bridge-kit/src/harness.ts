import type { BridgePluginModule } from "./plugin";

export interface HarnessStep {
  step: string;
  ok: boolean;
  detail: string;
}

/**
 * The plugin kit's test harness (ticket 68): a Lock Plugin taken through what
 * the product will ask of it, against a lock system (the simulated
 * on-premises one, or a vendor's test system). Steps a plugin does not
 * declare are skipped; one failing step fails the run.
 */
export async function runLockHarness(module: BridgePluginModule, config: Record<string, string>, door = "DOOR-101"): Promise<{ passed: boolean; steps: HarnessStep[] }> {
  const steps: HarnessStep[] = [];
  const step = async (name: string, run: () => Promise<string>): Promise<boolean> => {
    try {
      steps.push({ step: name, ok: true, detail: await run() });
      return true;
    } catch (err) {
      steps.push({ step: name, ok: false, detail: err instanceof Error ? err.message : String(err) });
      return false;
    }
  };
  const must = (ok: boolean, why: string) => {
    if (!ok) throw new Error(why);
  };
  const caps = module.capabilities;
  const plugin = module.create(config) as import("@hoteloftware/locks").LockPlugin;
  let externalId = "";
  let encoder = "";
  const kind = caps?.card ? "card" : caps?.pin ? "pin" : "phone";
  const until = new Date(Date.now() + 2 * 86_400_000);
  const ok =
    (await step("describes itself", async () => {
      must(module.kind === "lock" && !!caps, "a lock plugin declares its capabilities");
      must(JSON.stringify(plugin.capabilities) === JSON.stringify(caps), "the instance declares what the module declares");
      return `${module.name} ${module.version}`;
    })) &&
    (await step("health", async () => {
      const h = await plugin.health();
      must(h.ok, `not healthy: ${h.detail}`);
      return h.detail;
    })) &&
    (await step("lists encoders", async () => {
      const list = await plugin.listEncoders();
      must(!caps!.encoders || list.length > 0, "declares encoders but lists none");
      encoder = list[0]?.id ?? "";
      return `${list.length} encoder(s)`;
    })) &&
    (await step("issues a key", async () => {
      const made = await plugin.issueKey({ keyId: "harness-1", lockRef: door, kind, validFrom: new Date(), validUntil: until, guestName: "Harness", pin: kind === "pin" ? "345678" : undefined, encoderId: encoder || undefined });
      must(!!made.externalId, "no id for the key");
      externalId = made.externalId;
      return `${kind} ${externalId}`;
    })) &&
    (await step("reads the card back", async () => {
      if (!caps!.readCard) return "not declared";
      const card = await plugin.readCard(encoder);
      must(card?.lockRef === door, `read ${card?.lockRef ?? "nothing"}, expected ${door}`);
      must(card!.validUntil.getTime() === until.getTime(), "the card's validity differs");
      return `${card!.lockRef} until ${card!.validUntil.toISOString()}`;
    })) &&
    (await step("changes validity", async () => {
      const later = new Date(until.getTime() + 86_400_000);
      await plugin.updateKey(externalId, { keyId: "harness-1", lockRef: door, kind, validFrom: new Date(), validUntil: later, guestName: "Harness", encoderId: encoder || undefined });
      if (caps!.readCard) must((await plugin.readCard(encoder))?.validUntil.getTime() === later.getTime(), "the new validity does not read back");
      return later.toISOString();
    })) &&
    (await step("revokes", async () => {
      await plugin.revokeKey(externalId, door);
      return caps!.remoteRevoke ? "revoked at the door" : "blocked at the lock server; the card runs to its expiry";
    })) &&
    (await step("revokes a key by our name", async () => {
      await plugin.revokeByKeyId("harness-1", door);
      return "done";
    })) &&
    (await step("refuses what it cannot do, as a refusal", async () => {
      try {
        await plugin.issueKey({ keyId: "harness-2", lockRef: "", kind, validFrom: new Date(), validUntil: until, guestName: "Harness", pin: kind === "pin" ? "345678" : undefined, encoderId: "NO-SUCH-ENCODER" });
      } catch (err) {
        must(err instanceof Error && err.name === "LockRefused", `refused with ${err instanceof Error ? err.name : "something"}, not LockRefused (it would be tried again forever)`);
        return (err as Error).message;
      }
      throw new Error("a key for no door was made");
    }));
  return { passed: ok && steps.every((s) => s.ok), steps };
}
