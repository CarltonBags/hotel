// PROTOTYPE mock data. In memory only.
export type TabKind =
  | "dashboard" | "arrivals" | "calendar" | "housekeeping" | "rates" | "inbox" | "reports"
  | "reservation" | "guest" | "list";

export type Tab = { id: string; kind: TabKind; title: string; sub?: string };

export const PROPERTIES = [
  { id: "all", name: "All properties", city: "3 hotels", rooms: 696 },
  { id: "muc", name: "Hotel Isartor", city: "München", rooms: 212 },
  { id: "ber", name: "Spreehof Berlin", city: "Berlin", rooms: 388 },
  { id: "vie", name: "Haus am Ring", city: "Wien", rooms: 96 },
];

export const MODULES: { kind: TabKind; label: string }[] = [
  { kind: "dashboard", label: "Today" },
  { kind: "calendar", label: "Calendar" },
  { kind: "arrivals", label: "Arrivals" },
  { kind: "housekeeping", label: "Housekeeping" },
  { kind: "rates", label: "Rates" },
  { kind: "inbox", label: "Guest Inbox" },
  { kind: "reports", label: "Reports" },
];

export const INBOX_UNREAD = 3;

export type Arrival = {
  id: string; guest: string; roomType: string; room: string | null; nights: number; pax: string;
  source: string; balance: number; status: "Confirmed" | "Checked-in" | "Pre-check-in done"; country: string;
};

export const ARRIVALS: Arrival[] = [
  { id: "R-48211", guest: "Marta Kowalska", roomType: "Double Superior", room: "214", nights: 3, pax: "2", source: "Booking.com", balance: 0, status: "Pre-check-in done", country: "PL" },
  { id: "R-48217", guest: "Jonas Weidmann", roomType: "Single", room: null, nights: 1, pax: "1", source: "Direct", balance: 129, status: "Confirmed", country: "DE" },
  { id: "R-48220", guest: "Aiko Tanaka", roomType: "Junior Suite", room: "501", nights: 5, pax: "2 + 1 (6)", source: "Booking Engine", balance: 1240, status: "Confirmed", country: "JP" },
  { id: "R-48224", guest: "Pierre Lefèvre", roomType: "Double", room: "118", nights: 2, pax: "2", source: "Expedia", balance: 0, status: "Checked-in", country: "FR" },
  { id: "R-48229", guest: "Sofia Almeida", roomType: "Double", room: null, nights: 4, pax: "2", source: "Direct", balance: 412, status: "Confirmed", country: "PT" },
  { id: "R-48233", guest: "Henrik Larsen", roomType: "Twin", room: "322", nights: 2, pax: "2", source: "HRS", balance: 0, status: "Confirmed", country: "DK" },
  { id: "R-48236", guest: "Layla Haddad", roomType: "Double Superior", room: null, nights: 7, pax: "2 + 2 (3, 9)", source: "Booking Engine", balance: 980, status: "Confirmed", country: "AE" },
  { id: "R-48240", guest: "Tomás Ortega", roomType: "Single", room: "109", nights: 1, pax: "1", source: "Direct", balance: 0, status: "Checked-in", country: "ES" },
];

export const CONVERSATIONS = [
  { id: "c1", guest: "Aiko Tanaka", res: "R-48220", last: "Is early check-in at 11:00 possible?", time: "09:42", unread: 2 },
  { id: "c2", guest: "Layla Haddad", res: "R-48236", last: "We need a baby cot, please.", time: "09:10", unread: 1 },
  { id: "c3", guest: "Marta Kowalska", res: "R-48211", last: "Thank you, see you tonight!", time: "Yesterday", unread: 0 },
  { id: "c4", guest: "Henrik Larsen", res: "R-48233", last: "Parking reserved, confirmed.", time: "Yesterday", unread: 0 },
];

export const INITIAL_TABS: Tab[] = [
  { id: "dashboard", kind: "dashboard", title: "Today" },
  { id: "calendar", kind: "calendar", title: "Calendar" },
  { id: "R-48220", kind: "reservation", title: "Aiko Tanaka", sub: "R-48220" },
];

// Round 2 additions
export const QUICK: TabKind[] = ["dashboard", "calendar", "arrivals", "housekeeping", "inbox"];

export const HUE: Record<TabKind, string> = {
  dashboard: "#0071e3", calendar: "#7c5cff", arrivals: "#1fa971", housekeeping: "#e0900b", rates: "#e0457b",
  inbox: "#0aa5a5", reports: "#4f5bd5", reservation: "#0071e3", guest: "#7c5cff", list: "#6b7280",
};

export const ACCENTS = [
  { id: "ocean", label: "Ocean", light: "#0071e3", dark: "#4c9dff" },
  { id: "alpine", label: "Alpine", light: "#0a8f7a", dark: "#3fd0b6" },
  { id: "sunset", label: "Sunset", light: "#e2552b", dark: "#ff8a5c" },
  { id: "plum", label: "Plum", light: "#7c3aed", dark: "#a98bff" },
];

export type MenuItem = { label: string; kind?: TabKind };
export const MAIN_MENU: { group: string; icon: string; items: MenuItem[] }[] = [
  { group: "Front desk", icon: "DoorOpen", items: [{ label: "Today", kind: "dashboard" }, { label: "Calendar", kind: "calendar" }, { label: "Arrivals", kind: "arrivals" }, { label: "Departures" }, { label: "Walk-in" }, { label: "Meldeschein queue" }] },
  { group: "Lists", icon: "List", items: [{ label: "House list" }, { label: "Breakfast list" }, { label: "Arrivals list" }, { label: "Departures list" }, { label: "Housekeeping list" }, { label: "No-show list" }, { label: "Birthday list" }] },
  { group: "Cash and billing", icon: "Wallet", items: [{ label: "Kassenbuch" }, { label: "Open folios" }, { label: "Invoices" }, { label: "Payments" }, { label: "Night audit" }] },
  { group: "Rates and availability", icon: "Tag", items: [{ label: "Rates", kind: "rates" }, { label: "Restrictions" }, { label: "Availability" }, { label: "Channel sync status" }] },
  { group: "Guests", icon: "Users", items: [{ label: "Guest profiles" }, { label: "Companies" }, { label: "Guest Inbox", kind: "inbox" }] },
  { group: "Housekeeping", icon: "Sparkles", items: [{ label: "Room status", kind: "housekeeping" }, { label: "Tasks" }, { label: "Maintenance" }, { label: "Lost and found" }] },
  { group: "Reports", icon: "ChartColumn", items: [{ label: "Overview", kind: "reports" }, { label: "Occupancy" }, { label: "Revenue" }, { label: "Channel mix" }, { label: "City tax" }] },
  { group: "Settings", icon: "Settings", items: [{ label: "Property" }, { label: "Users and roles" }, { label: "Devices" }, { label: "Room types and rooms" }] },
];
