import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { CONVERSATION_FILE_BYTES, WHATSAPP_MEDIA_BYTES, can, isAutoReply, isConversationFile, parseReplyAddress } from "@hoteloftware/domain";
import { FileRefused, PORTAL_USER, WHATSAPP_SOURCE, applyTemplateReview, applyWhatsAppStatus, conversationByReplyToken, inboundMailKnown, propertyOfNumber, receiveWhatsApp, refreshTemplateReviews, whatsAppMessageKnown, dispatchMessages, escalateConversations, listTenantUsers, receiveGuestEmail, releaseEscalation, storeFile, mapProviderAccount, recordMailEvent, scanGuestMessages, type BouncedMessage, type Tenant } from "@hoteloftware/db";
import { DeliveryError, whatsAppMessageCost, type InboundMail, type MailProvider, type SmsProvider, type WhatsAppProvider } from "@hoteloftware/messaging";
import { notifyStaff, notifyWithRight, publishDataChange, publishNotification } from "@hoteloftware/events";
import { fileServices } from "@hoteloftware/storage";
import type { ProviderProcessor } from "./payments";
import { formFieldsOf, type WebhookSource } from "./webhooks";

/** The mail provider's delivery events, routed to the tenant named in the event's variables. */
export const MAIL_SOURCE = "mail";
/** Guests' email replies (ticket 43), routed by the tenant named in the reply address. */
export const INBOUND_SOURCE = "mail-inbound";

/**
 * Guest messages and staff alerts going out (ticket 39): each minute, per
 * tenant, derive the automatic messages and send what is due.
 */
// tenants whose mail events are routable from this process; the mapping is written once
const mapped = new Set<string>();

/** What guest messages link to: the portal, and the domain guests' email replies come in at (MAIL_INBOUND_DOMAIN). */
export function guestLinks(slug: string, env: NodeJS.ProcessEnv = process.env): { base: string; replyDomain: string | null } | null {
  const base = portalBase(slug, env);
  return base ? { base, replyDomain: env.MAIL_INBOUND_DOMAIN || null } : null;
}

/** Where a tenant's Guest Portal answers: its subdomain, with the scheme of the app's own address. */
export function portalBase(slug: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!env.APP_DOMAIN) return null;
  // the same rule as the app's tenantUrl: https when the app's own address is
  const scheme = (env.BETTER_AUTH_URL ?? "").startsWith("https") ? "https" : "http";
  return `${scheme}://${slug}.${env.APP_DOMAIN}`;
}

export async function runMessaging(pool: Pool, tenant: { id: string; slug: string; schemaName: string }, providers: { mail: MailProvider; sms: SmsProvider; whatsapp?: WhatsAppProvider }, platformDomain: string): Promise<{ queued: number; sent: number; failed: number }> {
  // the provider's events carry the tenant id; the intake maps it back
  if (!mapped.has(tenant.id)) {
    await mapProviderAccount(pool, MAIL_SOURCE, tenant.id, tenant.id);
    await mapProviderAccount(pool, INBOUND_SOURCE, tenant.slug, tenant.id);
    mapped.add(tenant.id);
  }
  const queued = await scanGuestMessages(pool, tenant.schemaName, new Date(), guestLinks(tenant.slug));
  const { whatsapp, ...rest } = providers;
  const r = await dispatchMessages(pool, tenant.schemaName, tenant.id, { ...rest, ...(whatsapp ? { whatsapp: { provider: whatsapp, cost: whatsAppMessageCost() } } : {}) }, { platformDomain });
  // template reviews come by webhook; a quarter-hourly look catches one missed
  if (whatsapp && new Date().getMinutes() % 15 === 0) await refreshTemplateReviews(pool, tenant.schemaName, whatsapp).catch((err) => console.error("[messaging] template reviews", err));
  await escalateUnread(pool, tenant).catch((err) => console.error("[messaging] inbox escalation", err));
  return { queued, ...r };
}

/** Guest messages nobody opened in the property's time (Desk Hours only): the Property Manager is told, once (ticket 42). */
export async function escalateUnread(pool: Pool, tenant: { id: string; schemaName: string }, now = new Date()): Promise<number> {
  const due = await escalateConversations(pool, tenant.schemaName, now);
  for (const e of due) {
    try {
      await notifyWithRight(pool, tenant, "receive_inbox_escalations", e.propertyId, {
        kind: "inbox.escalated",
        title: `Guest message waiting · ${e.guestName}`,
        body: "Nobody has opened it yet.",
        href: `/inbox?c=${e.conversationId}`,
      });
    } catch (err) {
      // not told: due again on the next run
      console.error("[messaging] escalation not sent", err);
      await releaseEscalation(pool, tenant.schemaName, e.conversationId);
    }
  }
  return due.length;
}

export function mailWebhookSource(mail: MailProvider): WebhookSource {
  return {
    name: MAIL_SOURCE,
    verify: (headers, rawBody) => mail.verifyWebhook(headers, rawBody),
    // the signed token, not the event id: a replayed signature with another body is a duplicate
    externalId: (_headers, body) => (mail.parseEvent(body) ? mail.replayKey(body) : null),
    externalRef: (body) => mail.parseEvent(body)?.tenantId ?? null,
  };
}

/** A delivery event: state on the message; a hard bounce of a critical message tells the property's desk to call the guest. */
export function mailProcessor(mail: MailProvider): ProviderProcessor {
  return async ({ tenant, data, pool }) => {
    const stored = await pool.query<{ body: unknown }>("select body from control.webhook_events where id = $1", [data.eventId]);
    const event = mail.parseEvent(stored.rows[0]?.body ?? null);
    if (!event) return;
    await notifyBounce(pool, tenant, await recordMailEvent(pool, tenant.schemaName, event));
  };
}

async function notifyBounce(pool: Pool, tenant: Tenant, bounce: BouncedMessage | null): Promise<void> {
  if (!bounce) return;
  const desk = (await listTenantUsers(pool, tenant.id)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "manage_reservations", bounce.propertyId));
  await notifyStaff(pool, tenant, desk, {
    kind: "guest_message.bounced",
    title: `Email not delivered · ${bounce.confirmationNumber}`,
    body: "The guest's address refused the message. Call the guest and correct the address.",
    href: `/reservations/${bounce.reservationId}`,
    propertyId: bounce.propertyId,
  });
}

/** Guests' email replies: the provider stores the mail and sends a signed notice (form fields). */
export function inboundWebhookSource(mail: MailProvider): WebhookSource {
  return {
    name: INBOUND_SOURCE,
    verify: (headers, rawBody) => mail.verifyInbound(headers, formFieldsOf(rawBody, headers["content-type"] ?? "") ?? {}),
    // the signed part of the notice: a captured signature sent again with other fields is a duplicate
    externalId: (_headers, body) => mail.inboundReplayKey((body ?? {}) as Record<string, string>),
    externalRef: (body) => parseReplyAddress(mail.parseInbound((body ?? {}) as Record<string, string>)?.recipient ?? "")?.slug ?? null,
  };
}

const RAW_MAIL_BYTES = 25 * 1024 * 1024;

/**
 * A guest's email reply (ticket 43): kept as received (the notice and the
 * mail itself); out-of-office replies are not counted; text and attachments
 * (images and PDFs up to 10 MB; others stay in the kept mail) land in the
 * Conversation; the inbox hears of it. The guest's text then leaves the
 * stored notice, so it goes with the Conversation's retention.
 */
export function inboundProcessor(mail: MailProvider): ProviderProcessor {
  return async ({ tenant, data, pool }) => {
    const stored = await pool.query<{ body: Record<string, string> | null }>("select body from control.webhook_events where id = $1", [data.eventId]);
    const fields = stored.rows[0]?.body ?? {};
    const m = mail.parseInbound(fields);
    const address = m ? parseReplyAddress(m.recipient) : null;
    const domain = process.env.MAIL_INBOUND_DOMAIN?.toLowerCase();
    if (m && address && address.slug === tenant.slug && (!domain || address.domain === domain)) await takeReply(pool, tenant, mail, m, address.token, fields);
    await pool.query("update control.webhook_events set body = null, raw_body = '' where id = $1", [data.eventId]);
  };
}

async function takeReply(pool: Pool, tenant: Tenant, mail: MailProvider, m: InboundMail, token: string, fields: Record<string, string>): Promise<void> {
  // the mail's id with the address it came to: the same mail to two Conversations is taken for each
  const providerId = `${m.id}|${token}`;
  if (await inboundMailKnown(pool, tenant.schemaName, providerId)) return;
  const target = await conversationByReplyToken(pool, tenant.schemaName, token);
  const autoReply = isAutoReply(m.headers, m.subject);
  const fileIds: string[] = [];
  if (target && !autoReply) {
    for (const a of m.attachments) {
      if (!isConversationFile(a.type, a.size)) continue;
      try {
        const bytes = await mail.fetchInboundAttachment(a.url, CONVERSATION_FILE_BYTES);
        fileIds.push(await storeFile(pool, tenant.schemaName, fileServices(), { tenantId: tenant.id, kind: "conversation_file", bytes, contentType: a.type, propertyId: target.propertyId, userId: PORTAL_USER }));
      } catch (err) {
        // a file refused for what it is stays in the kept mail; storage or provider away: the notice is tried again
        // (files stored before a failed try are unused uploads and go after two days)
        if (!(err instanceof FileRefused) && !(err instanceof DeliveryError && !err.retry)) throw err;
      }
    }
  }
  const mime = await mail.fetchInboundRaw(fields, RAW_MAIL_BYTES).catch(() => null);
  const got = await receiveGuestEmail(pool, tenant.schemaName, { providerId, token, sender: m.sender, subject: m.subject, text: m.text, autoReply, raw: fields, fileIds, mime }, guestLinks(tenant.slug));
  if (!got) return;
  // telling the inbox is best effort: the message is in, a retry would not tell anyone either
  try {
    await publishDataChange(pool, { tenantId: tenant.id, kind: "conversations", propertyId: got.propertyId });
    const users = (await listTenantUsers(pool, tenant.id)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "use_guest_inbox", got.propertyId));
    for (const u of users) {
      await publishNotification(pool, { tenantId: tenant.id, userId: u.id, kind: "inbox.message", title: got.guestName || "Guest message", body: m.text.split("\n")[0]!.slice(0, 120) || "📎", href: `/inbox?c=${got.conversationId}` });
    }
  } catch (err) {
    console.error("[messaging] inbox not told of an email reply", err);
  }
}

/** WhatsApp's webhook (ticket 44): signed with the app secret; the business number (or account) names the tenant. */
export function whatsAppWebhookSource(wa: WhatsAppProvider): WebhookSource {
  return {
    name: WHATSAPP_SOURCE,
    verify: (headers, rawBody) => wa.verifyWebhook(headers, rawBody),
    // Meta sends a body again unchanged when it retries: its digest is the delivery's identity
    externalId: (_headers, body) => (body ? createHash("sha256").update(JSON.stringify(body)).digest("hex") : null),
    externalRef: (body) => {
      const entry = (body as { entry?: { id?: string; changes?: { value?: { metadata?: { phone_number_id?: string } } }[] }[] } | null)?.entry?.[0];
      return entry?.changes?.[0]?.value?.metadata?.phone_number_id ?? entry?.id ?? null;
    },
    challenge: (query) => wa.verifyChallenge(query),
  };
}

/**
 * WhatsApp events inside their tenant: guests' messages (media up to 5 MB
 * stored like other attachments) into their Conversation or Unassigned;
 * delivery states; template reviews. The guest's text then leaves the stored
 * event.
 */
export function whatsAppProcessor(wa: WhatsAppProvider): ProviderProcessor {
  return async ({ tenant, data, pool }) => {
    const stored = await pool.query<{ body: unknown }>("select body from control.webhook_events where id = $1", [data.eventId]);
    for (const e of wa.parseWebhook(stored.rows[0]?.body ?? null)) {
      if (e.kind === "template") await applyTemplateReview(pool, tenant.schemaName, e.templateId, e.status, e.reason);
      else if (e.kind === "status") await applyWhatsAppStatus(pool, tenant.schemaName, e.id, e.status, e.error);
      else await takeWhatsApp(pool, tenant, wa, e);
    }
    await pool.query("update control.webhook_events set body = null, raw_body = '' where id = $1", [data.eventId]);
  };
}

async function takeWhatsApp(pool: Pool, tenant: Tenant, wa: WhatsAppProvider, e: Extract<ReturnType<WhatsAppProvider["parseWebhook"]>[number], { kind: "message" }>): Promise<void> {
  const at = await propertyOfNumber(pool, tenant.schemaName, e.phoneNumberId);
  if (!at || (await whatsAppMessageKnown(pool, tenant.schemaName, e.id))) return;
  let fileId: string | null = null;
  if (e.media && isConversationFile(e.media.type, 0)) {
    try {
      const media = await wa.fetchMedia(at.account, e.media.id, WHATSAPP_MEDIA_BYTES);
      if (media) fileId = await storeFile(pool, tenant.schemaName, fileServices(), { tenantId: tenant.id, kind: "conversation_file", bytes: media.bytes, contentType: media.type, propertyId: at.propertyId, userId: PORTAL_USER });
    } catch (err) {
      // a file refused for what it is is left out; WhatsApp away: the event is tried again
      if (!(err instanceof FileRefused) && !(err instanceof DeliveryError && !err.retry)) throw err;
    }
  }
  const got = await receiveWhatsApp(pool, tenant.schemaName, { propertyId: at.propertyId, providerId: e.id, from: e.from, name: e.name, text: e.text, at: e.at, fileId }, guestLinks(tenant.slug));
  try {
    await publishDataChange(pool, { tenantId: tenant.id, kind: "conversations", propertyId: at.propertyId });
    const users = (await listTenantUsers(pool, tenant.id)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "use_guest_inbox", at.propertyId));
    for (const u of users) {
      await publishNotification(pool, { tenantId: tenant.id, userId: u.id, kind: "inbox.message", title: got?.guestName || e.name || `+${e.from}`, body: e.text.split("\n")[0]!.slice(0, 120) || "📎", href: got ? `/inbox?c=${got.conversationId}` : "/inbox" });
    }
  } catch (err) {
    console.error("[messaging] inbox not told of a WhatsApp message", err);
  }
}
