import type { Pool } from "pg";
import { can, isAutoReply, isConversationFile, parseReplyAddress } from "@hoteloftware/domain";
import { FileRefused, PORTAL_USER, conversationByReplyToken, dispatchMessages, escalateConversations, listTenantUsers, receiveGuestEmail, releaseEscalation, storeFile, mapProviderAccount, recordMailEvent, scanGuestMessages, type BouncedMessage, type Tenant } from "@hoteloftware/db";
import type { MailProvider, SmsProvider } from "@hoteloftware/messaging";
import { notifyStaff, notifyWithRight, publishDataChange, publishNotification } from "@hoteloftware/events";
import { fileServices } from "@hoteloftware/storage";
import type { ProviderProcessor } from "./payments";
import type { WebhookSource } from "./webhooks";

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

export async function runMessaging(pool: Pool, tenant: { id: string; slug: string; schemaName: string }, providers: { mail: MailProvider; sms: SmsProvider }, platformDomain: string): Promise<{ queued: number; sent: number; failed: number }> {
  // the provider's events carry the tenant id; the intake maps it back
  if (!mapped.has(tenant.id)) {
    await mapProviderAccount(pool, MAIL_SOURCE, tenant.id, tenant.id);
    await mapProviderAccount(pool, INBOUND_SOURCE, tenant.slug, tenant.id);
    mapped.add(tenant.id);
  }
  const base = portalBase(tenant.slug);
  const queued = await scanGuestMessages(pool, tenant.schemaName, new Date(), guestLinks(tenant.slug));
  const r = await dispatchMessages(pool, tenant.schemaName, tenant.id, providers, { platformDomain });
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

const formFields = (rawBody: string) => Object.fromEntries(new URLSearchParams(rawBody));

/** Guests' email replies: the provider stores the mail and sends a signed notice (form fields). */
export function inboundWebhookSource(mail: MailProvider): WebhookSource {
  return {
    name: INBOUND_SOURCE,
    verify: (_headers, rawBody) => mail.verifyInbound(formFields(rawBody)),
    externalId: (_headers, body) => mail.parseInbound((body ?? {}) as Record<string, string>)?.id ?? null,
    externalRef: (body) => parseReplyAddress(mail.parseInbound((body ?? {}) as Record<string, string>)?.recipient ?? "")?.slug ?? null,
  };
}

/**
 * A guest's email reply (ticket 43): kept as received; out-of-office replies
 * are not counted; text and attachments (images and PDFs up to 10 MB, others
 * left with the raw mail) land in the Conversation; the inbox hears of it.
 */
export function inboundProcessor(mail: MailProvider): ProviderProcessor {
  return async ({ tenant, data, pool }) => {
    const stored = await pool.query<{ body: Record<string, string> | null }>("select body from control.webhook_events where id = $1", [data.eventId]);
    const fields = stored.rows[0]?.body ?? {};
    const m = mail.parseInbound(fields);
    if (!m) return;
    const address = parseReplyAddress(m.recipient);
    if (!address || address.slug !== tenant.slug) return;
    const target = await conversationByReplyToken(pool, tenant.schemaName, address.token);
    const autoReply = isAutoReply(m.headers, m.subject);
    const fileIds: string[] = [];
    if (target && !autoReply) {
      for (const a of m.attachments) {
        if (!isConversationFile(a.type, a.size)) continue;
        try {
          const bytes = await mail.fetchInboundAttachment(a.url);
          fileIds.push(await storeFile(pool, tenant.schemaName, fileServices(), { tenantId: tenant.id, kind: "conversation_file", bytes, contentType: a.type, propertyId: target.propertyId, userId: PORTAL_USER }));
        } catch (err) {
          // a refused file stays with the raw mail; anything else is tried again with the whole notice
          if (!(err instanceof FileRefused)) throw err;
        }
      }
    }
    const got = await receiveGuestEmail(pool, tenant.schemaName, { providerId: m.id, token: address.token, sender: m.sender, subject: m.subject, text: m.text, autoReply, raw: fields, fileIds }, guestLinks(tenant.slug));
    if (!got) return;
    await publishDataChange(pool, { tenantId: tenant.id, kind: "conversations", propertyId: got.propertyId });
    const users = (await listTenantUsers(pool, tenant.id)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "use_guest_inbox", got.propertyId));
    for (const u of users) {
      await publishNotification(pool, { tenantId: tenant.id, userId: u.id, kind: "inbox.message", title: got.guestName || "Guest message", body: m.text.split("\n")[0]!.slice(0, 120) || "📎", href: `/inbox?c=${got.conversationId}` });
    }
  };
}
