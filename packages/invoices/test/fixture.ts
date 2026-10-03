import { allocateDeposit, invoiceLines, invoiceTotals } from "@hoteloftware/domain";
import type { InvoiceDocument, ReminderDocument } from "../src/index";

const charges = [
  { description: "Übernachtung", serviceDate: "2026-10-02", amount: 96, unitPrice: 96, quantity: 1, taxCode: "ACC", taxRate: 7 },
  { description: "Übernachtung", serviceDate: "2026-10-03", amount: 96, unitPrice: 96, quantity: 1, taxCode: "ACC", taxRate: 7 },
  { description: "Frühstück", serviceDate: "2026-10-02", amount: 24, unitPrice: 12, quantity: 2, taxCode: "FOOD", taxRate: 7 },
  { description: "Frühstück", serviceDate: "2026-10-03", amount: 24, unitPrice: 12, quantity: 2, taxCode: "FOOD", taxRate: 7 },
  { description: "Minibar", serviceDate: "2026-10-03", amount: 9.5, unitPrice: 9.5, quantity: 1, taxCode: "STD", taxRate: 19 },
];
const deposit = allocateDeposit(100, [
  { taxCode: "ACC", rate: 7, gross: 192 },
  { taxCode: "FOOD", rate: 7, gross: 48 },
]);

/** A final invoice of a two-night stay with breakfast and minibar, a deposit of 100 and 50 paid at the desk. */
export const finalInvoice: InvoiceDocument = {
  kind: "final",
  number: "RE-2026-00042",
  issueDate: "2026-10-04",
  dueDate: "2026-10-18",
  currency: "EUR",
  language: "de",
  seller: {
    name: "Alpha Hotels GmbH",
    addressLine1: "Unter den Linden 1",
    addressLine2: "",
    postalCode: "10117",
    city: "Berlin",
    country: "DE",
    vatId: "DE123456789",
    taxNumber: "27/123/45678",
    email: "rechnung@alpha.example",
    phone: "+49 30 1234567",
    iban: "DE89 3704 0044 0532 0130 00",
    bic: "COBADEFFXXX",
    accountHolder: "Alpha Hotels GmbH",
  },
  buyer: { name: "Aiko Tanaka", addressLine1: "1-2-3 Shibuya", addressLine2: "", postalCode: "150-0002", city: "Tokyo", country: "JP", vatId: null },
  reference: "100031",
  periodStart: "2026-10-02",
  periodEnd: "2026-10-03",
  totals: invoiceTotals(invoiceLines(charges), { deposits: [{ number: "AZ-2026-00007", byTax: deposit }], paid: 50 }),
  deposits: [{ number: "AZ-2026-00007", issueDate: "2026-09-20", byTax: deposit }],
  notes: [],
};

export const cancellationInvoice: InvoiceDocument = {
  ...finalInvoice,
  kind: "cancellation",
  number: "ST-2026-0001",
  issueDate: "2026-10-05",
  dueDate: null,
  cancels: { number: finalInvoice.number, issueDate: finalInvoice.issueDate },
  notes: ["Wrong recipient"],
};

export const reminder: ReminderDocument = {
  level: 2,
  issueDate: "2026-11-20",
  payBy: "2026-11-30",
  currency: "EUR",
  language: "de",
  seller: finalInvoice.seller,
  buyer: finalInvoice.buyer,
  invoices: [{ number: finalInvoice.number, issueDate: finalInvoice.issueDate, dueDate: finalInvoice.dueDate!, open: 99.5 }],
};
