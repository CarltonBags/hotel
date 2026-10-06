import { describe, expect, it } from "vitest";
import { FiscalUnavailable, FiskalyProvider, adminPinFor, seal, unseal } from "../src";

/** Seams: the requests fiskaly receives for a Receipt, and what comes back from it; the admin secrets. */
describe("fiskaly SIGN DE", () => {
  const tx = { number: 7, time_start: 1759650000, time_end: 1759650001, state: "FINISHED", signature: { value: "c2ln", algorithm: "ecdsa-plain-SHA256", counter: 15, public_key: "PK" }, tss_serial_number: "TSS1", client_serial_number: "HS-1", qr_code_data: "V0;HS-1;...", log: { timestamp_format: "unixTime" } };
  const fake = () => {
    const calls: { method: string; url: string; body: unknown }[] = [];
    let first401 = true;
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/auth")) return Response.json({ access_token: `t${calls.length}`, access_token_expires_in: 86400 });
      if (first401) {
        first401 = false;
        return new Response("{}", { status: 401 });
      }
      return Response.json(url.includes("tx_revision=2") ? tx : { state: "ACTIVE" });
    }) as unknown as typeof fetch;
    return { calls, f };
  };

  it("starts and finishes the transaction with the amounts per VAT rate and payment type; renews an expired token", async () => {
    const { calls, f } = fake();
    const p = new FiskalyProvider("key", "secret", f);
    const signed = await p.sign({ tssId: "t1", clientId: "c1", txId: "x1", amountsPerVatRate: [{ vatRate: "NORMAL", amount: "100.00" }], amountsPerPaymentType: [{ paymentType: "CASH", amount: "100.00", currency: "EUR" }] });
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.url.split("/api/v2")[1])).toEqual(["/tss/t1/tx/x1?tx_revision=1", "/tss/t1/tx/x1?tx_revision=1", "/tss/t1/tx/x1?tx_revision=2"]);
    expect(puts.at(-1)!.body).toEqual({
      state: "FINISHED",
      client_id: "c1",
      schema: { standard_v1: { receipt: { receipt_type: "RECEIPT", amounts_per_vat_rate: [{ vat_rate: "NORMAL", amount: "100.00" }], amounts_per_payment_type: [{ payment_type: "CASH", amount: "100.00", currency_code: "EUR" }] } } },
    });
    expect(signed).toMatchObject({ number: 7, signatureCounter: 15, signature: "c2ln", tssSerial: "TSS1", clientSerial: "HS-1", qrCodeData: "V0;HS-1;...", timestampFormat: "unixTime" });
    expect(signed.timeStart.toISOString()).toBe("2025-10-05T07:40:00.000Z");
  });

  it("an unreachable TSE is an outage, not a crash", async () => {
    const p = new FiskalyProvider("key", "secret", (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(p.sign({ tssId: "t", clientId: "c", txId: "x", amountsPerVatRate: [], amountsPerPaymentType: [] })).rejects.toBeInstanceOf(FiscalUnavailable);
  });

  it("a transaction that started but did not finish is cancelled, or taken as signed when the TSE finished it after all", async () => {
    for (const [seen, expectSigned] of [["ACTIVE", false], ["FINISHED", true]] as const) {
      const calls: string[] = [];
      const f = (async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url.split("/api/v2")[1] ?? url}`);
        if (url.endsWith("/auth")) return Response.json({ access_token: "t", access_token_expires_in: 86400 });
        if (url.includes("tx_revision=2") && String(init.body).includes("FINISHED")) return new Response("{}", { status: 503 });
        if (init.method === "GET") return Response.json(seen === "FINISHED" ? tx : { state: "ACTIVE", latest_revision: 1 });
        return Response.json({ state: "ACTIVE" });
      }) as unknown as typeof fetch;
      const p = new FiskalyProvider("key", "secret", f);
      const run = p.sign({ tssId: "t1", clientId: "c1", txId: "x1", amountsPerVatRate: [{ vatRate: "NORMAL", amount: "1.00" }], amountsPerPaymentType: [] });
      if (expectSigned) await expect(run).resolves.toMatchObject({ number: 7 });
      else {
        await expect(run).rejects.toBeInstanceOf(FiscalUnavailable);
        expect(calls.at(-1)).toBe("PUT /tss/t1/tx/x1?tx_revision=2");
      }
    }
  });

  it("the admin PIN is derived, the PUK sealed", () => {
    const secret = "a-fiscal-secret-of-length";
    expect(adminPinFor(secret, "tss")).toBe(adminPinFor(secret, "tss"));
    expect(adminPinFor(secret, "tss")).not.toBe(adminPinFor(secret, "other"));
    expect(adminPinFor(secret, "tss")).toMatch(/^[A-Za-z0-9]{12}$/);
    const sealed = seal(secret, "PUK123456");
    expect(sealed).not.toContain("PUK");
    expect(unseal(secret, sealed)).toBe("PUK123456");
    expect(() => unseal("another-secret-entirely", sealed)).toThrow();
  });
});
