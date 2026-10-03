import type { Pool, PoolClient } from "pg";
import {
  addDays,
  allocateDeposit,
  formatInvoiceNumber,
  invoiceLines,
  invoiceTotals,
  isInvoiceNumberFormat,
  roundMoney,
  type InvoiceCharge,
  type TaxPart,
} from "@hoteloftware/domain";
import type { InvoiceDocument, Party } from "@hoteloftware/invoices";
import { isUuid } from "./catalogue-common";
import { lockProperty } from "./property-lock";
import { withTenant } from "./with-tenant";

/**
 * Invoices (ticket 28). An invoice is numbered only when issued, from one
 * gap-free range per Legal Entity: the counter moves inside the issuing
 * transaction, so an issue that fails leaves no gap. Everything it shows is
 * frozen in its document (master data historised), so it renders the same
 * forever. Money received before check-in gets a Deposit Invoice at once
 * (UStG §13(1) Nr. 1a), netted on the final invoice with its VAT (§14(5)).
 * Check-out issues the open folios and needs every guest folio settled, an
 * on-account Company's folio becoming a Receivable, or a Manager override.
 */

export type RangeKind = "final" | "deposit" | "cancellation";
export const DEFAULT_FORMATS: Record<RangeKind, string> = { final: "RE-{YYYY}-{NNNNN}", deposit: "AZ-{YYYY}-{NNNNN}", cancellation: "ST-{YYYY}-{NNNNN}" };

export interface NumberRange {
  kind: RangeKind;
  format: string;
  nextValue: number;
}

export async function listInvoiceNumberRanges(pool: Pool, schema: string, legalEntityId: string): Promise<NumberRange[]> {
  if (!isUuid(legalEntityId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ kind: RangeKind; format: string; next_value: number }>("select kind, format, next_value from invoice_number_ranges where legal_entity_id = $1 order by kind", [legalEntityId])).rows.map(
      (r) => ({ kind: r.kind, format: r.format, nextValue: r.next_value }),
    ),
  );
}

/**
 * Set a range's format; a new range may start at a given counter (taking
 * over numbering from an earlier system). The counter never moves back.
 */
export async function setInvoiceNumberRange(pool: Pool, schema: string, legalEntityId: string, kind: RangeKind, format: string, startAt?: number): Promise<void> {
  if (!isInvoiceNumberFormat(format)) throw new Error("The format needs exactly one counter such as {NNNNN}");
  if (startAt !== undefined && (!Number.isInteger(startAt) || startAt < 1)) throw new Error("The first number must be a whole number from 1");
  await withTenant(pool, schema, async (tx) => {
    const cur = (await tx.query<{ next_value: number }>("select next_value from invoice_number_ranges where legal_entity_id = $1 and kind = $2 for update", [legalEntityId, kind])).rows[0];
    if (cur) {
      if (startAt !== undefined && startAt < cur.next_value) throw new Error(`Numbers up to ${cur.next_value - 1} are used; the counter cannot go back`);
      await tx.query("update invoice_number_ranges set format = $3, next_value = greatest(next_value, $4) where legal_entity_id = $1 and kind = $2", [legalEntityId, kind, format, startAt ?? 1]);
    } else {
      await tx.query("insert into invoice_number_ranges (legal_entity_id, kind, format, next_value) values ($1, $2, $3, $4)", [legalEntityId, kind, format, startAt ?? 1]);
    }
  });
}

/**
 * The next number of a range, inside the issuing transaction (row locked:
 * parallel issues queue). A deposit or cancellation invoice uses its own
 * range only when one is set up, else the final range. With a year in the
 * format the counter restarts each year.
 */
async function nextNumber(tx: PoolClient, legalEntityId: string, kind: RangeKind, issueDate: string): Promise<string> {
  const pick = async (k: RangeKind) =>
    (await tx.query<{ kind: RangeKind; format: string; next_value: number; counter_year: number | null }>(
      "select kind, format, next_value, counter_year from invoice_number_ranges where legal_entity_id = $1 and kind = $2 for update",
      [legalEntityId, k],
    )).rows[0];
  let range = (await pick(kind)) ?? (kind !== "final" ? await pick("final") : undefined);
  if (!range) {
    await tx.query("insert into invoice_number_ranges (legal_entity_id, kind, format) values ($1, 'final', $2) on conflict do nothing", [legalEntityId, DEFAULT_FORMATS.final]);
    range = (await pick("final"))!;
  }
  const year = Number(issueDate.slice(0, 4));
  const yearly = /\{YY(YY)?\}/.test(range.format);
  const counter = yearly && range.counter_year !== null && range.counter_year !== year ? 1 : range.next_value;
  await tx.query("update invoice_number_ranges set next_value = $3, counter_year = $4 where legal_entity_id = $1 and kind = $2", [legalEntityId, range.kind, counter + 1, year]);
  return formatInvoiceNumber(range.format, counter, issueDate);
}

// ── document parts ──

interface Context {
  reservationId: string;
  propertyId: string;
  legalEntityId: string;
  currency: string;
  today: string;
  confirmation: string;
  arrival: string;
  departure: string;
  status: string;
  country: string;
}

async function contextOf(tx: PoolClient, reservationId: string): Promise<Context> {
  const { rows } = await tx.query<{ id: string; property_id: string; legal_entity_id: string; currency: string; today: string; confirmation_number: string; arrival: string; departure: string; status: string; country: string }>(
    `select r.id, r.property_id, p.legal_entity_id, p.currency, to_char((now() at time zone p.time_zone)::date, 'YYYY-MM-DD') as today, b.confirmation_number,
       to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, r.status, p.country
     from reservations r join properties p on p.id = r.property_id join bookings b on b.id = r.booking_id where r.id = $1`,
    [reservationId],
  );
  const r = rows[0]!;
  return {
    reservationId: r.id,
    propertyId: r.property_id,
    legalEntityId: r.legal_entity_id,
    currency: r.currency.trim(),
    // TODO(Night Audit ticket): the Business Date
    today: r.today,
    confirmation: r.confirmation_number,
    arrival: r.arrival,
    departure: r.departure,
    status: r.status,
    country: r.country,
  };
}

async function sellerOf(tx: PoolClient, legalEntityId: string): Promise<InvoiceDocument["seller"]> {
  const l = (await tx.query<{ name: string; address_line1: string; address_line2: string; postal_code: string; city: string; country: string; vat_id: string | null; tax_number: string; invoice_email: string; invoice_phone: string; iban: string | null; bic: string | null; account_holder: string | null }>(
    "select name, address_line1, address_line2, postal_code, city, country, vat_id, tax_number, invoice_email, invoice_phone, iban, bic, account_holder from legal_entities where id = $1",
    [legalEntityId],
  )).rows[0]!;
  return {
    name: l.name,
    addressLine1: l.address_line1,
    addressLine2: l.address_line2,
    postalCode: l.postal_code,
    city: l.city,
    country: l.country.trim(),
    vatId: l.vat_id || null,
    taxNumber: l.tax_number || null,
    email: l.invoice_email || null,
    phone: l.invoice_phone || null,
    iban: l.iban || null,
    bic: l.bic || null,
    accountHolder: l.account_holder || null,
  };
}

interface BillTo {
  party: Party;
  language: "de" | "en";
  /** Days to pay (a Company's payment terms), 0 for a guest. */
  termsDays: number;
  onAccount: boolean;
  isCompany: boolean;
}

const GERMAN = new Set(["DE", "AT", "CH", "LI"]);

async function billToOf(tx: PoolClient, folioId: string, propertyCountry: string): Promise<BillTo> {
  const f = (await tx.query<{ guest_id: string | null; company_id: string | null }>("select bill_to_guest_id as guest_id, bill_to_company_id as company_id from folios where id = $1", [folioId])).rows[0]!;
  if (f.company_id) {
    const c = (await tx.query<{ name: string; address_line1: string; address_line2: string; postal_code: string; city: string; country: string | null; vat_id: string | null; payment_terms_days: number; on_account: boolean }>(
      "select name, address_line1, address_line2, postal_code, city, country, vat_id, payment_terms_days, on_account from companies where id = $1",
      [f.company_id],
    )).rows[0]!;
    const country = c.country?.trim() || propertyCountry;
    return {
      party: { name: c.name, addressLine1: c.address_line1, addressLine2: c.address_line2, postalCode: c.postal_code, city: c.city, country, vatId: c.vat_id || null },
      language: GERMAN.has(country) ? "de" : "en",
      termsDays: c.payment_terms_days,
      onAccount: c.on_account,
      isCompany: true,
    };
  }
  const g = (await tx.query<{ first_name: string; last_name: string; address_line1: string; address_line2: string; postal_code: string | null; city: string; country_of_residence: string | null; language: string | null }>(
    "select first_name, last_name, address_line1, address_line2, postal_code, city, country_of_residence, language from guests where id = $1",
    [f.guest_id],
  )).rows[0]!;
  const country = g.country_of_residence?.trim() || propertyCountry;
  return {
    party: { name: `${g.first_name} ${g.last_name}`.trim(), addressLine1: g.address_line1, addressLine2: g.address_line2, postalCode: g.postal_code ?? "", city: g.city, country, vatId: null },
    language: g.language === "de" || g.language === "en" ? g.language : GERMAN.has(country) ? "de" : "en",
    termsDays: 0,
    onAccount: false,
    isCompany: false,
  };
}

export interface IssuedInvoice {
  id: string;
  kind: "final" | "deposit";
  number: string;
  folioId: string;
  issueDate: string;
  gross: number;
  due: number;
  receivable: boolean;
  billToName: string;
}

async function storeInvoice(tx: PoolClient, ctx: Context, folioId: string, doc: InvoiceDocument, extra: { receivable: boolean; paymentId: string | null }, userId: string): Promise<IssuedInvoice> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into invoices (legal_entity_id, property_id, reservation_id, folio_id, kind, number, issue_date, due_date, currency, gross, due, receivable, document, payment_id, issued_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
    [ctx.legalEntityId, ctx.propertyId, ctx.reservationId, folioId, doc.kind, doc.number, doc.issueDate, doc.dueDate, ctx.currency, doc.totals.gross, doc.totals.due, extra.receivable, JSON.stringify(doc), extra.paymentId, userId],
  );
  return { id: rows[0]!.id, kind: doc.kind, number: doc.number, folioId, issueDate: doc.issueDate, gross: doc.totals.gross, due: doc.totals.due, receivable: extra.receivable, billToName: doc.buyer.name };
}

/**
 * Issue the invoice of a folio's uninvoiced Charges, inside the caller's
 * transaction: the folio's payments not yet invoiced count as paid, its
 * Deposit Invoices not yet netted are deducted with their VAT.
 */
async function issueIn(tx: PoolClient, ctx: Context, folioId: string, userId: string): Promise<IssuedInvoice | null> {
  const charges = (await tx.query<{ id: string; description: string; service_date: string; amount: string; unit_price: string; quantity: string; tax_code: string; tax_rate: string; origin: string }>(
    `select ch.id, ch.description, to_char(ch.service_date, 'YYYY-MM-DD') as service_date, ch.amount, ch.unit_price, ch.quantity, t.code as tax_code, ch.tax_rate, ch.origin
     from charges ch join tax_codes t on t.id = ch.tax_code_id
     where ch.folio_id = $1 and ch.invoice_id is null and ch.voided_at is null order by ch.service_date, ch.posted_at`,
    [folioId],
  )).rows;
  if (charges.length === 0) return null;
  const pending = (await tx.query("select 1 from payments where folio_id = $1 and status = 'pending' limit 1", [folioId])).rows.length;
  if (pending) throw new Error("A payment is still waiting at the reader; finish or cancel it first");
  const billTo = await billToOf(tx, folioId, ctx.country);
  const lines: InvoiceCharge[] = charges.map((c) => ({
    // the early-departure fee is stored in English; the invoice speaks the buyer's language
    description: c.origin === "fee" && billTo.language === "de" ? "Gebühr für vorzeitige Abreise" : c.description,
    serviceDate: c.service_date,
    amount: Number(c.amount),
    unitPrice: Number(c.unit_price),
    quantity: Number(c.quantity),
    taxCode: c.tax_code,
    taxRate: Number(c.tax_rate),
  }));
  const deposits = (await tx.query<{ id: string; number: string; issue_date: string; document: InvoiceDocument }>(
    "select id, number, to_char(issue_date, 'YYYY-MM-DD') as issue_date, document from invoices where folio_id = $1 and kind = 'deposit' and netted_by is null order by issued_at",
    [folioId],
  )).rows;
  const payments = (await tx.query<{ id: string; amount: string }>("select id, amount from payments where folio_id = $1 and status = 'succeeded' and invoice_id is null", [folioId])).rows;
  const paid = roundMoney(payments.reduce((s, p) => s + Number(p.amount), 0));
  const depositParts = deposits.map((d) => ({ number: d.number, issueDate: d.issue_date, byTax: d.document.totals.byTax as TaxPart[] }));
  const totals = invoiceTotals(invoiceLines(lines), { deposits: depositParts, paid });
  const dates = charges.map((c) => c.service_date).sort();
  const doc: InvoiceDocument = {
    kind: "final",
    number: await nextNumber(tx, ctx.legalEntityId, "final", ctx.today),
    issueDate: ctx.today,
    dueDate: addDays(ctx.today, billTo.termsDays),
    currency: ctx.currency,
    language: billTo.language,
    seller: await sellerOf(tx, ctx.legalEntityId),
    buyer: billTo.party,
    reference: ctx.confirmation,
    periodStart: dates[0]!,
    periodEnd: dates.at(-1)!,
    totals,
    deposits: depositParts,
    notes: [],
  };
  const issued = await storeInvoice(tx, ctx, folioId, doc, { receivable: totals.due > 0 && billTo.onAccount, paymentId: null }, userId);
  await tx.query("update charges set invoice_id = $2 where id = any($1::uuid[])", [charges.map((c) => c.id), issued.id]);
  await tx.query("update payments set invoice_id = $2 where id = any($1::uuid[])", [payments.map((p) => p.id), issued.id]);
  await tx.query("update invoices set netted_by = $2 where id = any($1::uuid[])", [deposits.map((d) => d.id), issued.id]);
  return issued;
}

/** Issue the invoice of a folio's open Charges (before check-out, say for a Company that wants it now). */
export async function issueInvoice(pool: Pool, schema: string, folioId: string, userId: string): Promise<IssuedInvoice> {
  if (!isUuid(folioId)) throw new Error("Folio not found");
  return withTenant(pool, schema, async (tx) => {
    const f = (await tx.query<{ reservation_id: string }>("select reservation_id from folios where id = $1", [folioId])).rows[0];
    if (!f) throw new Error("Folio not found");
    await tx.query("select 1 from reservations where id = $1 for update", [f.reservation_id]);
    const issued = await issueIn(tx, await contextOf(tx, f.reservation_id), folioId, userId);
    if (!issued) throw new Error("The folio has no open Charges to invoice");
    return issued;
  });
}

/**
 * A Deposit Invoice for money received before check-in (bank transfer, card
 * at the desk), with the VAT of the stay it pays for, in proportion. Called
 * when a payment settles; does nothing after check-in, for refunds, for
 * money not received by the hotel (on account, collected by the OTA), or
 * when the payment already has one.
 */
export async function issueDepositInvoiceIfDue(pool: Pool, schema: string, paymentId: string, userId: string): Promise<IssuedInvoice | null> {
  if (!isUuid(paymentId)) return null;
  return withTenant(pool, schema, async (tx) => {
    const p = (await tx.query<{ id: string; folio_id: string; reservation_id: string; amount: string; tender: string; status: string; refund_of: string | null; invoice_id: string | null; posted_at: Date }>(
      "select id, folio_id, reservation_id, amount, tender, status, refund_of, invoice_id, posted_at from payments where id = $1 for update",
      [paymentId],
    )).rows[0];
    if (!p || p.status !== "succeeded" || p.refund_of || p.invoice_id || p.tender === "on_account" || p.tender === "ota_collect") return null;
    await tx.query("select 1 from reservations where id = $1 for update", [p.reservation_id]);
    const ctx = await contextOf(tx, p.reservation_id);
    if (ctx.status !== "confirmed") return null;
    // the stay's composition by Tax Code and the rate in force each night
    const stay = (await tx.query<{ code: string; rate: string; gross: string }>(
      `select t.code, tr.rate, sum(c.amount) as gross
       from reservation_night_components c
       join reservations r on r.id = c.reservation_id
       join rate_plans pl on pl.id = r.rate_plan_id left join rate_plans base on base.id = pl.base_plan_id
       join services s on s.id = case when c.kind = 'room' then coalesce(pl.accommodation_service_id, base.accommodation_service_id) else c.service_id end
       join tax_codes t on t.id = s.tax_code_id
       cross join lateral (select rate from tax_code_rates where tax_code_id = t.id and valid_from <= c.date order by valid_from desc limit 1) tr
       where c.reservation_id = $1 group by t.code, tr.rate order by t.code`,
      [p.reservation_id],
    )).rows;
    // TODO(gate 03): a stay without an Accommodation Service has no Tax Code for its room part; no Deposit Invoice until one is set
    if (stay.length === 0) return null;
    const amount = Number(p.amount);
    const parts = allocateDeposit(amount, stay.map((x) => ({ taxCode: x.code, rate: Number(x.rate), gross: Number(x.gross) })));
    const billTo = await billToOf(tx, p.folio_id, ctx.country);
    const label = billTo.language === "de" ? "Anzahlung für den Aufenthalt" : "Deposit for the stay";
    const lines: InvoiceCharge[] = parts.map((x) => ({ description: label, serviceDate: ctx.arrival, amount: x.gross, unitPrice: x.gross, quantity: 1, taxCode: x.taxCode, taxRate: x.rate }));
    const totals = invoiceTotals(invoiceLines(lines), { paid: amount });
    const doc: InvoiceDocument = {
      kind: "deposit",
      number: await nextNumber(tx, ctx.legalEntityId, "deposit", ctx.today),
      issueDate: ctx.today,
      dueDate: null,
      currency: ctx.currency,
      language: billTo.language,
      seller: await sellerOf(tx, ctx.legalEntityId),
      buyer: billTo.party,
      reference: ctx.confirmation,
      periodStart: ctx.arrival,
      periodEnd: addDays(ctx.departure, -1),
      totals,
      deposits: [],
      receivedOn: p.posted_at.toISOString().slice(0, 10),
      notes: [],
    };
    const issued = await storeInvoice(tx, ctx, p.folio_id, doc, { receivable: false, paymentId: p.id }, userId);
    // the payment is accounted for by its Deposit Invoice, not again as "paid" on the final one
    await tx.query("update payments set invoice_id = $2 where id = $1", [p.id, issued.id]);
    return issued;
  });
}

export async function listInvoices(pool: Pool, schema: string, reservationId: string): Promise<IssuedInvoice[]> {
  if (!isUuid(reservationId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; kind: "final" | "deposit"; number: string; folio_id: string; issue_date: string; gross: string; due: string; receivable: boolean; buyer: string }>(
      `select id, kind, number, folio_id, to_char(issue_date, 'YYYY-MM-DD') as issue_date, gross, due, receivable, document -> 'buyer' ->> 'name' as buyer
       from invoices where reservation_id = $1 order by issued_at`,
      [reservationId],
    )).rows.map((r) => ({ id: r.id, kind: r.kind, number: r.number, folioId: r.folio_id, issueDate: r.issue_date, gross: Number(r.gross), due: Number(r.due), receivable: r.receivable, billToName: r.buyer })),
  );
}

/** The frozen document of an issued invoice, to render as PDF or XML. */
export async function invoiceDocument(pool: Pool, schema: string, invoiceId: string): Promise<InvoiceDocument & { reservationId: string; propertyId: string }> {
  if (!isUuid(invoiceId)) throw new Error("Invoice not found");
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ document: InvoiceDocument; reservation_id: string; property_id: string }>("select document, reservation_id, property_id from invoices where id = $1", [invoiceId])).rows[0];
    if (!r) throw new Error("Invoice not found");
    return { ...r.document, reservationId: r.reservation_id, propertyId: r.property_id };
  });
}

// ── check-out ──

/** Check-out refused: folios still open, by Bill-to and amount. */
export class CheckOutBlocked extends Error {
  constructor(readonly open: { folioNumber: number; billToName: string; balance: number }[]) {
    super(`Check-out needs every guest folio settled: ${open.map((o) => `folio ${o.folioNumber} (${o.billToName}) ${o.balance.toFixed(2)}`).join(", ")} still open`);
    this.name = "CheckOutBlocked";
  }
}

/**
 * Check a guest out: every folio with open Charges is invoiced; then each
 * folio must be at zero after payments, or billed to an on-account Company
 * (its invoice becomes a Receivable). With a Manager's override the stay
 * leaves with balances open. Everything happens in one transaction, so a
 * refused check-out issues no invoice and uses no number.
 */
export async function checkOut(pool: Pool, schema: string, reservationId: string, userId: string, options: { override: boolean }): Promise<IssuedInvoice[]> {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  return withTenant(pool, schema, async (tx) => {
    const pre = (await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [reservationId])).rows[0];
    if (!pre) throw new Error("Reservation not found");
    await lockProperty(tx, pre.property_id);
    const status = (await tx.query<{ status: string }>("select status from reservations where id = $1 for update", [reservationId])).rows[0]!.status;
    if (status !== "checked_in") throw new Error("Only a checked-in guest can be checked out");
    const ctx = await contextOf(tx, reservationId);
    const folios = (await tx.query<{ id: string; number: number }>("select id, number from folios where reservation_id = $1 order by number", [reservationId])).rows;
    const issued: IssuedInvoice[] = [];
    for (const f of folios) {
      const inv = await issueIn(tx, ctx, f.id, userId);
      if (inv) issued.push(inv);
    }
    const open: CheckOutBlocked["open"] = [];
    for (const f of folios) {
      const b = (await tx.query<{ balance: string }>(
        `select (select coalesce(sum(amount), 0) from charges where folio_id = $1 and voided_at is null)
              - (select coalesce(sum(amount), 0) from payments where folio_id = $1 and status = 'succeeded') as balance`,
        [f.id],
      )).rows[0]!;
      const balance = roundMoney(Number(b.balance));
      if (balance === 0) continue;
      const billTo = await billToOf(tx, f.id, ctx.country);
      if (billTo.isCompany && billTo.onAccount && balance > 0) continue;
      open.push({ folioNumber: f.number, billToName: billTo.party.name, balance });
    }
    if (open.length && !options.override) throw new CheckOutBlocked(open);
    await tx.query("update reservations set status = 'checked_out', checked_out_at = now(), checked_out_by = $2 where id = $1", [reservationId, userId]);
    await tx.query("insert into reservation_changes (reservation_id, user_id, action, before, after) values ($1, $2, 'check_out', $3, $4)", [
      reservationId,
      userId,
      JSON.stringify({ status: "checked_in" }),
      JSON.stringify({ status: "checked_out", ...(open.length ? { openBalance: open.reduce((s, o) => roundMoney(s + o.balance), 0) } : {}) }),
    ]);
    // TODO(ticket 33): the room turns Dirty with housekeeping's room status
    return issued;
  });
}
