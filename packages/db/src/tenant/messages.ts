import type { Pool, PoolClient } from "pg";
import {
  ACCENTS,
  MESSAGE_LANGUAGES,
  MESSAGE_TYPE_INFO,
  MESSAGE_TYPES,
  SHIPPED_TEXTS,
  formatCurrency,
  isAccentId,
  messageLanguage,
  renderMessage,
  sendAfter,
  senderDomainProblem,
  unknownPlaceholders,
  type MessageLanguage,
  type MessageText,
  type MessageType,
  type Placeholder,
} from "@hoteloftware/domain";
import { DeliveryError, type DomainStatus, type MailEvent, type MailProvider, type SmsProvider } from "@hoteloftware/messaging";
import { queueMail } from "./mail-outbox";
import { withTenant } from "./with-tenant";

/**
 * Automatic guest messages (ticket 39): settings and edited texts per
 * property, the scan that derives messages from what happened (bookings,
 * changes, invoices, payments, stays), their dispatch through the mail
 * provider with delivery state, and the staff mail and SMS outboxes.
 */

export interface MessagingSettings {
  propertyId: string;
  sendingFrom: string;
  sendingTo: string;
  fallbackLanguage: MessageLanguage;
  useGuestLanguage: boolean;
  /** Every type: on or off (fixed types are always on). */
  enabled: Record<MessageType, boolean>;
  senderDomain: string | null;
  senderLocal: string;
  senderVerified: boolean;
  replyTo: string | null;
  preArrivalDays: number;
}

// a property added after the migration starts when it was created
const ENSURE = "insert into property_messaging (property_id, started_at) select id, created_at from properties where id = $1 on conflict do nothing";

function enabledTypes(switched: Record<string, boolean>): Record<MessageType, boolean> {
  return Object.fromEntries(MESSAGE_TYPES.map((t) => [t, MESSAGE_TYPE_INFO[t].switchable ? (switched[t] ?? MESSAGE_TYPE_INFO[t].defaultOn) : true])) as Record<MessageType, boolean>;
}

export async function messagingSettings(pool: Pool, schema: string, propertyId: string): Promise<MessagingSettings> {
  return withTenant(pool, schema, async (tx) => {
    await tx.query(ENSURE, [propertyId]);
    const { rows } = await tx.query(
      `select to_char(sending_from, 'HH24:MI') as sending_from, to_char(sending_to, 'HH24:MI') as sending_to, fallback_language, use_guest_language, switched,
              sender_domain, sender_local, sender_verified, reply_to, pre_arrival_days
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
      senderDomain: r.sender_domain,
      senderLocal: r.sender_local,
      senderVerified: r.sender_verified,
      replyTo: r.reply_to,
      preArrivalDays: r.pre_arrival_days,
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
  replyTo: string | null;
  preArrivalDays: number;
}

export async function setMessagingSettings(pool: Pool, schema: string, propertyId: string, input: MessagingSettingsInput, userId: string): Promise<void> {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.sendingFrom) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.sendingTo)) throw new Error("Sending Hours need times as HH:MM");
  if (input.sendingFrom >= input.sendingTo) throw new Error("Sending Hours must start before they end");
  if (!(MESSAGE_LANGUAGES as readonly string[]).includes(input.fallbackLanguage)) throw new Error("Unknown language");
  if (!Number.isInteger(input.preArrivalDays) || input.preArrivalDays < 1 || input.preArrivalDays > 30) throw new Error("Pre-arrival days must be between 1 and 30");
  if (input.replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.replyTo)) throw new Error("Reply-to is not an email address");
  const switched = Object.fromEntries(MESSAGE_TYPES.filter((t) => MESSAGE_TYPE_INFO[t].switchable && input.enabled[t] !== undefined).map((t) => [t, input.enabled[t]]));
  await withTenant(pool, schema, async (tx) => {
    await tx.query(ENSURE, [propertyId]);
    await tx.query(
      `update property_messaging set sending_from = $2, sending_to = $3, fallback_language = $4, use_guest_language = $5, switched = $6, reply_to = $7, pre_arrival_days = $8,
              updated_at = now(), updated_by = $9
       where property_id = $1`,
      [propertyId, input.sendingFrom, input.sendingTo, input.fallbackLanguage, input.useGuestLanguage, JSON.stringify(switched), input.replyTo || null, input.preArrivalDays, userId],
    );
  });
}

/**
 * The hotel's own sending domain: free mail is refused; the provider checks
 * the DNS records, and until they are verified mail goes from the platform
 * domain with the hotel's name.
 */
export async function setSenderDomain(pool: Pool, schema: string, propertyId: string, input: { domain: string | null; local: string }, userId: string): Promise<void> {
  const domain = input.domain?.trim().toLowerCase() || null;
  if (domain) {
    const problem = senderDomainProblem(domain);
    if (problem === "free_mail") throw new Error("A free-mail domain cannot be the sender; use the hotel's own domain");
    if (problem) throw new Error("Not a valid domain");
  }
  if (!/^[a-z0-9._-]{1,40}$/.test(input.local)) throw new Error("The sender name before @ may use letters, digits, dot, dash and underscore");
  await withTenant(pool, schema, async (tx) => {
    await tx.query(ENSURE, [propertyId]);
    // a changed domain is verified again; the same one keeps its state
    await tx.query(
      `update property_messaging set sender_verified = sender_verified and sender_domain is not distinct from $2, sender_domain = $2, sender_local = $3, updated_at = now(), updated_by = $4
       where property_id = $1`,
      [propertyId, domain, input.local, userId],
    );
  });
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
  if (!(MESSAGE_TYPES as readonly string[]).includes(type) || !(MESSAGE_LANGUAGES as readonly string[]).includes(language)) throw new Error("Unknown message type or language");
  const blocks = text.blocks.map((b) => b.trim()).filter(Boolean);
  if (!text.subject.trim() || !blocks.length) throw new Error("A message needs a subject and at least one block");
  if (text.subject.length > 200 || blocks.some((b) => b.length > 2000) || blocks.length > 12) throw new Error("The text is too long");
  const unknown = unknownPlaceholders({ subject: text.subject, blocks });
  if (unknown.length) throw new Error(`Unknown placeholder: ${unknown.map((u) => `{${u}}`).join(", ")}`);
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
}

async function propertyLook(tx: PoolClient, propertyId: string): Promise<PropertyLook> {
  const { rows } = await tx.query(
    `select p.name, p.country, p.time_zone, p.currency, le.name as le_name, le.address_line1, le.postal_code, le.city, le.vat_id,
            (select t.accent from control.tenants t where t.schema_name = current_schema()) as accent
     from properties p join legal_entities le on le.id = p.legal_entity_id where p.id = $1`,
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

/** What a message needs from the reservation: guest, address, dates, booking number. */
interface ReservationFacts {
  property_id: string;
  confirmation_number: string;
  arrival: string;
  departure: string;
  first_name: string;
  last_name: string;
  email: string | null;
  language: string | null;
  email_bounced: string | null;
  email_complained: string | null;
}

async function factsOf(tx: PoolClient, reservationId: string): Promise<ReservationFacts | null> {
  const { rows } = await tx.query<ReservationFacts>(
    `select r.property_id, b.confirmation_number, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure,
            g.first_name, g.last_name, nullif(trim(g.email), '') as email, g.language, g.email_bounced, g.email_complained
     from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id where r.id = $1`,
    [reservationId],
  );
  return rows[0] ?? null;
}

/** Render and queue one message; nothing when it went already for this trigger. Returns its id, or null. */
async function queueIn(
  tx: PoolClient,
  input: { reservationId: string; type: MessageType; triggerKey: string; invoiceId: string | null; documentNumber: string | null; amount: number | null; userId: string | null; now: Date },
): Promise<string | null> {
  const f = await factsOf(tx, input.reservationId);
  if (!f) throw new Error("No such reservation");
  const { rows: setting } = await tx.query<{ fallback_language: MessageLanguage; use_guest_language: boolean; sending_from: string; sending_to: string }>(
    "select fallback_language, use_guest_language, to_char(sending_from, 'HH24:MI') as sending_from, to_char(sending_to, 'HH24:MI') as sending_to from property_messaging where property_id = $1",
    [f.property_id],
  );
  const s = setting[0]!;
  const look = await propertyLook(tx, f.property_id);
  const language = messageLanguage(f.language, s.use_guest_language, s.fallback_language);
  const values: Partial<Record<Placeholder, string>> = {
    guest_name: [f.first_name, f.last_name].filter(Boolean).join(" "),
    hotel_name: look.name,
    confirmation: f.confirmation_number,
    arrival: dateText(f.arrival, language),
    departure: dateText(f.departure, language),
    amount: input.amount === null ? "" : formatCurrency(input.amount, look.currency, language, look.country),
    document_number: input.documentNumber ?? "",
    // wired with the Guest Portal (ticket 40) and Conversations (ticket 43)
    portal_link: "",
    reply_address: "",
    checkout_time: "11:00",
  };
  const rendered = renderMessage(await textIn(tx, f.property_id, input.type, language), values, { hotelName: look.name, accent: look.accent }, look.footer);
  const info = MESSAGE_TYPE_INFO[input.type];
  const when = sendAfter(info.timing, localNow(look.timeZone, input.now), { from: s.sending_from, to: s.sending_to });
  const email = f.email?.toLowerCase() ?? null;
  // no address, an address that bounced, or a complaint (non-essential only): kept, not sent
  const reason = !email ? "no_email" : email === f.email_bounced ? "bounced" : email === f.email_complained && !info.essential ? "complained" : null;
  const { rows } = await tx.query<{ id: string }>(
    `insert into guest_messages (property_id, reservation_id, type, trigger_key, language, to_email, subject, html, body_text, invoice_id, status, reason, send_after, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, greatest(($13::date + $14::time) at time zone $15, $16::timestamptz), $17)
     on conflict (reservation_id, type, trigger_key) do nothing returning id`,
    [
      f.property_id,
      input.reservationId,
      input.type,
      input.triggerKey,
      language,
      email,
      rendered.subject,
      rendered.html,
      rendered.text,
      input.invoiceId,
      reason ? "suppressed" : "queued",
      reason,
      when.date,
      when.time,
      look.timeZone,
      input.now,
      input.userId,
    ],
  );
  return rows[0]?.id ?? null;
}

/**
 * Derive the automatic messages from what happened since messaging started
 * at each property (events of the last two days; later ones are not caught
 * up). Each type goes once per reservation and trigger; a switched-off type
 * is not queued.
 */
export async function scanGuestMessages(pool: Pool, schema: string, now = new Date()): Promise<number> {
  return withTenant(pool, schema, async (tx) => {
    await tx.query("insert into property_messaging (property_id, started_at) select id, created_at from properties on conflict do nothing");
    const { rows: settings } = await tx.query<{ property_id: string; switched: Record<string, boolean> }>("select property_id, switched from property_messaging");
    const enabled = new Map(settings.map((s) => [s.property_id, enabledTypes(s.switched)]));
    const { rows } = await tx.query<Candidate & { property_id: string }>(
      `with pm as (
         select pm.property_id, pm.started_at, greatest(pm.started_at, $1::timestamptz - interval '2 days') as since, pm.pre_arrival_days, (($1::timestamptz) at time zone p.time_zone)::date as today
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
           where r.status = 'confirmed' and r.created_at >= pm.started_at
             and r.arrival > pm.today and r.arrival - pm.pre_arrival_days <= pm.today
         union all
         select r.id, r.property_id, 'welcome', '', null, null, null
           from reservations r join pm on pm.property_id = r.property_id where r.checked_in_at >= pm.since and r.status = 'checked_in'
         union all
         select r.id, r.property_id, 'departure_eve', '', null, null, null
           from reservations r join pm on pm.property_id = r.property_id
           where r.status = 'checked_in' and r.departure = pm.today + 1 and r.created_at >= pm.started_at
         union all
         select r.id, r.property_id, 'thanks', '', null, null, null
           from reservations r join pm on pm.property_id = r.property_id where r.checked_out_at >= pm.since and r.status = 'checked_out'
       )
       select c.* from c
       where not exists (select 1 from guest_messages gm where gm.reservation_id = c.reservation_id and gm.type = c.type and gm.trigger_key = c.trigger_key)
       order by c.reservation_id`,
      [now],
    );
    let n = 0;
    for (const c of rows) {
      if (!enabled.get(c.property_id)?.[c.type]) continue;
      // a non-repeatable type goes once per reservation, whatever triggered it
      const key = MESSAGE_TYPE_INFO[c.type].repeatable ? c.trigger_key : "";
      const id = await queueIn(tx, { reservationId: c.reservation_id, type: c.type, triggerKey: key, invoiceId: c.invoice_id, documentNumber: c.document_number, amount: c.amount === null ? null : Number(c.amount), userId: null, now });
      if (id) n++;
    }
    return n;
  });
}

/** Staff send a message by hand (a card or balance request, a confirmation again): it goes at once, a new one each time. */
export async function sendGuestMessage(pool: Pool, schema: string, input: { reservationId: string; type: "card_request" | "balance_request" | "confirmation"; amount?: number | null }, userId: string, now = new Date()): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [input.reservationId]);
    if (!rows[0]) throw new Error("No such reservation");
    await tx.query(ENSURE, [rows[0].property_id]);
    const id = await queueIn(tx, { reservationId: input.reservationId, type: input.type, triggerKey: `manual:${now.toISOString()}`, invoiceId: null, documentNumber: null, amount: input.amount ?? null, userId, now });
    if (!id) throw new Error("This message was just sent");
    return id;
  });
}

export interface GuestMessageRow {
  id: string;
  type: MessageType;
  language: MessageLanguage;
  toEmail: string | null;
  subject: string;
  status: "queued" | "sending" | "sent" | "delivered" | "failed" | "suppressed";
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

export interface SenderOptions {
  /** The platform's sending domain, used until a hotel's own domain is verified. */
  platformDomain: string;
}

const MAX_ATTEMPTS = 5;

/**
 * Send what is due: guest messages, staff mail, SMS. Each row is claimed
 * ("sending") in a short transaction and sent outside it; a temporary failure
 * goes back to the queue with a growing pause, a refusal fails it. A row left
 * "sending" by a crash is not sent again (no double mail): it fails after an hour.
 */
export async function dispatchMessages(
  pool: Pool,
  schema: string,
  tenantId: string,
  providers: { mail: MailProvider; sms: SmsProvider },
  options: SenderOptions,
  now = new Date(),
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const due = await withTenant(pool, schema, async (tx) => {
    await tx.query("update guest_messages set status = 'failed', failed_at = $1, reason = 'unknown: sending interrupted' where status = 'sending' and sent_at is null and send_after < $1::timestamptz - interval '1 hour'", [now]);
    // the address may have bounced since it was queued
    await tx.query(
      `update guest_messages gm set status = 'suppressed', reason = case when lower(g.email_bounced) = gm.to_email then 'bounced' else 'complained' end
       from reservations r, guests g
       where gm.status = 'queued' and gm.send_after <= $1 and r.id = gm.reservation_id and g.id = r.primary_guest_id
         and (lower(g.email_bounced) = gm.to_email or (lower(g.email_complained) = gm.to_email and gm.type = any($2)))`,
      [now, MESSAGE_TYPES.filter((t) => !MESSAGE_TYPE_INFO[t].essential)],
    );
    const { rows } = await tx.query(
      `update guest_messages gm set status = 'sending', attempts = attempts + 1
       from (select id from guest_messages where status = 'queued' and send_after <= $1 order by send_after limit 50 for update skip locked) d
       where gm.id = d.id
       returning gm.id, gm.property_id, gm.to_email, gm.subject, gm.html, gm.body_text, gm.invoice_id, gm.attempts`,
      [now],
    );
    return rows as { id: string; property_id: string; to_email: string; subject: string; html: string; body_text: string; invoice_id: string | null; attempts: number }[];
  });
  for (const m of due) {
    const sender = await withTenant(pool, schema, async (tx) => {
      const { rows } = await tx.query(
        `select p.name, pm.sender_domain, pm.sender_local, pm.sender_verified, coalesce(pm.reply_to, nullif(le.invoice_email, '')) as reply_to,
                i.pdf, i.number
         from properties p join legal_entities le on le.id = p.legal_entity_id join property_messaging pm on pm.property_id = p.id
         left join invoices i on i.id = $2
         where p.id = $1`,
        [m.property_id, m.invoice_id],
      );
      return rows[0];
    });
    try {
      const { providerId } = await providers.mail.send({
        from: sender.sender_verified && sender.sender_domain ? `${sender.sender_local}@${sender.sender_domain}` : `no-reply@${options.platformDomain}`,
        fromName: sender.name,
        replyTo: sender.reply_to ?? undefined,
        to: m.to_email,
        subject: m.subject,
        html: m.html,
        text: m.body_text,
        attachments: sender.pdf ? [{ name: `${sender.number}.pdf`, type: "application/pdf", bytes: new Uint8Array(sender.pdf) }] : [],
        tags: { tenantId, messageId: m.id },
      });
      await withTenant(pool, schema, (tx) => tx.query("update guest_messages set status = 'sent', sent_at = now(), provider_id = $2, reason = null where id = $1", [m.id, providerId]));
      sent++;
    } catch (err) {
      const retry = err instanceof DeliveryError ? err.retry : true;
      const reason = err instanceof Error ? err.message.slice(0, 500) : String(err);
      await withTenant(pool, schema, (tx) =>
        retry && m.attempts < MAX_ATTEMPTS
          ? tx.query("update guest_messages set status = 'queued', reason = $2, send_after = now() + make_interval(mins => 5 * $3) where id = $1", [m.id, reason, 2 ** (m.attempts - 1)])
          : tx.query("update guest_messages set status = 'failed', failed_at = now(), reason = $2 where id = $1", [m.id, reason]),
      );
      failed++;
    }
  }
  const r2 = await dispatchOutboxes(pool, schema, tenantId, providers, options);
  return { sent: sent + r2.sent, failed: failed + r2.failed };
}

/** Staff mail (reports, reminders, alerts) and SMS alerts. */
async function dispatchOutboxes(pool: Pool, schema: string, tenantId: string, providers: { mail: MailProvider; sms: SmsProvider }, options: SenderOptions): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const mails = await withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(
      `update mail_outbox o set attempts = attempts + 1
       from (select id from mail_outbox where sent_at is null and attempts < $1 order by created_at limit 50 for update skip locked) d
       where o.id = d.id returning o.id, o.to_email, o.subject, o.body, o.html, o.attachment_name, o.attachment_type, o.attachment`,
      [MAX_ATTEMPTS],
    );
    return rows as { id: string; to_email: string; subject: string; body: string; html: string | null; attachment_name: string | null; attachment_type: string | null; attachment: Buffer | null }[];
  });
  for (const m of mails) {
    try {
      const html = m.html ?? `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;white-space:pre-wrap">${m.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</body></html>`;
      await providers.mail.send({
        from: `no-reply@${options.platformDomain}`,
        fromName: "Hoteloftware",
        to: m.to_email,
        subject: m.subject,
        html,
        text: m.body,
        attachments: m.attachment ? [{ name: m.attachment_name!, type: m.attachment_type ?? "application/octet-stream", bytes: new Uint8Array(m.attachment) }] : [],
        tags: { tenantId, messageId: `outbox:${m.id}` },
      });
      await withTenant(pool, schema, (tx) => tx.query("update mail_outbox set sent_at = now(), error = null where id = $1", [m.id]));
      sent++;
    } catch (err) {
      await withTenant(pool, schema, (tx) => tx.query("update mail_outbox set error = $2 where id = $1", [m.id, err instanceof Error ? err.message.slice(0, 500) : String(err)]));
      failed++;
    }
  }
  const texts = await withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(
      `update sms_outbox o set attempts = attempts + 1
       from (select id from sms_outbox where sent_at is null and attempts < $1 order by created_at limit 50 for update skip locked) d
       where o.id = d.id returning o.id, o.to_phone, o.body`,
      [MAX_ATTEMPTS],
    );
    return rows as { id: string; to_phone: string; body: string }[];
  });
  for (const t of texts) {
    try {
      const { providerId } = await providers.sms.send({ to: t.to_phone, text: t.body, sender: "Hoteloftwr" });
      await withTenant(pool, schema, (tx) => tx.query("update sms_outbox set sent_at = now(), provider_id = $2, error = null where id = $1", [t.id, providerId]));
      sent++;
    } catch (err) {
      await withTenant(pool, schema, (tx) => tx.query("update sms_outbox set error = $2 where id = $1", [t.id, err instanceof Error ? err.message.slice(0, 500) : String(err)]));
      failed++;
    }
  }
  return { sent, failed };
}

/** Queue an SMS to a user's alert phone (the urgent staff alerts). */
export async function queueSms(pool: Pool, schema: string, input: { toUserId: string; toPhone: string; body: string }): Promise<void> {
  await withTenant(pool, schema, (tx) => tx.query("insert into sms_outbox (to_user_id, to_phone, body) values ($1, $2, $3)", [input.toUserId, input.toPhone, input.body.slice(0, 480)]));
}

export interface BounceAlert {
  reservationId: string;
  propertyId: string;
  confirmationNumber: string;
  type: MessageType;
}

/**
 * A delivery event from the provider, once per event id: delivered, failed
 * (a hard bounce marks the guest's address; for a critical message the desk
 * is to be alerted, returned here), or a spam complaint (no more
 * non-essential mail to that address).
 */
export async function recordMailEvent(pool: Pool, schema: string, event: MailEvent): Promise<BounceAlert | null> {
  if (!event.messageId || event.messageId.startsWith("outbox:")) return null;
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
      await tx.query("update guest_messages set status = 'delivered', delivered_at = now() where id = $1 and status = 'sent'", [msg.id]);
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

/** A test send of a text to the user's own address, rendered with sample values. */
export async function previewMessage(pool: Pool, schema: string, propertyId: string, type: MessageType, language: MessageLanguage, text?: MessageText): Promise<{ subject: string; html: string; text: string }> {
  return withTenant(pool, schema, async (tx) => {
    const look = await propertyLook(tx, propertyId);
    const t = text ?? (await textIn(tx, propertyId, type, language));
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
      checkout_time: "11:00",
    };
    return renderMessage(t, values, { hotelName: look.name, accent: look.accent }, look.footer);
  });
}

/** A test send: the text as the guest would get it, with sample values, to the user's own address. */
export async function sendTestMessage(pool: Pool, schema: string, input: { tenantId: string; propertyId: string; type: MessageType; language: MessageLanguage; userId: string }): Promise<void> {
  const m = await previewMessage(pool, schema, input.propertyId, input.type, input.language);
  await queueMail(pool, schema, { tenantId: input.tenantId, toUserId: input.userId, subject: `[Test] ${m.subject}`, body: m.text, html: m.html });
}

/** Ask the provider whether the hotel's domain is verified, and keep the answer. */
export async function checkSenderDomain(pool: Pool, schema: string, propertyId: string, mail: MailProvider): Promise<DomainStatus | null> {
  const s = await messagingSettings(pool, schema, propertyId);
  if (!s.senderDomain) return null;
  const status = await mail.domainStatus(s.senderDomain);
  await withTenant(pool, schema, (tx) => tx.query("update property_messaging set sender_verified = $2 where property_id = $1 and sender_domain = $3", [propertyId, status.verified, s.senderDomain]));
  return status;
}
