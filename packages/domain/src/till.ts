import { roundMoney } from "./money";

/**
 * Room charges from external tills (ticket 65, decision "Restaurant and bar
 * charges to the room"): one Charge per Tax Code per bill with the items as
 * detail, or totals per tax rate where the till sends no items; the tip on a
 * line of its own; the till stays the fiscal cash register for the sale.
 */

export interface TillItem {
  description: string;
  quantity: number;
  /** Gross, tax included. */
  amount: number;
  /** Percent, as 7 or 19. */
  taxRate: number;
}

export interface TillTotal {
  taxRate: number;
  amount: number;
}

export interface TillChargeGroup {
  taxRate: number;
  amount: number;
  items: { description: string; quantity: number; amount: number }[];
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** A bill's items (or totals) per tax rate, in the order the rates first appear. */
export function tillChargeGroups(bill: { items?: TillItem[] | undefined; totals?: TillTotal[] | undefined }): TillChargeGroup[] {
  const out = new Map<number, TillChargeGroup>();
  const group = (rate: number) => {
    if (!finite(rate) || rate < 0 || rate > 100) throw new Error("Each line needs a tax rate in percent");
    if (!out.has(rate)) out.set(rate, { taxRate: rate, amount: 0, items: [] });
    return out.get(rate)!;
  };
  for (const i of bill.items ?? []) {
    if (!finite(i.amount) || !finite(i.quantity)) throw new Error("Each line needs a quantity and an amount");
    const g = group(i.taxRate);
    g.amount = roundMoney(g.amount + i.amount);
    g.items.push({ description: String(i.description ?? "").trim().slice(0, 200) || "Item", quantity: i.quantity, amount: roundMoney(i.amount) });
  }
  if (!bill.items?.length) {
    for (const t of bill.totals ?? []) {
      if (!finite(t.amount)) throw new Error("Each total needs an amount");
      const g = group(t.taxRate);
      g.amount = roundMoney(g.amount + t.amount);
    }
  }
  const groups = [...out.values()].filter((g) => g.amount !== 0);
  if (!groups.length) throw new Error("The bill has nothing to charge");
  return groups;
}

/** The Tax Code for a till's rate: the one set for it, else the only code with that rate; null where it is unclear (7 % may be food or accommodation). */
export function taxCodeForRate(rate: number, codes: { id: string; rate: number }[], set: Record<string, string>): string | null {
  const chosen = set[String(rate)];
  if (chosen && codes.some((c) => c.id === chosen)) return chosen;
  const same = codes.filter((c) => c.rate === rate);
  return same.length === 1 ? same[0]!.id : null;
}

/** A till posting in our own terms. */
export interface TillPosting {
  externalId: string;
  /** For a void: the till's id of the bill it cancels. */
  reversalOf: string | null;
  reservationId: string;
  receiptNumber: string;
  fiscalId: string;
  items: TillItem[];
  tip: number;
}

interface LightspeedLine {
  description?: string;
  quantity?: number;
  amount?: string | number;
  /** A multiplier: 1.07 for 7 % (research "Point-of-sale systems and room charge interfaces", to confirm in the sandbox). */
  taxRate?: number;
}

interface LightspeedPayment {
  code?: string;
  amount?: string | number;
  gratuity?: string | number;
  pmsReservationId?: string;
}

export interface LightspeedAccount {
  uuid?: string;
  initialAccountId?: string;
  receiptId?: string;
  fiscId?: string;
  salesLines?: LightspeedLine[];
  payments?: LightspeedPayment[];
}

/** The "Charge to Room" payment method a hotel sets up in Lightspeed. */
export const LIGHTSPEED_ROOM_CHARGE = "IKPMS";

/**
 * A Lightspeed account closed to a room, as our posting. The whole bill goes
 * to the room (partial payments are not offered); the tip rides on the
 * payment apart from revenue; a void is a new account pointing to the first.
 */
export function fromLightspeed(a: LightspeedAccount): TillPosting {
  const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".")));
  if (!a.uuid) throw new Error("The account has no id");
  const room = (a.payments ?? []).filter((p) => p.code === LIGHTSPEED_ROOM_CHARGE);
  const reservationId = room.find((p) => p.pmsReservationId)?.pmsReservationId ?? "";
  if (!room.length || !reservationId) throw new Error("No room charge payment with a reservation");
  const items: TillItem[] = (a.salesLines ?? []).map((l) => ({
    description: String(l.description ?? ""),
    quantity: num(l.quantity ?? 1),
    amount: roundMoney(num(l.amount)),
    taxRate: roundMoney((num(l.taxRate) - 1) * 100),
  }));
  const lines = roundMoney(items.reduce((s, i) => s + i.amount, 0));
  const charged = roundMoney(room.reduce((s, p) => s + num(p.amount), 0));
  if (charged !== lines) throw new Error("Only the whole bill can go to the room");
  return {
    externalId: a.uuid,
    reversalOf: a.initialAccountId && a.initialAccountId !== a.uuid ? a.initialAccountId : null,
    reservationId,
    receiptNumber: String(a.receiptId ?? ""),
    fiscalId: String(a.fiscId ?? ""),
    items,
    tip: roundMoney(room.reduce((s, p) => s + (num(p.gratuity ?? 0) || 0), 0)),
  };
}
