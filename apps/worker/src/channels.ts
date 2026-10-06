import type { Pool } from "pg";
import { acceptsOnlineReservations, can, todayIn } from "@hoteloftware/domain";
import { connectedProperties, ensureBookingWebhook, listTenantUsers, nonPaymentStatus, processChannelFeed, pushChannels, tenantEnd, type Tenant } from "@hoteloftware/db";
import { notifyStaff } from "@hoteloftware/events";
import type { ChannelManager } from "@hoteloftware/channels";
import { timingSafeEqual } from "node:crypto";
import type { ProviderProcessor } from "./payments";
import type { WebhookSource } from "./webhooks";

/**
 * The channel push (ticket 37): every minute, each connected property's
 * waiting changes go to the channel manager. A failure keeps them for the
 * next run and tells Revenue and the Property Manager once per streak.
 * Unpaid from day 60, or after the contract ended, sales are closed at the
 * channels (ticket 89).
 */
export async function pushTenantChannels(pool: Pool, tenant: { id: string; schemaName: string }, manager: ChannelManager): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const acceptsReservations = await acceptsReservationsNow(pool, tenant.id);
  for (const propertyId of await connectedProperties(pool, tenant.schemaName)) {
    const r = await pushChannels(pool, tenant.schemaName, propertyId, manager, { acceptsReservations });
    sent += r.sent;
    if (r.error) failed++;
    if (r.alert) {
      const revenue = (await listTenantUsers(pool, tenant.id)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "manage_rates", propertyId));
      await notifyStaff(pool, tenant, revenue, {
        kind: "channels.failing",
        title: "Channel manager: changes are not getting through",
        body: `${r.error}\nThe changes wait and are sent again every minute.`,
        href: "/settings/channels",
        propertyId,
      });
    }
  }
  return { sent, failed };
}

/** Online reservations are taken unless the subscription is unpaid from day 60 or the contract ended (ticket 89); the platform's day, as the app reckons the stage. */
async function acceptsReservationsNow(pool: Pool, tenantId: string): Promise<boolean> {
  return acceptsOnlineReservations((await nonPaymentStatus(pool, tenantId, todayIn("Europe/Berlin"))).stage) && !(await tenantEnd(pool, tenantId));
}

/**
 * Channel bookings (ticket 38): the channel manager's webhook only says
 * something changed at a property; we take its feed of unacknowledged
 * revisions, apply them and acknowledge. Problems (refused, conflicting,
 * overbooked) go to the property's desk and Property Manager.
 */
export async function pullChannelBookings(pool: Pool, tenant: Tenant, manager: ChannelManager, propertyIds?: string[], webhook?: { url: string; secret: string }): Promise<{ applied: number; problems: number }> {
  const acceptsReservations = await acceptsReservationsNow(pool, tenant.id);
  let applied = 0;
  let problems = 0;
  for (const propertyId of propertyIds ?? (await connectedProperties(pool, tenant.schemaName))) {
    // properties connected before booking webhooks existed get theirs now
    if (webhook) await ensureBookingWebhook(pool, tenant.schemaName, propertyId, manager, webhook).catch((err) => console.error("[channels] webhook not registered", err));
    const r = await processChannelFeed(pool, tenant.schemaName, propertyId, manager, { acceptsReservations });
    applied += r.applied;
    problems += r.problems.length;
    if (r.problems.length) {
      const desk = (await listTenantUsers(pool, tenant.id)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "manage_reservations", propertyId));
      for (const p of r.problems) {
        // to the reservation where there is one; the list of channel problems otherwise (open to the desk)
        await notifyStaff(pool, tenant, desk, { kind: "channels.booking_problem", title: p.outcome === "refused" ? "Channel booking refused" : "Channel booking needs attention", body: p.message, href: p.reservationId ? `/reservations/${p.reservationId}` : "/settings/channels", propertyId });
      }
    }
  }
  return { applied, problems };
}

/** The channel manager's webhooks: our secret in a header set when the webhook was registered; its property id finds the tenant. */
export function channelWebhookSource(manager: ChannelManager, secret: string): WebhookSource {
  return {
    name: manager.name,
    verify: (headers) => {
      const given = Buffer.from(headers["x-hoteloftware-secret"] ?? "");
      const expected = Buffer.from(secret);
      return secret.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
    },
    externalId: (_headers, body) => {
      const b = body as { event?: string; timestamp?: string; payload?: { booking_revision_id?: string; revision_id?: string; booking_id?: string } } | null;
      // a revision id is unique; a bare booking id is not (each change of the booking announces it again)
      const revision = b?.payload?.booking_revision_id ?? b?.payload?.revision_id;
      const id = revision ?? (b?.payload?.booking_id ? `${b.payload.booking_id}:${b.timestamp ?? Date.now()}` : null);
      return b?.event && id ? `${b.event}:${id}` : null;
    },
    externalRef: (body) => (body as { property_id?: string } | null)?.property_id ?? null,
  };
}

/** A webhook arrived: pull that property's feed. */
export function channelBookingProcessor(manager: ChannelManager): ProviderProcessor {
  return async ({ tenant, data, pool }) => {
    const stored = await pool.query<{ property_id: string | null }>(
      "select e.property_id from control.webhook_events w join control.external_ids e on e.provider = w.source and e.external_id = w.body ->> 'property_id' where w.id = $1",
      [data.eventId],
    );
    const propertyId = stored.rows[0]?.property_id;
    await pullChannelBookings(pool, tenant, manager, propertyId ? [propertyId] : undefined);
  };
}
