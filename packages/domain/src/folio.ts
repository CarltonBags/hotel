/**
 * Folio rules ("Folio, billing and invoicing domain model", ADR 0009, ADR 0010):
 * Charges store gross and a Tax Code; net and VAT are derived. Stay Charges are
 * posted at check-in, one per night per component, and kept in step with the
 * stay afterwards.
 */
import { roundMoney } from "./money";
import type { FeeKind } from "./rates";
import type { RoutingCategory } from "./companies";
import { splitGross } from "./tax";

export interface TotalsInput {
  amount: number;
  taxCode: string;
  /** Rate in force on the Service Date, stored with the Charge. */
  taxRate: number;
  voided: boolean;
}

export interface TaxCodeTotal {
  taxCode: string;
  rate: number;
  gross: number;
  net: number;
  vat: number;
}

/** Totals per Tax Code and rate: gross summed, then split once (ADR 0010), voided Charges left out. */
export function folioTotals(charges: TotalsInput[]): { byTaxCode: TaxCodeTotal[]; gross: number } {
  const groups = new Map<string, { taxCode: string; rate: number; gross: number }>();
  for (const c of charges) {
    if (c.voided) continue;
    const key = `${c.taxCode}|${c.taxRate}`;
    const g = groups.get(key) ?? { taxCode: c.taxCode, rate: c.taxRate, gross: 0 };
    g.gross = roundMoney(g.gross + c.amount);
    groups.set(key, g);
  }
  const byTaxCode = [...groups.values()]
    .sort((a, b) => a.taxCode.localeCompare(b.taxCode) || a.rate - b.rate)
    .map((g) => {
      const split = splitGross(g.gross, g.rate);
      return { taxCode: g.taxCode, rate: g.rate, gross: split.gross, net: split.net, vat: split.vat };
    });
  return { byTaxCode, gross: roundMoney(byTaxCode.reduce((s, t) => s + t.gross, 0)) };
}

/** Routing Rules: the folio a Charge of a category lands on, else the reservation's main folio. */
export function routeCharge(category: RoutingCategory, rules: { category: RoutingCategory; folioId: string }[], mainFolioId: string): string {
  return rules.find((r) => r.category === category)?.folioId ?? mainFolioId;
}

/** Early-departure fee of a Rate Plan on the nights the guest gives up (their stored prices). */
export function earlyDepartureFee(kind: FeeKind, percent: number | null, givenUpNights: number[]): number {
  if (givenUpNights.length === 0 || kind === "none") return 0;
  const total = givenUpNights.reduce((s, n) => s + n, 0);
  if (kind === "first_night") return roundMoney(givenUpNights[0]!);
  if (kind === "percent") return roundMoney((total * (percent ?? 0)) / 100);
  return roundMoney(total);
}

export interface PostedStayCharge {
  id: string;
  serviceDate: string;
  /** "room" or "svc:<serviceId>" */
  component: string;
  amount: number;
}
export interface WantedStayCharge {
  serviceDate: string;
  component: string;
  amount: number;
}

/**
 * Keep stay Charges in step with the stored nights: a posted Charge whose
 * night and component are no longer wanted at that amount is voided, a wanted
 * one not posted is posted. `removedDates` are nights given up (shortening).
 */
export function staySync(posted: PostedStayCharge[], wanted: WantedStayCharge[]): { voids: string[]; posts: WantedStayCharge[]; removedDates: string[] } {
  const key = (c: { serviceDate: string; component: string; amount: number }) => `${c.serviceDate}|${c.component}|${roundMoney(c.amount)}`;
  const want = new Map(wanted.map((w) => [key(w), w]));
  const have = new Set(posted.map(key));
  const wantedDates = new Set(wanted.map((w) => w.serviceDate));
  return {
    voids: posted.filter((p) => !want.has(key(p))).map((p) => p.id),
    posts: wanted.filter((w) => !have.has(key(w))),
    removedDates: [...new Set(posted.map((p) => p.serviceDate).filter((d) => !wantedDates.has(d)))].sort(),
  };
}
