import { can, type Actor, type PropertyAction } from "./permissions";
import type { CellKind } from "./reports";

/**
 * The report builder (ticket 84, "Reporting scope"): one data set, its
 * columns, filters, grouping and totals; a table, no joins, no formulas.
 * Columns follow the role's rights: a column a role may not see elsewhere is
 * not offered.
 */
export const DATA_SETS = ["room_nights", "reservations", "charges", "payments", "housekeeping_tasks"] as const;
export type DataSet = (typeof DATA_SETS)[number];

/** What a column shows, deciding who may add it: revenue figures (Revenue may), money movements (Accounting and the Property Manager). */
export type Sensitivity = "plain" | "guest" | "contact" | "revenue" | "money";

export interface BuilderColumn {
  key: string;
  label: { en: string; de: string };
  kind: CellKind;
  sensitivity: Sensitivity;
  /** Groupable (text) or summable (numbers). */
  groupable: boolean;
}

const col = (key: string, en: string, de: string, kind: CellKind, sensitivity: Sensitivity = "plain", groupable = kind === "text"): BuilderColumn => ({ key, label: { en, de }, kind, sensitivity, groupable });

export const DATA_SET_COLUMNS: Record<DataSet, BuilderColumn[]> = {
  room_nights: [
    col("date", "Night", "Nacht", "text"),
    col("confirmation", "Confirmation", "Buchungsnummer", "text"),
    col("status", "Status", "Status", "text"),
    col("room_type", "Room type", "Zimmerkategorie", "text"),
    col("rate_plan", "Rate Plan", "Rate", "text"),
    col("source", "Source", "Quelle", "text"),
    col("guest", "Guest", "Gast", "text", "guest"),
    col("country", "Country of residence", "Wohnsitzland", "text"),
    col("price", "Night price (gross)", "Nachtpreis (brutto)", "money", "revenue", false),
    col("nights", "Room nights", "Zimmernächte", "int", "plain", false),
  ],
  reservations: [
    col("confirmation", "Confirmation", "Buchungsnummer", "text"),
    col("status", "Status", "Status", "text"),
    col("arrival", "Arrival", "Anreise", "text"),
    col("departure", "Departure", "Abreise", "text"),
    col("room_type", "Room type", "Zimmerkategorie", "text"),
    col("rate_plan", "Rate Plan", "Rate", "text"),
    col("source", "Source", "Quelle", "text"),
    col("channel", "Channel", "Kanal", "text"),
    col("guest", "Guest", "Gast", "text", "guest"),
    col("email", "Email", "E-Mail", "text", "contact"),
    col("phone", "Phone", "Telefon", "text", "contact"),
    col("country", "Country of residence", "Wohnsitzland", "text"),
    col("adults", "Adults", "Erwachsene", "int", "plain", false),
    col("nights", "Nights", "Nächte", "int", "plain", false),
    col("total", "Stay total (gross)", "Aufenthalt gesamt (brutto)", "money", "revenue", false),
    col("count", "Reservations", "Reservierungen", "int", "plain", false),
  ],
  charges: [
    col("service_date", "Service Date", "Leistungsdatum", "text"),
    col("business_date", "Business Date", "Geschäftstag", "text"),
    col("category", "Category", "Kategorie", "text"),
    col("service", "Service", "Leistung", "text"),
    col("tax_code", "Tax Code", "Steuerschlüssel", "text"),
    col("confirmation", "Confirmation", "Buchungsnummer", "text"),
    col("guest", "Guest", "Gast", "text", "guest"),
    col("net", "Net", "Netto", "money", "revenue", false),
    col("gross", "Gross", "Brutto", "money", "revenue", false),
    col("count", "Charges", "Buchungen", "int", "plain", false),
  ],
  payments: [
    col("business_date", "Business Date", "Geschäftstag", "text"),
    col("tender", "Tender", "Zahlart", "text"),
    col("status", "Status", "Status", "text"),
    col("confirmation", "Confirmation", "Buchungsnummer", "text"),
    col("guest", "Guest", "Gast", "text", "guest"),
    col("reference", "Reference", "Referenz", "text", "money"),
    col("amount", "Amount", "Betrag", "money", "money", false),
    col("count", "Payments", "Zahlungen", "int", "plain", false),
  ],
  housekeeping_tasks: [
    col("business_date", "Business Date", "Geschäftstag", "text"),
    col("room", "Room", "Zimmer", "text"),
    col("kind", "Kind", "Art", "text"),
    col("status", "Status", "Status", "text"),
    col("assignee", "Assignee", "Zuständig", "text"),
    col("minutes", "Minutes planned", "Minuten geplant", "int", "plain", false),
    col("count", "Tasks", "Aufgaben", "int", "plain", false),
  ],
};

/** The right a data set needs at a property at all, besides the builder's own. */
export const DATA_SET_RIGHT: Record<DataSet, PropertyAction> = {
  room_nights: "view_reservations",
  reservations: "view_reservations",
  charges: "view_revenue_reports",
  payments: "view_financial_reports",
  housekeeping_tasks: "view_housekeeping_reports",
};

/** The right each sensitive kind of column needs, as everywhere else in the app (permission matrix). */
const SENSITIVE_RIGHT: Record<Exclude<Sensitivity, "plain">, PropertyAction> = { guest: "view_guests", contact: "view_guest_contacts", revenue: "view_revenue_reports", money: "view_financial_reports" };

/** The columns of a data set this actor may add at every one of these properties. */
export function allowedColumns(actor: Actor, dataSet: DataSet, propertyIds: string[]): BuilderColumn[] {
  if (!propertyIds.length || !propertyIds.every((p) => can(actor, "use_report_builder", p) && can(actor, DATA_SET_RIGHT[dataSet], p))) return [];
  return DATA_SET_COLUMNS[dataSet].filter((c) => {
    const s = c.sensitivity;
    return s === "plain" || propertyIds.every((p) => can(actor, SENSITIVE_RIGHT[s], p));
  });
}

export const FILTER_OPS = ["eq", "neq", "contains"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface BuilderDefinition {
  dataSet: DataSet;
  columns: string[];
  filters: { column: string; op: FilterOp; value: string }[];
  /** Group by these text columns; numbers are summed per group. */
  groupBy: string[];
  totals: boolean;
}

/** A definition checked against what the actor may see; the reason it is refused, or the clean definition. */
export function checkDefinition(actor: Actor, def: BuilderDefinition, propertyIds: string[]): { ok: BuilderDefinition } | { problem: string } {
  if (!(DATA_SETS as readonly string[]).includes(def.dataSet)) return { problem: "Choose a data set" };
  const allowed = new Map(allowedColumns(actor, def.dataSet, propertyIds).map((c) => [c.key, c]));
  if (!allowed.size) return { problem: "You may not see this data set here" };
  const columns = [...new Set(def.columns)];
  if (!columns.length) return { problem: "Choose at least one column" };
  for (const k of [...columns, ...def.groupBy, ...def.filters.map((f) => f.column)]) if (!allowed.has(k)) return { problem: `The column ${k} is not available to you` };
  for (const g of def.groupBy) if (!allowed.get(g)!.groupable) return { problem: `Group by text columns only (${g})` };
  for (const g of def.groupBy) if (!columns.includes(g)) return { problem: `Show the column you group by (${g})` };
  for (const f of def.filters) if (!(FILTER_OPS as readonly string[]).includes(f.op) || typeof f.value !== "string" || f.value.length > 100) return { problem: "A filter is incomplete" };
  if (def.filters.length > 3 || def.groupBy.length > 2) return { problem: "At most three filters and two groupings" };
  // grouped: every shown text column must be a group, numbers are summed
  if (def.groupBy.length) for (const k of columns) if (allowed.get(k)!.groupable && !def.groupBy.includes(k)) return { problem: `Group by ${k} too, or leave it out` };
  return { ok: { dataSet: def.dataSet, columns, filters: def.filters, groupBy: [...new Set(def.groupBy)], totals: def.totals === true } };
}
