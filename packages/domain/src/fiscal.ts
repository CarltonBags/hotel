import { apportion } from "./invoices";
import { roundMoney } from "./money";

/**
 * The fiscal module for Germany (ticket 51, ADR 0013): what a Receipt is
 * signed with, and the DSFinV-K daily closing built from the signed
 * Receipts. Pure rules; the provider and the database are elsewhere.
 */

/** Which Receipts are signed: every desk process ending in a Receipt, or (a switch for later) cash and vouchers only. */
export const FISCAL_SCOPES = ["all", "cash_and_vouchers"] as const;
export type FiscalScope = (typeof FISCAL_SCOPES)[number];

export function fiscalScopeCovers(scope: FiscalScope, tender: string): boolean {
  return scope === "all" || tender === "cash" || tender === "voucher";
}

/** Printed in place of the signature when the TSE could not sign; the Receipt is never signed later. */
export const FISCAL_OUTAGE_NOTICE = "TSE nicht erreichbar: Beleg ohne Signatur (Ausfall der TSE)";

/** The VAT rates as the TSE and DSFinV-K name them; null: a payment whose VAT cannot be determined. */
const VAT: { rate: number | null; tse: "NORMAL" | "REDUCED_1" | "SPECIAL_RATE_1" | "SPECIAL_RATE_2" | "NULL"; dsfinvk: number }[] = [
  { rate: 19, tse: "NORMAL", dsfinvk: 1 },
  { rate: 7, tse: "REDUCED_1", dsfinvk: 2 },
  { rate: 10.7, tse: "SPECIAL_RATE_1", dsfinvk: 3 },
  { rate: 5.5, tse: "SPECIAL_RATE_2", dsfinvk: 4 },
  { rate: 0, tse: "NULL", dsfinvk: 5 },
  { rate: null, tse: "NULL", dsfinvk: 7 },
];

export function fiscalVat(rate: number | null): { tse: (typeof VAT)[number]["tse"]; dsfinvk: number } {
  const v = VAT.find((x) => x.rate === rate);
  if (!v) throw new Error(`No fiscal VAT rate for ${rate} %`);
  return { tse: v.tse, dsfinvk: v.dsfinvk };
}

/** An amount at one VAT rate; rate null: not determinable. */
export interface VatAmount {
  rate: number | null;
  amount: number;
}

/** Net and VAT within a gross amount at a rate. */
export function vatSplit(incl: number, rate: number | null): { incl: number; excl: number; vat: number } {
  const excl = rate ? roundMoney(incl / (1 + rate / 100)) : roundMoney(incl);
  return { incl: roundMoney(incl), excl, vat: roundMoney(incl - excl) };
}

/** A refund is shared over the rates of the payment it gives back, to the cent. */
export function refundVatAmounts(refund: number, original: VatAmount[]): VatAmount[] {
  if (!original.length) return [{ rate: null, amount: roundMoney(refund) }];
  const shares = apportion(refund, original.map((a) => Math.abs(a.amount)));
  return original.map((a, i) => ({ rate: a.rate, amount: shares[i]! }));
}

/**
 * A Receipt's amount per VAT rate: the payment shared out over what it pays
 * for (the stay's VAT for a deposit, the folio's Charges after check-in), to
 * the cent; nothing to share by: VAT not determinable.
 */
export function receiptVatAmounts(amount: number, parts: { rate: number; gross: number }[]): VatAmount[] {
  const byRate = new Map<number, number>();
  for (const p of parts) if (p.gross > 0) byRate.set(p.rate, roundMoney((byRate.get(p.rate) ?? 0) + p.gross));
  if (!byRate.size) return [{ rate: null, amount: roundMoney(amount) }];
  const rates = [...byRate.keys()].sort((a, b) => b - a);
  const shares = apportion(amount, rates.map((r) => byRate.get(r)!));
  return rates.map((rate, i) => ({ rate, amount: shares[i]! }));
}

/** The tender as the TSE and DSFinV-K know it. */
export function fiscalPayment(tender: string): { tse: "CASH" | "NON_CASH"; dsfinvk: "Bar" | "Unbar" } {
  return tender === "cash" ? { tse: "CASH", dsfinvk: "Bar" } : { tse: "NON_CASH", dsfinvk: "Unbar" };
}

/** A Cash Register's serial for the TSE: assigned by us once, never changed (no "/" or "_", at most 70 characters). */
export function fiscalSerial(id: string): string {
  return `HS-${id.replace(/-/g, "").toUpperCase()}`;
}

/** An amount as the TSE takes it: "-12.50". */
export function fiscalAmount(n: number): string {
  return roundMoney(n).toFixed(2);
}

/** Money paid before the stay began is a deposit (Anzahlung); after, it settles the stay's sales. */
export type FiscalBusinessCase = "Anzahlungseinstellung" | "Umsatz" | "MehrzweckgutscheinKauf";

/** A closing line's text, per business case. */
const CLOSING_TEXT: Record<FiscalBusinessCase, string> = { Umsatz: "Zahlung Aufenthalt", Anzahlungseinstellung: "Anzahlung Aufenthalt", MehrzweckgutscheinKauf: "Wertgutschein Verkauf" };

export interface ClosingTransaction {
  /** BON_ID: ascending per tenant, never the TSE's own id. */
  exportId: number;
  /** The TSE transaction number (null when the TSE failed). */
  number: number | null;
  tssTxId: string | null;
  error: string | null;
  timeStart: Date;
  timeEnd: Date;
  businessCase: FiscalBusinessCase;
  paymentType: "Bar" | "Unbar";
  currency: string;
  amounts: VatAmount[];
}

const vatOf = (incl: number, rate: number | null) => {
  const v = vatSplit(incl, rate);
  return { incl_vat: v.incl, excl_vat: v.excl, vat: v.vat };
};

function perVat(amounts: VatAmount[]) {
  const m = new Map<number, VatAmount>();
  for (const a of amounts) {
    const id = fiscalVat(a.rate).dsfinvk;
    m.set(id, { rate: a.rate, amount: roundMoney((m.get(id)?.amount ?? 0) + a.amount) });
  }
  return [...m].sort(([a], [b]) => a - b).map(([id, a]) => ({ vat_definition_export_id: id, ...vatOf(a.amount, a.rate) }));
}

/**
 * The DSFinV-K daily closing (Kassenabschluss) of one Cash Register for a
 * Business Date, in fiskaly's cash point closing format: the day's business
 * cases and payments, and every Receipt with its TSE transaction (or the
 * reason it has none).
 */
export function dsfinvkClosing(input: { clientId: string; exportNumber: number; businessDate: string; createdAt: Date; currency: string; transactions: ClosingTransaction[] }): Record<string, unknown> {
  const txs = [...input.transactions].sort((a, b) => a.exportId - b.exportId);
  if (!txs.length) throw new Error("A closing needs at least one Receipt");
  const cases = new Map<FiscalBusinessCase, VatAmount[]>();
  for (const t of txs) cases.set(t.businessCase, [...(cases.get(t.businessCase) ?? []), ...t.amounts]);
  const total = (ts: ClosingTransaction[]) => roundMoney(ts.reduce((s, t) => s + t.amounts.reduce((x, a) => x + a.amount, 0), 0));
  const payTypes = new Map<string, number>();
  for (const t of txs) payTypes.set(t.paymentType, roundMoney((payTypes.get(t.paymentType) ?? 0) + total([t])));
  const cash = payTypes.get("Bar") ?? 0;
  const secs = (d: Date) => Math.floor(d.getTime() / 1000);
  return {
    client_id: input.clientId,
    cash_point_closing_export_id: input.exportNumber,
    head: { export_creation_date: secs(input.createdAt), business_date: input.businessDate, first_transaction_export_id: String(txs[0]!.exportId), last_transaction_export_id: String(txs.at(-1)!.exportId) },
    cash_statement: {
      business_cases: [...cases].map(([type, amounts]) => ({ type, amounts_per_vat_id: perVat(amounts) })),
      payment: {
        full_amount: total(txs),
        cash_amount: cash,
        cash_amounts_by_currency: cash ? [{ currency_code: input.currency, amount: cash }] : [],
        payment_types: [...payTypes].map(([type, amount]) => ({ type, currency_code: input.currency, amount })),
      },
    },
    transactions: txs.map((t) => ({
      head: { type: "Beleg", storno: false, number: t.exportId, transaction_export_id: String(t.exportId), timestamp_start: secs(t.timeStart), timestamp_end: secs(t.timeEnd), ...(t.tssTxId ? { tx_id: t.tssTxId } : {}) },
      data: {
        full_amount_incl_vat: total([t]),
        payment_types: [{ type: t.paymentType, currency_code: t.currency, amount: total([t]) }],
        amounts_per_vat_id: perVat(t.amounts),
        lines: [{ business_case: { type: t.businessCase, amounts_per_vat_id: perVat(t.amounts) }, lineitem_export_id: "1", storno: false, text: CLOSING_TEXT[t.businessCase], item: { number: "1", quantity: 1, price_per_unit: total([t]) } }],
      },
      security: t.tssTxId && !t.error ? { tss_tx_id: t.tssTxId } : { error_message: (t.error ?? "TSE nicht erreichbar").slice(0, 200) },
    })),
  };
}

/** Austria (ticket 52): the RKSV's rate keys. */
const AT_VAT: { rate: number; key: "STANDARD" | "REDUCED_1" | "REDUCED_2" | "SPECIAL" | "ZERO" }[] = [
  { rate: 20, key: "STANDARD" },
  { rate: 10, key: "REDUCED_1" },
  { rate: 13, key: "REDUCED_2" },
  { rate: 19, key: "SPECIAL" },
  { rate: 0, key: "ZERO" },
];

export function atVatKey(rate: number | null): (typeof AT_VAT)[number]["key"] {
  // the RKSV has no key for "not determinable": such a payment is refused rather than signed at a guessed rate
  const v = AT_VAT.find((x) => x.rate === rate);
  if (!v) throw new Error(`No Austrian VAT rate key for ${rate} %`);
  return v.key;
}

/** Printed on an Austrian Receipt the signature unit did not sign (RKSV). */
export const AT_OUTAGE_NOTICE = "Sicherheitseinrichtung ausgefallen";

/** Printed on an Austrian Receipt the provider refused to sign: the desk corrects it. */
export const AT_NOT_SIGNED_NOTICE = "Beleg nicht signiert: wird von der Rezeption berichtigt";

/** An outage longer than 48 hours is reported to FinanzOnline within a week (RKSV § 17). */
export const AT_OUTAGE_REPORT_HOURS = 48;
export const AT_OUTAGE_REPORT_DAYS = 7;

export function atOutageReport(o: { startedAt: Date; endedAt: Date | null }, now: Date): { due: boolean; reportBy: Date | null } {
  const reportable = new Date(o.startedAt.getTime() + AT_OUTAGE_REPORT_HOURS * 3_600_000);
  const due = (o.endedAt ?? now) > reportable;
  return { due, reportBy: due ? new Date(reportable.getTime() + AT_OUTAGE_REPORT_DAYS * 86_400_000) : null };
}

/** The yearly receipt is printed and checked by 15 February of the next year. */
export function yearlyReceiptCheckBy(signedAt: Date): string {
  const y = signedAt.getUTCMonth() === 11 ? signedAt.getUTCFullYear() + 1 : signedAt.getUTCFullYear();
  return `${y}-02-15`;
}
