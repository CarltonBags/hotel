/**
 * Roles and the permission matrix (decided in "Tenancy, property and role model",
 * "Permission matrix for fixed roles" and "Permissions for cash, vouchers and
 * outlet roles"). Fixed roles, fixed permissions, no custom roles in v1.
 * Rows are added here as the tickets that need them land.
 */

export const TENANT_ROLES = ["owner", "tenant_admin"] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const PROPERTY_ROLES = [
  "property_manager",
  "front_desk",
  "housekeeper",
  "housekeeping_supervisor",
  "maintenance",
  "accounting",
  "revenue",
  "service",
  "spa_staff",
  "outlet_manager",
] as const;
export type PropertyRole = (typeof PROPERTY_ROLES)[number];

/** English labels; the German words come from docs/glossary/german-terms.md when ticket 12 wires languages. */
export const ROLE_LABELS: Record<TenantRole | PropertyRole, { en: string }> = {
  owner: { en: "Owner" },
  tenant_admin: { en: "Tenant Admin" },
  property_manager: { en: "Property Manager" },
  front_desk: { en: "Front Desk" },
  housekeeper: { en: "Housekeeper" },
  housekeeping_supervisor: { en: "Housekeeping Supervisor" },
  maintenance: { en: "Maintenance" },
  accounting: { en: "Accounting" },
  revenue: { en: "Revenue" },
  service: { en: "Service" },
  spa_staff: { en: "Spa Staff" },
  outlet_manager: { en: "Outlet Manager" },
};

export interface PropertyRoleAssignment {
  propertyId: string;
  role: PropertyRole;
}

/** Everything the permission check needs to know about the signed-in user. */
export interface Actor {
  tenantRole?: TenantRole | undefined;
  propertyRoles: PropertyRoleAssignment[];
}

/** Actions decided at tenant level: no property involved. */
export const TENANT_ACTIONS = {
  manage_legal_entities: ["owner", "tenant_admin"],
  manage_properties: ["owner", "tenant_admin"],
  manage_tenant_roles: ["owner", "tenant_admin"],
  manage_tenant_settings: ["owner", "tenant_admin"],
  manage_subscription: ["owner"],
  delete_tenant: ["owner"],
} as const satisfies Record<string, readonly TenantRole[]>;
export type TenantAction = keyof typeof TENANT_ACTIONS;

/** Actions decided per property: which property roles hold them there. */
export const PROPERTY_ACTIONS = {
  view_property: [...PROPERTY_ROLES],
  manage_property_users: ["property_manager"],
  manage_property_settings: ["property_manager"],
  /** Service catalogue: prices (permission matrix row "Service catalogue: prices"). */
  manage_service_prices: ["property_manager", "revenue"],
  /** Service catalogue: Tax Codes and revenue accounts; Tax Codes of the Legal Entity. */
  manage_tax_codes: ["property_manager", "accounting"],
} as const satisfies Record<string, readonly PropertyRole[]>;
export type PropertyAction = keyof typeof PROPERTY_ACTIONS;

export type Action = TenantAction | PropertyAction;

export function isTenantAction(action: Action): action is TenantAction {
  return action in TENANT_ACTIONS;
}

/** Owner and Tenant Admin hold Property Manager rights on every current and future property. */
function actsAsPropertyManagerEverywhere(actor: Actor): boolean {
  return actor.tenantRole !== undefined;
}

/** The roles the actor holds at one property, including the implied Property Manager. */
export function rolesAt(actor: Actor, propertyId: string): PropertyRole[] {
  const roles = new Set<PropertyRole>(actor.propertyRoles.filter((r) => r.propertyId === propertyId).map((r) => r.role));
  if (actsAsPropertyManagerEverywhere(actor)) roles.add("property_manager");
  return [...roles];
}

/**
 * The one permission check. Roles add up: a user holding several roles may do
 * whatever any of them may do.
 */
export function can(actor: Actor, action: Action, propertyId?: string): boolean {
  if (isTenantAction(action)) {
    const allowed: readonly TenantRole[] = TENANT_ACTIONS[action];
    return actor.tenantRole !== undefined && allowed.includes(actor.tenantRole);
  }
  if (!propertyId) return false;
  const allowed: readonly PropertyRole[] = PROPERTY_ACTIONS[action];
  return rolesAt(actor, propertyId).some((role) => allowed.includes(role));
}

/** True when the actor may see the property at all (any role there, or a tenant role). */
export function canViewAnyProperty(actor: Actor): boolean {
  return actor.tenantRole !== undefined || actor.propertyRoles.length > 0;
}
