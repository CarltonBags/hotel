import type { Pool } from "pg";
import { refreshPaymentAccountById, renewExpiringHolds, retryOpenRefunds, syncByIntent, syncRefund, withTenant, type Tenant } from "@hoteloftware/db";
import { publishDataChange, publishNotification } from "@hoteloftware/events";
import type { PaymentProvider } from "@hoteloftware/payments";
import type { WebhookJobData, WebhookSource } from "./webhooks";

/** A webhook processor that talks to a provider: it runs without an open transaction, so no connection waits on the network. */
export type ProviderProcessor = (ctx: { tenant: Tenant; data: WebhookJobData; pool: Pool }) => Promise<void>;

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
export function paymentProcessor(provider: PaymentProvider): ProviderProcessor {
  return async ({ tenant, data, pool }) => {
    const stored = await pool.query<{ body: unknown }>("select body from control.webhook_events where id = $1", [data.eventId]);
    const event = provider.parseEvent(stored.rows[0]?.body ?? null);
    if (!event?.objectId) return;
    const s = tenant.schemaName;
    const hit =
      event.type === "intent" ? await syncByIntent(pool, s, provider, event.objectId) : event.type === "refund" ? await syncRefund(pool, s, provider, event.objectId) : null;
    if (event.type === "account" && event.accountId) await refreshPaymentAccountById(pool, s, provider, event.accountId);
    // balances changed: open screens refresh
    if (hit) await publishDataChange(pool, { tenantId: tenant.id, kind: "reservations", propertyId: hit.propertyId });
  };
}

/** One tenant's hold check: renew holds close to expiry, tell the property's desk with the confirmation number only. */
export async function checkHolds(pool: Pool, tenant: { id: string; schemaName: string }, provider: PaymentProvider, now = new Date()): Promise<{ renewed: number; failed: number }> {
  const warnings: Parameters<Parameters<typeof renewExpiringHolds>[4]>[0][] = [];
  const result = await renewExpiringHolds(pool, tenant.schemaName, provider, now, (w) => warnings.push(w));
  // refunds the provider did not answer, or that waited for balance, are sent again
  const refunds = await retryOpenRefunds(pool, tenant.schemaName, provider);
  const changed = new Set([...warnings.filter((w) => w.renewed).map((w) => w.propertyId), ...refunds.propertyIds]);
  for (const propertyId of changed) await publishDataChange(pool, { tenantId: tenant.id, kind: "reservations", propertyId });
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
