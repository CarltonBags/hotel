import type { InvoiceTotals, TaxPart } from "@hoteloftware/domain";

/**
 * Everything an issued invoice shows, frozen at issue (master data
 * historised): rendering it again later gives the same document.
 */
export interface Party {
  name: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  /** ISO 3166 alpha-2 */
  country: string;
  vatId: string | null;
  taxNumber?: string | null;
  email?: string | null;
  phone?: string | null;
}

export type InvoiceKind = "final" | "deposit" | "cancellation";

export interface InvoiceDocument {
  kind: InvoiceKind;
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  language: "de" | "en";
  seller: Party & { iban: string | null; bic: string | null; accountHolder: string | null };
  buyer: Party;
  /** Booking confirmation number: the buyer's reference. */
  reference: string;
  periodStart: string;
  periodEnd: string;
  totals: InvoiceTotals;
  /** Deposit invoices netted on this final invoice. */
  deposits: { number: string; issueDate: string; byTax: TaxPart[] }[];
  /** A deposit invoice: received on this date. */
  receivedOn?: string | null;
  /** A Cancellation Invoice: the invoice it cancels (its totals are mirrored, shown negative). */
  cancels?: { number: string; issueDate: string } | null;
  notes: string[];
}

/** A reminder letter about overdue invoices of one Bill-to, frozen when issued. */
export interface ReminderDocument {
  level: 1 | 2 | 3;
  issueDate: string;
  payBy: string;
  currency: string;
  language: "de" | "en";
  seller: InvoiceDocument["seller"];
  buyer: Party;
  invoices: { number: string; issueDate: string; dueDate: string; open: number }[];
}
