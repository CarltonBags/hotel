import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FiasTillSimulator, asPluginModule, type TillPluginInstance } from "../src";

/**
 * Seam: the FIAS plugin serves a FIAS till on the hotel's network and relays
 * lookup, postings (totals per subtotal) and reversals to our room charge
 * interface; its health tells whether a till is connected.
 */
describe("FIAS till plugin", () => {
  const calls: { method: string; url: string; body: unknown }[] = [];
  let api: Server;
  let base = "";
  let plugin: TillPluginInstance;
  const port = 15000 + Math.floor(Math.random() * 1000);
  beforeAll(async () => {
    api = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        calls.push({ method: req.method!, url: req.url!, body: body ? JSON.parse(body) : null });
        if (req.url!.startsWith("/guests")) return res.writeHead(200).end(JSON.stringify({ guests: req.url!.includes("101") ? [{ reservationId: "res-1", room: "101", lastName: "Tanaka", firstName: "Aiko", remainingLimit: 150 }] : [] }));
        res.writeHead(201).end(JSON.stringify({ postingId: "p", chargeIds: [] }));
      });
    });
    await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
    const a = api.address();
    base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
    const module = asPluginModule(await import(pathToFileURL(resolve(import.meta.dirname, "../template/fias-till.mjs")).href));
    plugin = module.create({ port: String(port), api: base, key: "hs_till_x", subtotalRates: "1:19,2:7" }) as TillPluginInstance;
  });
  afterAll(async () => {
    await plugin.stop?.();
    await new Promise<void>((r) => api.close(() => r()));
  });

  it("a till looks a guest up, posts a check as totals per tax rate with the tip apart, and takes it back", async () => {
    expect((await plugin.health()).detail).toMatch(/no till connected/);
    const till = new FiasTillSimulator();
    await till.connect(port);
    expect(await till.inquire("101")).toEqual([{ room: "101", reservation: "res-1", name: "Tanaka, Aiko" }]);
    expect(await till.post({ room: "101", reservation: "res-1", check: "4711", subtotals: { 1: 1200, 2: 3150 }, tip: 200 })).toEqual({ ok: true, text: "" });
    expect(calls.find((c) => c.method === "POST")).toEqual({ method: "POST", url: "/bills", body: { id: "fias-1-4711", reservationId: "res-1", receiptNumber: "4711", fiscalId: "", totals: [{ taxRate: 19, amount: 12 }, { taxRate: 7, amount: 31.5 }], tip: 2 } });
    expect(await till.post({ room: "101", reservation: "res-1", check: "4711", subtotals: { 1: -1200, 2: -3150 }, tip: -200 })).toMatchObject({ ok: true });
    expect(calls.filter((c) => c.method === "POST").at(-1)).toMatchObject({ url: "/bills/fias-1-4711/correction" });
    expect(await plugin.health()).toMatchObject({ ok: true, detail: expect.stringMatching(/till connected \(1\).*interface reachable/) });
    till.close();
  });
});
