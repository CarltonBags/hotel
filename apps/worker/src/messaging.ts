import type { Pool } from "pg";
import { can } from "@hoteloftware/domain";
import { dispatchMessages, listTenantUsers, mapProviderAccount, recordMailEvent, scanGuestMessages, type Tenant } from "@hoteloftware/db";
import type { MailProvider, SmsProvider } from "@hoteloftware/messaging";
import { alertStaff } from "./alerts";
import type { ProviderProcessor } from "./payments";
import type { WebhookSource } from "./webhooks";

/** The mail provider's delivery events, routed to the tenant named in the event's variables. */
export const MAIL_SOURCE = "mail";

/**
 * Guest messages and staff alerts going out (ticket 39): each minute, per
 * tenant, derive the automatic messages and send what is due.
 */
export async function runMessaging(pool: Pool, tenant: { id: string; schemaName: string }, providers: { mail: MailProvider; sms: SmsProvider }, platformDomain: string): Promise<{ queued: number; sent: number; failed: number }> {
  // the provider's events carry the tenant id; the intake maps it back
  await mapProviderAccount(pool, MAIL_SOURCE, tenant.id, tenant.id);
  const queued = await scanGuestMessages(pool, tenant.schemaName);
  const r = await dispatchMessages(pool, tenant.schemaName, tenant.id, providers, { platformDomain });
  return { queued, ...r };
}

export function mailWebhookSource(mail: MailProvider): WebhookSource {
  return {
    name: MAIL_SOURCE,
    verify: (headers, rawBody) => mail.verifyWebhook(headers, rawBody),
    externalId: (_headers, body) => mail.parseEvent(body)?.id ?? null,
    externalRef: (body) => mail.parseEvent(body)?.tenantId ?? null,
  };
}

/** A delivery event: state on the message; a hard bounce of a critical message alerts the property's desk to call the guest. */
export function mailProcessor(mail: MailProvider): ProviderProcessor {
  return async ({ tenant, data, pool }) => {
    const stored = await pool.query<{ body: unknown }>("select body from control.webhook_events where id = $1", [data.eventId]);
    const event = mail.parseEvent(stored.rows[0]?.body ?? null);
    if (!event) return;
    await alertBounce(pool, tenant, await recordMailEvent(pool, tenant.schemaName, event));
  };
}

async function alertBounce(pool: Pool, tenant: Tenant, bounce: Awaited<ReturnType<typeof recordMailEvent>>): Promise<void> {
  if (!bounce) return;
  const desk = (await listTenantUsers(pool, tenant.id)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "manage_reservations", bounce.propertyId));
  await alertStaff(pool, tenant, desk, {
    kind: "guest_message.bounced",
    title: `Email not delivered · ${bounce.confirmationNumber}`,
    body: "The guest's address refused the message. Call the guest and correct the address.",
    href: `/reservations/${bounce.reservationId}`,
    propertyId: bounce.propertyId,
  });
}
