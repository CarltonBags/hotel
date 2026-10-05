import { randomUUID, timingSafeEqual } from "node:crypto";
import type { DomainStatus, InboundMail, MailEvent, MailMessage, MailProvider, SmsProvider } from "./provider";
import { inboundFromFields } from "./inbound";

/** In-memory mail for tests and development without provider keys: keeps what was sent; events carry a shared secret. */
export class FakeMailProvider implements MailProvider {
  readonly name = "fake-mail";
  readonly sent: (MailMessage & { providerId: string })[] = [];
  /** Events are accepted with this secret in x-fake-signature; none means none are accepted. */
  constructor(private readonly webhookSecret = "") {}

  async send(message: MailMessage): Promise<{ providerId: string }> {
    const providerId = `<fake-${randomUUID()}@mail.test>`;
    this.sent.push({ ...message, providerId });
    return { providerId };
  }

  verifyWebhook(headers: Record<string, string>): boolean {
    const given = Buffer.from(headers["x-fake-signature"] ?? "");
    const expected = Buffer.from(this.webhookSecret);
    return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
  }

  replayKey(body: unknown): string | null {
    return (body as { id?: string } | null)?.id ?? null;
  }

  parseEvent(raw: unknown): MailEvent | null {
    const e = raw as Partial<MailEvent> | null;
    if (!e?.id || !e.type) return null;
    return { id: e.id, type: e.type, severity: e.severity ?? null, tenantId: e.tenantId ?? null, messageId: e.messageId ?? null, recipient: e.recipient ?? "", detail: e.detail ?? "" };
  }

  /** Incoming mail notices carry the test secret as a field. */
  verifyInbound(fields: Record<string, string>): boolean {
    const given = Buffer.from(fields.secret ?? "");
    const expected = Buffer.from(this.webhookSecret);
    return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
  }

  parseInbound(fields: Record<string, string>): InboundMail | null {
    return inboundFromFields(fields);
  }

  /** The stand-in keeps attachments as data: addresses. */
  async fetchInboundAttachment(url: string): Promise<Uint8Array> {
    const m = /^data:[^;,]+;base64,(.*)$/.exec(url);
    if (!m) throw new Error("Not a stored attachment");
    return new Uint8Array(Buffer.from(m[1]!, "base64"));
  }

  async domainStatus(domain: string): Promise<DomainStatus> {
    // a domain under .invalid never verifies; any other does
    const verified = !domain.endsWith(".invalid");
    return { verified, records: [{ type: "TXT", name: `mx._domainkey.${domain}`, value: "k=rsa; p=FAKE", valid: verified }, { type: "TXT", name: domain, value: "v=spf1 include:mailgun.org ~all", valid: verified }] };
  }
}

export class FakeSmsProvider implements SmsProvider {
  readonly name = "fake-sms";
  readonly sent: { to: string; text: string; sender: string; providerId: string }[] = [];
  async send(input: { to: string; text: string; sender: string }): Promise<{ providerId: string }> {
    const providerId = `sms-${randomUUID()}`;
    this.sent.push({ ...input, providerId });
    return { providerId };
  }
}
