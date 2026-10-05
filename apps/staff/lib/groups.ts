import { groupProperty } from "@hoteloftware/db";
import type { PropertyAction } from "@hoteloftware/domain";
import { authorize, requirePrincipal } from "./authorize";
import { pool } from "./db";
import { moduleOn } from "./modules";

/** The Groups Module of the subscription is on at the property (ticket 58). Server only. */
export async function groupsModuleOn(schema: string, propertyId: string): Promise<boolean> {
  return moduleOn(schema, propertyId, "groups");
}

/** A group (or one of its holdings) acted on: the one permission check at its property, and the Groups Module on there. */
export async function authorizeGroup(action: PropertyAction, ref: { groupId?: string; holdingId?: string; propertyId?: string }) {
  const { tenant } = await requirePrincipal();
  const propertyId = ref.propertyId ?? (await groupProperty(pool(), tenant.schemaName, ref));
  if (!propertyId) throw new Error("Group not found");
  const principal = await authorize(action, propertyId);
  if (!(await groupsModuleOn(tenant.schemaName, propertyId))) throw new Error("The Groups Module is not on for this property");
  return { ...principal, propertyId };
}
