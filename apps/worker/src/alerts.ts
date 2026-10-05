import type { Pool } from "pg";
import { URGENT_ALERTS } from "@hoteloftware/domain";
import { alertSettingsOf, queueMail, queueSms, type TenantUser } from "@hoteloftware/db";
import { publishNotification } from "@hoteloftware/events";

export interface StaffAlert {
  kind: string;
  title: string;
  body?: string;
  href?: string;
  /** The property it is about: who counts as its Property Manager. Null for tenant-wide alerts. */
  propertyId: string | null;
}

/** Owner, or Property Manager of the property (of any property for a tenant-wide alert): the only ones alerted by SMS. */
function managerOf(u: TenantUser, propertyId: string | null): boolean {
  return u.tenantRole === "owner" || u.propertyRoles.some((r) => r.role === "property_manager" && (!propertyId || r.propertyId === propertyId));
}

/**
 * A staff alert (ticket 39): in the app always; by email where the user
 * wants it; by SMS for the urgent kinds, to Property Manager and Owner only.
 * The mail and SMS go through the outboxes, sent by the dispatch job.
 */
export async function alertStaff(pool: Pool, tenant: { id: string; schemaName: string }, users: TenantUser[], alert: StaffAlert): Promise<void> {
  const settings = await alertSettingsOf(pool, users.map((u) => u.id));
  const urgent = (URGENT_ALERTS as readonly string[]).includes(alert.kind);
  for (const u of users) {
    await publishNotification(pool, { tenantId: tenant.id, userId: u.id, kind: alert.kind, title: alert.title, body: alert.body ?? "", ...(alert.href ? { href: alert.href } : {}) });
    const s = settings.get(u.id)!;
    // PIN-only floor staff have no address of their own
    if (s.email && !u.pinOnly && u.email) await queueMail(pool, tenant.schemaName, { tenantId: tenant.id, toUserId: u.id, subject: alert.title, body: alert.body || alert.title });
    if (urgent && s.sms && s.phone && managerOf(u, alert.propertyId)) await queueSms(pool, tenant.schemaName, { toUserId: u.id, toPhone: s.phone, body: `Hoteloftware: ${alert.title}` });
  }
}
