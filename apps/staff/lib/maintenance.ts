import { findTenantUser, type FixedIssue } from "@hoteloftware/db";
import { notifyStaff } from "@hoteloftware/events";
import { pool } from "./db";

/** The reporter hears that their Maintenance Issue is fixed (ticket 36). */
export async function notifyFixed(tenant: { id: string; schemaName: string }, fixed: FixedIssue): Promise<void> {
  const reporter = await findTenantUser(pool(), tenant.id, fixed.reportedBy);
  if (!reporter) return;
  const what = `${fixed.roomNumber ? `Room ${fixed.roomNumber}` : fixed.place} · ${fixed.pick}`;
  await notifyStaff(pool(), tenant, [reporter], { kind: "maintenance.fixed", title: `Fixed: ${what}`, href: "/maintenance?show=done", propertyId: null }).catch((err) => console.error("notification not sent", err));
}
