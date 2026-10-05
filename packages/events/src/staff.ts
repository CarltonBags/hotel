import type { Pool } from "pg";
import { URGENT_NOTIFICATIONS, receivesUrgentSms } from "@hoteloftware/domain";
import { notificationChannelsOf, queueMail, queueSms, type TenantUser } from "@hoteloftware/db";
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
