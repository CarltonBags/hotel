import { listProperties, loadActor, type Tenant } from "@hoteloftware/db";
import { can, cleanlinessScope, type Actor } from "@hoteloftware/domain";
import type { TenantSession } from "@hoteloftware/auth";
import { pool } from "./db";
import { currentSession } from "./tenant";

export interface FloorContext {
  tenant: Tenant;
  session: TenantSession;
  actor: Actor;
  propertyId: string;
}

/** May work the phone view at the property: cleans rooms, or works the Maintenance queue. */
export function worksTheFloor(actor: Actor, propertyId: string): boolean {
  return cleanlinessScope(actor, propertyId, "clean") !== "none" || can(actor, "work_maintenance", propertyId);
}

/**
 * Who uses the phone view and at which property: on an enrolled Device its
 * property; otherwise the first property where the user works the floor.
 * Null when signed out or without such a role. Server only.
 */
export async function floorContext(): Promise<FloorContext | null> {
  const current = await currentSession();
  // a first or reset PIN is changed before anything else
  if (!current || current.session.device?.mustChange) return null;
  const actor = await loadActor(pool(), current.tenant.id, current.session.user.id);
  const propertyId =
    current.session.device?.propertyId ?? (await listProperties(pool(), current.tenant.schemaName)).find((p) => worksTheFloor(actor, p.id))?.id;
  if (!propertyId || !worksTheFloor(actor, propertyId)) return null;
  return { ...current, actor, propertyId };
}
