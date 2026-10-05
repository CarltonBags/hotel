import type { Pool } from "pg";
import { can } from "@hoteloftware/domain";
import { connectedProperties, listTenantUsers, pushChannels } from "@hoteloftware/db";
import { notifyStaff } from "@hoteloftware/events";
import type { ChannelManager } from "@hoteloftware/channels";

/**
 * The channel push (ticket 37): every minute, each connected property's
 * waiting changes go to the channel manager. A failure keeps them for the
 * next run and tells Revenue and the Property Manager once per streak.
 */
export async function pushTenantChannels(pool: Pool, tenant: { id: string; schemaName: string }, manager: ChannelManager): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const propertyId of await connectedProperties(pool, tenant.schemaName)) {
    const r = await pushChannels(pool, tenant.schemaName, propertyId, manager);
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
