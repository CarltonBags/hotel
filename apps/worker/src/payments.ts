import type { Pool } from "pg";
import { refreshPaymentAccountById, renewExpiringHolds, syncByIntent, syncRefund, withTenant } from "@hoteloftware/db";
import { publishDataChange, publishNotification } from "@hoteloftware/events";
import type { PaymentProvider } from "@hoteloftware/payments";
import type { TenantJobHandler } from "./jobs";
import type { WebhookJobData, WebhookSource } from "./webhooks";

/**
 * The payment provider in the worker (ticket 27): its webhooks settle
 * payments, holds, refunds and account states; an hourly check renews Card
 * Holds before they expire and tells the desk.
 */

/** The provider's webhooks: its own signature check; the connected account finds the tenant. */
export function paymentWebhookSource(provider: PaymentProvider): WebhookSource {
  return {
    name: provider.name,
    verify: (headers, rawBody) => provider.verifyWebhook(rawBody, headers[provider.signatureHeader] ?? "") !== null,
    externalId: (_headers, body) => provider.parseEvent(body)?.id ?? null,
    externalRef: (body) => provider.parseEvent(body)?.accountId ?? null,
  };
}

/** Process a stored provider event inside its tenant: settle what it is about and refresh the desk's screens. */
export function paymentProcessor(provider: PaymentProvider): TenantJobHandler<WebhookJobData> {
  return async ({ tx, tenant, data, pool }) => {
    const stored = await pool.query<{ body: unknown }>("select body from control.webhook_events where id = $1", [data.eventId]);
    const event = provider.parseEvent(stored.rows[0]?.body ?? null);
    if (!event?.objectId) return;
    const s = tenant.schemaName;
    if (event.type === "intent") {
      const hit = await syncByIntent(pool, s, provider, event.objectId);
      if (hit) await publishDataChange(tx, { tenantId: tenant.id, kind: "reservations", propertyId: hit.propertyId });
    } else if (event.type === "refund") {
      await syncRefund(pool, s, provider, event.objectId);
    } else if (event.type === "account" && event.accountId) {
      await refreshPaymentAccountById(pool, s, provider, event.accountId);
    }
  };
}

/** One tenant's hold check: renew holds close to expiry, tell the property's desk with the confirmation number only. */
export async function checkHolds(pool: Pool, tenant: { id: string; schemaName: string }, provider: PaymentProvider, now = new Date()): Promise<{ renewed: number; failed: number }> {
  const warnings: Parameters<Parameters<typeof renewExpiringHolds>[4]>[0][] = [];
  const result = await renewExpiringHolds(pool, tenant.schemaName, provider, now, (w) => warnings.push(w));
  for (const w of warnings) {
    const confirmation = await withTenant(pool, tenant.schemaName, async (tx) =>
      (await tx.query<{ confirmation_number: string }>("select b.confirmation_number from reservations r join bookings b on b.id = r.booking_id where r.id = $1", [w.reservationId])).rows[0]?.confirmation_number ?? "",
    );
    await publishNotification(pool, {
      tenantId: tenant.id,
      userId: null,
      kind: w.renewed ? "card_hold.renewed" : "card_hold.expiring",
      title: w.renewed ? `Card Hold renewed · ${confirmation}` : `Card Hold expiring · ${confirmation}`,
      body: w.renewed ? "The pre-authorisation was renewed on the same card." : `The pre-authorisation runs out soon and could not be renewed${w.error ? `: ${w.error}` : ""}. Take a new hold or a payment.`,
      href: `/reservations/${w.reservationId}`,
    });
  }
  return result;
}
