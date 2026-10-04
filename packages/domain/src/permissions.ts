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
  /** Matrix "Issue invoice". */
  issue_invoices: ["property_manager", "front_desk", "accounting"],
  /** Correct an issued invoice by a Cancellation Invoice and a new one (matrix "Cancellation invoice"). */
  correct_invoices: ["property_manager", "front_desk", "accounting"],
  /** Matrix "Receivables (matching payments, reminders)". */
  manage_receivables: ["property_manager", "accounting"],
  /** Check-out with balances open: a Manager's decision (Front Desk would need an Approval, ticket 31). */
  override_check_out: ["property_manager"],
  /** Matrix "Price Override at or above Price Floor"; below the floor and complimentary need an Approval. */
  override_prices: ["property_manager", "front_desk"],
  /** Approve another user's action beyond their limit (matrix "Approval"). */
  approve_requests: ["property_manager"],
  /** Matrix "Property-wide audit log": Accounting sees its money entries. */
  view_audit_log: ["property_manager", "accounting"],
  view_full_audit_log: ["property_manager"],
  /** Matrix "Run Night Audit". */
  run_night_audit: ["property_manager", "front_desk"],
  /** Matrix "Run Night Audit": Accounting views the result; reports kept under Reports. */
  view_night_audit_reports: ["property_manager", "accounting"],
  /** Matrix "Room Block: Out of Service". */
  manage_out_of_service: ["property_manager", "front_desk", "housekeeping_supervisor", "maintenance"],
  /** Matrix "Room Block: Out of Order". */
  manage_out_of_order: ["property_manager", "housekeeping_supervisor", "maintenance"],
  /** Matrix "Generate, assign, publish Housekeeping Tasks; Sections". */
  assign_housekeeping: ["property_manager", "housekeeping_supervisor"],
  /** Matrix "View Cleanliness and Room Blocks" (a Housekeeper only own rooms: roomViewScope). */
  view_rooms: ["property_manager", "front_desk", "housekeeping_supervisor", "housekeeper", "maintenance"],
  /** Report a Maintenance Issue (decided: anyone at the property; the queue and file storage come with ticket 36). */
  report_maintenance_issues: ["property_manager", "front_desk", "housekeeping_supervisor", "housekeeper", "maintenance", "service", "spa_staff"],
  /** Work the Maintenance queue: take an issue, mark it fixed. */
  work_maintenance: ["property_manager", "maintenance"],
  /** Record an item found in a room (Lost and Found). */
  record_lost_items: ["property_manager", "front_desk", "housekeeping_supervisor", "housekeeper", "maintenance"],
  /** See Lost and Found. */
  view_lost_items: ["property_manager", "front_desk", "housekeeping_supervisor"],
  /** Count the minibar on the room sheet; posted as Charges to the stay in the room. */
  post_minibar: ["property_manager", "front_desk", "housekeeping_supervisor", "housekeeper"],
  /** Housekeeping Notes on a reservation for floor staff. */
  manage_housekeeping_notes: ["property_manager", "front_desk", "housekeeping_supervisor"],
  /** Matrix "Open and close a Shift at the desk; take cash, refund cash" (desk cash, ticket 50). */
  handle_cash: ["property_manager", "front_desk"],
  /** Matrix "Paid-out": Front Desk up to the property limit, above it with Approval. */
  paid_out: ["property_manager", "front_desk"],
  paid_out_without_limit: ["property_manager"],
  /** Matrix "Bank deposit, transfer between registers; view all Cash Books". */
  manage_cash: ["property_manager", "accounting"],
  /** Official tourism statistics: the monthly report, its submission, the statistical settings and opening calendar. */
  tourism_statistics: ["property_manager"],
  /** Leave a stay out of the statistics with a reason (refugees, stays over a year). */
  exclude_from_statistics: ["property_manager", "front_desk"],
  /** The cash desk page: the desk for its own Shift, Property Manager and Accounting for every register. */
  view_cash_desk: ["property_manager", "front_desk", "accounting"],
  /** The property's cash desk: on or off, Cash Registers, tolerance and Paid-out limit. */
  manage_cash_desk: ["property_manager"],
  /** Enrol and revoke Devices of the property, choose who signs in on them (Property Manager). */
  manage_devices: ["property_manager"],
  /** Create Housekeeper users, reset their PIN and unlock them (amendment "Shared-device login"); the Property Manager for every user. */
  manage_floor_users: ["property_manager", "housekeeping_supervisor"],
  /** Matrix "Financial reports, City Tax report". */
  view_financial_reports: ["property_manager", "accounting"],
  /** Card terminals of the property, its refund limit, and onboarding its Legal Entity with the payment provider. */
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
