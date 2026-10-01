import type { PropertyAction } from "@hoteloftware/domain";
import { findProperty } from "@hoteloftware/db";
import { authorize } from "./authorize";
import { pool } from "./db";

/** A server action's property: the caller must hold the action there, and the property must exist in the tenant. */
export async function propertyFor(action: PropertyAction, propertyId: string) {
  const { tenant, session } = await authorize(action, propertyId);
  const property = await findProperty(pool(), tenant.schemaName, propertyId);
  if (!property) throw new Error("Property not found");
  return { schema: tenant.schemaName, property, userId: session.user.id };
}
