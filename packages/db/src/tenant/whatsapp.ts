import type { Pool, PoolClient } from "pg";
import {
  SHIPPED_TEXTS,
  WHATSAPP_TYPES,
  asMetaTemplate,
  isMessageLanguage,
  unknownPlaceholders,
  whatsAppNumber,
  windowOpen,
  type MessageLanguage,
  type MessageType,
  type Placeholder,
} from "@hoteloftware/domain";
import { DeliveryError, type TemplateState, type WhatsAppAccount, type WhatsAppProvider } from "@hoteloftware/messaging";
import { isUuid } from "./catalogue-common";
import { mapProviderAccount } from "../control/external-ids";
import { recordUsage } from "../control/subscription";
import { withTenant } from "./with-tenant";

/**
 * The WhatsApp Module (ticket 44): a property connects its own business
 * account and number; templates per type and language go to Meta's review;
 * service messages go by WhatsApp to guests who opted in (an approved
 * template, else email, never both); staff write freely within 24 hours of the
 * guest's last message, else by template or email; guests' messages are
 * matched to their stay by number, or wait Unassigned. Usage is counted per
 * property for billing.
 */

/** The provider name in control.external_ids: a number's phone_number_id finds its tenant. */
export const WHATSAPP_SOURCE = "whatsapp";
export const USAGE_KIND = "whatsapp_message";
/** Templates a property has: the service messages, and the staff answer outside the 24 hours. */
export const WHATSAPP_TEMPLATE_TYPES = [...WHATSAPP_TYPES, "inbox_reply"] as const satisfies readonly MessageType[];
type TemplateType = (typeof WHATSAPP_TEMPLATE_TYPES)[number];

const SIGN_OFF: Record<MessageLanguage, string> = { de: "Ihr Team vom {hotel_name}.", en: "Your team at {hotel_name}." };

/** The text we ship for a template: the email's blocks (a template may not end on a placeholder, so a closing line follows). */
export function shippedWhatsAppText(type: TemplateType, language: MessageLanguage): string {
  return [...SHIPPED_TEXTS[type][language].blocks, SIGN_OFF[language]].join("\n\n");
}

const templateName = (type: string) => `hs_${type}`;

export interface WhatsAppConnection {
  wabaId: string;
  phoneNumberId: string;
  displayNumber: string;
  connectedAt: Date;
}

async function accountIn(tx: PoolClient, propertyId: string): Promise<(WhatsAppAccount & { displayNumber: string; connectedAt: Date }) | null> {
  const { rows } = await tx.query<{ waba_id: string; phone_number_id: string; display_number: string; connected_at: Date }>(
    "select waba_id, phone_number_id, display_number, connected_at from whatsapp_accounts a where property_id = $1 and exists (select 1 from property_modules m join properties p on p.id = m.property_id where m.property_id = a.property_id and m.module = 'whatsapp' and m.on_since <= coalesce(p.business_date, current_date) and (m.off_at is null or m.off_at > coalesce(p.business_date, current_date)))",
    [propertyId],
  );
  const r = rows[0];
  return r ? { wabaId: r.waba_id, phoneNumberId: r.phone_number_id, displayNumber: r.display_number, connectedAt: r.connected_at } : null;
}

/** Whether the property is on WhatsApp now (connected, Module on). */
export async function whatsAppConnectionIn(tx: PoolClient, propertyId: string): Promise<boolean> {
  return (await accountIn(tx, propertyId)) !== null;
}

/** The property's connected number, while the Module is on. */
export async function whatsAppConnection(pool: Pool, schema: string, propertyId: string): Promise<WhatsAppConnection | null> {
  if (!isUuid(propertyId)) return null;
  return withTenant(pool, schema, (tx) => accountIn(tx, propertyId));
}

/**
 * The hotel finished Embedded Signup with its own Meta business account and
 * number (coexistence keeps an existing business number): we take the
 * account, route its webhooks to this tenant and submit the shipped templates.
 */
export async function connectWhatsApp(
  pool: Pool,
  schema: string,
  provider: WhatsAppProvider,
  input: { tenantId: string; propertyId: string; code: string; wabaId: string; phoneNumberId: string },
  userId: string,
): Promise<void> {
  if (!/^\d{5,25}$/.test(input.wabaId) && !input.wabaId.startsWith("test_")) throw new Error("The signup gave no business account");
  if (!/^\d{5,25}$/.test(input.phoneNumberId) && !input.phoneNumberId.startsWith("test_")) throw new Error("The signup gave no number");
  const { displayNumber } = await provider.finishSignup(input);
  await withTenant(pool, schema, (tx) =>
    tx.query(
      `insert into whatsapp_accounts (property_id, waba_id, phone_number_id, display_number, connected_by) values ($1, $2, $3, $4, $5)
       on conflict (property_id) do update set waba_id = excluded.waba_id, phone_number_id = excluded.phone_number_id, display_number = excluded.display_number, connected_at = now(), connected_by = excluded.connected_by`,
      [input.propertyId, input.wabaId, input.phoneNumberId, displayNumber, userId],
    ),
  );
  // its webhooks name the number (messages, states) or the business account (template reviews)
  await mapProviderAccount(pool, WHATSAPP_SOURCE, input.phoneNumberId, input.tenantId, input.propertyId);
  await mapProviderAccount(pool, WHATSAPP_SOURCE, input.wabaId, input.tenantId, input.propertyId);
  await submitWhatsAppTemplates(pool, schema, provider, input.propertyId);
}

/** Templates not yet at Meta are submitted (the shipped text, or the property's own). */
export async function submitWhatsAppTemplates(pool: Pool, schema: string, provider: WhatsAppProvider, propertyId: string): Promise<number> {
  const account = await whatsAppConnection(pool, schema, propertyId);
  if (!account) throw new Error("Connect a WhatsApp number first");
  const due = await withTenant(pool, schema, async (tx) => {
    for (const type of WHATSAPP_TEMPLATE_TYPES) {
      for (const language of ["de", "en"] as const) {
        await tx.query("insert into whatsapp_templates (property_id, type, language, name, text) values ($1, $2, $3, $4, $5) on conflict do nothing", [propertyId, type, language, templateName(type), shippedWhatsAppText(type, language)]);
      }
    }
    return (await tx.query<{ id: string; type: string; language: string; name: string; text: string }>("select id, type, language, name, text from whatsapp_templates where property_id = $1 and provider_id is null", [propertyId])).rows;
  });
  for (const t of due) {
    const r = await provider.submitTemplate(account, { name: t.name, language: t.language, ...metaBody(t.text) });
    await withTenant(pool, schema, (tx) => tx.query("update whatsapp_templates set provider_id = $2, status = $3, updated_at = now() where id = $1", [t.id, r.templateId, r.status]));
  }
  return due.length;
}

/** A template's body for Meta, with an example per parameter for the review. */
function metaBody(text: string): { body: string; examples: string[] } {
  const { body, params } = asMetaTemplate(text);
  const sample: Partial<Record<string, string>> = { guest_name: "Anna Schmidt", hotel_name: "Hotel Beispiel", confirmation: "100123", arrival: "12.10.2026", departure: "14.10.2026", amount: "120,00 €", portal_link: "https://hotel.example/g/abc", checkout_time: "11:00", message: "Your room is ready." };
  return { body, examples: params.map((p) => sample[p] ?? p) };
}

export interface WhatsAppTemplateRow {
  id: string;
  type: TemplateType;
  language: MessageLanguage;
  text: string;
  status: TemplateState;
  reason: string | null;
  /** The text in use while an edit is in review. */
  approvedText: string | null;
}

export async function listWhatsAppTemplates(pool: Pool, schema: string, propertyId: string): Promise<WhatsAppTemplateRow[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; type: TemplateType; language: MessageLanguage; text: string; status: TemplateState; reason: string | null; approved_text: string | null }>(
      "select id, type, language, text, status, reason, approved_text from whatsapp_templates where property_id = $1 order by type, language",
      [propertyId],
    )).rows.map((r) => ({ id: r.id, type: r.type, language: r.language, text: r.text, status: r.status, reason: r.reason, approvedText: r.approved_text })),
  );
}

/** The property edits a template: it goes back to review; the approved version is used meanwhile. */
export async function saveWhatsAppTemplate(pool: Pool, schema: string, provider: WhatsAppProvider, propertyId: string, templateId: string, text: string, userId: string): Promise<void> {
  const clean = text.trim();
  if (!clean || clean.length > 1024) throw new Error("A template has up to 1,024 characters");
  const unknown = unknownPlaceholders({ subject: "", blocks: [clean] });
  if (unknown.length) throw new Error(`Unknown placeholder: ${unknown.map((u) => `{${u}}`).join(", ")}`);
  if (/^\s*\{[a-z_]+\}|\{[a-z_]+\}\s*$/.test(clean)) throw new Error("A template may not begin or end with a placeholder");
  const account = await whatsAppConnection(pool, schema, propertyId);
  if (!account) throw new Error("Connect a WhatsApp number first");
  const t = await withTenant(pool, schema, async (tx) => (await tx.query<{ id: string; name: string; language: string; provider_id: string | null }>("select id, name, language, provider_id from whatsapp_templates where id = $1 and property_id = $2", [templateId, propertyId])).rows[0]);
  if (!t) throw new Error("Template not found");
  const meta = { name: t.name, language: t.language, ...metaBody(clean) };
  const r = t.provider_id ? { status: (await provider.updateTemplate(account, t.provider_id, meta)).status, providerId: t.provider_id } : await provider.submitTemplate(account, meta).then((x) => ({ status: x.status, providerId: x.templateId }));
  await withTenant(pool, schema, (tx) => tx.query("update whatsapp_templates set text = $2, status = $3, provider_id = $4, reason = null, updated_at = now(), updated_by = $5 where id = $1", [t.id, clean, r.status, r.providerId, userId]));
}

/** Meta's review decided (webhook or the regular check): approved text is what goes out from now on. */
export async function applyTemplateReview(pool: Pool, schema: string, providerTemplateId: string, status: TemplateState, reason: string | null): Promise<void> {
  await withTenant(pool, schema, (tx) =>
    tx.query("update whatsapp_templates set status = $2, reason = $3, approved_text = case when $2 = 'approved' then text else approved_text end, updated_at = now() where provider_id = $1", [providerTemplateId, status, reason]),
  );
}

/** Templates still in review are asked about (in case a review notice was missed). */
export async function refreshTemplateReviews(pool: Pool, schema: string, provider: WhatsAppProvider): Promise<number> {
  const open = await withTenant(pool, schema, async (tx) =>
    (await tx.query<{ provider_id: string; property_id: string }>("select provider_id, property_id from whatsapp_templates where status = 'in_review' and provider_id is not null")).rows,
  );
  for (const t of open) {
    const account = await whatsAppConnection(pool, schema, t.property_id);
    if (!account) continue;
    const r = await provider.templateStatus(account, t.provider_id);
    if (r.status !== "in_review") await applyTemplateReview(pool, schema, t.provider_id, r.status, r.reason);
  }
  return open.length;
}

/** A guest's latest WhatsApp consent (null: never asked). */
export async function whatsAppConsentIn(tx: PoolClient, guestId: string): Promise<boolean | null> {
  return (await tx.query<{ granted: boolean }>("select granted from messaging_consents where guest_id = $1 and transport = 'whatsapp' order by at desc limit 1", [guestId])).rows[0]?.granted ?? null;
}

/** A guest's WhatsApp consent as last recorded (null: never asked). */
export async function whatsAppConsentOf(pool: Pool, schema: string, guestId: string): Promise<boolean | null> {
  if (!isUuid(guestId)) return null;
  return withTenant(pool, schema, (tx) => whatsAppConsentIn(tx, guestId));
}

/** Record a guest's WhatsApp consent or withdrawal (time, source, wording); a withdrawal stops WhatsApp only. */
export async function setWhatsAppConsent(pool: Pool, schema: string, guestId: string, input: { granted: boolean; source: string; wording: string }): Promise<void> {
  if (!isUuid(guestId)) throw new Error("Guest not found");
  await withTenant(pool, schema, (tx) => setConsentIn(tx, guestId, input));
}

export async function setConsentIn(tx: PoolClient, guestId: string, input: { granted: boolean; source: string; wording: string }): Promise<void> {
  if ((await whatsAppConsentIn(tx, guestId)) === input.granted) return;
  await tx.query("insert into messaging_consents (guest_id, transport, granted, source, wording) values ($1, 'whatsapp', $2, $3, $4)", [guestId, input.granted, input.source.slice(0, 100), input.wording.slice(0, 1000)]);
}

/**
 * Whether an automatic message goes by WhatsApp: a service message type, the
 * property's number connected, the guest opted in with an international
 * number, and an approved template in the language. The template's
 * parameters are filled from the message's values. Null: email.
 */
export async function whatsAppRouteIn(
  tx: PoolClient,
  input: { propertyId: string; guestId: string; phone: string | null; type: MessageType; language: MessageLanguage; values: Partial<Record<Placeholder, string>> },
): Promise<{ to: string; name: string; params: string[] } | null> {
  if (!(WHATSAPP_TYPES as readonly string[]).includes(input.type)) return null;
  const to = input.phone ? whatsAppNumber(input.phone) : null;
  if (!to || !(await accountIn(tx, input.propertyId)) || (await whatsAppConsentIn(tx, input.guestId)) !== true) return null;
  const t = (await tx.query<{ name: string; approved_text: string | null }>("select name, approved_text from whatsapp_templates where property_id = $1 and type = $2 and language = $3", [input.propertyId, input.type, input.language])).rows[0];
  if (!t?.approved_text) return null;
  return { to, name: t.name, params: asMetaTemplate(t.approved_text).params.map((p) => input.values[p as Placeholder] ?? "") };
}

/** A message went out on WhatsApp: counted for billing, per property (at cost; handling is added on the invoice). */
export async function countWhatsAppMessage(pool: Pool, tenantId: string, propertyId: string, cost: number): Promise<void> {
  await recordUsage(pool, tenantId, USAGE_KIND, 1, cost, new Date(), propertyId);
}

/** WhatsApp messages sent for a property in a month (by the platform's calendar), as billed. */
export async function whatsAppUsage(pool: Pool, tenantId: string, propertyId: string, month: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select coalesce(sum(quantity), 0) as n from control.usage_events
     where tenant_id = $1 and property_id = $2 and kind = $3 and at >= ($4::date::timestamp at time zone 'Europe/Berlin') and at < (($4::date + interval '1 month')::timestamp at time zone 'Europe/Berlin')`,
    [tenantId, propertyId, USAGE_KIND, `${month}-01`],
  );
  return Number(rows[0]!.n);
}

/** Which property (and so which tenant schema) a WhatsApp number belongs to, from its id at Meta. */
export async function propertyOfNumber(pool: Pool, schema: string, phoneNumberId: string): Promise<{ propertyId: string; account: WhatsAppAccount } | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ property_id: string; waba_id: string }>("select property_id, waba_id from whatsapp_accounts where phone_number_id = $1", [phoneNumberId]);
    return rows[0] ? { propertyId: rows[0].property_id, account: { wabaId: rows[0].waba_id, phoneNumberId } } : null;
  });
}

export async function whatsAppMessageKnown(pool: Pool, schema: string, providerId: string): Promise<boolean> {
  return withTenant(pool, schema, async (tx) =>
    (await tx.query("select 1 from conversation_messages where provider_id = $1 union all select 1 from whatsapp_unassigned where provider_id = $1", [providerId])).rows.length > 0,
  );
}

/**
 * A delivery state for something we sent: a staff message shows it; an
 * automatic message that failed on WhatsApp goes by email instead (once).
 */
export async function applyWhatsAppStatus(pool: Pool, schema: string, providerId: string, status: "sent" | "delivered" | "read" | "failed", error: string | null): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    await tx.query("update conversation_messages set delivery = $2, delivery_error = $3 where provider_id = $1 and delivery is distinct from 'read'", [providerId, status, error]);
    if (status === "failed") {
      await tx.query(
        `update guest_messages set transport = 'email', status = case when to_email is null then 'failed' else 'queued' end, provider_id = null, reason = $2, send_after = now()
         where provider_id = $1 and transport = 'whatsapp'`,
        [providerId, `whatsapp: ${error ?? "failed"}`.slice(0, 200)],
      );
    } else {
      await tx.query("update guest_messages set status = case when $2 in ('delivered', 'read') then 'delivered' else status end, delivered_at = case when $2 in ('delivered', 'read') then coalesce(delivered_at, now()) else delivered_at end where provider_id = $1 and transport = 'whatsapp'", [providerId, status]);
    }
  });
}

/** For the composer: whether the Conversation can go by WhatsApp, and whether free text is allowed now. */
export async function whatsAppState(pool: Pool, schema: string, propertyId: string, conversationId: string, now = new Date()): Promise<{ possible: boolean; windowOpen: boolean; templateReady: boolean; consent: boolean | null }> {
  if (!isUuid(conversationId)) return { possible: false, windowOpen: false, templateReady: false, consent: null };
  return withTenant(pool, schema, async (tx) => {
    const c = await whatsAppTarget(tx, propertyId, conversationId);
    if (!c || !(await accountIn(tx, propertyId))) return { possible: false, windowOpen: false, templateReady: false, consent: c?.consent ?? null };
    const t = (await tx.query("select 1 from whatsapp_templates where property_id = $1 and type = 'inbox_reply' and language = $2 and approved_text is not null", [propertyId, c.language])).rows.length > 0;
    return { possible: !!c.to && c.consent === true, windowOpen: windowOpen(c.lastIn, now), templateReady: t, consent: c.consent };
  });
}

/** Whom a Conversation reaches on WhatsApp: the number the guest wrote from, else the guest's own; with consent and language. */
async function whatsAppTarget(tx: PoolClient, propertyId: string, conversationId: string): Promise<{ to: string | null; lastIn: Date | null; guestId: string; consent: boolean | null; language: MessageLanguage; guestName: string; portalKey: string | null } | null> {
  const { rows } = await tx.query<{ whatsapp_phone: string | null; whatsapp_last_in: Date | null; guest_id: string | null; phone: string | null; language: string | null; fallback_language: MessageLanguage; use_guest_language: boolean; name: string; portal_key: string | null }>(
    `select c.whatsapp_phone, c.whatsapp_last_in, g.id as guest_id, g.phone, g.language, coalesce(pm.fallback_language, 'de') as fallback_language, coalesce(pm.use_guest_language, true) as use_guest_language,
            trim(g.first_name || ' ' || g.last_name) as name, coalesce(r.portal_key, b.portal_key) as portal_key
     from conversations c left join reservations r on r.id = c.reservation_id join bookings b on b.id = coalesce(c.booking_id, r.booking_id)
       left join guests g on g.id = coalesce(r.primary_guest_id, b.booker_guest_id) left join property_messaging pm on pm.property_id = c.property_id
     where c.id = $1 and c.property_id = $2`,
    [conversationId, propertyId],
  );
  const r = rows[0];
  if (!r?.guest_id) return null;
  const language: MessageLanguage = r.use_guest_language && r.language && isMessageLanguage(r.language) ? r.language : r.fallback_language;
  return { to: r.whatsapp_phone ?? (r.phone ? whatsAppNumber(r.phone) : null), lastIn: r.whatsapp_last_in, guestId: r.guest_id, consent: await whatsAppConsentIn(tx, r.guest_id), language, guestName: r.name, portalKey: r.portal_key };
}

/**
 * A staff message written for WhatsApp goes out: free text within 24 hours
 * of the guest's last message, else the approved "answer" template with the
 * text in it; refused otherwise (the composer offers email). Its delivery is
 * shown on the message.
 */
export async function deliverStaffWhatsApp(
  pool: Pool,
  schema: string,
  provider: WhatsAppProvider,
  input: { tenantId: string; propertyId: string; messageId: string; portalBase: string | null; cost: number },
  now = new Date(),
): Promise<void> {
  const failed = (error: string) => withTenant(pool, schema, (tx) => tx.query("update conversation_messages set delivery = 'failed', delivery_error = $2 where id = $1", [input.messageId, error.slice(0, 300)]));
  const prepared = await withTenant(pool, schema, async (tx) => {
    const m = (await tx.query<{ id: string; conversation_id: string; body: string; file_id: string | null }>(
      "select m.id, m.conversation_id, m.body, m.file_id from conversation_messages m join conversations c on c.id = m.conversation_id where m.id = $1 and c.property_id = $2 and m.via = 'whatsapp' and m.delivery = 'sending'",
      [input.messageId, input.propertyId],
    )).rows[0];
    if (!m) throw new Error("Message not found");
    const account = await accountIn(tx, input.propertyId);
    const c = await whatsAppTarget(tx, input.propertyId, m.conversation_id);
    if (!account || !c?.to || c.consent !== true) throw new Error("This guest cannot be reached on WhatsApp: send by email");
    const hotel = (await tx.query<{ name: string }>("select name from properties where id = $1", [input.propertyId])).rows[0]!.name;
    const template = windowOpen(c.lastIn, now)
      ? null
      : (await tx.query<{ name: string; approved_text: string | null }>("select name, approved_text from whatsapp_templates where property_id = $1 and type = 'inbox_reply' and language = $2", [input.propertyId, c.language])).rows[0];
    if (template && !template.approved_text) throw new Error("More than 24 hours since the guest wrote and no approved template: send by email");
    const values: Partial<Record<Placeholder, string>> = { guest_name: c.guestName, hotel_name: hotel, message: m.body, portal_link: input.portalBase && c.portalKey ? `${input.portalBase}/g/${c.portalKey}` : "" };
    return { m, account, to: c.to, template: template ? { name: template.name, language: c.language, params: asMetaTemplate(template.approved_text!).params.map((p) => values[p as Placeholder] ?? "") } : null };
  }).catch(async (err: unknown) => {
    // not sendable: the message stays in the thread, marked as not sent
    if (err instanceof Error && err.message !== "Message not found") await failed(err.message);
    throw err;
  });
  try {
    const sent = prepared.template ? await provider.sendTemplate(prepared.account, prepared.to, prepared.template) : await provider.sendText(prepared.account, prepared.to, prepared.m.body);
    await withTenant(pool, schema, (tx) => tx.query("update conversation_messages set provider_id = $2, delivery = 'sent' where id = $1", [prepared.m.id, sent.messageId]));
    await countWhatsAppMessage(pool, input.tenantId, input.propertyId, input.cost);
  } catch (err) {
    await failed(err instanceof Error ? err.message : "failed");
    if (err instanceof DeliveryError && err.retry) throw new Error("WhatsApp is not reachable just now; try again or send by email");
    throw err;
  }
}

export interface IncomingWhatsApp {
  propertyId: string;
  providerId: string;
  from: string;
  name: string;
  text: string;
  at: Date;
  fileId: string | null;
}

/**
 * A guest's WhatsApp message: matched by number to the Conversation of the
 * guest's current or next stay at the property (the number they wrote from
 * before, else a guest profile with that number); several stays, an unknown
 * or a shared number wait Unassigned for staff. Writing first counts as
 * opting in. Null when unmatched.
 */
export async function matchWhatsApp(tx: PoolClient, msg: IncomingWhatsApp): Promise<{ conversationId: string; guestId: string } | null> {
  const { rows } = await tx.query<{ reservation_id: string; guest_id: string }>(
    `select distinct r.id as reservation_id, r.primary_guest_id as guest_id
     from reservations r join guests g on g.id = r.primary_guest_id join properties p on p.id = r.property_id
     where r.property_id = $1 and r.status in ('confirmed', 'checked_in') and r.departure >= coalesce(p.business_date, current_date)
       and (g.phone_normalised = $2 or exists (select 1 from conversations c where c.reservation_id = r.id and c.whatsapp_phone = $2))`,
    [msg.propertyId, msg.from],
  );
  if (rows.length !== 1) return null;
  await tx.query("insert into conversations (property_id, reservation_id) values ($1, $2) on conflict do nothing", [msg.propertyId, rows[0]!.reservation_id]);
  const c = (await tx.query<{ id: string }>("select id from conversations where reservation_id = $1", [rows[0]!.reservation_id])).rows[0]!;
  return { conversationId: c.id, guestId: rows[0]!.guest_id };
}

/** The Conversation now talks to this number on WhatsApp; the guest's message opens the 24 hours. */
export async function noteWhatsAppIn(tx: PoolClient, conversationId: string, guestId: string, from: string, at: Date): Promise<void> {
  await tx.query("update conversations set whatsapp_phone = $2, whatsapp_last_in = greatest(coalesce(whatsapp_last_in, $3), $3) where id = $1", [conversationId, from, at]);
  // a guest who writes first has opted in; one who wrote STOP has withdrawn (WhatsApp only)
  await setConsentIn(tx, guestId, { granted: true, source: "guest wrote on WhatsApp", wording: "The guest wrote to the property on WhatsApp." });
}

export async function withdrawWhatsAppIn(tx: PoolClient, guestId: string): Promise<void> {
  await setConsentIn(tx, guestId, { granted: false, source: "guest wrote STOP on WhatsApp", wording: "STOP" });
}

export async function keepUnassignedIn(tx: PoolClient, msg: IncomingWhatsApp): Promise<void> {
  // its picture is kept while it waits (a quarter); linked, it is the Conversation's
  if (msg.fileId) await tx.query("update stored_files set delete_after = current_date + 90 where id = $1", [msg.fileId]);
  await tx.query("insert into whatsapp_unassigned (property_id, from_phone, name, body, file_id, provider_id, received_at) values ($1, $2, $3, $4, $5, $6, $7) on conflict (provider_id) do nothing", [
    msg.propertyId,
    msg.from,
    msg.name.slice(0, 200),
    msg.text.slice(0, 5000),
    msg.fileId,
    msg.providerId,
    msg.at,
  ]);
}

export interface UnassignedWhatsApp {
  id: string;
  propertyId: string;
  fromPhone: string;
  name: string;
  body: string;
  fileId: string | null;
  receivedAt: Date;
}

export async function listUnassignedWhatsApp(pool: Pool, schema: string, propertyIds: string[]): Promise<UnassignedWhatsApp[]> {
  const ids = propertyIds.filter(isUuid);
  if (!ids.length) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; property_id: string; from_phone: string; name: string; body: string; file_id: string | null; received_at: Date }>(
      "select id, property_id, from_phone, name, body, file_id, received_at from whatsapp_unassigned where property_id = any($1::uuid[]) and linked_at is null order by received_at desc limit 100",
      [ids],
    )).rows.map((r) => ({ id: r.id, propertyId: r.property_id, fromPhone: r.from_phone, name: r.name, body: r.body, fileId: r.file_id, receivedAt: r.received_at })),
  );
}

/** The stays an Unassigned message could belong to: current and coming ones at the property. */
export async function linkableStays(pool: Pool, schema: string, propertyId: string): Promise<{ reservationId: string; label: string }[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; label: string }>(
      `select r.id, b.confirmation_number || ' · ' || trim(g.first_name || ' ' || g.last_name) || ' · ' || to_char(r.arrival, 'DD.MM.') || '–' || to_char(r.departure, 'DD.MM.') as label
       from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id join properties p on p.id = r.property_id
       where r.property_id = $1 and r.status in ('confirmed', 'checked_in') and r.departure >= coalesce(p.business_date, current_date)
       order by r.arrival, g.last_name limit 300`,
      [propertyId],
    )).rows.map((r) => ({ reservationId: r.id, label: r.label })),
  );
}
