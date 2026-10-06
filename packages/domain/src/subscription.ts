import { roundMoney } from "./money";
import { addDays } from "./rates-grid";

/**
 * Modules and subscription billing (ticket 88, "Onboarding and
 * subscription"): optional parts switched on per property, and the monthly
 * invoice per Legal Entity of the customer: rooms on the 1st, Modules, usage
 * at cost plus handling. Prices are configuration (a price list), not code.
 */
export const MODULES = ["channel", "guest_portal", "point_of_sale", "groups", "whatsapp"] as const;
export type Module = (typeof MODULES)[number];

export function isModule(s: string): s is Module {
  return (MODULES as readonly string[]).includes(s);
}

/** A Module's setup steps, started when it is switched on; none for Modules that need no setup. */
export const MODULE_CHECKLIST: Record<Module, string[]> = {
  channel: ["channel_account", "room_mapping", "rate_mapping"],
  guest_portal: ["portal_texts", "payment_onboarding"],
  point_of_sale: ["outlet", "cash_register", "printer", "menu"],
  groups: [],
  whatsapp: ["business_verification", "number", "templates"],
};

/** One switching of a Module at a property: on since a day; off at a month's end once switched off. */
export interface ModulePeriod {
  module: Module;
  onSince: string;
  offAt: string | null;
}

/** On; switched off but running to the month's end; off with its data readable; or never on. */
export type ModuleState = "on" | "ending" | "readable" | "never";

export function moduleState(periods: ModulePeriod[], module: Module, today: string): ModuleState {
  const mine = periods.filter((p) => p.module === module).sort((a, b) => b.onSince.localeCompare(a.onSince));
  const last = mine[0];
  if (!last) return "never";
  if (last.offAt === null) return "on";
  return today <= last.offAt ? "ending" : "readable";
}

/** Whether a Module's screens show: while on or ending, and (read only) once off. */
export const moduleVisible = (s: ModuleState) => s !== "never";

/** Switched off, a Module runs to the end of the month. */
export function monthEnd(today: string): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** A Module is billed for a month when it was on before the month began (billed from the next month) and not off before it. */
export function moduleBilled(p: ModulePeriod, monthStart: string): boolean {
  return p.onSince < monthStart && (p.offAt === null || p.offAt >= monthStart);
}

export interface PriceList {
  /** Per room and month, the base (staff app, reservations, housekeeping, billing, reports). */
  base_room: number;
  /** Per Module: per room or per property and month. */
  modules: Record<Module, { unit: "room" | "property"; amount: number }>;
  /** Usage billed at cost plus this share. */
  handling: number;
  /** Discount on the base for yearly prepayment. */
  yearlyDiscount: number;
  /** VAT rate of the invoice, percent. */
  vatRate: number;
}

export interface SubscriptionLine {
  description: string;
  quantity: number;
  unitNet: number;
  net: number;
}

export interface SubscriptionInput {
  /** First day of the month billed. */
  monthStart: string;
  properties: { name: string; rooms: number; modules: ModulePeriod[] }[];
  /** Usage of the month before, at cost. */
  usage: { kind: string; quantity: number; cost: number }[];
  prices: PriceList;
  /** Yearly prepayment of the base from this month on (a month's 1st): invoiced 12 months ahead each year, with the discount. */
  yearlyFrom: string | null;
}

/** Whole months from one month's 1st to another's. */
function monthsBetween(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
}

const MODULE_LABEL: Record<Module, string> = { channel: "Channel connection", guest_portal: "Guest portal and self check-in", point_of_sale: "Point of sale with spa", groups: "Groups", whatsapp: "WhatsApp" };

/**
 * The invoice lines of one Legal Entity for a month: rooms per property (or,
 * prepaid yearly, twelve months of them once a year with the discount and
 * none in the months between), each Module billed, usage in arrears.
 */
export function subscriptionLines(input: SubscriptionInput): SubscriptionLine[] {
  const lines: SubscriptionLine[] = [];
  const month = input.monthStart.slice(0, 7);
  const line = (description: string, quantity: number, unitNet: number) => lines.push({ description, quantity, unitNet: roundMoney(unitNet), net: roundMoney(quantity * unitNet) });
  const term = input.yearlyFrom && input.monthStart >= input.yearlyFrom ? monthsBetween(input.yearlyFrom, input.monthStart) % 12 : null;
  for (const p of input.properties) {
    if (term === null) line(`${p.name}: rooms on ${input.monthStart} · ${month}`, p.rooms, input.prices.base_room);
    // the prepaid year: rooms on its first day, twelve months, the discount on them
    else if (term === 0) {
      line(`${p.name}: rooms on ${input.monthStart} · 12 months from ${month}`, p.rooms * 12, input.prices.base_room);
      if (input.prices.yearlyDiscount > 0) line(`${p.name}: yearly prepayment discount ${input.prices.yearlyDiscount} %`, 1, -roundMoney((p.rooms * 12 * input.prices.base_room * input.prices.yearlyDiscount) / 100));
    }
    const billed = [...new Set(p.modules.filter((m) => moduleBilled(m, input.monthStart)).map((m) => m.module))];
    for (const m of billed) {
      const price = input.prices.modules[m];
      line(`${p.name}: ${MODULE_LABEL[m]} · ${month}`, price.unit === "room" ? p.rooms : 1, price.amount);
    }
  }
  const previous = addDays(input.monthStart, -1).slice(0, 7);
  const byKind = new Map<string, { quantity: number; cost: number }>();
  for (const u of input.usage) {
    const x = byKind.get(u.kind) ?? { quantity: 0, cost: 0 };
    byKind.set(u.kind, { quantity: x.quantity + u.quantity, cost: x.cost + u.cost });
  }
  for (const [kind, u] of byKind) {
    const total = roundMoney(u.cost * (1 + input.prices.handling / 100));
    // one line per kind (quantity × price must equal the amount on an e-invoice): the count goes in the text
    lines.push({ description: `${kind} × ${u.quantity} · ${previous} · at cost plus ${input.prices.handling} % handling`, quantity: 1, unitNet: total, net: total });
  }
  return lines;
}
