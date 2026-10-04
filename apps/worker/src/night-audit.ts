import type { Pool } from "pg";
import { can } from "@hoteloftware/domain";
import { listTenantUsers, markAuditAlerted, overdueAudits } from "@hoteloftware/db";
import { publishNotification } from "@hoteloftware/events";

/**
 * Overdue Night Audits (ticket 32): once per property and Business Date
 * past the deadline, Front Desk and Property Manager of the property are
 * alerted; the banner stays in the app until the audit is run.
 */
export async function alertOverdueAudits(pool: Pool, tenant: { id: string; schemaName: string }, now = new Date()): Promise<number> {
  const overdue = await overdueAudits(pool, tenant.schemaName, now);
  if (!overdue.length) return 0;
  const users = await listTenantUsers(pool, tenant.id);
  for (const o of overdue) {
    // marked first: a crash part-way sends no alert twice (at most once per Business Date)
    await markAuditAlerted(pool, tenant.schemaName, o.propertyId, o.businessDate);
    const staff = users.filter((u) => !u.pendingInvitation && can({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "run_night_audit", o.propertyId));
    for (const u of staff) {
      await publishNotification(pool, {
        tenantId: tenant.id,
        userId: u.id,
        kind: "night_audit.overdue",
        title: `Night Audit overdue · ${o.name} · ${o.businessDate}${o.behind > 1 ? ` (${o.behind} days behind)` : ""}`,
        href: "/night-audit",
      });
    }
  }
  return overdue.length;
}
