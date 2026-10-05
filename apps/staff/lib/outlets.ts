import { listProperties, loadActor, outletProperty, type Tenant } from "@hoteloftware/db";
import type { TenantSession } from "@hoteloftware/auth";
import { can, type Actor, type PropertyAction } from "@hoteloftware/domain";
import { authorize, requirePrincipal } from "./authorize";
import { pool } from "./db";
import { moduleOn } from "./modules";
import { currentSession } from "./tenant";

/** The Point of Sale Module is on at the property (ticket 60). Server only. */
export async function outletsModuleOn(schema: string, propertyId: string): Promise<boolean> {
  return moduleOn(schema, propertyId, "point_of_sale");
}

/** An outlet (or one of its bills) acted on: the one permission check at its property, and the Point of Sale Module on there. */
export async function authorizeOutlet(action: PropertyAction, ref: { outletId?: string; billId?: string; propertyId?: string }) {
  const { tenant } = await requirePrincipal();
  const propertyId = ref.propertyId ?? (await outletProperty(pool(), tenant.schemaName, ref));
  if (!propertyId) throw new Error("Outlet not found");
  const principal = await authorize(action, propertyId);
  if (!(await outletsModuleOn(tenant.schemaName, propertyId))) throw new Error("The Point of Sale Module is not on for this property");
  return { ...principal, propertyId, viewer: { userId: principal.session.user.id, actor: principal.actor, name: principal.session.user.name } };
}

/** Works at an outlet of the property: serves, takes money, or manages one. */
export function worksAnOutlet(actor: Actor, propertyId: string): boolean {
  return can(actor, "serve_outlet", propertyId) || can(actor, "outlet_cash", propertyId) || can(actor, "manage_own_outlets", propertyId);
}

export interface OutletAppContext {
  tenant: Tenant;
  session: TenantSession;
  actor: Actor;
  /** On an enrolled Device its property; otherwise every property where the user works an outlet. */
  propertyIds: string[];
}

/** Who uses the outlet app (phone, tablet or fixed till), with a password or a PIN Sign-in. Null when signed out or without an outlet role. Server only. */
export async function outletAppContext(): Promise<OutletAppContext | null> {
  const current = await currentSession();
  if (!current || current.session.device?.mustChange) return null;
  const actor = await loadActor(pool(), current.tenant.id, current.session.user.id);
  const all = current.session.device?.propertyId ? [current.session.device.propertyId] : (await listProperties(pool(), current.tenant.schemaName)).map((p) => p.id);
  const propertyIds = all.filter((id) => worksAnOutlet(actor, id));
  return propertyIds.length ? { ...current, actor, propertyIds } : null;
}
