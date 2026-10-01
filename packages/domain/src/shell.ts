import type { Actor } from "./permissions";
import { rolesAt } from "./permissions";

/** Tenant accent colours; both themes derive from the choice. Ocean is the product default. */
export const ACCENTS = {
  ocean: { label: "Ocean", light: "#0071e3", dark: "#4c9dff" },
  alpine: { label: "Alpine", light: "#0a8f7a", dark: "#3fd0b6" },
  sunset: { label: "Sunset", light: "#e2552b", dark: "#ff8a5c" },
  plum: { label: "Plum", light: "#7c3aed", dark: "#a98bff" },
} as const;
export type AccentId = keyof typeof ACCENTS;
export const DEFAULT_ACCENT: AccentId = "ocean";

export function isAccentId(value: string): value is AccentId {
  return value in ACCENTS;
}

export type Theme = "light" | "dark" | "system";
export function isTheme(value: string): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Default Quick Access per role (decided in "App shell and multi-tab navigation
 * prototype": defaults per role, then per-user configurable). Module ids match
 * the staff app's module registry.
 */
export function defaultQuickAccess(actor: Actor, propertyIds: string[]): string[] {
  const roles = new Set(propertyIds.flatMap((id) => rolesAt(actor, id)));
  if (actor.tenantRole) roles.add("property_manager");
  const picks: string[] = ["today"];
  if (roles.has("property_manager") || roles.has("front_desk")) picks.push("calendar", "arrivals", "guest_inbox");
  if (roles.has("housekeeping_supervisor") || roles.has("housekeeper") || roles.has("maintenance")) picks.push("housekeeping");
  if (roles.has("revenue")) picks.push("rates");
  if (roles.has("accounting")) picks.push("invoices", "reports");
  if (roles.has("service") || roles.has("outlet_manager") || roles.has("spa_staff")) picks.push("outlets");
  return [...new Set(picks)].slice(0, 8);
}
