import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MailgunProvider } from "../src/mailgun";
import { SevenSmsProvider } from "../src/seven";

const signed = (key: string, eventData: object, timestamp = String(Math.floor(Date.now() / 1000))) => {
  const token = "tok123";
  return JSON.stringify({ signature: { timestamp, token, signature: createHmac("sha256", key).update(timestamp + token).digest("hex") }, "event-data": eventData });
};

describe("Mailgun", () => {
  it("sends to the EU API with tenant and message ids as variables", async () => {
    const calls: { url: string; body: FormData; auth: string }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as FormData, auth: (init.headers as Record<string, string>).authorization! });
      return new Response(JSON.stringify({ id: "<abc@mg>", message: "Queued" }), { status: 200 });
    }) as typeof fetch;
    const mg = new MailgunProvider("key-1", "mg.hoteloftware.example", "sign", fetcher);
    const r = await mg.send({ from: "booking@haus.example", fromName: "Haus am Ring", to: "aiko@example.com", subject: "S", html: "<p>h</p>", text: "h", attachments: [{ name: "RE-1.pdf", type: "application/pdf", bytes: new Uint8Array([37, 80]) }], tags: { tenantId: "t1", messageId: "m1" } });
    expect(r.providerId).toBe("<abc@mg>");
    await mg.send({ from: "booking@haus.example", fromName: "H", sendingDomain: "haus.example", to: "a@example.com", subject: "S", html: "h", text: "h", attachments: [], tags: { tenantId: "t1", messageId: "m2" } });
    expect(calls[1]!.url).toBe("https://api.eu.mailgun.net/v3/haus.example/messages");
    expect(calls[0]!.url).toBe("https://api.eu.mailgun.net/v3/mg.hoteloftware.example/messages");
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from("api:key-1").toString("base64")}`);
    expect(calls[0]!.body.get("from")).toBe("Haus am Ring <booking@haus.example>");
    expect(calls[0]!.body.get("v:message_id")).toBe("m1");
    expect((calls[0]!.body.get("attachment") as File).name).toBe("RE-1.pdf");
  });

  it("verifies event signatures and reads a hard bounce", () => {
    const mg = new MailgunProvider("k", "d", "signing-key");
    const raw = signed("signing-key", { id: "ev1", event: "failed", severity: "permanent", recipient: "x@example.com", "user-variables": { tenant_id: "t1", message_id: "m1" }, "delivery-status": { description: "No such user" } });
    expect(mg.verifyWebhook({}, raw)).toBe(true);
    expect(mg.verifyWebhook({}, signed("other-key", { id: "ev1" }))).toBe(false);
    expect(mg.verifyWebhook({}, signed("signing-key", { id: "ev1" }, "1000"))).toBe(false);
    expect(mg.replayKey(JSON.parse(raw))).toBeNull();
    expect(mg.parseEvent(JSON.parse(raw))).toEqual({ id: "ev1", type: "failed", severity: "permanent", tenantId: "t1", messageId: "m1", recipient: "x@example.com", detail: "No such user" });
  });
});

describe("seven.io", () => {
  it("sends an SMS and reads the message id", async () => {
    const fetcher = (async () => new Response(JSON.stringify({ success: "100", messages: [{ id: 77 }] }), { status: 200 })) as unknown as typeof fetch;
    expect(await new SevenSmsProvider("k", fetcher).send({ to: "+491701234567", text: "Night Audit overdue", sender: "Hoteloftware" })).toEqual({ providerId: "77" });
    const refused = (async () => new Response(JSON.stringify({ success: "202" }), { status: 200 })) as unknown as typeof fetch;
    await expect(new SevenSmsProvider("k", refused).send({ to: "x", text: "t", sender: "s" })).rejects.toThrow(/did not send/);
  });
});
