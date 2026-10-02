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
  /** Payment accounts of the Legal Entities (onboarding with the payment provider); Legal Entities are tenant matters. */
  manage_payment_accounts: ["owner", "tenant_admin"],
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
  /** Rate Plans, policies, Rates, Restrictions and Price Floors (permission matrix rows "Rates"). */
  manage_rates: ["property_manager", "revenue"],
  /** Guest profiles are tenant-wide (ADR 0004): a right at any property counts, see canAtAnyProperty. Matrix row "View and edit Guest profile": Accounting views. */
  view_guests: ["property_manager", "front_desk", "accounting"],
  /** Contact data, address, birth date and identity document wherever a guest appears; Revenue sees reservations with "no contact details". */
  view_guest_contacts: ["property_manager", "front_desk", "accounting"],
  edit_guests: ["property_manager", "front_desk"],
  merge_guests: ["property_manager", "front_desk"],
  /** Companies: not in the matrix; viewing follows guests, editing billing data and payment terms adds Accounting (assumption, ticket 20). */
  view_companies: ["property_manager", "front_desk", "accounting"],
  /** Matrix "View reservation": Revenue without contact details and folio; floor view for housekeeping comes with its tickets. */
  view_reservations: ["property_manager", "front_desk", "accounting", "revenue"],
  /** Matrix "Create, edit, cancel reservation". */
  manage_reservations: ["property_manager", "front_desk"],
  /** Matrix "View folio". */
  view_folio: ["property_manager", "front_desk", "accounting"],
  /** Matrix "Check-in, check-out". */
  check_in: ["property_manager", "front_desk"],
  /** Matrix "Post Charge from Service catalogue" (minibar for housekeeping comes with its ticket). */
  post_charges: ["property_manager", "front_desk", "accounting"],
  /** Matrix "Post free-text Charge". */
  post_free_text_charges: ["property_manager"],
  /** Matrix "Void uninvoiced Charge (reason)", "Move Charge between folios"; adding a Folio and routing go with them. */
  manage_folios: ["property_manager", "front_desk", "accounting"],
  /** Matrix "Operational lists (house, arrivals, departures, breakfast)"; housekeeping lists come with their tickets. */
  view_operational_lists: ["property_manager", "front_desk"],
  edit_companies: ["property_manager", "front_desk", "accounting"],
  /** Matrix "Take Payment"; Card Holds go with it (not in the matrix: assumption, ticket 27). */
  take_payments: ["property_manager", "front_desk", "accounting"],
  /** Matrix "Refund": Front Desk up to the property limit, above it with Approval. */
  refund_payments: ["property_manager", "front_desk", "accounting"],
  /** Matrix "Refund" without limit. */
  refund_without_limit: ["property_manager", "accounting"],
  /** Card terminals of the property and its refund limit. */
  manage_payment_settings: ["property_manager"],
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

/**
 * For tenant-wide records (Guest profiles, Companies): allowed when the
 * action is allowed at any property the actor holds a role at. Owner and
 * Tenant Admin act as Property Manager everywhere.
 */
export function canAtAnyProperty(actor: Actor, action: PropertyAction): boolean {
  if (actor.tenantRole !== undefined) return can(actor, action, "*");
  return actor.propertyRoles.some((r) => can(actor, action, r.propertyId));
}

/** True when the actor may see the property at all (any role there, or a tenant role). */
export function canViewAnyProperty(actor: Actor): boolean {
  return actor.tenantRole !== undefined || actor.propertyRoles.length > 0;
}
