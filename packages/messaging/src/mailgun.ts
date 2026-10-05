import { createHmac, timingSafeEqual } from "node:crypto";
import { DeliveryError, type DomainStatus, type MailEvent, type MailMessage, type MailProvider } from "./provider";

/**
 * Mailgun, EU region (data stays in the EU). Sending by the HTTP API with
 * custom variables carrying tenant and message ids; events signed with the
 * webhook signing key (HMAC-SHA256 over timestamp and token).
 */
export class MailgunProvider implements MailProvider {
  readonly name = "mailgun";
  constructor(
    private readonly apiKey: string,
    private readonly domain: string,
    private readonly signingKey: string | null,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = "https://api.eu.mailgun.net",
  ) {}

  async send(m: MailMessage): Promise<{ providerId: string }> {
    const form = new FormData();
    form.set("from", `${m.fromName.replace(/["<>]/g, "")} <${m.from}>`);
    form.set("to", m.to);
    form.set("subject", m.subject);
    form.set("html", m.html);
    form.set("text", m.text);
    if (m.replyTo) form.set("h:Reply-To", m.replyTo);
    form.set("v:tenant_id", m.tags.tenantId);
    form.set("v:message_id", m.tags.messageId);
    for (const a of m.attachments) form.append("attachment", new Blob([Buffer.from(a.bytes)], { type: a.type }), a.name);
    let res: Response;
    try {
      res = await this.fetcher(`${this.baseUrl}/v3/${encodeURIComponent(this.domain)}/messages`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString("base64")}` },
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new DeliveryError(`Mailgun not reached: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    if (!res.ok) throw new DeliveryError(`Mailgun refused the message (${res.status})`, res.status >= 500 || res.status === 429);
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new DeliveryError("Mailgun gave no message id", true);
    return { providerId: body.id };
  }

  verifyWebhook(_headers: Record<string, string>, rawBody: string): boolean {
    if (!this.signingKey) return false;
    try {
      const s = (JSON.parse(rawBody) as { signature?: { timestamp?: string; token?: string; signature?: string } }).signature;
      if (!s?.timestamp || !s.token || !s.signature) return false;
      // older than 15 minutes: a replay
      if (Math.abs(Date.now() / 1000 - Number(s.timestamp)) > 900) return false;
      const expected = createHmac("sha256", this.signingKey).update(s.timestamp + s.token).digest();
      const given = Buffer.from(s.signature, "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    } catch {
      return false;
    }
  }

  parseEvent(raw: unknown): MailEvent | null {
    const e = (raw as { "event-data"?: Record<string, unknown> } | null)?.["event-data"];
    if (!e || typeof e.id !== "string") return null;
    const v = (e["user-variables"] ?? {}) as Record<string, string>;
    const type = e.event === "delivered" ? "delivered" : e.event === "failed" ? "failed" : e.event === "complained" ? "complained" : null;
    if (!type) return null;
    const status = (e["delivery-status"] ?? {}) as { message?: string; description?: string };
    return {
      id: e.id,
      type,
      severity: type === "failed" ? (e.severity === "permanent" ? "permanent" : "temporary") : null,
      tenantId: v.tenant_id ?? null,
      messageId: v.message_id ?? null,
      recipient: String(e.recipient ?? ""),
      detail: String(status.description || status.message || e.reason || ""),
    };
  }

  async domainStatus(domain: string): Promise<DomainStatus> {
    const auth = { authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString("base64")}` };
    const url = `${this.baseUrl}/v4/domains/${encodeURIComponent(domain)}`;
    let res = await this.fetcher(url, { headers: auth, signal: AbortSignal.timeout(20_000) });
    if (res.status === 404) {
      // first ask: register the domain, then read its records
      const form = new FormData();
      form.set("name", domain);
      const created = await this.fetcher(`${this.baseUrl}/v4/domains`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(20_000) });
      if (!created.ok) throw new DeliveryError(`Mailgun did not register the domain (${created.status})`, false);
      res = await this.fetcher(url, { headers: auth, signal: AbortSignal.timeout(20_000) });
    } else if (res.ok) {
      // ask Mailgun to look at the DNS again
      await this.fetcher(`${url}/verify`, { method: "PUT", headers: auth, signal: AbortSignal.timeout(20_000) });
      res = await this.fetcher(url, { headers: auth, signal: AbortSignal.timeout(20_000) });
    }
    if (!res.ok) throw new DeliveryError(`Mailgun did not answer for the domain (${res.status})`, true);
    const body = (await res.json()) as { domain?: { state?: string }; sending_dns_records?: { record_type: string; name: string; value: string; valid: string }[] };
    return {
      verified: body.domain?.state === "active",
      records: (body.sending_dns_records ?? []).map((r) => ({ type: r.record_type, name: r.name, value: r.value, valid: r.valid === "valid" })),
    };
  }
}
