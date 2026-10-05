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

/** A split moves at least one of the bill's own lines. */
export function splitIsValid(lineIds: string[], moving: string[]): boolean {
  return moving.length > 0 && moving.every((id) => lineIds.includes(id));
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
