/**
 * Every list and function the Main Menu offers (decided in "App shell and
 * multi-tab navigation prototype"). Modules not built yet point at a
 * placeholder and name the ticket that builds them. Tickets add their modules
 * here; nothing else in the shell knows them.
 */
import type { Action, PropertyAction } from "@hoteloftware/domain";
import type { MessageKey } from "@/i18n/messages";

export type GroupId = "front_desk" | "lists" | "cash_billing" | "rates" | "guests" | "housekeeping" | "reports" | "settings";

export interface ModuleDef {
  id: string;
  group: GroupId;
  label: MessageKey;
  /** Lucide icon name, resolved in the client. */
  icon: string;
  hue: string;
  href: string;
  /** Build ticket number when the module is not built yet. */
  soon?: number;
  /** Tenant-level action required to see the item. */
  requires?: Action;
  /** Property-level action the user must hold at at least one property to see the item. */
  requiresProperty?: PropertyAction;
}

export const GROUPS: { id: GroupId; label: MessageKey; icon: string }[] = [
  { id: "front_desk", label: "group.front_desk", icon: "DoorOpen" },
  { id: "lists", label: "group.lists", icon: "List" },
  { id: "cash_billing", label: "group.cash_billing", icon: "Wallet" },
  { id: "rates", label: "group.rates", icon: "Tag" },
  { id: "guests", label: "group.guests", icon: "Users" },
  { id: "housekeeping", label: "group.housekeeping", icon: "Sparkles" },
  { id: "reports", label: "group.reports", icon: "ChartColumn" },
  { id: "settings", label: "group.settings", icon: "Settings" },
];

const soon = (id: string, group: GroupId, label: MessageKey, icon: string, hue: string, ticket: number): ModuleDef => ({
  id,
  group,
  label,
  icon,
  hue,
  href: `/soon/${id}`,
  soon: ticket,
});

export const MODULES: ModuleDef[] = [
  { id: "today", group: "front_desk", label: "module.today", icon: "LayoutDashboard", hue: "#0071e3", href: "/" },
  { id: "new_reservation", group: "front_desk", label: "module.new_reservation", icon: "ClipboardList", hue: "#0071e3", href: "/reservations/new", requiresProperty: "manage_reservations" },
  { id: "calendar", group: "front_desk", label: "module.calendar", icon: "CalendarDays", hue: "#7c5cff", href: "/calendar", requiresProperty: "view_reservations" },
  { id: "arrivals", group: "front_desk", label: "module.arrivals", icon: "LogIn", hue: "#1fa971", href: "/lists/arrivals", requiresProperty: "view_operational_lists" },
  { id: "departures", group: "front_desk", label: "module.departures", icon: "LogOut", hue: "#e0900b", href: "/lists/departures", requiresProperty: "view_operational_lists" },
  soon("registration", "front_desk", "module.registration", "FileSignature", "#4f5bd5", 45),
  { id: "house_list", group: "lists", label: "module.house_list", icon: "List", hue: "#6b7280", href: "/lists/house", requiresProperty: "view_operational_lists" },
  { id: "breakfast_list", group: "lists", label: "module.breakfast_list", icon: "Coffee", hue: "#b98900", href: "/lists/breakfast", requiresProperty: "view_operational_lists" },
  { id: "in_house", group: "lists", label: "module.in_house", icon: "BedDouble", hue: "#0aa5a5", href: "/lists/in-house", requiresProperty: "view_operational_lists" },
  soon("downtime_reports", "lists", "module.downtime_reports", "Printer", "#6b7280", 86),
  soon("cash_book", "cash_billing", "module.cash_book", "Wallet", "#1fa971", 50),
  soon("open_folios", "cash_billing", "module.open_folios", "Receipt", "#0071e3", 26),
  { id: "receivables", group: "cash_billing", label: "module.receivables", icon: "FileText", hue: "#4f5bd5", href: "/receivables", requiresProperty: "manage_receivables" },
  { id: "payments", group: "cash_billing", label: "module.payments", icon: "CreditCard", hue: "#e0457b", href: "/payments", requiresProperty: "take_payments" },
  { id: "night_audit", group: "cash_billing", label: "module.night_audit", icon: "MoonStar", hue: "#7c5cff", href: "/night-audit", requiresProperty: "run_night_audit" },
  { id: "approvals", group: "cash_billing", label: "module.approvals", icon: "ClipboardCheck", hue: "#e0900b", href: "/approvals", requiresProperty: "approve_requests" },
  { id: "rates", group: "rates", label: "module.rates", icon: "Tag", hue: "#e0457b", href: "/rates", requiresProperty: "manage_rates" },
  soon("availability", "rates", "module.availability", "Grid3x3", "#0aa5a5", 24),
  soon("channel_sync", "rates", "module.channel_sync", "RefreshCw", "#6b7280", 37),
  { id: "guests", group: "guests", label: "module.guests", icon: "User", hue: "#7c5cff", href: "/guests", requiresProperty: "view_guests" },
  { id: "companies", group: "guests", label: "module.companies", icon: "Building", hue: "#6b7280", href: "/companies", requiresProperty: "view_companies" },
  soon("guest_inbox", "guests", "module.guest_inbox", "MessageCircle", "#0aa5a5", 42),
  soon("housekeeping", "housekeeping", "module.housekeeping", "Sparkles", "#e0900b", 33),
  soon("housekeeping_tasks", "housekeeping", "module.housekeeping_tasks", "ClipboardCheck", "#e0900b", 34),
  soon("maintenance", "housekeeping", "module.maintenance", "Wrench", "#6b7280", 36),
  soon("lost_found", "housekeeping", "module.lost_found", "PackageSearch", "#b98900", 35),
  soon("reports", "reports", "module.reports", "ChartColumn", "#4f5bd5", 82),
  { id: "night_audit_reports", group: "reports", label: "module.night_audit_reports", icon: "MoonStar", hue: "#7c5cff", href: "/night-audit/reports", requiresProperty: "view_night_audit_reports" },
  { id: "audit_log", group: "reports", label: "module.audit_log", icon: "List", hue: "#4f5bd5", href: "/audit-log", requiresProperty: "view_audit_log" },
  { id: "city_tax_report", group: "reports", label: "module.city_tax_report", icon: "Landmark", hue: "#6b7280", href: "/city-tax-report", requiresProperty: "view_financial_reports" },
  soon("outlets", "front_desk", "module.outlets", "UtensilsCrossed", "#e2552b", 60),
  { id: "settings_tenant", group: "settings", label: "module.settings_tenant", icon: "Palette", hue: "#0071e3", href: "/settings/tenant", requires: "manage_tenant_settings" },
  { id: "settings_legal_entities", group: "settings", label: "module.settings_legal_entities", icon: "Landmark", hue: "#4f5bd5", href: "/settings/legal-entities", requires: "manage_legal_entities" },
  { id: "settings_properties", group: "settings", label: "module.settings_properties", icon: "Building2", hue: "#1fa971", href: "/settings/properties", requires: "manage_properties" },
  { id: "settings_users", group: "settings", label: "module.settings_users", icon: "Users", hue: "#7c5cff", href: "/settings/users", requiresProperty: "manage_property_users" },
  { id: "settings_services", group: "settings", label: "module.settings_services", icon: "Tag", hue: "#e0457b", href: "/settings/services", requiresProperty: "view_property" },
  { id: "settings_rate_plans", group: "settings", label: "module.settings_rate_plans", icon: "Tag", hue: "#e0457b", href: "/settings/rate-plans", requiresProperty: "manage_rates" },
  soon("settings_devices", "settings", "module.settings_devices", "TabletSmartphone", "#6b7280", 14),
  { id: "settings_payments", group: "settings", label: "module.settings_payments", icon: "CreditCard", hue: "#635bff", href: "/settings/payments", requiresProperty: "manage_payment_settings" },
  { id: "settings_city_tax", group: "settings", label: "module.settings_city_tax", icon: "Landmark", hue: "#b98900", href: "/settings/city-tax", requiresProperty: "manage_property_settings" },
  { id: "settings_rooms", group: "settings", label: "module.settings_rooms", icon: "BedDouble", hue: "#0aa5a5", href: "/settings/rooms", requiresProperty: "manage_property_settings" },
  { id: "settings_account", group: "settings", label: "module.settings_account", icon: "UserCog", hue: "#6b7280", href: "/settings/account" },
];

export const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m] as const));

/** The module whose href matches a pathname (longest prefix wins; "/" only exactly). */
export function moduleForPath(pathname: string): ModuleDef | undefined {
  let best: ModuleDef | undefined;
  for (const m of MODULES) {
    if (m.href === "/") {
      if (pathname === "/") return m;
      continue;
    }
    if (pathname === m.href || pathname.startsWith(`${m.href}/`)) {
      if (!best || m.href.length > best.href.length) best = m;
    }
  }
  return best;
}
