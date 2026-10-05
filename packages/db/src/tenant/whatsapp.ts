import type { Pool, PoolClient } from "pg";
import {
  SHIPPED_TEXTS,
  WHATSAPP_TYPES,
  asMetaTemplate,
  isMessageLanguage,
  messageLanguage,
  storedForms,
  unknownPlaceholders,
  whatsAppNumber,
  windowOpen,
  type MessageLanguage,
  type MessageType,
  type Placeholder,
  type WhatsAppType,
} from "@hoteloftware/domain";
import { DeliveryError, type TemplateState, type WhatsAppAccount, type WhatsAppProvider } from "@hoteloftware/messaging";
import { isUuid } from "./catalogue-common";
import { claimProviderAccount } from "../control/external-ids";
import { recordUsage } from "../control/subscription";
import { fileIn } from "./files";
import { withTenant } from "./with-tenant";

/**
 * The WhatsApp Module (ticket 44): a property connects its own business
 * account and number; templates per type and language go to Meta's review;
 * service messages go by WhatsApp to guests who opted in (an approved
 * template, else email, never both); staff write freely within 24 hours of the
 * guest's last message, otherwise they send an approved template or email;
 * guests' messages are matched to their stay by number, or wait Unassigned.
 * What Meta bills (delivered template messages) is counted per property.
 */

/** The provider name in control.external_ids: a number's (or business account's) id at Meta finds its tenant. */
export const WHATSAPP_SOURCE = "whatsapp";
export const USAGE_KIND = "whatsapp_message";

const SIGN_OFF: Record<MessageLanguage, string> = { de: "Ihr Team vom {hotel_name}.", en: "Your team at {hotel_name}." };
/** What a guest writes to stop WhatsApp messages (withdrawal, WhatsApp only). */
const STOP_WORDS = /^\s*(stop|stopp|abmelden|unsubscribe|abbestellen)\s*[.!]?\s*$/i;

/** The text we ship for a template: the email's blocks (a template may not end on a placeholder, so a closing line follows). */
export function shippedWhatsAppText(type: WhatsAppType, language: MessageLanguage): string {
  return [...SHIPPED_TEXTS[type][language].blocks, SIGN_OFF[language]].join("\n\n");
}

/** Meta's name of a template version: an edit is a new version, so the approved one keeps going out meanwhile. */
const templateName = (type: string, version: number) => (version === 1 ? `hs_${type}` : `hs_${type}_v${version}`);

const MODULE_ON = `exists (select 1 from property_modules m join properties p on p.id = m.property_id
  where m.property_id = $1 and m.module = 'whatsapp' and m.on_since <= coalesce(p.business_date, current_date) and (m.off_at is null or m.off_at > coalesce(p.business_date, current_date)))`;

export interface WhatsAppConnection {
  wabaId: string;
  phoneNumberId: string;
  displayNumber: string;
  connectedAt: Date;
}

async function accountIn(tx: PoolClient, propertyId: string): Promise<(WhatsAppAccount & { displayNumber: string; connectedAt: Date }) | null> {
  const { rows } = await tx.query<{ waba_id: string; phone_number_id: string; display_number: string; connected_at: Date }>(
    `select waba_id, phone_number_id, display_number, connected_at from whatsapp_accounts where property_id = $1 and ${MODULE_ON}`,
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
 * number: the provider checks the grant covers them (a number of another
 * hotel is refused), the number is claimed for this tenant alone, and the
 * shipped templates go to review. `coexistence`: the number stays in the
 * hotel's WhatsApp Business app; otherwise it is registered as a new number.
 */
export async function connectWhatsApp(
  pool: Pool,
  schema: string,
  provider: WhatsAppProvider,
  input: { tenantId: string; propertyId: string; code: string; wabaId: string; phoneNumberId: string; coexistence: boolean },
  userId: string,
): Promise<void> {
  if (!isUuid(input.propertyId)) throw new Error("Property not found");
  const on = await withTenant(pool, schema, async (tx) => (await tx.query(`select 1 where ${MODULE_ON}`, [input.propertyId])).rows.length > 0);
  if (!on) throw new Error("Switch the WhatsApp Module on first");
  const { displayNumber } = await provider.finishSignup(input);
  await claimProviderAccount(pool, WHATSAPP_SOURCE, input.phoneNumberId, input.tenantId, input.propertyId);
  await claimProviderAccount(pool, WHATSAPP_SOURCE, input.wabaId, input.tenantId, input.propertyId);
  await withTenant(pool, schema, (tx) =>
    tx.query(
      `insert into whatsapp_accounts (property_id, waba_id, phone_number_id, display_number, connected_by) values ($1, $2, $3, $4, $5)
       on conflict (property_id) do update set waba_id = excluded.waba_id, phone_number_id = excluded.phone_number_id, display_number = excluded.display_number, connected_at = now(), connected_by = excluded.connected_by`,
      [input.propertyId, input.wabaId, input.phoneNumberId, displayNumber, userId],
    ),
  );
  await submitWhatsAppTemplates(pool, schema, provider, input.propertyId);
}

/** Templates not yet at Meta are submitted (the shipped text, or the property's own). */
export async function submitWhatsAppTemplates(pool: Pool, schema: string, provider: WhatsAppProvider, propertyId: string): Promise<number> {
  const account = await whatsAppConnection(pool, schema, propertyId);
  if (!account) throw new Error("Connect a WhatsApp number first");
  const due = await withTenant(pool, schema, async (tx) => {
    for (const type of WHATSAPP_TYPES) {
      for (const language of ["de", "en"] as const) {
        await tx.query("insert into whatsapp_templates (property_id, type, language, name, text) values ($1, $2, $3, $4, $5) on conflict do nothing", [propertyId, type, language, templateName(type, 1), shippedWhatsAppText(type, language)]);
      }
    }
    return (await tx.query<{ id: string; language: string; name: string; text: string }>("select id, language, name, text from whatsapp_templates where property_id = $1 and provider_id is null", [propertyId])).rows;
  });
  for (const t of due) {
    const r = await provider.submitTemplate(account, { name: t.name, language: t.language, ...metaBody(t.text) });
    await withTenant(pool, schema, (tx) => tx.query("update whatsapp_templates set provider_id = $2, status = $3, updated_at = now() where id = $1", [t.id, r.templateId, r.status]));
    if (r.status === "approved") await applyTemplateReview(pool, schema, r.templateId, "approved", null);
  }
  return due.length;
}

/** A template's body for Meta, with an example per parameter for the review. */
function metaBody(text: string): { body: string; examples: string[] } {
  const { body, params } = asMetaTemplate(text);
  const sample: Partial<Record<string, string>> = { guest_name: "Anna Schmidt", hotel_name: "Hotel Beispiel", confirmation: "100123", arrival: "12.10.2026", departure: "14.10.2026", amount: "120,00 €", portal_link: "https://hotel.example/g/abc", checkout_time: "11:00" };
  return { body, examples: params.map((p) => sample[p] ?? p) };
}

export interface WhatsAppTemplateRow {
  id: string;
  type: WhatsAppType;
  language: MessageLanguage;
  text: string;
  status: TemplateState;
  reason: string | null;
  /** The text in use (while an edit is in review, the earlier approved one); null: none goes out. */
  approvedText: string | null;
}

export async function listWhatsAppTemplates(pool: Pool, schema: string, propertyId: string): Promise<WhatsAppTemplateRow[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; type: WhatsAppType; language: MessageLanguage; text: string; status: TemplateState; reason: string | null; approved_text: string | null }>(
      "select id, type, language, text, status, reason, approved_text from whatsapp_templates where property_id = $1 order by type, language",
      [propertyId],
    )).rows.map((r) => ({ id: r.id, type: r.type, language: r.language, text: r.text, status: r.status, reason: r.reason, approvedText: r.approved_text })),
  );
}

/** The property edits a template: a new version goes to review; the approved version is used meanwhile. */
export async function saveWhatsAppTemplate(pool: Pool, schema: string, provider: WhatsAppProvider, propertyId: string, templateId: string, text: string, userId: string): Promise<void> {
  const clean = text.trim();
  if (!clean || clean.length > 1024) throw new Error("A template has up to 1,024 characters");
  const unknown = unknownPlaceholders({ subject: "", blocks: [clean] });
  if (unknown.length) throw new Error(`Unknown placeholder: ${unknown.map((u) => `{${u}}`).join(", ")}`);
  if (/^\s*\{[a-z_]+\}|\{[a-z_]+\}\s*$/.test(clean)) throw new Error("A template may not begin or end with a placeholder");
  const account = await whatsAppConnection(pool, schema, propertyId);
  if (!account) throw new Error("Connect a WhatsApp number first");
  const t = await withTenant(pool, schema, async (tx) => (await tx.query<{ id: string; type: string; language: string; version: number }>("select id, type, language, version from whatsapp_templates where id = $1 and property_id = $2", [templateId, propertyId])).rows[0]);
  if (!t) throw new Error("Template not found");
  const version = t.version + 1;
  const r = await provider.submitTemplate(account, { name: templateName(t.type, version), language: t.language, ...metaBody(clean) });
  await withTenant(pool, schema, (tx) =>
    tx.query("update whatsapp_templates set text = $2, version = $3, name = $4, status = $5, provider_id = $6, reason = null, updated_at = now(), updated_by = $7 where id = $1", [t.id, clean, version, templateName(t.type, version), r.status, r.templateId, userId]),
  );
  if (r.status === "approved") await applyTemplateReview(pool, schema, r.templateId, "approved", null);
}

/**
 * Meta's review of a template version (webhook or the regular check). The
 * latest version approved goes out from now on; rejected, the approved one
 * stays. The version in use paused or disabled by Meta: none goes out (email
 * instead). A notice about an older version changes nothing else.
 */
export async function applyTemplateReview(pool: Pool, schema: string, providerTemplateId: string, status: TemplateState, reason: string | null): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    await tx.query(
      `update whatsapp_templates set status = $2, reason = $3, updated_at = now(),
         approved_name = case when $2 = 'approved' then name else approved_name end,
         approved_text = case when $2 = 'approved' then text else approved_text end,
         approved_provider_id = case when $2 = 'approved' then provider_id else approved_provider_id end
       where provider_id = $1`,
      [providerTemplateId, status, reason],
    );
    if (status !== "approved") {
      await tx.query("update whatsapp_templates set approved_name = null, approved_text = null, approved_provider_id = null, reason = coalesce($2, reason) where approved_provider_id = $1", [providerTemplateId, reason]);
    }
  });
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

/** The guest's own WhatsApp number, from the profile, in the property's country. */
async function guestNumberIn(tx: PoolClient, guestId: string, propertyId: string): Promise<string | null> {
  const { rows } = await tx.query<{ phone: string | null; country: string }>("select g.phone, p.country from guests g, properties p where g.id = $1 and p.id = $2", [guestId, propertyId]);
  return rows[0]?.phone ? whatsAppNumber(rows[0].phone, rows[0].country) : null;
}

/**
 * Whether an automatic message goes by WhatsApp: a service message type, the
 * property's number connected (Module on), the guest opted in with a number,
 * and an approved template in the language. Parameters come from the
 * message's values. Null: email.
 */
export async function whatsAppRouteIn(
  tx: PoolClient,
  input: { propertyId: string; guestId: string; type: MessageType; language: MessageLanguage; values: Partial<Record<Placeholder, string>> },
): Promise<{ to: string; name: string; params: string[] } | null> {
  if (!(WHATSAPP_TYPES as readonly string[]).includes(input.type)) return null;
  const to = await guestNumberIn(tx, input.guestId, input.propertyId);
  if (!to || !(await accountIn(tx, input.propertyId)) || (await whatsAppConsentIn(tx, input.guestId)) !== true) return null;
  const t = (await tx.query<{ approved_name: string | null; approved_text: string | null }>("select approved_name, approved_text from whatsapp_templates where property_id = $1 and type = $2 and language = $3", [input.propertyId, input.type, input.language])).rows[0];
  if (!t?.approved_text || !t.approved_name) return null;
  return { to, name: t.approved_name, params: asMetaTemplate(t.approved_text).params.map((p) => input.values[p as Placeholder] ?? "") };
}

/** Still the way at sending time: the Module on and the guest's consent not withdrawn since the message was queued. */
export async function stillByWhatsAppIn(tx: PoolClient, propertyId: string, reservationId: string): Promise<WhatsAppAccount | null> {
  const account = await accountIn(tx, propertyId);
  const guest = (await tx.query<{ primary_guest_id: string }>("select primary_guest_id from reservations where id = $1", [reservationId])).rows[0];
  return account && guest && (await whatsAppConsentIn(tx, guest.primary_guest_id)) === true ? account : null;
}

/** An automatic message that cannot go by WhatsApp goes by email instead (once, from the start), or fails without an address. */
export async function fallBackToEmailIn(tx: PoolClient, where: { id: string } | { providerId: string }, reason: string): Promise<void> {
  await tx.query(
    `update guest_messages set transport = 'email', status = case when to_email is null then 'failed' else 'queued' end, provider_id = null, claimed_at = null, attempts = 0,
       reason = $2, send_after = now()
     where ${"id" in where ? "id" : "provider_id"} = $1 and transport = 'whatsapp'`,
    ["id" in where ? where.id : where.providerId, `whatsapp: ${reason}`.slice(0, 200)],
  );
}

/** WhatsApp messages Meta billed for a property in a month (UTC, as Meta counts). */
export async function whatsAppUsage(pool: Pool, tenantId: string, propertyId: string, month: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `select coalesce(sum(quantity), 0) as n from control.usage_events
     where tenant_id = $1 and property_id = $2 and kind = $3 and at >= ($4::date::timestamp at time zone 'UTC') and at < (($4::date + interval '1 month')::timestamp at time zone 'UTC')`,
    [tenantId, propertyId, USAGE_KIND, `${month}-01`],
  );
  return Number(rows[0]!.n);
}

/** Which property a WhatsApp number belongs to, from its id at Meta. */
export async function propertyOfNumber(pool: Pool, schema: string, phoneNumberId: string): Promise<{ propertyId: string; account: WhatsAppAccount } | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ property_id: string; waba_id: string }>("select property_id, waba_id from whatsapp_accounts where phone_number_id = $1", [phoneNumberId]);
    return rows[0] ? { propertyId: rows[0].property_id, account: { wabaId: rows[0].waba_id, phoneNumberId } } : null;
  });
}

export async function whatsAppMessageKnownIn(tx: PoolClient, providerId: string): Promise<boolean> {
  return (await tx.query("select 1 from conversation_messages where provider_id = $1 union all select 1 from whatsapp_unassigned where provider_id = $1", [providerId])).rows.length > 0;
}

export async function whatsAppMessageKnown(pool: Pool, schema: string, providerId: string): Promise<boolean> {
  return withTenant(pool, schema, (tx) => whatsAppMessageKnownIn(tx, providerId));
}

/**
 * A delivery state for something we sent. States only move forward; an
 * automatic message that failed on WhatsApp goes by email instead (once); a
 * message Meta bills (a delivered template) is counted once for the
 * property. False when no message of ours has that id (yet).
 */
export async function applyWhatsAppStatus(
  pool: Pool,
  schema: string,
  input: { tenantId: string; providerId: string; status: "sent" | "delivered" | "read" | "failed"; error: string | null; billable: boolean; cost: number },
): Promise<boolean> {
  const rank = { sent: 1, delivered: 2, read: 3, failed: 0 } as const;
  const found = await withTenant(pool, schema, async (tx) => {
    const staff = (await tx.query<{ id: string; delivery: keyof typeof rank | "sending" | null; property_id: string }>(
      "select m.id, m.delivery, c.property_id from conversation_messages m join conversations c on c.id = m.conversation_id where m.provider_id = $1 for update of m",
      [input.providerId],
    )).rows[0];
    if (staff) {
      const now = staff.delivery && staff.delivery !== "sending" ? rank[staff.delivery] : 0;
      const forward = input.status === "failed" ? staff.delivery !== "read" : rank[input.status] > now;
      if (forward) await tx.query("update conversation_messages set delivery = $2, delivery_error = $3 where id = $1", [staff.id, input.status, input.error]);
    }
    const auto = (await tx.query<{ property_id: string }>("select property_id from guest_messages where provider_id = $1 and transport = 'whatsapp' for update", [input.providerId])).rows[0];
    if (auto) {
      if (input.status === "failed") await fallBackToEmailIn(tx, { providerId: input.providerId }, input.error ?? "failed");
      else if (input.status !== "sent") await tx.query("update guest_messages set status = 'delivered', delivered_at = coalesce(delivered_at, now()) where provider_id = $1 and transport = 'whatsapp'", [input.providerId]);
    }
    const propertyId = staff?.property_id ?? auto?.property_id;
    if (!propertyId) return null;
    const counted = input.billable && (await tx.query("insert into whatsapp_billed (provider_id, property_id) values ($1, $2) on conflict do nothing returning provider_id", [input.providerId, propertyId])).rows.length > 0;
    return { propertyId, counted };
  });
  if (found?.counted) await recordUsage(pool, input.tenantId, USAGE_KIND, 1, input.cost, new Date(), found.propertyId);
  return found !== null;
}

export interface WhatsAppState {
  /** The guest can be reached on WhatsApp at all. */
  possible: boolean;
  /** Within 24 hours of the guest's last WhatsApp message: free text (and files). */
  windowOpen: boolean;
  /** Outside them: the service templates approved in the guest's language, to send instead. */
  templates: WhatsAppType[];
  consent: boolean | null;
}

/** For the composer: whether the Conversation can go by WhatsApp, free text now, or which templates. */
export async function whatsAppState(pool: Pool, schema: string, propertyId: string, conversationId: string, now = new Date()): Promise<WhatsAppState> {
  const none: WhatsAppState = { possible: false, windowOpen: false, templates: [], consent: null };
  if (!isUuid(conversationId)) return none;
  return withTenant(pool, schema, async (tx) => {
    const c = await whatsAppTarget(tx, propertyId, conversationId);
    if (!c || !(await accountIn(tx, propertyId))) return { ...none, consent: c?.consent ?? null };
    const open = !!c.writtenFrom && windowOpen(c.lastIn, now);
    const templates =
      c.consent === true && c.guestNumber
        ? (await tx.query<{ type: WhatsAppType }>("select type from whatsapp_templates where property_id = $1 and language = $2 and approved_text is not null order by type", [propertyId, c.language])).rows.map((r) => r.type)
        : [];
    return { possible: open || templates.length > 0, windowOpen: open, templates, consent: c.consent };
  });
}

/** Whom a Conversation reaches: within the 24 hours the number that wrote; for templates the guest's own number with the guest's consent. */
async function whatsAppTarget(
  tx: PoolClient,
  propertyId: string,
  conversationId: string,
): Promise<{ writtenFrom: string | null; guestNumber: string | null; lastIn: Date | null; guestId: string; reservationId: string | null; consent: boolean | null; language: MessageLanguage } | null> {
  const { rows } = await tx.query<{ whatsapp_phone: string | null; whatsapp_last_in: Date | null; guest_id: string | null; reservation_id: string | null; language: string | null; fallback_language: MessageLanguage; use_guest_language: boolean }>(
    `select c.whatsapp_phone, c.whatsapp_last_in, g.id as guest_id, coalesce(r.id, (select x.id from reservations x where x.booking_id = c.booking_id and x.status <> 'cancelled' order by x.created_at limit 1)) as reservation_id,
            g.language, coalesce(pm.fallback_language, 'de') as fallback_language, coalesce(pm.use_guest_language, true) as use_guest_language
     from conversations c left join reservations r on r.id = c.reservation_id join bookings b on b.id = coalesce(c.booking_id, r.booking_id)
       left join guests g on g.id = coalesce(r.primary_guest_id, b.booker_guest_id) left join property_messaging pm on pm.property_id = c.property_id
     where c.id = $1 and c.property_id = $2`,
    [conversationId, propertyId],
  );
  const r = rows[0];
  if (!r?.guest_id) return null;
  const language = messageLanguage(r.language, r.use_guest_language, r.fallback_language);
  return { writtenFrom: r.whatsapp_phone, guestNumber: await guestNumberIn(tx, r.guest_id, propertyId), lastIn: r.whatsapp_last_in, guestId: r.guest_id, reservationId: r.reservation_id, consent: await whatsAppConsentIn(tx, r.guest_id), language };
}

/** The stay a template from the composer is sent for (its values: confirmation, dates, link …); null when the guest cannot get templates. */
export async function templateTargetIn(tx: PoolClient, propertyId: string, conversationId: string): Promise<{ reservationId: string } | null> {
  const c = await whatsAppTarget(tx, propertyId, conversationId);
  return c?.reservationId && c.consent === true && c.guestNumber ? { reservationId: c.reservationId } : null;
}

/**
 * A staff message written for WhatsApp goes out: within 24 hours of the
 * guest's last message as free text (or the file with the text as caption);
 * refused otherwise (the composer offers a template or email). Only the send
 * itself may fail into "not sent": once WhatsApp took it, it is never sent
 * again.
 */
export async function deliverStaffWhatsApp(
  pool: Pool,
  schema: string,
  provider: WhatsAppProvider,
  input: { propertyId: string; messageId: string; read: (key: string) => Promise<Uint8Array | null> },
  now = new Date(),
): Promise<void> {
  const failed = (error: string) => withTenant(pool, schema, (tx) => tx.query("update conversation_messages set delivery = 'failed', delivery_error = $2 where id = $1 and delivery = 'sending'", [input.messageId, error.slice(0, 300)]));
  const prepared = await withTenant(pool, schema, async (tx) => {
    const m = (await tx.query<{ id: string; conversation_id: string; body: string; file_id: string | null }>(
      "select m.id, m.conversation_id, m.body, m.file_id from conversation_messages m join conversations c on c.id = m.conversation_id where m.id = $1 and c.property_id = $2 and m.via = 'whatsapp' and m.delivery = 'sending'",
      [input.messageId, input.propertyId],
    )).rows[0];
    if (!m) throw new Error("Message not found");
    const account = await accountIn(tx, input.propertyId);
    const c = await whatsAppTarget(tx, input.propertyId, m.conversation_id);
    if (!account || !c?.writtenFrom || !windowOpen(c.lastIn, now)) throw new Error("More than 24 hours since the guest wrote: send an approved template or by email");
    const file = m.file_id ? await fileIn(tx, m.file_id) : null;
    return { m, account, to: c.writtenFrom, file };
  }).catch(async (err: unknown) => {
    // not sendable: the message stays in the thread, marked as not sent
    if (err instanceof Error && err.message !== "Message not found") await failed(err.message);
    throw err;
  });
  let messageId: string;
  try {
    if (prepared.file) {
      const bytes = await input.read(prepared.file.key);
      if (!bytes) throw new DeliveryError("The file is gone", false);
      messageId = (await provider.sendMedia(prepared.account, prepared.to, { bytes, type: prepared.file.contentType, name: prepared.file.contentType === "application/pdf" ? "document.pdf" : "image", caption: prepared.m.body })).messageId;
    } else {
      messageId = (await provider.sendText(prepared.account, prepared.to, prepared.m.body)).messageId;
    }
  } catch (err) {
    await failed(err instanceof Error ? err.message : "failed");
    if (err instanceof DeliveryError && err.retry) throw new Error("WhatsApp is not reachable just now; try again or send by email");
    throw err;
  }
  await withTenant(pool, schema, (tx) => tx.query("update conversation_messages set provider_id = $2, delivery = case when delivery = 'sending' then 'sent' else delivery end where id = $1", [prepared.m.id, messageId]));
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
 * before, or a guest profile with that number, national or international);
 * several stays, an unknown or shared number wait Unassigned. Null when
 * unmatched.
 */
export async function matchWhatsApp(tx: PoolClient, msg: { propertyId: string; from: string }): Promise<{ conversationId: string; guestId: string } | null> {
  const country = (await tx.query<{ country: string }>("select country from properties where id = $1", [msg.propertyId])).rows[0]?.country ?? null;
  const { rows } = await tx.query<{ reservation_id: string; guest_id: string }>(
    `select distinct r.id as reservation_id, r.primary_guest_id as guest_id
     from reservations r join guests g on g.id = r.primary_guest_id join properties p on p.id = r.property_id
     where r.property_id = $1 and r.status in ('confirmed', 'checked_in') and r.departure >= coalesce(p.business_date, current_date)
       and (g.phone_normalised = any($3::text[]) or exists (select 1 from conversations c where c.reservation_id = r.id and c.whatsapp_phone = $2))`,
    [msg.propertyId, msg.from, storedForms(msg.from, country)],
  );
  if (rows.length !== 1) return null;
  await tx.query("insert into conversations (property_id, reservation_id) values ($1, $2) on conflict do nothing", [msg.propertyId, rows[0]!.reservation_id]);
  const c = (await tx.query<{ id: string }>("select id from conversations where reservation_id = $1", [rows[0]!.reservation_id])).rows[0]!;
  return { conversationId: c.id, guestId: rows[0]!.guest_id };
}

/**
 * A guest wrote from a number: the Conversation talks to it from now on and
 * the 24 hours open. "STOP" withdraws for every guest with that number
 * (WhatsApp only). Writing first opts the guest in, only from the guest's own
 * number and only when the guest never decided before (a withdrawal stands
 * until the guest opts in again in the portal or at the desk).
 */
export async function noteWhatsAppIn(tx: PoolClient, input: { conversationId: string | null; guestId: string | null; propertyId: string; from: string; text: string; at: Date }): Promise<void> {
  const country = (await tx.query<{ country: string }>("select country from properties where id = $1", [input.propertyId])).rows[0]?.country ?? null;
  const stop = STOP_WORDS.test(input.text);
  if (stop) {
    const { rows } = await tx.query<{ id: string }>("select id from guests where phone_normalised = any($1::text[])", [storedForms(input.from, country)]);
    for (const g of rows) await setConsentIn(tx, g.id, { granted: false, source: "guest wrote STOP on WhatsApp", wording: input.text.trim().slice(0, 50) });
  }
  if (!input.conversationId || !input.guestId) return;
  await tx.query("update conversations set whatsapp_phone = $2, whatsapp_last_in = greatest(coalesce(whatsapp_last_in, $3), $3) where id = $1", [input.conversationId, input.from, input.at]);
  if (stop) return;
  if ((await guestNumberIn(tx, input.guestId, input.propertyId)) === input.from && (await whatsAppConsentIn(tx, input.guestId)) === null) {
    await setConsentIn(tx, input.guestId, { granted: true, source: "guest wrote on WhatsApp", wording: "The guest wrote to the property on WhatsApp." });
  }
}

/** How long an Unassigned message waits for staff before it goes (with its file). */
export const UNASSIGNED_DAYS = 30;

export async function keepUnassignedIn(tx: PoolClient, msg: IncomingWhatsApp): Promise<void> {
  // its picture is kept while it waits; linked, it is the Conversation's
  if (msg.fileId) await tx.query("update stored_files set delete_after = current_date + $2::int where id = $1", [msg.fileId, UNASSIGNED_DAYS]);
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

/** The retention of Unassigned messages: gone after a month unlinked (their files went with the file retention). */
export async function deleteOldUnassignedWhatsApp(pool: Pool, schema: string): Promise<number> {
  return withTenant(pool, schema, async (tx) => (await tx.query("delete from whatsapp_unassigned where received_at < now() - make_interval(days => $1)", [UNASSIGNED_DAYS])).rowCount ?? 0);
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
      "select id, property_id, from_phone, name, body, file_id, received_at from whatsapp_unassigned where property_id = any($1::uuid[]) order by received_at desc limit 100",
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
