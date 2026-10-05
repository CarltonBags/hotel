import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DeliveryError } from "./provider";

/**
 * WhatsApp Business through Meta's Cloud API (ticket 44), the platform as
 * Tech Provider: each hotel connects its own business account and number by
 * Embedded Signup; templates are submitted per property and language; the
 * webhook (signed with the app secret) brings guests' messages, delivery
 * states and template reviews. The fake stands in for development and tests.
 */
export interface WhatsAppAccount {
  wabaId: string;
  phoneNumberId: string;
}

export type TemplateState = "in_review" | "approved" | "rejected";

export interface WhatsAppTemplate {
  /** Our name for it at Meta (lower case, digits, underscores). */
  name: string;
  language: string;
  /** With Meta's numbered parameters {{1}}, {{2}} … */
  body: string;
  /** One example value per parameter, for the review. */
  examples: string[];
}

export type WhatsAppEvent =
  | { kind: "message"; phoneNumberId: string; id: string; from: string; at: Date; name: string; text: string; media: { id: string; type: string; name: string } | null }
  | { kind: "status"; phoneNumberId: string; id: string; status: "sent" | "delivered" | "read" | "failed"; error: string | null; billable: boolean }
  | { kind: "template"; wabaId: string; templateId: string; status: TemplateState; reason: string | null };

export interface WhatsAppProvider {
  readonly name: string;
  /** After the hotel finished Embedded Signup in the browser: the app is subscribed to its account and the number made ready. */
  finishSignup(input: { code: string; wabaId: string; phoneNumberId: string }): Promise<{ displayNumber: string }>;
  submitTemplate(account: WhatsAppAccount, template: WhatsAppTemplate): Promise<{ templateId: string; status: TemplateState }>;
  /** An edited template goes back to review. */
  updateTemplate(account: WhatsAppAccount, templateId: string, template: WhatsAppTemplate): Promise<{ status: TemplateState }>;
  templateStatus(account: WhatsAppAccount, templateId: string): Promise<{ status: TemplateState; reason: string | null }>;
  /** Free text: only within 24 hours after the guest's last message. */
  sendText(account: WhatsAppAccount, to: string, text: string): Promise<{ messageId: string }>;
  sendTemplate(account: WhatsAppAccount, to: string, template: { name: string; language: string; params: string[] }): Promise<{ messageId: string }>;
  /** A guest's image or document, downloaded at once; null when larger than allowed. */
  fetchMedia(account: WhatsAppAccount, mediaId: string, maxBytes: number): Promise<{ bytes: Uint8Array; type: string } | null>;
  verifyWebhook(headers: Record<string, string>, rawBody: string): boolean;
  /** Meta's subscription check (GET with hub.challenge): the challenge to answer, or null. */
  verifyChallenge(query: URLSearchParams): string | null;
  parseWebhook(body: unknown): WhatsAppEvent[];
}

const STATES: Record<string, TemplateState> = { APPROVED: "approved", REJECTED: "rejected", PENDING: "in_review", IN_APPEAL: "in_review", PAUSED: "rejected", DISABLED: "rejected" };

/** Meta's webhook body (shared by the fake): messages, statuses, template reviews. */
export function parseMetaWebhook(body: unknown): WhatsAppEvent[] {
  const out: WhatsAppEvent[] = [];
  const entries = (body as { entry?: { id?: string; changes?: { field?: string; value?: Record<string, unknown> }[] }[] } | null)?.entry ?? [];
  for (const e of entries) {
    for (const c of e.changes ?? []) {
      const v = c.value ?? {};
      if (c.field === "message_template_status_update") {
        const id = String(v.message_template_id ?? "");
        if (id) out.push({ kind: "template", wabaId: String(e.id ?? ""), templateId: id, status: STATES[String(v.event ?? "").toUpperCase()] ?? "in_review", reason: v.reason && v.reason !== "NONE" ? String(v.reason) : null });
        continue;
      }
      const phoneNumberId = String((v.metadata as { phone_number_id?: string } | undefined)?.phone_number_id ?? "");
      const names = new Map(((v.contacts as { wa_id?: string; profile?: { name?: string } }[] | undefined) ?? []).map((x) => [String(x.wa_id), x.profile?.name ?? ""]));
      for (const m of (v.messages as Record<string, unknown>[] | undefined) ?? []) {
        const type = String(m.type ?? "");
        const media = (type === "image" || type === "document" ? (m[type] as { id?: string; mime_type?: string; filename?: string }) : null) ?? null;
        const text = type === "text" ? String((m.text as { body?: string })?.body ?? "") : String((media as { caption?: string } | null)?.caption ?? (type === "button" ? (m.button as { text?: string })?.text ?? "" : ""));
        out.push({
          kind: "message",
          phoneNumberId,
          id: String(m.id ?? ""),
          from: String(m.from ?? ""),
          at: new Date(Number(m.timestamp ?? 0) * 1000),
          name: names.get(String(m.from)) ?? "",
          text,
          media: media?.id ? { id: media.id, type: media.mime_type ?? "application/octet-stream", name: media.filename ?? type } : null,
        });
      }
      for (const s of (v.statuses as Record<string, unknown>[] | undefined) ?? []) {
        const status = String(s.status ?? "");
        if (!["sent", "delivered", "read", "failed"].includes(status)) continue;
        const errors = (s.errors as { title?: string; message?: string }[] | undefined) ?? [];
        out.push({ kind: "status", phoneNumberId, id: String(s.id ?? ""), status: status as "sent", error: errors[0] ? (errors[0].message ?? errors[0].title ?? "failed") : null, billable: !!(s.pricing as { billable?: boolean } | undefined)?.billable });
      }
    }
  }
  return out;
}

export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = "whatsapp";
  constructor(
    private readonly config: { appId: string; appSecret: string; systemToken: string; verifyToken: string },
    private readonly fetcher: typeof fetch = fetch,
    private readonly base = "https://graph.facebook.com/v21.0",
  ) {}

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.base}/${path}`, {
        method: init.method ?? (init.body ? "POST" : "GET"),
        headers: { authorization: `Bearer ${this.config.systemToken}`, ...(init.body ? { "content-type": "application/json" } : {}) },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new DeliveryError(`WhatsApp not reached: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new DeliveryError(`WhatsApp refused: ${json.error?.message ?? res.status}`, res.status >= 500 || res.status === 429);
    return json;
  }

  async finishSignup(input: { code: string; wabaId: string; phoneNumberId: string }): Promise<{ displayNumber: string }> {
    // the code proves the hotel finished the signup with our app; the platform's system user works the account from now on
    const q = new URLSearchParams({ client_id: this.config.appId, client_secret: this.config.appSecret, code: input.code });
    await this.call(`oauth/access_token?${q}`);
    await this.call(`${input.wabaId}/subscribed_apps`, { method: "POST", body: {} });
    const n = await this.call<{ display_phone_number?: string }>(`${input.phoneNumberId}?fields=display_phone_number`);
    return { displayNumber: n.display_phone_number ?? "" };
  }

  private components(t: WhatsAppTemplate) {
    return [{ type: "BODY", text: t.body, ...(t.examples.length ? { example: { body_text: [t.examples] } } : {}) }];
  }

  async submitTemplate(account: WhatsAppAccount, t: WhatsAppTemplate): Promise<{ templateId: string; status: TemplateState }> {
    const r = await this.call<{ id: string; status: string }>(`${account.wabaId}/message_templates`, { body: { name: t.name, language: t.language, category: "UTILITY", components: this.components(t) } });
    return { templateId: r.id, status: STATES[r.status] ?? "in_review" };
  }

  async updateTemplate(_account: WhatsAppAccount, templateId: string, t: WhatsAppTemplate): Promise<{ status: TemplateState }> {
    await this.call(`${templateId}`, { body: { components: this.components(t) } });
    return { status: "in_review" };
  }

  async templateStatus(_account: WhatsAppAccount, templateId: string): Promise<{ status: TemplateState; reason: string | null }> {
    const r = await this.call<{ status: string; rejected_reason?: string }>(`${templateId}?fields=status,rejected_reason`);
    return { status: STATES[r.status] ?? "in_review", reason: r.rejected_reason && r.rejected_reason !== "NONE" ? r.rejected_reason : null };
  }

  async sendText(account: WhatsAppAccount, to: string, text: string): Promise<{ messageId: string }> {
    const r = await this.call<{ messages?: { id: string }[] }>(`${account.phoneNumberId}/messages`, { body: { messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: false } } });
    if (!r.messages?.[0]) throw new DeliveryError("WhatsApp gave no message id", true);
    return { messageId: r.messages[0].id };
  }

  async sendTemplate(account: WhatsAppAccount, to: string, t: { name: string; language: string; params: string[] }): Promise<{ messageId: string }> {
    const r = await this.call<{ messages?: { id: string }[] }>(`${account.phoneNumberId}/messages`, {
      body: { messaging_product: "whatsapp", to, type: "template", template: { name: t.name, language: { code: t.language }, components: t.params.length ? [{ type: "body", parameters: t.params.map((p) => ({ type: "text", text: p || "-" })) }] : [] } },
    });
    if (!r.messages?.[0]) throw new DeliveryError("WhatsApp gave no message id", true);
    return { messageId: r.messages[0].id };
  }

  async fetchMedia(_account: WhatsAppAccount, mediaId: string, maxBytes: number): Promise<{ bytes: Uint8Array; type: string } | null> {
    const meta = await this.call<{ url?: string; mime_type?: string; file_size?: number }>(`${mediaId}`);
    if (!meta.url || Number(meta.file_size ?? 0) > maxBytes) return null;
    if (!/^https:\/\/[a-z0-9.-]+\.(fbsbx|facebook|whatsapp)\.(com|net)\//.test(meta.url)) throw new DeliveryError("Not a WhatsApp media address", false);
    const res = await this.fetcher(meta.url, { headers: { authorization: `Bearer ${this.config.systemToken}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new DeliveryError(`WhatsApp media refused (${res.status})`, res.status >= 500);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length > maxBytes ? null : { bytes, type: meta.mime_type ?? "application/octet-stream" };
  }

  verifyWebhook(headers: Record<string, string>, rawBody: string): boolean {
    const given = (headers["x-hub-signature-256"] ?? "").replace(/^sha256=/, "");
    const expected = createHmac("sha256", this.config.appSecret).update(rawBody).digest("hex");
    return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  }

  verifyChallenge(query: URLSearchParams): string | null {
    return query.get("hub.mode") === "subscribe" && this.config.verifyToken && query.get("hub.verify_token") === this.config.verifyToken ? query.get("hub.challenge") : null;
  }

  parseWebhook(body: unknown): WhatsAppEvent[] {
    return parseMetaWebhook(body);
  }
}

/** In-memory WhatsApp for tests and development: sent messages kept, templates in review until approved, media as data: addresses. */
export class FakeWhatsAppProvider implements WhatsAppProvider {
  readonly name = "whatsapp";
  readonly sent: { to: string; text?: string; template?: { name: string; language: string; params: string[] }; messageId: string }[] = [];
  readonly templates = new Map<string, { template: WhatsAppTemplate; status: TemplateState }>();
  readonly media = new Map<string, { bytes: Uint8Array; type: string }>();
  /** Numbers that refuse messages (to test the fallback to email). */
  readonly refusing = new Set<string>();
  constructor(private readonly secret = "") {}

  async finishSignup(input: { code: string }): Promise<{ displayNumber: string }> {
    if (!input.code) throw new DeliveryError("No signup code", false);
    return { displayNumber: "+49 30 1234567" };
  }
  async submitTemplate(_a: WhatsAppAccount, template: WhatsAppTemplate): Promise<{ templateId: string; status: TemplateState }> {
    const templateId = `tpl_${randomUUID().slice(0, 8)}`;
    this.templates.set(templateId, { template, status: "in_review" });
    return { templateId, status: "in_review" };
  }
  async updateTemplate(_a: WhatsAppAccount, templateId: string, template: WhatsAppTemplate): Promise<{ status: TemplateState }> {
    this.templates.set(templateId, { template, status: "in_review" });
    return { status: "in_review" };
  }
  async templateStatus(_a: WhatsAppAccount, templateId: string): Promise<{ status: TemplateState; reason: string | null }> {
    // a template submitted from another process stays in review until a review notice comes
    return { status: this.templates.get(templateId)?.status ?? "in_review", reason: null };
  }
  /** Test helper: Meta's review decides. */
  review(status: TemplateState): void {
    for (const t of this.templates.values()) if (t.status === "in_review") t.status = status;
  }
  private send(to: string, rest: { text?: string; template?: { name: string; language: string; params: string[] } }): { messageId: string } {
    if (this.refusing.has(to)) throw new DeliveryError("Recipient cannot be reached on WhatsApp", false);
    const messageId = `wamid.${randomUUID()}`;
    this.sent.push({ to, ...rest, messageId });
    return { messageId };
  }
  async sendText(_a: WhatsAppAccount, to: string, text: string): Promise<{ messageId: string }> {
    return this.send(to, { text });
  }
  async sendTemplate(_a: WhatsAppAccount, to: string, template: { name: string; language: string; params: string[] }): Promise<{ messageId: string }> {
    return this.send(to, { template });
  }
  async fetchMedia(_a: WhatsAppAccount, mediaId: string, maxBytes: number): Promise<{ bytes: Uint8Array; type: string } | null> {
    const m = this.media.get(mediaId) ?? (/^data:([^;,]+);base64,(.*)$/.exec(mediaId) ? { type: /^data:([^;,]+)/.exec(mediaId)![1]!, bytes: new Uint8Array(Buffer.from(mediaId.split(",")[1]!, "base64")) } : undefined);
    return m && m.bytes.length <= maxBytes ? m : null;
  }
  verifyWebhook(headers: Record<string, string>): boolean {
    const given = Buffer.from(headers["x-fake-signature"] ?? "");
    const expected = Buffer.from(this.secret);
    return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
  }
  verifyChallenge(query: URLSearchParams): string | null {
    return query.get("hub.mode") === "subscribe" && this.secret && query.get("hub.verify_token") === this.secret ? query.get("hub.challenge") : null;
  }
  parseWebhook(body: unknown): WhatsAppEvent[] {
    return parseMetaWebhook(body);
  }
}
