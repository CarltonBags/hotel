import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, canAtAnyProperty, canViewAnyProperty, isFrontOfficeOnly, isTenantAction, type Action, type Actor, type PropertyAction } from "@hoteloftware/domain";
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

/** The navbar's property choice: "all" or a property id. */
export const SCOPE_COOKIE = "hs_scope";

/**
 * Front-office users work in one property at a time (ticket 96): the one they
 * hold a role at, or the one chosen after sign-in; "" while not chosen yet.
 * Null for every other user.
 */
export const workingPropertyId = cache(async (): Promise<string | null> => {
  const { actor } = await requirePrincipal();
  if (!isFrontOfficeOnly(actor)) return null;
  const available = await accessibleProperties();
  if (available.length === 1) return available[0]!.id;
  const requested = (await cookies()).get(SCOPE_COOKIE)?.value;
  return available.find((p) => p.id === requested)?.id ?? "";
});

/** Rights plus, for the front office, the property they work in now. */
async function allowed(principal: Principal, action: Action, propertyId?: string): Promise<boolean> {
  if (!can(principal.actor, action, propertyId)) return false;
  if (isTenantAction(action) || propertyId === undefined) return true;
  const working = await workingPropertyId();
  return working === null || working === propertyId;
}

/**
 * The one permission check every server action and page goes through.
 * Throws ForbiddenError; server actions turn that into a form error.
 */
export async function authorize(action: Action, propertyId?: string): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!(await allowed(principal, action, propertyId))) throw new ForbiddenError(action, propertyId);
  return principal;
}

/**
 * For pages: the same check, but a denied user lands on the "not allowed"
 * page instead of a server error. Server actions use authorize() directly.
 */
export async function requireAllowed(action: Action, propertyId?: string): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!(await allowed(principal, action, propertyId))) redirect("/not-allowed");
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
