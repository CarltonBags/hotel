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
  soon("calendar", "front_desk", "module.calendar", "CalendarDays", "#7c5cff", 23),
  soon("arrivals", "front_desk", "module.arrivals", "LogIn", "#1fa971", 25),
  soon("departures", "front_desk", "module.departures", "LogOut", "#e0900b", 25),
  soon("registration", "front_desk", "module.registration", "FileSignature", "#4f5bd5", 45),
  soon("house_list", "lists", "module.house_list", "List", "#6b7280", 25),
  soon("breakfast_list", "lists", "module.breakfast_list", "Coffee", "#b98900", 25),
  soon("in_house", "lists", "module.in_house", "BedDouble", "#0aa5a5", 25),
  soon("downtime_reports", "lists", "module.downtime_reports", "Printer", "#6b7280", 86),
  soon("cash_book", "cash_billing", "module.cash_book", "Wallet", "#1fa971", 50),
  soon("open_folios", "cash_billing", "module.open_folios", "Receipt", "#0071e3", 26),
  soon("invoices", "cash_billing", "module.invoices", "FileText", "#4f5bd5", 28),
  soon("payments", "cash_billing", "module.payments", "CreditCard", "#e0457b", 27),
  soon("night_audit", "cash_billing", "module.night_audit", "MoonStar", "#7c5cff", 32),
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
  soon("city_tax_report", "reports", "module.city_tax_report", "Landmark", "#6b7280", 30),
  soon("outlets", "front_desk", "module.outlets", "UtensilsCrossed", "#e2552b", 60),
  { id: "settings_tenant", group: "settings", label: "module.settings_tenant", icon: "Palette", hue: "#0071e3", href: "/settings/tenant", requires: "manage_tenant_settings" },
  { id: "settings_legal_entities", group: "settings", label: "module.settings_legal_entities", icon: "Landmark", hue: "#4f5bd5", href: "/settings/legal-entities", requires: "manage_legal_entities" },
  { id: "settings_properties", group: "settings", label: "module.settings_properties", icon: "Building2", hue: "#1fa971", href: "/settings/properties", requires: "manage_properties" },
  { id: "settings_users", group: "settings", label: "module.settings_users", icon: "Users", hue: "#7c5cff", href: "/settings/users", requiresProperty: "manage_property_users" },
  { id: "settings_services", group: "settings", label: "module.settings_services", icon: "Tag", hue: "#e0457b", href: "/settings/services", requiresProperty: "view_property" },
  { id: "settings_rate_plans", group: "settings", label: "module.settings_rate_plans", icon: "Tag", hue: "#e0457b", href: "/settings/rate-plans", requiresProperty: "manage_rates" },
  soon("settings_devices", "settings", "module.settings_devices", "TabletSmartphone", "#6b7280", 14),
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
