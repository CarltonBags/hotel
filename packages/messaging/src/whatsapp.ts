import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
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
  | { kind: "template"; wabaId: string; templateId: string; status: TemplateState; reason: string | null }
  /** The hotel wrote from its own WhatsApp Business app (coexistence): the message belongs in the thread. */
  | { kind: "echo"; phoneNumberId: string; id: string; to: string; at: Date; text: string };

export interface WhatsAppProvider {
  readonly name: string;
  /**
   * After the hotel finished Embedded Signup in the browser: the code proves
   * which account the hotel granted us, so a business account or number the
   * hotel does not own is refused; the app is subscribed to it, and a new
   * number (not kept in the WhatsApp Business app) is registered.
   */
  finishSignup(input: { code: string; wabaId: string; phoneNumberId: string; coexistence: boolean }): Promise<{ displayNumber: string }>;
  submitTemplate(account: WhatsAppAccount, template: WhatsAppTemplate): Promise<{ templateId: string; status: TemplateState }>;
  /** An edited template goes back to review. */
  updateTemplate(account: WhatsAppAccount, templateId: string, template: WhatsAppTemplate): Promise<{ status: TemplateState }>;
  templateStatus(account: WhatsAppAccount, templateId: string): Promise<{ status: TemplateState; reason: string | null }>;
  /** Free text: only within 24 hours after the guest's last message. */
  sendText(account: WhatsAppAccount, to: string, text: string): Promise<{ messageId: string }>;
  sendTemplate(account: WhatsAppAccount, to: string, template: { name: string; language: string; params: string[] }): Promise<{ messageId: string }>;
  /** An image or PDF (up to 5 MB), within the 24 hours. */
  sendMedia(account: WhatsAppAccount, to: string, media: { bytes: Uint8Array; type: string; name: string; caption: string }): Promise<{ messageId: string }>;
  /** A guest's image or document, downloaded at once; null when larger than allowed. */
  fetchMedia(account: WhatsAppAccount, mediaId: string, maxBytes: number): Promise<{ bytes: Uint8Array; type: string } | null>;
  verifyWebhook(headers: Record<string, string>, rawBody: string): boolean;
  /** Meta's subscription check (GET with hub.challenge): the challenge to answer, or null. */
  verifyChallenge(query: URLSearchParams): string | null;
  parseWebhook(body: unknown): WhatsAppEvent[];
}

const STATES: Record<string, TemplateState> = { APPROVED: "approved", REJECTED: "rejected", PENDING: "in_review", IN_APPEAL: "in_review", PAUSED: "rejected", DISABLED: "rejected" };

/** A template parameter as Meta takes it: no line breaks or tabs, no long runs of spaces, at most 1,024 characters. */
export function templateParam(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 1024) || "-";
}

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
      for (const m of (v.message_echoes as Record<string, unknown>[] | undefined) ?? []) {
        if (m.type !== "text") continue;
        out.push({ kind: "echo", phoneNumberId, id: String(m.id ?? ""), to: String(m.to ?? ""), at: new Date(Number(m.timestamp ?? 0) * 1000), text: String((m.text as { body?: string })?.body ?? "") });
      }
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

  async finishSignup(input: { code: string; wabaId: string; phoneNumberId: string; coexistence: boolean }): Promise<{ displayNumber: string }> {
    if (!/^\d{5,25}$/.test(input.wabaId) || !/^\d{5,25}$/.test(input.phoneNumberId)) throw new DeliveryError("The signup gave no business account or number", false);
    // the hotel's own grant: the business accounts its code covers
    const q = new URLSearchParams({ client_id: this.config.appId, client_secret: this.config.appSecret, code: input.code });
    const { access_token: token } = await this.call<{ access_token?: string }>(`oauth/access_token?${q}`);
    if (!token) throw new DeliveryError("Meta gave no access for this signup", false);
    const debug = await this.call<{ data?: { granular_scopes?: { scope?: string; target_ids?: string[] }[] } }>(`debug_token?${new URLSearchParams({ input_token: token, access_token: `${this.config.appId}|${this.config.appSecret}` })}`);
    const granted = (debug.data?.granular_scopes ?? []).filter((g) => g.scope?.startsWith("whatsapp_business")).flatMap((g) => g.target_ids ?? []);
    if (!granted.includes(input.wabaId)) throw new DeliveryError("This business account was not granted in the signup", false);
    const numbers = await this.call<{ data?: { id: string; display_phone_number?: string }[] }>(`${input.wabaId}/phone_numbers?fields=id,display_phone_number`);
    const number = numbers.data?.find((n) => n.id === input.phoneNumberId);
    if (!number) throw new DeliveryError("This number does not belong to the business account", false);
    await this.call(`${input.wabaId}/subscribed_apps`, { method: "POST", body: {} });
    // a new number is registered for the Cloud API; one kept in the WhatsApp Business app (coexistence) is not
    if (!input.coexistence) await this.call(`${input.phoneNumberId}/register`, { body: { messaging_product: "whatsapp", pin: String(100000 + randomInt(900000)) } });
    return { displayNumber: number.display_phone_number ?? "" };
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
      body: { messaging_product: "whatsapp", to, type: "template", template: { name: t.name, language: { code: t.language }, components: t.params.length ? [{ type: "body", parameters: t.params.map((p) => ({ type: "text", text: templateParam(p) })) }] : [] } },
    });
    if (!r.messages?.[0]) throw new DeliveryError("WhatsApp gave no message id", true);
    return { messageId: r.messages[0].id };
  }

  async sendMedia(account: WhatsAppAccount, to: string, media: { bytes: Uint8Array; type: string; name: string; caption: string }): Promise<{ messageId: string }> {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", media.type);
    form.set("file", new Blob([Buffer.from(media.bytes)], { type: media.type }), media.name);
    let res: Response;
    try {
      res = await this.fetcher(`${this.base}/${account.phoneNumberId}/media`, { method: "POST", headers: { authorization: `Bearer ${this.config.systemToken}` }, body: form, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      throw new DeliveryError(`WhatsApp not reached: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    const up = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !up.id) throw new DeliveryError(`WhatsApp refused the file: ${up.error?.message ?? res.status}`, res.status >= 500 || res.status === 429);
    const kind = media.type.startsWith("image/") ? "image" : "document";
    const r = await this.call<{ messages?: { id: string }[] }>(`${account.phoneNumberId}/messages`, {
      body: { messaging_product: "whatsapp", to, type: kind, [kind]: { id: up.id, caption: media.caption.slice(0, 1024), ...(kind === "document" ? { filename: media.name } : {}) } },
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
    // read with a cap: the size Meta states is not trusted
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
    return { bytes: new Uint8Array(Buffer.concat(chunks)), type: meta.mime_type ?? "application/octet-stream" };
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
  readonly sent: { to: string; text?: string; template?: { name: string; language: string; params: string[] }; media?: { type: string; name: string; caption: string }; messageId: string }[] = [];
  readonly templates = new Map<string, { template: WhatsAppTemplate; status: TemplateState }>();
  readonly media = new Map<string, { bytes: Uint8Array; type: string }>();
  /** Numbers that refuse messages (to test the fallback to email). */
  readonly refusing = new Set<string>();
  constructor(private readonly secret = "") {}

  /** The stand-in's numbers are test numbers only ("test_…"): a real account id is refused. */
  async finishSignup(input: { code: string; wabaId: string; phoneNumberId: string }): Promise<{ displayNumber: string }> {
    if (!input.code || !input.wabaId.startsWith("test_") || !input.phoneNumberId.startsWith("test_")) throw new DeliveryError("The stand-in connects test numbers only", false);
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
  private send(to: string, rest: { text?: string; template?: { name: string; language: string; params: string[] }; media?: { type: string; name: string; caption: string } }): { messageId: string } {
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
  async sendMedia(_a: WhatsAppAccount, to: string, media: { bytes: Uint8Array; type: string; name: string; caption: string }): Promise<{ messageId: string }> {
    return this.send(to, { media: { type: media.type, name: media.name, caption: media.caption } });
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

/** WhatsApp where the platform has no Meta keys (production): nothing goes out, every send falls back to email, no webhook is accepted. */
export class UnconfiguredWhatsAppProvider implements WhatsAppProvider {
  readonly name = "whatsapp";
  private refuse(): never {
    throw new DeliveryError("WhatsApp is not configured on this platform", false);
  }
  async finishSignup(): Promise<{ displayNumber: string }> {
    return this.refuse();
  }
  async submitTemplate(): Promise<{ templateId: string; status: TemplateState }> {
    return this.refuse();
  }
  async updateTemplate(): Promise<{ status: TemplateState }> {
    return this.refuse();
  }
  async templateStatus(): Promise<{ status: TemplateState; reason: string | null }> {
    return { status: "in_review", reason: null };
  }
  async sendText(): Promise<{ messageId: string }> {
    return this.refuse();
  }
  async sendTemplate(): Promise<{ messageId: string }> {
    return this.refuse();
  }
  async sendMedia(): Promise<{ messageId: string }> {
    return this.refuse();
  }
  async fetchMedia(): Promise<null> {
    return null;
  }
  verifyWebhook(): boolean {
    return false;
  }
  verifyChallenge(): null {
    return null;
  }
  parseWebhook(): WhatsAppEvent[] {
    return [];
  }
}
