import type { Pool } from "pg";
import { can } from "@hoteloftware/domain";
import { dispatchMessages, escalateConversations, listTenantUsers, mapProviderAccount, recordMailEvent, scanGuestMessages, type BouncedMessage, type Tenant } from "@hoteloftware/db";
import type { MailProvider, SmsProvider } from "@hoteloftware/messaging";
import { notifyStaff, notifyWithRight } from "@hoteloftware/events";
import type { ProviderProcessor } from "./payments";
import type { WebhookSource } from "./webhooks";

/** The mail provider's delivery events, routed to the tenant named in the event's variables. */
export const MAIL_SOURCE = "mail";

/**
 * Guest messages and staff alerts going out (ticket 39): each minute, per
 * tenant, derive the automatic messages and send what is due.
 */
// tenants whose mail events are routable from this process; the mapping is written once
const mapped = new Set<string>();

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
    mapped.add(tenant.id);
  }
  const base = portalBase(tenant.slug);
  const queued = await scanGuestMessages(pool, tenant.schemaName, new Date(), base ? { base } : null);
  const r = await dispatchMessages(pool, tenant.schemaName, tenant.id, providers, { platformDomain });
  await escalateUnread(pool, tenant).catch((err) => console.error("[messaging] inbox escalation", err));
  return { queued, ...r };
}

/** Guest messages nobody opened in the property's time (Desk Hours only): the Property Manager is told, once (ticket 42). */
export async function escalateUnread(pool: Pool, tenant: { id: string; schemaName: string }, now = new Date()): Promise<number> {
  const due = await escalateConversations(pool, tenant.schemaName, now);
  for (const e of due) {
    await notifyWithRight(pool, tenant, "receive_inbox_escalations", e.propertyId, {
      kind: "inbox.escalated",
      title: `Guest message waiting · ${e.guestName}`,
      body: "Nobody has opened it yet.",
      href: `/inbox?c=${e.conversationId}`,
    });
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
