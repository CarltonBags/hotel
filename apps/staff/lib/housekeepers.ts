import { listTenantUsers } from "@hoteloftware/db";
import { pool } from "./db";

/** The property's Housekeepers (accepted users holding the role there): the people the plan gives tasks to. Server only. */
export async function housekeepersAt(tenantId: string, propertyId: string): Promise<{ id: string; name: string }[]> {
  return (await listTenantUsers(pool(), tenantId))
    .filter((u) => !u.pendingInvitation && u.propertyRoles.some((r) => r.propertyId === propertyId && r.role === "housekeeper"))
    .map((u) => ({ id: u.id, name: u.name }));
}
