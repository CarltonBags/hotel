import type { Pool } from "pg";
import { claimIncidentsToAlert, listTenantUsers, queueMail } from "@hoteloftware/db";
import { canAtAnyProperty } from "@hoteloftware/domain";
import { publishNotification } from "@hoteloftware/events";

/**
 * An outage on our side (ticket 86): a major incident reported on the status
 * page reaches every customer's Property Managers in the app and by email
 * (queued; SMS comes with the messaging provider). Each incident is claimed
 * before alerting, so a retry never alerts twice; one tenant failing does
 * not keep the others from hearing.
 */
export async function alertMajorIncidents(pool: Pool, options: { platformSlug: string; statusUrl: string }): Promise<number> {
  const incidents = await claimIncidentsToAlert(pool);
  if (!incidents.length) return 0;
  const { rows: tenants } = await pool.query<{ id: string; schema_name: string; slug: string }>("select id, schema_name, slug from control.tenants where slug <> $1", [options.platformSlug]);
  let n = 0;
  for (const incident of incidents) {
    for (const t of tenants) {
      try {
        const managers = (await listTenantUsers(pool, t.id)).filter((u) => !u.pendingInvitation && canAtAnyProperty({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "manage_downtime"));
        for (const u of managers) {
          await publishNotification(pool, { tenantId: t.id, userId: u.id, kind: "service.outage", title: `Service outage: ${incident.title}`, body: incident.message, href: "/catch-up" });
          await queueMail(pool, t.schema_name, { tenantId: t.id, toUserId: u.id, subject: `Hoteloftware outage: ${incident.title}`, body: `${incident.message}\n\nStatus: ${options.statusUrl}\nAfterwards, enter what happened on paper under "Catch-up after outage".` });
          n++;
        }
      } catch (err) {
        console.error(`[outage] alerting ${t.slug} failed`, err);
      }
    }
  }
  return n;
}
