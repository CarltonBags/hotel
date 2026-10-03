/**
 * Invoice arithmetic (ticket 28; ADR 0010 gross with Tax Code, split once):
 * lines from Charges, VAT per Tax Code and rate, deposits with their VAT
 * (UStG §13(1) Nr. 1a: taxed when received, at the rates of the stay paid
 * for) netted on the final invoice (UStG §14(5)), and invoice numbers.
 */
import { roundMoney } from "./money";
import { splitGross } from "./tax";

export interface InvoiceCharge {
  description: string;
  serviceDate: string;
  amount: number;
  unitPrice: number;
  quantity: number;
  taxCode: string;
  taxRate: number;
}

export interface InvoiceLine {
  description: string;
  taxCode: string;
  rate: number;
  quantity: number;
  unitGross: number;
  gross: number;
  periodStart: string;
  periodEnd: string;
}

export interface TaxPart {
  taxCode: string;
  rate: number;
  gross: number;
  net: number;
  vat: number;
}

/** Charges of the same description, unit price and Tax Code become one line spanning their Service Dates. */
export function invoiceLines(charges: InvoiceCharge[]): InvoiceLine[] {
  const lines = new Map<string, InvoiceLine>();
  for (const c of charges) {
    const key = `${c.description}|${c.taxCode}|${c.taxRate}|${roundMoney(c.unitPrice)}`;
    const l = lines.get(key);
    if (l) {
      l.quantity = roundMoney(l.quantity + c.quantity);
      l.gross = roundMoney(l.gross + c.amount);
      if (c.serviceDate < l.periodStart) l.periodStart = c.serviceDate;
      if (c.serviceDate > l.periodEnd) l.periodEnd = c.serviceDate;
    } else {
      lines.set(key, { description: c.description, taxCode: c.taxCode, rate: c.taxRate, quantity: c.quantity, unitGross: roundMoney(c.unitPrice), gross: roundMoney(c.amount), periodStart: c.serviceDate, periodEnd: c.serviceDate });
    }
  }
  return [...lines.values()];
}

/** Split an amount over weights so the parts are whole cents and add up exactly (largest remainder). */
function apportion(total: number, weights: number[]): number[] {
  const cents = Math.round(total * 100);
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (cents * w) / sum);
  const floor = raw.map(Math.floor);
  let left = cents - floor.reduce((s, x) => s + x, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (left <= 0) break;
    floor[i]! += 1;
    left--;
  }
  return floor.map((c) => c / 100);
}

export interface PrecedingDeposit {
  number: string;
  byTax: TaxPart[];
}

export interface InvoiceTotals {
  lines: (InvoiceLine & { net: number })[];
  byTax: TaxPart[];
  gross: number;
  net: number;
  vat: number;
  depositsGross: number;
  depositsVat: number;
  /** Other payments received (not deposits). */
  paid: number;
  due: number;
}

/**
 * VAT per Tax Code and rate: gross summed, split once. Each line's net is
 * its share of its rate's net, so line nets add up to the rate's net to the
 * cent (EN16931 consistency). Deposits are deducted with their VAT, then
 * other payments; what remains is due.
 */
export function invoiceTotals(lines: InvoiceLine[], received: { deposits?: PrecedingDeposit[]; paid?: number } = {}): InvoiceTotals {
  const groups = new Map<string, { taxCode: string; rate: number; idx: number[] }>();
  lines.forEach((l, i) => {
    const key = `${l.taxCode}|${l.rate}`;
    const g = groups.get(key) ?? { taxCode: l.taxCode, rate: l.rate, idx: [] };
    g.idx.push(i);
    groups.set(key, g);
  });
  const nets = new Array<number>(lines.length).fill(0);
  const byTax: TaxPart[] = [...groups.values()]
    .sort((a, b) => a.taxCode.localeCompare(b.taxCode) || a.rate - b.rate)
    .map((g) => {
      const gross = roundMoney(g.idx.reduce((s, i) => s + lines[i]!.gross, 0));
      const split = splitGross(gross, g.rate);
      apportion(split.net, g.idx.map((i) => lines[i]!.gross)).forEach((n, k) => (nets[g.idx[k]!] = n));
      return { taxCode: g.taxCode, rate: g.rate, gross: split.gross, net: split.net, vat: split.vat };
    });
  const sum = (f: (t: TaxPart) => number, parts: TaxPart[]) => roundMoney(parts.reduce((s, t) => s + f(t), 0));
  const deposits = (received.deposits ?? []).flatMap((d) => d.byTax);
  const gross = sum((t) => t.gross, byTax);
  const depositsGross = sum((t) => t.gross, deposits);
  const paid = roundMoney(received.paid ?? 0);
  return {
    lines: lines.map((l, i) => ({ ...l, net: nets[i]! })),
    byTax,
    gross,
    net: sum((t) => t.net, byTax),
    vat: sum((t) => t.vat, byTax),
    depositsGross,
    depositsVat: sum((t) => t.vat, deposits),
    paid,
    due: roundMoney(gross - depositsGross - paid),
  };
}

/** A deposit takes the Tax Codes of the stay it pays for, in proportion to their gross. */
export function allocateDeposit(amount: number, stay: { taxCode: string; rate: number; gross: number }[]): TaxPart[] {
  const parts = apportion(amount, stay.map((s) => s.gross));
  return stay.map((s, i) => ({ taxCode: s.taxCode, rate: s.rate, ...splitGross(parts[i]!, s.rate) }));
}

const COUNTER = /\{(N+)\}/;

/** A number format needs exactly one counter ({N}, {NNNN}, ...); {YYYY}, {YY} and {MM} are the issue date's. */
export function isInvoiceNumberFormat(format: string): boolean {
  return (format.match(/\{N+\}/g) ?? []).length === 1 && format.length <= 40 && !/[\\/]{2}/.test(format);
}

export function formatInvoiceNumber(format: string, counter: number, issueDate: string): string {
  const [y, m] = issueDate.split("-");
  return format
    .replace(COUNTER, (_, n: string) => String(counter).padStart(n.length, "0"))
    .replaceAll("{YYYY}", y!)
    .replaceAll("{YY}", y!.slice(2))
    .replaceAll("{MM}", m!);
}
