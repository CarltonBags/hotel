import { cache } from "react";
import { redirect } from "next/navigation";
import { can, canAtAnyProperty, canViewAnyProperty, type Action, type Actor, type PropertyAction } from "@hoteloftware/domain";
import { listProperties, loadActor, type Property, type Tenant } from "@hoteloftware/db";
import type { TenantSession } from "@hoteloftware/auth";
import { pool } from "./db";
import { currentSession } from "./tenant";

export class ForbiddenError extends Error {
  constructor(action: Action, propertyId?: string) {
    super(`Not allowed: ${action}${propertyId ? ` at property ${propertyId}` : ""}`);
    this.name = "ForbiddenError";
  }
}

export interface Principal {
  tenant: Tenant;
  session: TenantSession;
  actor: Actor;
}

/** The signed-in user with their roles, or a redirect to the sign-in page. */
export const requirePrincipal = cache(async (): Promise<Principal> => {
  const current = await currentSession();
  if (!current) redirect("/sign-in");
  const actor = await loadActor(pool(), current.tenant.id, current.session.user.id);
  return { ...current, actor };
});

/**
 * The one permission check every server action and page goes through.
 * Throws ForbiddenError; server actions turn that into a form error.
 */
export async function authorize(action: Action, propertyId?: string): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!can(principal.actor, action, propertyId)) throw new ForbiddenError(action, propertyId);
  return principal;
}

/**
 * For pages: the same check, but a denied user lands on the "not allowed"
 * page instead of a server error. Server actions use authorize() directly.
 */
export async function requireAllowed(action: Action, propertyId?: string): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!can(principal.actor, action, propertyId)) redirect("/not-allowed");
  return principal;
}

/** Properties the signed-in user may open: all for tenant roles, otherwise those with a property role. */
export const accessibleProperties = cache(async (): Promise<Property[]> => {
  const { tenant, actor } = await requirePrincipal();
  if (!canViewAnyProperty(actor)) return [];
  const all = await listProperties(pool(), tenant.schemaName);
  return all.filter((p) => can(actor, "view_property", p.id));
});

/** For tenant-wide records (Guest profiles, Companies): the action must be allowed at some property. Throws for server actions. */
export async function authorizeAnywhere(action: PropertyAction): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!canAtAnyProperty(principal.actor, action)) throw new ForbiddenError(action);
  return principal;
}

/** Page variant of authorizeAnywhere: redirects to /not-allowed. */
export async function requireAllowedAnywhere(action: PropertyAction): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!canAtAnyProperty(principal.actor, action)) redirect("/not-allowed");
  return principal;
}
