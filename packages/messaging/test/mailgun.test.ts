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

describe("incoming mail (ticket 43)", () => {
  it("reads Mailgun's store-and-notify fields and checks their signature", async () => {
    const { createHmac } = await import("node:crypto");
    const { MailgunProvider } = await import("../src/mailgun");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = "t".repeat(50);
    const signature = createHmac("sha256", "signing").update(timestamp + token).digest("hex");
    const fields = {
      recipient: "alpha.0123456789abcdef0123@replies.example",
      sender: "aiko@example.com",
      subject: "Re: New message",
      "stripped-text": "Thanks!",
      "Message-Id": "<abc@mail.example>",
      "message-headers": JSON.stringify([["Auto-Submitted", "no"], ["X-Mailer", "x"]]),
      attachments: JSON.stringify([{ url: "https://storage-europe-west1.api.mailgun.net/v3/domains/x/messages/y/attachments/0", "content-type": "image/png", name: "a.png", size: 10 }]),
      timestamp,
      token,
      signature,
    };
    const mg = new MailgunProvider("key", "mg.example", "signing");
    expect(mg.verifyInbound({}, fields)).toBe(true);
    expect(mg.inboundReplayKey(fields)).toBe(`mailgun:${token}`);
    expect(mg.verifyInbound({}, { ...fields, signature: "00" })).toBe(false);
    expect(mg.parseInbound(fields)).toMatchObject({ id: "<abc@mail.example>", text: "Thanks!", headers: { "auto-submitted": "no" }, attachments: [{ name: "a.png", type: "image/png" }] });
  });
});

describe("WhatsApp webhooks (ticket 44)", () => {
  it("reads Meta's messages, statuses and template reviews, and checks the app signature", async () => {
    const { MetaCloudProvider, parseMetaWebhook } = await import("../src/whatsapp");
    const body = {
      entry: [
        {
          id: "waba1",
          changes: [
            { field: "messages", value: { metadata: { phone_number_id: "pn1" }, contacts: [{ wa_id: "491701234567", profile: { name: "Mira" } }], messages: [{ id: "wamid.1", from: "491701234567", timestamp: "1790000000", type: "text", text: { body: "Hi" } }], statuses: [{ id: "wamid.out", status: "delivered", pricing: { billable: true } }] } },
            { field: "message_template_status_update", value: { event: "APPROVED", message_template_id: "t1", reason: "NONE" } },
          ],
        },
      ],
    };
    expect(parseMetaWebhook(body)).toEqual([
      { kind: "message", phoneNumberId: "pn1", id: "wamid.1", from: "491701234567", at: new Date(1790000000 * 1000), name: "Mira", text: "Hi", media: null },
      { kind: "status", phoneNumberId: "pn1", id: "wamid.out", status: "delivered", error: null, billable: true },
      { kind: "template", wabaId: "waba1", templateId: "t1", status: "approved", reason: null },
    ]);
    const meta = new MetaCloudProvider({ appId: "a", appSecret: "secret", systemToken: "t", verifyToken: "v" });
    const raw = JSON.stringify(body);
    const sig = createHmac("sha256", "secret").update(raw).digest("hex");
    expect(meta.verifyWebhook({ "x-hub-signature-256": `sha256=${sig}` }, raw)).toBe(true);
    expect(meta.verifyWebhook({ "x-hub-signature-256": "sha256=00" }, raw)).toBe(false);
    expect(meta.verifyChallenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "v", "hub.challenge": "42" }))).toBe("42");
  });
});
