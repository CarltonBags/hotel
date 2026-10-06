import { roundMoney } from "./money";
import { can, type Actor } from "./permissions";

/**
 * Outlets (ticket 60, "Own point of sale for bar, restaurant and spa"):
 * bills of items with modifiers, order rounds printed per printer, splits.
 */

export const OUTLET_KINDS = ["bar", "restaurant", "spa", "other"] as const;
export type OutletKind = (typeof OUTLET_KINDS)[number];
export const PRINTER_KINDS = ["kitchen", "bar", "other"] as const;
export type PrinterKind = (typeof PRINTER_KINDS)[number];

export interface Modifier {
  name: string;
  /** Added to the item's price (0 for "no ice"). */
  price: number;
}

export interface BillLineDraft {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  modifiers: Modifier[];
  note: string;
}

/** An item ordered: the menu price plus its chosen modifiers, times the quantity. */
export function lineFor(item: { name: string; price: number; modifiers: Modifier[] }, quantity: number, chosen: string[], note: string): BillLineDraft {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error("The quantity is a whole number from 1");
  const modifiers = [...new Set(chosen)].map((name) => {
    const m = item.modifiers.find((x) => x.name === name);
    if (!m) throw new Error(`Unknown modifier: ${name}`);
    return m;
  });
  const unitPrice = roundMoney(item.price + modifiers.reduce((s, m) => s + m.price, 0));
  return { description: item.name, quantity, unitPrice, amount: roundMoney(unitPrice * quantity), modifiers, note: note.trim().slice(0, 200) };
}

export function billTotal(lines: { amount: number }[]): number {
  return roundMoney(lines.reduce((s, l) => s + l.amount, 0));
}

export interface PrintTicket {
  printerId: string;
  outlet: string;
  table: string | null;
  bill: number;
  round: number;
  waiter: string;
  at: string;
  lines: { description: string; quantity: number; modifiers: Modifier[]; note: string }[];
}

/** An order round's tickets: one per printer, the items in the order taken; items without a printer are not printed. */
export function ticketsFor(head: Omit<PrintTicket, "printerId" | "lines">, lines: { printerId: string | null; description: string; quantity: number; modifiers: Modifier[]; note: string }[]): PrintTicket[] {
  const out = new Map<string, PrintTicket>();
  for (const l of lines) {
    if (!l.printerId) continue;
    if (!out.has(l.printerId)) out.set(l.printerId, { ...head, printerId: l.printerId, lines: [] });
    out.get(l.printerId)!.lines.push({ description: l.description, quantity: l.quantity, modifiers: l.modifiers, note: l.note });
  }
  return [...out.values()];
}

/** The ticket as the printer prints it (42 columns): table and round first, then items with their modifiers and notes. */
export function ticketText(t: PrintTicket): string {
  const at = t.at.slice(11, 16);
  return [
    t.outlet.toUpperCase(),
    `${t.table ? `Tisch/Table ${t.table}` : `Bon ${t.bill}`}   #${t.bill}/${t.round}   ${at}`,
    `${t.waiter}`,
    "-".repeat(42),
    ...t.lines.flatMap((l) => [`${l.quantity} x ${l.description}`, ...l.modifiers.map((m) => `  - ${m.name}`), ...(l.note ? [`  ! ${l.note}`] : [])]),
    "-".repeat(42),
    "",
  ].join("\n");
}

/** A split moves some of the bill's own lines, never all (the bill would be left empty). */
export function splitIsValid(lineIds: string[], moving: string[]): boolean {
  return moving.length > 0 && moving.length < lineIds.length && moving.every((id) => lineIds.includes(id));
}

/** Works at an outlet of the property: serves its tables, takes its money, or manages one. */
export function worksAnOutlet(actor: Actor, propertyId: string): boolean {
  return can(actor, "serve_outlet", propertyId) || can(actor, "outlet_cash", propertyId) || can(actor, "manage_own_outlets", propertyId);
}

/** Menus, prices, printers and tables of an outlet: the Property Manager, or an Outlet Manager of that outlet. */
export function mayManageOutlet(actor: Actor, userId: string, outlet: { propertyId: string; managers: string[] }): boolean {
  if (can(actor, "manage_outlets", outlet.propertyId)) return true;
  return can(actor, "manage_own_outlets", outlet.propertyId) && outlet.managers.includes(userId);
}

/** The ticket as an Epson ePOS-Print request (the network printers kitchens and bars use): text, then a feed cut. */
export function eposPrintXml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"><text lang="de">${esc}</text><cut type="feed"/></epos-print></s:Body></s:Envelope>`;
}

export interface RoomChargeCheck {
  allowed: boolean;
  /** Above what is left of tonight's Spending Limit: the guest pays, or an Outlet Manager approves. */
  overLimit: boolean;
  remaining: number;
  reason: string | null;
  /** Why not, for a machine (an External Till's refusal). */
  refusal: "not_checked_in" | "blocked" | "not_covered" | null;
}

/**
 * A Room Charge: the stay is Checked-in, not blocked for room charge ("cash
 * only") and covered by a Card Hold, Card Guarantee or an on-account
 * Bill-to; within the Spending Limit per night, or with an Approval above it.
 */
export function roomChargeCheck(c: { status: string; blocked: boolean; covered: boolean; chargedTonight: number; limit: number; amount: number }): RoomChargeCheck {
  const remaining = roundMoney(Math.max(0, c.limit - c.chargedTonight));
  const no = (reason: string, refusal: RoomChargeCheck["refusal"]) => ({ allowed: false, overLimit: false, remaining, reason, refusal });
  if (c.status !== "checked_in") return no("The guest is not checked in", "not_checked_in");
  if (c.blocked) return no("Room charge is blocked for this stay (cash only)", "blocked");
  if (!c.covered) return no("No Card Hold, Card Guarantee or account covers a Room Charge", "not_covered");
  return { allowed: true, overLimit: c.amount > remaining, remaining, reason: null, refusal: null };
}

export interface OutletChargeLine {
  taxCode: string;
  taxRate: number;
  revenueAccount: string;
  description: string;
  quantity: number;
  amount: number;
}

/** A bill as Charges: one per Tax Code (and rate; per revenue account where items of one Tax Code book to different ones), its items as detail, the bill's discount taken off each. */
export function chargesPerTaxCode(lines: OutletChargeLine[], discountPercent: number): { taxCode: string; taxRate: number; revenueAccount: string; amount: number; items: { description: string; quantity: number; amount: number }[]; discount: number }[] {
  const out = new Map<string, { taxCode: string; taxRate: number; revenueAccount: string; gross: number; items: { description: string; quantity: number; amount: number }[] }>();
  for (const l of lines) {
    const k = `${l.taxCode}|${l.taxRate}|${l.revenueAccount}`;
    if (!out.has(k)) out.set(k, { taxCode: l.taxCode, taxRate: l.taxRate, revenueAccount: l.revenueAccount, gross: 0, items: [] });
    const g = out.get(k)!;
    g.gross = roundMoney(g.gross + l.amount);
    g.items.push({ description: l.description, quantity: l.quantity, amount: l.amount });
  }
  return [...out.values()].map((g) => {
    const discount = roundMoney((g.gross * discountPercent) / 100);
    return { taxCode: g.taxCode, taxRate: g.taxRate, revenueAccount: g.revenueAccount, amount: roundMoney(g.gross - discount), items: g.items, discount };
  });
}

/** A discount beyond the outlet's percentage needs an Approval, unless the user decides at this outlet (its Outlet Manager, the Property Manager). */
export function discountNeedsApproval(percent: number, outletMax: number, decidesHere: boolean): boolean {
  return percent > outletMax && !decidesHere;
}

/** Decides at the outlet without an Approval (Room Charge above the limit, discounts, voids, refunds): the Property Manager, or this outlet's own Outlet Manager. */
export function decidesAtOutlet(actor: Actor, userId: string, outlet: { propertyId: string; managers: string[] }): boolean {
  return can(actor, "manage_outlets", outlet.propertyId) || (can(actor, "approve_outlet_requests", outlet.propertyId) && outlet.managers.includes(userId));
}

/** Tap to pay on a phone takes Visa, Mastercard, Amex and Maestro, never girocard (it needs a reader). */
export function tapToPayAccepts(brand: string | null): boolean {
  return (brand ?? "").toLowerCase() !== "girocard";
}
