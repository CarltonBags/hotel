import type { Pool } from "pg";
import { URGENT_NOTIFICATIONS, can, receivesUrgentSms, type Action } from "@hoteloftware/domain";
import { listTenantUsers, notificationChannelsOf, queueMail, queueSms, type TenantUser } from "@hoteloftware/db";
import { publishNotification } from "./index";

export interface StaffNotification {
  kind: string;
  title: string;
  body?: string;
  href?: string;
  /** The property it is about: whose Property Managers count for SMS. Null for the whole tenant. */
  propertyId: string | null;
}

/**
 * Notify staff users (ticket 39): in the app always; by email where the user
 * wants it; by SMS for the urgent kinds, to Property Managers (Owner and
 * Tenant Admin count as one) who gave a phone. Mail and SMS go through the
 * outboxes, sent by the worker's dispatch.
 */
export async function notifyStaff(pool: Pool, tenant: { id: string; schemaName: string }, users: TenantUser[], n: StaffNotification): Promise<void> {
  const channels = await notificationChannelsOf(pool, users.map((u) => u.id));
  const urgent = (URGENT_NOTIFICATIONS as readonly string[]).includes(n.kind);
  for (const u of users) {
    await publishNotification(pool, { tenantId: tenant.id, userId: u.id, kind: n.kind, title: n.title, body: n.body ?? "", ...(n.href ? { href: n.href } : {}) });
    const c = channels.get(u.id)!;
    // PIN-only floor staff have no address of their own
    if (c.email && !u.pinOnly && u.email) await queueMail(pool, tenant.schemaName, { tenantId: tenant.id, toUserId: u.id, subject: n.title, body: n.body || n.title });
    if (urgent && c.sms && c.phone && receivesUrgentSms({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, n.propertyId)) {
      await queueSms(pool, tenant.schemaName, { toUserId: u.id, toPhone: c.phone, body: `Hoteloftware: ${n.title}` });
    }
  }
}

/** Notify the users who hold a right at the property (the desk that can take a payment, say). */
export async function notifyWithRight(pool: Pool, tenant: { id: string; schemaName: string }, action: Action, propertyId: string, n: Omit<StaffNotification, "propertyId">): Promise<void> {
  const users = (await listTenantUsers(pool, tenant.id)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, action, propertyId));
  await notifyStaff(pool, tenant, users, { ...n, propertyId });
}

/** A guest's online payment was declined in the Guest Portal: the desk is told once (ticket 41). */
export function notifyPortalDecline(pool: Pool, tenant: { id: string; schemaName: string }, d: { reservationId: string; propertyId: string; reason: string }): Promise<void> {
  return notifyWithRight(pool, tenant, "take_payments", d.propertyId, { kind: "payments.portal_declined", title: "Online payment declined in the Guest Portal", body: d.reason, href: `/reservations/${d.reservationId}` });
}

/**
 * How a Self Check-in ended, told to the desk (ticket 49): a guest who needs
 * help, or waits for a room, as any notification; a completed check-in only
 * in the app (one per arrival would flood the mailbox).
 */
export async function notifySelfCheckin(
  pool: Pool,
  tenant: { id: string; schemaName: string },
  r: { reservationId: string; propertyId: string; guestName: string; outcome: "checked_in" | "waiting" | "help"; roomNumber: string | null; reasons: string },
): Promise<void> {
  const href = `/reservations/${r.reservationId}`;
  if (r.outcome === "help") return notifyWithRight(pool, tenant, "check_in", r.propertyId, { kind: "self_checkin.help", title: `${r.guestName} needs help at Self Check-in`, body: r.reasons, href });
  if (r.outcome === "waiting") return notifyWithRight(pool, tenant, "check_in", r.propertyId, { kind: "self_checkin.waiting", title: `${r.guestName} is waiting for a room`, body: "Arrived, Waiting for Room: assign a room once one is ready and tell the guest.", href });
  const users = (await listTenantUsers(pool, tenant.id)).filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "check_in", r.propertyId));
  for (const u of users) await publishNotification(pool, { tenantId: tenant.id, userId: u.id, kind: "self_checkin.done", title: "Self check-in complete", body: `${r.guestName} · Room ${r.roomNumber ?? "?"}`, href });
}
