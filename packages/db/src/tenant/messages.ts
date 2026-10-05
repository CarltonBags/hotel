import type { Pool, PoolClient } from "pg";
import {
  ACCENTS,
  MESSAGE_TYPE_INFO,
  MESSAGE_TYPES,
  SHIPPED_TEXTS,
  formatCurrency,
  isAccentId,
  isMessageLanguage,
  isMessageType,
  messageLanguage,
  messageSendable,
  missingPlaceholders,
  renderMessage,
  sendAfter,
  senderDomainProblem,
  unknownPlaceholders,
  type ManualMessageType,
  type MessageLanguage,
  type MessageText,
  type MessageType,
  type Placeholder,
} from "@hoteloftware/domain";
import { DeliveryError, type DomainStatus, type MailEvent, type MailProvider, type SmsProvider } from "@hoteloftware/messaging";
import { dispatchOutboxes, OUTBOX_MAX_ATTEMPTS, queueMail } from "./mail-outbox";
import { senderFor, type SenderOptions } from "./sender";
import { withTenant } from "./with-tenant";

/**
 * Automatic guest messages (ticket 39): settings and edited texts per
 * property, the scan that derives messages from what happened (bookings,
 * changes, invoices, payments, stays), and their dispatch through the mail
 * provider with delivery state. They are Messages to the guest by email;
 * they join the reservation's Conversation with ticket 43.
 */

export interface MessagingSettings {
  propertyId: string;
  sendingFrom: string;
  sendingTo: string;
  fallbackLanguage: MessageLanguage;
  useGuestLanguage: boolean;
  /** Every type: on or off (fixed types are always on). */
  enabled: Record<MessageType, boolean>;
  /** Our own confirmation and cancellation for bookings from booking sites. */
  channelConfirmation: boolean;
  senderDomain: string | null;
  senderLocal: string;
  senderVerified: boolean;
  replyTo: string | null;
  preArrivalDays: number;
  checkoutTime: string;
}

// a property added after the migration starts when it was created
export const ENSURE_MESSAGING = "insert into property_messaging (property_id, started_at) select id, created_at from properties where id = $1 on conflict do nothing";
/** The switch for channel bookings lives beside the type switches. */
const CHANNEL_SWITCH = "channel_confirmation";
/** How far back the scan looks: documents of a longer worker outage are still sent. */
const SCAN_DAYS = 7;
const MAX_ATTEMPTS = OUTBOX_MAX_ATTEMPTS;
const CODE_MASK = "••••••";
const withCode = (text: string, code: string | null) => (code ? text.split(CODE_MASK).join(code) : text);

export function enabledTypes(switched: Record<string, boolean>): Record<MessageType, boolean> {
  return Object.fromEntries(MESSAGE_TYPES.map((t) => [t, MESSAGE_TYPE_INFO[t].switchable ? (switched[t] ?? MESSAGE_TYPE_INFO[t].defaultOn) : true])) as Record<MessageType, boolean>;
}

export async function messagingSettings(pool: Pool, schema: string, propertyId: string): Promise<MessagingSettings> {
  return withTenant(pool, schema, async (tx) => {
    await tx.query(ENSURE_MESSAGING, [propertyId]);
    const { rows } = await tx.query(
      `select to_char(sending_from, 'HH24:MI') as sending_from, to_char(sending_to, 'HH24:MI') as sending_to, fallback_language, use_guest_language, switched,
              sender_domain, sender_local, sender_verified, reply_to, pre_arrival_days, to_char(checkout_time, 'HH24:MI') as checkout_time
       from property_messaging where property_id = $1`,
      [propertyId],
    );
    const r = rows[0];
    if (!r) throw new Error("No such property");
    return {
      propertyId,
      sendingFrom: r.sending_from,
      sendingTo: r.sending_to,
      fallbackLanguage: r.fallback_language,
      useGuestLanguage: r.use_guest_language,
      enabled: enabledTypes(r.switched),
      channelConfirmation: r.switched[CHANNEL_SWITCH] ?? true,
      senderDomain: r.sender_domain,
      senderLocal: r.sender_local,
      senderVerified: r.sender_verified,
      replyTo: r.reply_to,
      preArrivalDays: r.pre_arrival_days,
      checkoutTime: r.checkout_time,
    };
  });
}

export interface MessagingSettingsInput {
  sendingFrom: string;
  sendingTo: string;
  fallbackLanguage: MessageLanguage;
  useGuestLanguage: boolean;
  /** Switchable types only; others are ignored. */
  enabled: Partial<Record<MessageType, boolean>>;
  channelConfirmation: boolean;
  replyTo: string | null;
  preArrivalDays: number;
  checkoutTime: string;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function setMessagingSettings(pool: Pool, schema: string, propertyId: string, input: MessagingSettingsInput, userId: string): Promise<void> {
  if (!TIME.test(input.sendingFrom) || !TIME.test(input.sendingTo) || !TIME.test(input.checkoutTime)) throw new Error("Times are needed as HH:MM");
  if (input.sendingFrom >= input.sendingTo) throw new Error("Sending Hours must start before they end");
  if (!isMessageLanguage(input.fallbackLanguage)) throw new Error("Unknown language");
  if (!Number.isInteger(input.preArrivalDays) || input.preArrivalDays < 1 || input.preArrivalDays > 30) throw new Error("Pre-arrival days must be between 1 and 30");
  if (input.replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.replyTo)) throw new Error("Reply-to is not an email address");
  const switched = {
    ...Object.fromEntries(MESSAGE_TYPES.filter((t) => MESSAGE_TYPE_INFO[t].switchable && input.enabled[t] !== undefined).map((t) => [t, input.enabled[t]])),
    [CHANNEL_SWITCH]: input.channelConfirmation,
  };
  await withTenant(pool, schema, async (tx) => {
    await tx.query(ENSURE_MESSAGING, [propertyId]);
    await tx.query(
      `update property_messaging set sending_from = $2, sending_to = $3, fallback_language = $4, use_guest_language = $5, switched = $6, reply_to = $7, pre_arrival_days = $8,
              checkout_time = $9, updated_at = now(), updated_by = $10
       where property_id = $1`,
      [propertyId, input.sendingFrom, input.sendingTo, input.fallbackLanguage, input.useGuestLanguage, JSON.stringify(switched), input.replyTo || null, input.preArrivalDays, input.checkoutTime, userId],
    );
  });
}

/**
 * The hotel's own sending domain. Free mail and the platform's domain are
 * refused, and a domain belongs to one tenant (control.sender_domains):
 * nobody else can send as it. The provider checks the DNS records; until
 * they are verified mail goes from the platform domain with the hotel's name.
 */
export async function setSenderDomain(pool: Pool, schema: string, input: { tenantId: string; propertyId: string; domain: string | null; local: string; platformDomain: string }, userId: string): Promise<void> {
  const domain = input.domain?.trim().toLowerCase() || null;
  if (domain) {
    const problem = senderDomainProblem(domain);
    if (problem === "free_mail") throw new Error("A free-mail domain cannot be the sender; use the hotel's own domain");
    if (problem) throw new Error("Not a valid domain");
    const platform = input.platformDomain.toLowerCase();
    if (domain === platform || domain.endsWith(`.${platform}`) || platform.endsWith(`.${domain}`)) throw new Error("The platform's domain cannot be a hotel's sender");
  }
  if (!/^[a-z0-9._-]{1,40}$/.test(input.local)) throw new Error("The sender name before @ may use letters, digits, dot, dash and underscore");
  await withTenant(pool, schema, async (tx) => {
    await tx.query(ENSURE_MESSAGING, [input.propertyId]);
    await tx.query("delete from control.sender_domains where tenant_id = $1 and property_id = $2 and domain is distinct from $3", [input.tenantId, input.propertyId, domain]);
    if (domain) {
      const { rows } = await tx.query<{ tenant_id: string; property_id: string }>(
        `insert into control.sender_domains (domain, tenant_id, property_id) values ($1, $2, $3)
         on conflict (domain) do update set domain = excluded.domain returning tenant_id, property_id`,
        [domain, input.tenantId, input.propertyId],
      );
      if (rows[0]!.tenant_id !== input.tenantId) throw new Error("This domain is used by another account");
      if (rows[0]!.property_id !== input.propertyId) throw new Error("This domain is the sender of another property; one domain per property");
    }
    // a changed domain is verified again; the same one keeps its state
    await tx.query(
      `update property_messaging set sender_verified = sender_verified and sender_domain is not distinct from $2, sender_domain = $2, sender_local = $3, updated_at = now(), updated_by = $4
       where property_id = $1`,
      [input.propertyId, domain, input.local, userId],
    );
  });
}

/** Ask the provider whether the hotel's domain is verified, and keep the answer. */
export async function checkSenderDomain(pool: Pool, schema: string, propertyId: string, mail: MailProvider): Promise<DomainStatus | null> {
  const s = await messagingSettings(pool, schema, propertyId);
  if (!s.senderDomain) return null;
  const status = await mail.domainStatus(s.senderDomain);
  await withTenant(pool, schema, (tx) => tx.query("update property_messaging set sender_verified = $2 where property_id = $1 and sender_domain = $3", [propertyId, status.verified, s.senderDomain]));
  return status;
}

/** The text in use: the property's edit, else the shipped one. */
export async function messageText(pool: Pool, schema: string, propertyId: string, type: MessageType, language: MessageLanguage): Promise<MessageText & { edited: boolean }> {
  return withTenant(pool, schema, (tx) => textIn(tx, propertyId, type, language));
}

async function textIn(tx: PoolClient, propertyId: string, type: MessageType, language: MessageLanguage): Promise<MessageText & { edited: boolean }> {
  const { rows } = await tx.query<{ subject: string; blocks: string[] }>("select subject, blocks from message_templates where property_id = $1 and type = $2 and language = $3", [propertyId, type, language]);
  return rows[0] ? { subject: rows[0].subject, blocks: rows[0].blocks, edited: true } : { ...SHIPPED_TEXTS[type][language], edited: false };
}

export async function setMessageText(pool: Pool, schema: string, propertyId: string, type: MessageType, language: MessageLanguage, text: MessageText, userId: string): Promise<void> {
  if (!isMessageType(type) || !isMessageLanguage(language)) throw new Error("Unknown message type or language");
  const blocks = text.blocks.map((b) => b.trim()).filter(Boolean);
  if (!text.subject.trim() || !blocks.length) throw new Error("A message needs a subject and at least one block");
  if (text.subject.length > 200 || blocks.some((b) => b.length > 2000) || blocks.length > 12) throw new Error("The text is too long");
  const edited = { subject: text.subject, blocks };
  const unknown = unknownPlaceholders(edited);
  if (unknown.length) throw new Error(`Unknown placeholder: ${unknown.map((u) => `{${u}}`).join(", ")}`);
  // mandatory content stays
  const missing = missingPlaceholders(type, edited);
  if (missing.length) throw new Error(`This message must keep ${missing.map((u) => `{${u}}`).join(", ")}`);
  await withTenant(pool, schema, (tx) =>
    tx.query(
      `insert into message_templates (property_id, type, language, subject, blocks, updated_by) values ($1, $2, $3, $4, $5, $6)
       on conflict (property_id, type, language) do update set subject = excluded.subject, blocks = excluded.blocks, updated_at = now(), updated_by = excluded.updated_by`,
      [propertyId, type, language, text.subject.trim(), JSON.stringify(blocks), userId],
    ),
  );
}

export async function resetMessageText(pool: Pool, schema: string, propertyId: string, type: MessageType, language: MessageLanguage): Promise<void> {
  await withTenant(pool, schema, (tx) => tx.query("delete from message_templates where property_id = $1 and type = $2 and language = $3", [propertyId, type, language]));
}

interface PropertyLook {
  name: string;
  country: string;
  timeZone: string;
  currency: string;
  accent: string;
  footer: { name: string; address: string; vatId: string | null; register: string | null };
  hours: { from: string; to: string };
  checkoutTime: string;
}

async function propertyLook(tx: PoolClient, propertyId: string): Promise<PropertyLook> {
  await tx.query(ENSURE_MESSAGING, [propertyId]);
  const { rows } = await tx.query(
    `select p.name, p.country, p.time_zone, p.currency, le.name as le_name, le.address_line1, le.postal_code, le.city, le.vat_id,
            to_char(pm.sending_from, 'HH24:MI') as sending_from, to_char(pm.sending_to, 'HH24:MI') as sending_to, to_char(pm.checkout_time, 'HH24:MI') as checkout_time,
            (select t.accent from control.tenants t where t.schema_name = current_schema()) as accent
     from properties p join legal_entities le on le.id = p.legal_entity_id join property_messaging pm on pm.property_id = p.id where p.id = $1`,
    [propertyId],
  );
  const r = rows[0];
  if (!r) throw new Error("No such property");
  return {
    name: r.name,
    country: r.country,
    timeZone: r.time_zone,
    currency: r.currency,
    accent: isAccentId(r.accent ?? "") ? ACCENTS[r.accent as keyof typeof ACCENTS].light : ACCENTS.ocean.light,
    footer: { name: r.le_name, address: [r.address_line1, [r.postal_code, r.city].filter(Boolean).join(" ")].filter(Boolean).join(", "), vatId: r.vat_id || null, register: null },
    hours: { from: r.sending_from, to: r.sending_to },
    checkoutTime: r.checkout_time,
  };
}

function localNow(timeZone: string, at: Date): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** The moment a message of this timing may go, from a given instant, as SQL parameters (local date, time, zone). */
function sendMoment(look: PropertyLook, timing: (typeof MESSAGE_TYPE_INFO)[MessageType]["timing"], at: Date): [string, string, string] {
  const when = sendAfter(timing, localNow(look.timeZone, at), look.hours);
  return [when.date, when.time, look.timeZone];
}

const dateText = (d: string, language: MessageLanguage) => {
  const [y, m, day] = d.split("-");
  return language === "de" ? `${day}.${m}.${y}` : new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

interface Candidate {
  reservation_id: string;
  type: MessageType;
  trigger_key: string;
  invoice_id: string | null;
  document_number: string | null;
  amount: string | null;
}

/** What a message needs from the reservation: guest, address, dates, booking number, where it came from. */
interface ReservationFacts {
  property_id: string;
  confirmation_number: string;
  channel: boolean;
  /** For a channel booking: whether the channel's own setting wants our confirmation (null: not set, the property's switch decides). */
  channel_confirmation: boolean | null;
  arrival: string;
  departure: string;
  first_name: string;
  last_name: string;
  email: string | null;
  language: string | null;
  email_bounced: string | null;
  email_complained: string | null;
  portal_key: string;
  /** The Booker's own link to every room, when the guest is the Booker of a booking with more rooms. */
  booking_key: string | null;
}

async function factsOf(tx: PoolClient, reservationId: string): Promise<ReservationFacts | null> {
  const { rows } = await tx.query<ReservationFacts>(
    `select r.property_id, b.confirmation_number, b.source = 'channel' as channel,
            (select cs.send_confirmation from channel_settings cs where cs.property_id = r.property_id and cs.channel = b.channel_name) as channel_confirmation, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure,
            g.first_name, g.last_name, nullif(trim(g.email), '') as email, g.language, g.email_bounced, g.email_complained, r.portal_key,
            case when b.booker_guest_id = r.primary_guest_id and (select count(*) from reservations x where x.booking_id = b.id and x.status <> 'cancelled') > 1 then b.portal_key end as booking_key
     from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id where r.id = $1`,
    [reservationId],
  );
  return rows[0] ?? null;
}

/** Where the Guest Portal answers for this tenant (https://<slug>.<domain>); links in messages start with it. */
export interface PortalLinks {
  base: string;
}

/** Render and queue one message; nothing when it went already for this trigger. Returns its id, or null. */
export async function queueGuestMessageIn(
  tx: PoolClient,
  input: {
    reservationId: string;
    type: MessageType;
    triggerKey: string;
    invoiceId?: string | null;
    documentNumber?: string | null;
    amount?: number | null;
    /** Who sent it by hand; none for automatic messages. */
    userId?: string | null;
    now: Date;
    links: PortalLinks | null;
    /** Another recipient than the guest (the Booker invites a room's guest). */
    toEmail?: string;
    /** The one-time code (only in the mail; the stored copy is blanked once sent). */
    code?: string;
    /** A staff member's message in the Conversation (ticket 42). */
    message?: string;
    /** The Portal Link to put in, when not the stay's own (the Booker's booking link). */
    linkKey?: string;
  },
): Promise<string | null> {
  const f = await factsOf(tx, input.reservationId);
  if (!f) throw new Error("No such reservation");
  const look = await propertyLook(tx, f.property_id);
  const { rows: setting } = await tx.query<{ fallback_language: MessageLanguage; use_guest_language: boolean; switched: Record<string, boolean>; desk_opens: string; emergency_phone: string | null }>(
    "select fallback_language, use_guest_language, switched, to_char(desk_opens, 'HH24:MI') as desk_opens, emergency_phone from property_messaging where property_id = $1",
    [f.property_id],
  );
  const s = setting[0]!;
  const language = messageLanguage(f.language, s.use_guest_language, s.fallback_language);
  const values: Partial<Record<Placeholder, string>> = {
    guest_name: [f.first_name, f.last_name].filter(Boolean).join(" "),
    hotel_name: look.name,
    confirmation: f.confirmation_number,
    arrival: dateText(f.arrival, language),
    departure: dateText(f.departure, language),
    amount: input.amount == null ? "" : formatCurrency(input.amount, look.currency, language, look.country),
    document_number: input.documentNumber ?? "",
    portal_link: input.links ? `${input.links.base}/g/${input.linkKey ?? (input.toEmail ? f.portal_key : (f.booking_key ?? f.portal_key))}` : "",
    // wired with Conversations (ticket 43)
    reply_address: "",
    checkout_time: look.checkoutTime,
    // the stored copy shows dots; the code goes in when the mail is sent
    code: input.code ? CODE_MASK : "",
    message: input.message ?? "",
    desk_opens: s.desk_opens,
    emergency_phone: s.emergency_phone ?? "",
  };
  const text = await textIn(tx, f.property_id, input.type, language);
  // without an emergency number the sentence that gives it is left out
  if (!values.emergency_phone) text.blocks = text.blocks.filter((b) => !b.includes("{emergency_phone}"));
  const rendered = renderMessage(text, values, { hotelName: look.name, accent: look.accent }, look.footer);
  const info = MESSAGE_TYPE_INFO[input.type];
  // a message with a Portal Link waits until there is an address of the portal to put in it
  if (info.needsPortal && !input.links) return null;
  const email = (input.toEmail ?? f.email)?.toLowerCase() ?? null;
  // kept, not sent: no address, an address that bounced, a complaint (non-essential only), our confirmation switched off for booking sites
  // the channel's own setting (ticket 38) before the property's switch for all booking sites
  const channelOff = f.channel && !(f.channel_confirmation ?? s.switched[CHANNEL_SWITCH] ?? true) && (input.type === "confirmation" || input.type === "cancellation");
  const reason = channelOff ? "channel" : !email ? "no_email" : email === f.email_bounced ? "bounced" : email === f.email_complained && !info.essential ? "complained" : null;
  const { rows } = await tx.query<{ id: string }>(
    `insert into guest_messages (property_id, reservation_id, type, trigger_key, language, to_email, subject, html, body_text, invoice_id, status, reason, send_after, created_by, secret_code)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, greatest(($13::date + $14::time) at time zone $15, $16::timestamptz), $17, $18)
     on conflict (reservation_id, type, trigger_key) do nothing returning id`,
    [f.property_id, input.reservationId, input.type, input.triggerKey, language, email, rendered.subject, rendered.html, rendered.text, input.invoiceId ?? null, reason ? "suppressed" : "queued", reason, ...sendMoment(look, info.timing, input.now), input.now, input.userId ?? null, reason ? null : (input.code ?? null)],
  );
  return rows[0]?.id ?? null;
}

/**
 * Derive the automatic messages from what happened since messaging started
 * at each property (events of the last week; a longer outage is not caught
 * up). Each type goes once per reservation and trigger; a switched-off type,
 * or one whose Portal Link does not exist yet, is not queued.
 */
export async function scanGuestMessages(pool: Pool, schema: string, now = new Date(), links: PortalLinks | null = null): Promise<number> {
  return withTenant(pool, schema, async (tx) => {
    await tx.query("insert into property_messaging (property_id, started_at) select id, created_at from properties on conflict do nothing");
    const { rows: settings } = await tx.query<{ property_id: string; switched: Record<string, boolean> }>("select property_id, switched from property_messaging");
    const enabled = new Map(settings.map((s) => [s.property_id, enabledTypes(s.switched)]));
    const { rows } = await tx.query<Candidate & { property_id: string }>(
      `with pm as (
         select pm.property_id, pm.started_at, greatest(pm.started_at, $1::timestamptz - make_interval(days => $2)) as since, pm.pre_arrival_days, (($1::timestamptz) at time zone p.time_zone)::date as today
         from property_messaging pm join properties p on p.id = pm.property_id
       ), c as (
         select r.id as reservation_id, r.property_id, 'confirmation' as type, '' as trigger_key, null::uuid as invoice_id, null as document_number, null::numeric as amount
           from reservations r join pm on pm.property_id = r.property_id where r.created_at >= pm.since and r.status <> 'cancelled'
         union all
         select rc.reservation_id, r.property_id, 'confirmation', rc.id::text, null, null, null
           from reservation_changes rc join reservations r on r.id = rc.reservation_id join pm on pm.property_id = r.property_id
           where rc.action = 'edit' and rc.at >= pm.since and r.status = 'confirmed'
         union all
         select rc.reservation_id, r.property_id, 'cancellation', '', null, null, null
           from reservation_changes rc join reservations r on r.id = rc.reservation_id join pm on pm.property_id = r.property_id where rc.action = 'cancel' and rc.at >= pm.since
         union all
         select rc.reservation_id, r.property_id, 'fee_notice', '', null, null, r.cancellation_fee
           from reservation_changes rc join reservations r on r.id = rc.reservation_id join pm on pm.property_id = r.property_id where rc.action = 'fee_confirmed' and rc.at >= pm.since and r.cancellation_fee > 0
         union all
         select i.reservation_id, i.property_id, case i.kind when 'deposit' then 'deposit_invoice' else 'final_invoice' end, i.id::text, i.id, i.number, i.gross
           from invoices i join pm on pm.property_id = i.property_id where i.kind in ('deposit', 'final') and i.issued_at >= pm.since
         union all
         select pa.reservation_id, pa.property_id, 'payment_receipt', pa.id::text, null, null, pa.amount
           from payments pa join pm on pm.property_id = pa.property_id
           where pa.amount > 0 and pa.status = 'succeeded' and pa.tender not in ('on_account', 'ota_virtual_card', 'ota_collect') and pa.posted_at >= pm.since
             -- a deposit invoice is the receipt of its payment
             and not exists (select 1 from invoices i where i.payment_id = pa.id)
         union all
         select pa.reservation_id, pa.property_id, 'refund_notice', pa.id::text, null, null, -pa.amount
           from payments pa join pm on pm.property_id = pa.property_id where pa.refund_of is not null and pa.status = 'succeeded' and pa.posted_at >= pm.since
         union all
         select r.id, r.property_id, 'pre_arrival', '', null, null, null
           from reservations r join pm on pm.property_id = r.property_id
           where r.status = 'confirmed' and r.created_at >= pm.started_at and r.arrival > pm.today and r.arrival - pm.pre_arrival_days <= pm.today
         union all
         select r.id, r.property_id, 'welcome', '', null, null, null
           from reservations r join pm on pm.property_id = r.property_id where r.checked_in_at >= pm.since and r.status = 'checked_in'
         union all
         select r.id, r.property_id, 'departure_eve', '', null, null, null
           from reservations r join pm on pm.property_id = r.property_id where r.status = 'checked_in' and r.departure = pm.today + 1 and r.created_at >= pm.started_at
         union all
         select r.id, r.property_id, 'thanks', '', null, null, null
           from reservations r join pm on pm.property_id = r.property_id where r.checked_out_at >= pm.since and r.status = 'checked_out'
       )
       select c.* from c
       where not exists (select 1 from guest_messages gm where gm.reservation_id = c.reservation_id and gm.type = c.type and gm.trigger_key = c.trigger_key)
       order by c.reservation_id`,
      [now, SCAN_DAYS],
    );
    let n = 0;
    for (const c of rows) {
      if (!enabled.get(c.property_id)?.[c.type] || !messageSendable(c.type)) continue;
      // a non-repeatable type goes once per reservation, whatever triggered it
      const key = MESSAGE_TYPE_INFO[c.type].repeatable ? c.trigger_key : "";
      const id = await queueGuestMessageIn(tx, { reservationId: c.reservation_id, type: c.type, triggerKey: key, invoiceId: c.invoice_id, documentNumber: c.document_number, amount: c.amount === null ? null : Number(c.amount), userId: null, now, links });
      if (id) n++;
    }
    return n;
  });
}

/** Staff send a message by hand (a card or balance request, the confirmation again): it goes at once, a new one each time. */
export async function sendGuestMessage(pool: Pool, schema: string, input: { reservationId: string; type: ManualMessageType; amount?: number | null; links: PortalLinks | null }, userId: string, now = new Date()): Promise<string> {
  if (!messageSendable(input.type)) throw new Error("This message needs the Portal Link of the Guest Portal, which is not available yet");
  return withTenant(pool, schema, async (tx) => {
    const id = await queueGuestMessageIn(tx, { reservationId: input.reservationId, type: input.type, triggerKey: `manual:${now.toISOString()}`, invoiceId: null, documentNumber: null, amount: input.amount ?? null, userId, now, links: input.links });
    if (!id) throw new Error("This message was just sent");
    return id;
  });
}

export type MessageStatus = "queued" | "sending" | "sent" | "delivered" | "failed" | "suppressed";

export interface GuestMessageRow {
  id: string;
  type: MessageType;
  language: MessageLanguage;
  toEmail: string | null;
  subject: string;
  status: MessageStatus;
  reason: string | null;
  sendAfter: Date;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  manual: boolean;
}

/** A reservation's messages with their delivery state, newest first. */
export async function reservationMessages(pool: Pool, schema: string, reservationId: string): Promise<GuestMessageRow[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(
      `select id, type, language, to_email, subject, status, reason, send_after, created_at, sent_at, delivered_at, failed_at, created_by is not null as manual
       from guest_messages where reservation_id = $1 order by created_at desc`,
      [reservationId],
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      language: r.language,
      toEmail: r.to_email,
      subject: r.subject,
      status: r.status,
      reason: r.reason,
      sendAfter: r.send_after,
      createdAt: r.created_at,
      sentAt: r.sent_at,
      deliveredAt: r.delivered_at,
      failedAt: r.failed_at,
      manual: r.manual,
    }));
  });
}

/**
 * Send what is due: guest messages, then staff mail and SMS. Each row is
 * claimed ("sending") in a short transaction and sent outside it, so only one
 * run sends it. A temporary failure goes back to the queue with a growing
 * pause, still inside Sending Hours for service messages; a refusal fails it.
 * A row whose run died stays "sending" and fails after an hour: no double mail.
 */
export async function dispatchMessages(pool: Pool, schema: string, tenantId: string, providers: { mail: MailProvider; sms: SmsProvider }, options: SenderOptions, now = new Date()): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const due = await withTenant(pool, schema, async (tx) => {
    await tx.query("update guest_messages set status = 'failed', failed_at = $1, reason = 'unknown: sending interrupted', secret_code = null where status = 'sending' and claimed_at < $1::timestamptz - interval '1 hour'", [now]);
    // a code nobody could send in its ten minutes is of no use: not kept
    await tx.query("update guest_messages set secret_code = null where secret_code is not null and created_at < $1::timestamptz - interval '15 minutes'", [now]);
    // the address may have bounced since it was queued
    await tx.query(
      `update guest_messages gm set status = 'suppressed', reason = case when lower(g.email_bounced) = gm.to_email then 'bounced' else 'complained' end
       from reservations r, guests g
       where gm.status = 'queued' and gm.send_after <= $1 and r.id = gm.reservation_id and g.id = r.primary_guest_id
         and (lower(g.email_bounced) = gm.to_email or (lower(g.email_complained) = gm.to_email and gm.type = any($2)))`,
      [now, MESSAGE_TYPES.filter((t) => !MESSAGE_TYPE_INFO[t].essential)],
    );
    const { rows } = await tx.query(
      `update guest_messages gm set status = 'sending', attempts = attempts + 1, claimed_at = $1
       from (select id from guest_messages where status = 'queued' and send_after <= $1 order by send_after limit 50 for update skip locked) d
       where gm.id = d.id
       returning gm.id, gm.property_id, gm.type, gm.to_email, gm.subject, gm.html, gm.body_text, gm.invoice_id, gm.attempts, gm.secret_code`,
      [now],
    );
    return rows as { id: string; property_id: string; type: MessageType; to_email: string; subject: string; html: string; body_text: string; invoice_id: string | null; attempts: number; secret_code: string | null }[];
  });
  for (const m of due) {
    const { sender, document } = await withTenant(pool, schema, async (tx) => ({
      sender: await senderFor(tx, m.property_id, options),
      document: m.invoice_id ? (await tx.query<{ pdf: Buffer | null; number: string }>("select pdf, number from invoices where id = $1", [m.invoice_id])).rows[0] : undefined,
    }));
    let providerId: string;
    try {
      providerId = (
        await providers.mail.send({
          from: sender.from,
          fromName: sender.fromName,
          ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
          ...(sender.sendingDomain ? { sendingDomain: sender.sendingDomain } : {}),
          to: m.to_email,
          subject: withCode(m.subject, m.secret_code),
          html: withCode(m.html, m.secret_code),
          text: withCode(m.body_text, m.secret_code),
          attachments: document?.pdf ? [{ name: `${document.number}.pdf`, type: "application/pdf", bytes: new Uint8Array(document.pdf) }] : [],
          tags: { tenantId, messageId: m.id },
        })
      ).providerId;
    } catch (err) {
      const retry = err instanceof DeliveryError ? err.retry : true;
      const reason = err instanceof Error ? err.message.slice(0, 500) : String(err);
      await withTenant(pool, schema, async (tx) => {
        if (!retry || m.attempts >= MAX_ATTEMPTS) return tx.query("update guest_messages set status = 'failed', failed_at = now(), reason = $2, secret_code = null where id = $1", [m.id, reason]);
        const look = await propertyLook(tx, m.property_id);
        const later = new Date(now.getTime() + 5 * 60_000 * 2 ** (m.attempts - 1));
        return tx.query("update guest_messages set status = 'queued', claimed_at = null, reason = $2, send_after = ($3::date + $4::time) at time zone $5 where id = $1", [m.id, reason, ...sendMoment(look, MESSAGE_TYPE_INFO[m.type].timing, later)]);
      });
      failed++;
      continue;
    }
    // sent: a failure to record it leaves the row "sending", never sent twice; an early "delivered" event stays
    await withTenant(pool, schema, (tx) =>
      tx.query("update guest_messages set status = case when status = 'delivered' then status else 'sent' end, sent_at = now(), provider_id = $2, reason = null where id = $1", [m.id, providerId]),
    );
    // a one-time code is not kept once it went out
    if (m.secret_code) await withTenant(pool, schema, (tx) => tx.query("update guest_messages set secret_code = null where id = $1", [m.id]));
    sent++;
  }
  const r2 = await dispatchOutboxes(pool, schema, tenantId, providers, options);
  return { sent: sent + r2.sent, failed: failed + r2.failed };
}

export interface BouncedMessage {
  reservationId: string;
  propertyId: string;
  confirmationNumber: string;
  type: MessageType;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A delivery event from the provider, once per event id: delivered, failed
 * (a hard bounce marks the guest's address; for a critical message the desk
 * is to be notified, returned here), or a spam complaint (no more
 * non-essential mail to that address).
 */
export async function recordMailEvent(pool: Pool, schema: string, event: MailEvent): Promise<BouncedMessage | null> {
  // staff mail, or an id that is none of ours
  if (!event.messageId || !UUID.test(event.messageId)) return null;
  return withTenant(pool, schema, async (tx) => {
    const { rows: m } = await tx.query<{ id: string; reservation_id: string; property_id: string; type: MessageType; to_email: string }>(
      "select id, reservation_id, property_id, type, to_email from guest_messages where id = $1 for update",
      [event.messageId],
    );
    const msg = m[0];
    if (!msg) return null;
    const fresh = await tx.query("insert into message_events (id, message_id, kind, detail) values ($1, $2, $3, $4) on conflict do nothing", [
      event.id,
      msg.id,
      event.type === "failed" ? `failed_${event.severity ?? "temporary"}` : event.type,
      event.detail.slice(0, 500),
    ]);
    if (!fresh.rowCount) return null;
    const guest = "(select primary_guest_id from reservations where id = $1)";
    if (event.type === "delivered") {
      await tx.query("update guest_messages set status = 'delivered', delivered_at = now() where id = $1 and status in ('sending', 'sent')", [msg.id]);
      return null;
    }
    if (event.type === "complained") {
      await tx.query(`update guests set email_complained = $2 where id = ${guest} and lower(email) = $2`, [msg.reservation_id, msg.to_email]);
      return null;
    }
    if (event.severity !== "permanent") return null;
    await tx.query("update guest_messages set status = 'failed', failed_at = now(), reason = $2 where id = $1", [msg.id, event.detail.slice(0, 500) || "hard bounce"]);
    await tx.query(`update guests set email_bounced = $2 where id = ${guest} and lower(email) = $2`, [msg.reservation_id, msg.to_email]);
    if (!MESSAGE_TYPE_INFO[msg.type].critical) return null;
    const { rows } = await tx.query<{ confirmation_number: string }>("select b.confirmation_number from reservations r join bookings b on b.id = r.booking_id where r.id = $1", [msg.reservation_id]);
    return { reservationId: msg.reservation_id, propertyId: msg.property_id, confirmationNumber: rows[0]?.confirmation_number ?? "", type: msg.type };
  });
}

/** The text in use rendered with sample values, as the guest would see it. */
export async function previewMessage(pool: Pool, schema: string, propertyId: string, type: MessageType, language: MessageLanguage): Promise<{ subject: string; html: string; text: string }> {
  return withTenant(pool, schema, async (tx) => {
    const look = await propertyLook(tx, propertyId);
    const values: Partial<Record<Placeholder, string>> = {
      guest_name: "Aiko Tanaka",
      hotel_name: look.name,
      confirmation: "100123",
      arrival: dateText("2026-11-12", language),
      departure: dateText("2026-11-14", language),
      amount: formatCurrency(240, look.currency, language, look.country),
      document_number: "RE-2026-00042",
      portal_link: "https://portal.example/…",
      reply_address: "reply@example",
      checkout_time: look.checkoutTime,
      code: "482913",
    };
    return renderMessage(await textIn(tx, propertyId, type, language), values, { hotelName: look.name, accent: look.accent }, look.footer);
  });
}

/** A test send: the text as the guest would get it, from the hotel's sender, with sample values, to the user's own address. */
export async function sendTestMessage(pool: Pool, schema: string, input: { tenantId: string; propertyId: string; type: MessageType; language: MessageLanguage; userId: string }): Promise<void> {
  const m = await previewMessage(pool, schema, input.propertyId, input.type, input.language);
  await queueMail(pool, schema, { tenantId: input.tenantId, toUserId: input.userId, subject: `[Test] ${m.subject}`, body: m.text, html: m.html, propertyId: input.propertyId });
}
