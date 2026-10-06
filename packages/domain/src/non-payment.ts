import type { Action } from "./permissions";

/**
 * Non-payment of the subscription (ticket 89, "Onboarding and
 * subscription"): never a sudden lockout, because a hotel cannot stop checking
 * guests in. The stage follows the days the oldest unpaid invoice is overdue.
 */
export const NON_PAYMENT_STAGES = ["none", "reminders", "restricted", "no_new_bookings", "termination"] as const;
export type NonPaymentStage = (typeof NON_PAYMENT_STAGES)[number];

/** 0 to 30 days: reminders; 30 to 60: banner, settings and reports locked; from 60: no new reservations from booking page and channels; from 90: termination by us. Each stage starts on its day. */
export function nonPaymentStage(daysOverdue: number | null): NonPaymentStage {
  if (daysOverdue === null || daysOverdue <= 0) return "none";
  if (daysOverdue < 30) return "reminders";
  if (daysOverdue < 60) return "restricted";
  if (daysOverdue < 90) return "no_new_bookings";
  return "termination";
}

/** The days overdue on which the Owner is reminded. */
export const REMINDER_DAYS = [1, 10, 20, 30] as const;

const rank = (s: NonPaymentStage) => NON_PAYMENT_STAGES.indexOf(s);
export const atLeast = (s: NonPaymentStage, than: NonPaymentStage) => rank(s) >= rank(than);

/**
 * Settings and reports are locked from the restricted stage; operations
 * continue (users, devices, the cash desk and downtime lists among them),
 * the subscription screens and the export stay open.
 */
const LOCKED: readonly Action[] = [
  "manage_legal_entities",
  "manage_properties",
  "manage_tenant_roles",
  "manage_tenant_settings",
  "manage_modules",
  "go_live",
  "manage_property_settings",
  "manage_service_prices",
  "manage_tax_codes",
  "manage_payment_settings",
  "manage_budget",
  "view_budget",
  "view_revenue_reports",
  "view_financial_reports",
  "view_housekeeping_reports",
  "use_report_builder",
];

export function lockedByNonPayment(stage: NonPaymentStage, action: Action): boolean {
  return atLeast(stage, "restricted") && LOCKED.includes(action);
}

/** Reservations from the booking page and channels stop after day 60; those already made can be handled and invoiced. */
export function acceptsOnlineReservations(stage: NonPaymentStage): boolean {
  return !atLeast(stage, "no_new_bookings");
}

/** A tenant's data is deleted this many days after its end; backups follow within 30 more. */
export const TENANT_DELETION_DAYS = 90;
