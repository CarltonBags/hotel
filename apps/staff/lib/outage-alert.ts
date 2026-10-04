import { listTenantUsers, queueMail } from "@hoteloftware/db";
import { canAtAnyProperty } from "@hoteloftware/domain";
import { publishNotification } from "@hoteloftware/events";
import { pool } from "./db";
import { env } from "./env";

/**
 * An outage on our side (ticket 86): every customer's Property Managers hear
 * of it in the app and by email (queued; SMS comes with the messaging
 * provider), besides the status page. Server only.
 */
export async function alertPropertyManagers(title: string, message: string): Promise<number> {
  const { rows } = await pool().query<{ id: string; schema_name: string; slug: string }>("select id, schema_name, slug from control.tenants where slug <> $1", [env.platformSlug]);
  let n = 0;
  for (const t of rows) {
    const users = (await listTenantUsers(pool(), t.id)).filter((u) => !u.pendingInvitation && canAtAnyProperty({ tenantRole: u.tenantRole, propertyRoles: u.propertyRoles }, "manage_downtime"));
    for (const u of users) {
      await publishNotification(pool(), { tenantId: t.id, userId: u.id, kind: "service.outage", title: `Service outage: ${title}`, body: message, href: "/catch-up" });
      await queueMail(pool(), t.schema_name, { tenantId: t.id, toUserId: u.id, subject: `Hoteloftware outage: ${title}`, body: `${message}\n\nStatus: ${env.authUrl.replace(/\/$/, "")}/status\nAfterwards, enter what happened on paper under "Catch-up after outage".` });
      n++;
    }
  }
  return n;
}
