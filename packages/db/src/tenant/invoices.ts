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
import type { InvoiceDocument, Party } from "@hoteloftware/invoices/document";
import { LABELS } from "@hoteloftware/invoices/labels";
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
 * An issued invoice never changes (a database trigger refuses it); it is
 * corrected by a Cancellation Invoice that mirrors it and frees its Charges,
 * payments and deposits for a new invoice (ticket 29).
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
      // a first number set this year is this year's: no restart at 1 on the next issue
      await tx.query(
        "update invoice_number_ranges set format = $3, next_value = greatest(next_value, $4), counter_year = case when $5::boolean then extract(year from now())::int else counter_year end where legal_entity_id = $1 and kind = $2",
        [legalEntityId, kind, format, startAt ?? 1, startAt !== undefined],
      );
    } else {
      await tx.query("insert into invoice_number_ranges (legal_entity_id, kind, format, next_value, counter_year) values ($1, $2, $3, $4, extract(year from now())::int)", [legalEntityId, kind, format, startAt ?? 1]);
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
  // the year only moves forward: a property still in the old year (another time zone) keeps counting, never restarts at 1 again
  const newYear = yearly && range.counter_year !== null && year > range.counter_year;
  const counter = newYear ? 1 : range.next_value;
  await tx.query("update invoice_number_ranges set next_value = $3, counter_year = greatest(coalesce(counter_year, $4), $4) where legal_entity_id = $1 and kind = $2", [legalEntityId, range.kind, counter + 1, year]);
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
  timeZone: string;
}

async function contextOf(tx: PoolClient, reservationId: string): Promise<Context> {
  const { rows } = await tx.query<{ id: string; property_id: string; legal_entity_id: string; currency: string; today: string; confirmation_number: string; arrival: string; departure: string; status: string; country: string; time_zone: string }>(
    `select r.id, r.property_id, p.legal_entity_id, p.currency, p.time_zone, to_char((now() at time zone p.time_zone)::date, 'YYYY-MM-DD') as today, b.confirmation_number,
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
    timeZone: r.time_zone,
  };
}

export async function sellerOf(tx: PoolClient, legalEntityId: string): Promise<InvoiceDocument["seller"]> {
  const l = (await tx.query<{ name: string; address_line1: string; address_line2: string; postal_code: string; city: string; country: string; vat_id: string | null; tax_number: string; invoice_email: string; invoice_phone: string; iban: string | null; bic: string | null; account_holder: string | null }>(
    "select name, address_line1, address_line2, postal_code, city, country, vat_id, tax_number, invoice_email, invoice_phone, iban, bic, account_holder from legal_entities where id = $1",
    [legalEntityId],
  )).rows[0]!;
  // UStG §14(4): the issuer's full address and its VAT ID or tax number
  if (!l.vat_id && !l.tax_number) throw new Error("Invoices need the Legal Entity's VAT ID or tax number (Settings → Legal Entities)");
  if (!l.address_line1 || !l.postal_code || !l.city) throw new Error("Invoices need the Legal Entity's full address (Settings → Legal Entities)");
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
  /** A public-sector buyer's Leitweg-ID: the e-invoice's buyer reference. */
  reference: string | null;
}

const GERMAN = new Set(["DE", "AT", "CH", "LI"]);

async function billToOf(tx: PoolClient, folioId: string, propertyCountry: string): Promise<BillTo> {
  const f = (await tx.query<{ guest_id: string | null; company_id: string | null }>("select bill_to_guest_id as guest_id, bill_to_company_id as company_id from folios where id = $1", [folioId])).rows[0]!;
  if (f.company_id) {
    const c = (await tx.query<{ name: string; address_line1: string; address_line2: string; postal_code: string; city: string; country: string | null; vat_id: string | null; payment_terms_days: number; on_account: boolean; buyer_reference: string }>(
      "select name, address_line1, address_line2, postal_code, city, country, vat_id, payment_terms_days, on_account, buyer_reference from companies where id = $1",
      [f.company_id],
    )).rows[0]!;
    const country = c.country?.trim() || propertyCountry;
    return {
      party: { name: c.name, addressLine1: c.address_line1, addressLine2: c.address_line2, postalCode: c.postal_code, city: c.city, country, vatId: c.vat_id || null },
      language: GERMAN.has(country) ? "de" : "en",
      termsDays: c.payment_terms_days,
      onAccount: c.on_account,
      isCompany: true,
      reference: c.buyer_reference || null,
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
    reference: null,
  };
}

export interface IssuedInvoice {
  id: string;
  kind: InvoiceDocument["kind"];
  number: string;
  folioId: string;
  issueDate: string;
  gross: number;
  due: number;
  receivable: boolean;
  billToName: string;
  /** The Cancellation Invoice that cancelled this one. */
  cancelledBy: string | null;
}

type Stored = Pick<Context, "legalEntityId" | "propertyId" | "reservationId" | "currency">;

async function storeInvoice(tx: PoolClient, ctx: Stored, folioId: string, doc: InvoiceDocument, extra: { receivable: boolean; paymentId: string | null; cancels?: string }, userId: string): Promise<IssuedInvoice> {
  // the document shows a Cancellation Invoice's totals as on the original; the books count them negative
  const sign = doc.kind === "cancellation" ? -1 : 1;
  const gross = sign * doc.totals.gross;
  const due = sign * doc.totals.due;
  const { rows } = await tx.query<{ id: string }>(
    `insert into invoices (legal_entity_id, property_id, reservation_id, folio_id, kind, number, issue_date, due_date, currency, gross, due, receivable, document, payment_id, cancels, issued_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
    [ctx.legalEntityId, ctx.propertyId, ctx.reservationId, folioId, doc.kind, doc.number, doc.issueDate, doc.dueDate, ctx.currency, gross, due, extra.receivable, JSON.stringify(doc), extra.paymentId, extra.cancels ?? null, userId],
  );
  return { id: rows[0]!.id, kind: doc.kind, number: doc.number, folioId, issueDate: doc.issueDate, gross, due, receivable: extra.receivable, billToName: doc.buyer.name, cancelledBy: null };
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
  const pending = (await tx.query("select 1 from payments where folio_id = $1 and status = 'pending' and refund_of is null limit 1", [folioId])).rows.length;
  if (pending) throw new Error("A payment is still waiting at the reader; finish or cancel it first");
  const billTo = await billToOf(tx, folioId, ctx.country);
  const lines: InvoiceCharge[] = charges.map((c) => ({
    // the early-departure fee is stored in English; the invoice speaks the buyer's language
    description: c.origin === "fee" ? LABELS[billTo.language].earlyDepartureFee : c.description,
    serviceDate: c.service_date,
    amount: Number(c.amount),
    unitPrice: Number(c.unit_price),
    quantity: Number(c.quantity),
    taxCode: c.tax_code,
    taxRate: Number(c.tax_rate),
  }));
  const deposits = (await tx.query<{ id: string; number: string; issue_date: string; document: InvoiceDocument; payment_id: string; refunded: string }>(
    `select i.id, i.number, to_char(i.issue_date, 'YYYY-MM-DD') as issue_date, i.document, i.payment_id,
       (select coalesce(sum(r.amount), 0) from payments r where r.refund_of = i.payment_id and r.status = 'succeeded') as refunded
     from invoices i where i.folio_id = $1 and i.kind = 'deposit' and i.netted_by is null and i.cancelled_by is null order by i.issued_at`,
    [folioId],
  )).rows;
  // refunds of a deposit belong to its deposit, not to the payments of the stay
  const depositPayments = deposits.map((d) => d.payment_id);
  // payments received, and refunds once sent (pending or waiting for balance count: the money is owed back)
  const payments = (await tx.query<{ id: string; amount: string; refund_of: string | null; tender: string }>(
    `select id, amount, refund_of, tender from payments where folio_id = $1 and invoice_id is null
       and (status = 'succeeded' or (refund_of is not null and status in ('pending', 'refund_pending_balance')))`,
    [folioId],
  )).rows;
  // "on account" is no money received: it stays due and the invoice becomes a Receivable
  const onAccount = payments.some((p) => p.tender === "on_account" && !p.refund_of);
  const paid = roundMoney(payments.filter((p) => p.tender !== "on_account" && !depositPayments.includes(p.refund_of ?? "")).reduce((s, p) => s + Number(p.amount), 0));
  // a deposit partly refunded is netted for what was kept, with the VAT of that part
  // TODO: the refunded part could get its own correcting document; a fully refunded deposit can be cancelled
  const depositParts = deposits
    .map((d) => {
      const kept = roundMoney(Number(d.document.totals.gross) + Number(d.refunded));
      const byTax = d.document.totals.byTax as TaxPart[];
      return { number: d.number, issueDate: d.issue_date, byTax: kept === Number(d.document.totals.gross) ? byTax : allocateDeposit(Math.max(0, kept), byTax) };
    })
    .filter((d) => d.byTax.some((x) => x.gross > 0));
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
    reference: billTo.reference ?? ctx.confirmation,
    periodStart: dates[0]!,
    periodEnd: dates.at(-1)!,
    totals,
    deposits: depositParts,
    notes: [],
  };
  // UStG §14(4) Nr. 1: the recipient's address, waived only for small invoices up to 250 € (§33 UStDV)
  if (!billTo.isCompany && totals.gross > 250 && (!billTo.party.addressLine1 || !billTo.party.city)) {
    throw new Error(`${billTo.party.name}'s address is needed for invoices over 250 € (Guest details)`);
  }
  const issued = await storeInvoice(tx, ctx, folioId, doc, { receivable: totals.due > 0 && (billTo.onAccount || onAccount), paymentId: null }, userId);
  await tx.query("update charges set invoice_id = $2 where id = any($1::uuid[])", [charges.map((c) => c.id), issued.id]);
  await tx.query("update payments set invoice_id = $2 where id = any($1::uuid[])", [payments.map((p) => p.id), issued.id]);
  await tx.query("update invoices set netted_by = $2 where id = any($1::uuid[])", [deposits.map((d) => d.id), issued.id]);
  return issued;
}

/** Issue the invoice of a folio's open Charges (before check-out, say for a Company that wants it now). */
export async function issueInvoice(pool: Pool, schema: string, folioId: string, userId: string): Promise<IssuedInvoice> {
  if (!isUuid(folioId)) throw new Error("Folio not found");
  return withTenant(pool, schema, async (tx) => {
    const f = (await tx.query<{ reservation_id: string; property_id: string }>("select f.reservation_id, r.property_id from folios f join reservations r on r.id = f.reservation_id where f.id = $1", [folioId])).rows[0];
    if (!f) throw new Error("Folio not found");
    await lockProperty(tx, f.property_id);
    await tx.query("select 1 from reservations where id = $1 for update", [f.reservation_id]);
    const issued = await issueIn(tx, await contextOf(tx, f.reservation_id), folioId, userId);
    if (!issued) throw new Error("The folio has no open Charges to invoice");
    return issued;
  });
}

export async function issueDepositInvoiceIfDue(pool: Pool, schema: string, paymentId: string, userId: string): Promise<IssuedInvoice | null> {
  if (!isUuid(paymentId)) return null;
  return withTenant(pool, schema, (tx) => depositIn(tx, paymentId, userId));
}

/** The stay's composition by Tax Code and the rate in force each night: what a deposit is taxed by. */
async function stayComposition(tx: PoolClient, reservationId: string): Promise<{ taxCode: string; rate: number; gross: number }[]> {
  const rows = (await tx.query<{ code: string; rate: string; gross: string }>(
    `select t.code, tr.rate, sum(c.amount) as gross
     from reservation_night_components c
     join reservations r on r.id = c.reservation_id
     join rate_plans pl on pl.id = r.rate_plan_id left join rate_plans base on base.id = pl.base_plan_id
     join services s on s.id = case when c.kind = 'room' then coalesce(pl.accommodation_service_id, base.accommodation_service_id) else c.service_id end
     join tax_codes t on t.id = s.tax_code_id
     cross join lateral (select rate from tax_code_rates where tax_code_id = t.id and valid_from <= c.date order by valid_from desc limit 1) tr
     where c.reservation_id = $1 group by t.code, tr.rate order by t.code`,
    [reservationId],
  )).rows;
  return rows.map((x) => ({ taxCode: x.code, rate: Number(x.rate), gross: Number(x.gross) }));
}

/** Tenders whose money the hotel receives: a payment by them before check-in needs a Deposit Invoice. */
const RECEIVED = new Set(["card_terminal", "card_online", "bank_transfer", "ota_virtual_card"]);

/**
 * Before money is taken ahead of check-in: the stay must be taxable as a
 * deposit (every component has a Tax Code, which needs the Rate Plan's
 * Accommodation Service), or the Deposit Invoice could not be issued.
 */
export async function assertDepositInvoiceable(tx: PoolClient, reservationId: string, tender: string): Promise<void> {
  if (!RECEIVED.has(tender)) return;
  const status = (await tx.query<{ status: string }>("select status from reservations where id = $1", [reservationId])).rows[0]?.status;
  if (status !== "confirmed") return;
  const components = Number((await tx.query<{ n: string }>("select count(*) as n from reservation_night_components where reservation_id = $1", [reservationId])).rows[0]!.n);
  const taxed = (await stayComposition(tx, reservationId)).length;
  if (components === 0 || taxed === 0) throw new Error("Money before check-in needs a Deposit Invoice: set the Rate Plan's Accommodation Service first (Settings → Rate Plans)");
}

/**
 * A Deposit Invoice for money received before check-in, with the VAT of the
 * stay it pays for, in proportion; inside the transaction that settles the
 * payment, so the payment never stands without it. Does nothing after
 * check-in, for refunds, for money the hotel does not receive (on account,
 * collected by the OTA), or when the payment already has one.
 */
export async function depositIn(tx: PoolClient, paymentId: string, userId: string): Promise<IssuedInvoice | null> {
  const p = (await tx.query<{ id: string; folio_id: string; reservation_id: string; amount: string; tender: string; status: string; refund_of: string | null; invoice_id: string | null; posted_at: Date }>(
    "select id, folio_id, reservation_id, amount, tender, status, refund_of, invoice_id, posted_at from payments where id = $1 for update",
    [paymentId],
  )).rows[0];
  if (!p || p.status !== "succeeded" || p.refund_of || p.invoice_id || !RECEIVED.has(p.tender)) return null;
  const ctx = await contextOf(tx, p.reservation_id);
  if (ctx.status !== "confirmed") return null;
  const stay = await stayComposition(tx, p.reservation_id);
  if (stay.length === 0) throw new Error("Money before check-in needs a Deposit Invoice: set the Rate Plan's Accommodation Service first (Settings → Rate Plans)");
  const amount = Number(p.amount);
  const parts = allocateDeposit(amount, stay);
  const billTo = await billToOf(tx, p.folio_id, ctx.country);
  const label = LABELS[billTo.language].depositLine;
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
    reference: billTo.reference ?? ctx.confirmation,
    periodStart: ctx.arrival,
    periodEnd: addDays(ctx.departure, -1),
    totals,
    deposits: [],
    receivedOn: new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timeZone }).format(p.posted_at),
    notes: [],
  };
  const issued = await storeInvoice(tx, ctx, p.folio_id, doc, { receivable: false, paymentId: p.id }, userId);
  // the payment is accounted for by its Deposit Invoice, not again as "paid" on the final one
  await tx.query("update payments set invoice_id = $2 where id = $1", [p.id, issued.id]);
  return issued;
}

export async function listInvoices(pool: Pool, schema: string, reservationId: string): Promise<IssuedInvoice[]> {
  if (!isUuid(reservationId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; kind: IssuedInvoice["kind"]; number: string; folio_id: string; issue_date: string; gross: string; due: string; receivable: boolean; buyer: string; cancelled_by: string | null }>(
      `select id, kind, number, folio_id, to_char(issue_date, 'YYYY-MM-DD') as issue_date, gross, due, receivable, document -> 'buyer' ->> 'name' as buyer, cancelled_by
       from invoices where reservation_id = $1 order by issued_at`,
      [reservationId],
    )).rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      number: r.number,
      folioId: r.folio_id,
      issueDate: r.issue_date,
      gross: Number(r.gross),
      due: Number(r.due),
      receivable: r.receivable,
      billToName: r.buyer,
      cancelledBy: r.cancelled_by,
    })),
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

// ── correction ──

/**
 * Cancel an issued invoice by a Cancellation Invoice: a new number from the
 * cancellation range, the original's document mirrored and referenced, its
 * totals reversed in the books. The original's Charges, payments and netted
 * deposits are free again, so the folio can be corrected (moved to another
 * Bill-to for a recipient change) and invoiced anew. Refused once money is
 * matched to it, and for a deposit already netted on a final invoice. A
 * Deposit Invoice cancelled before check-in is issued anew at once for its
 * payment (to the folio's Bill-to as it is now); after check-in the payment
 * counts as paid on the final invoice.
 */
export async function cancelInvoice(pool: Pool, schema: string, invoiceId: string, reason: string, userId: string): Promise<IssuedInvoice> {
  if (!isUuid(invoiceId)) throw new Error("Invoice not found");
  const why = reason.trim();
  if (!why) throw new Error("Give a reason for the Cancellation Invoice");
  return withTenant(pool, schema, async (tx) => {
    const pre = (await tx.query<{ property_id: string }>("select property_id from invoices where id = $1", [invoiceId])).rows[0];
    if (!pre) throw new Error("Invoice not found");
    await lockProperty(tx, pre.property_id);
    await tx.query("select 1 from invoices where id = $1 for update", [invoiceId]);
    // read after the lock, in its own statement: a transfer matched meanwhile is seen
    const inv = (await tx.query<{ id: string; kind: IssuedInvoice["kind"]; reservation_id: string; folio_id: string; document: InvoiceDocument; cancelled_by: string | null; netted_by: string | null; payment_id: string | null; matched: boolean }>(
      `select i.id, i.kind, i.reservation_id, i.folio_id, i.document, i.cancelled_by, i.netted_by, i.payment_id,
         exists (select 1 from receivable_matches m where m.invoice_id = i.id) as matched
       from invoices i where i.id = $1`,
      [invoiceId],
    )).rows[0]!;
    if (inv.kind === "cancellation") throw new Error("A Cancellation Invoice cannot be cancelled; issue a new invoice instead");
    if (inv.cancelled_by) throw new Error("This invoice is already cancelled");
    if (inv.netted_by) throw new Error("This Deposit Invoice is netted on a final invoice; cancel that one first");
    if (inv.matched) throw new Error("Money is matched to this invoice; it cannot be cancelled");
    const ctx = await contextOf(tx, inv.reservation_id);
    const original = inv.document;
    const doc: InvoiceDocument = {
      ...original,
      kind: "cancellation",
      number: await nextNumber(tx, ctx.legalEntityId, "cancellation", ctx.today),
      issueDate: ctx.today,
      dueDate: null,
      cancels: { number: original.number, issueDate: original.issueDate },
      // the reason first: the cancellation list shows it
      notes: [why, ...original.notes],
    };
    const cancellation = await storeInvoice(tx, ctx, inv.folio_id, doc, { receivable: false, paymentId: null, cancels: inv.id }, userId);
    await tx.query("update invoices set cancelled_by = $2, receivable = false where id = $1", [inv.id, cancellation.id]);
    // free for a new invoice: what it billed, what it counted as paid, the deposits it netted
    await tx.query("update charges set invoice_id = null where invoice_id = $1", [inv.id]);
    await tx.query("update payments set invoice_id = null where invoice_id = $1", [inv.id]);
    await tx.query("update invoices set netted_by = null where netted_by = $1", [inv.id]);
    if (inv.kind === "deposit" && inv.payment_id) await depositIn(tx, inv.payment_id, userId);
    return cancellation;
  });
}

export interface CancellationListRow {
  id: string;
  number: string;
  issueDate: string;
  cancelsId: string;
  cancelsNumber: string;
  reservationId: string;
  billToName: string;
  gross: number;
  reason: string;
  issuedBy: string;
}

/** The Cancellation Invoices of a property, newest first: part of the money audit trail. */
export async function listCancellationInvoices(pool: Pool, schema: string, propertyId: string): Promise<CancellationListRow[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; number: string; issue_date: string; cancels: string; cancels_number: string; reservation_id: string; buyer: string; gross: string; reason: string | null; issued_by: string }>(
      `select c.id, c.number, to_char(c.issue_date, 'YYYY-MM-DD') as issue_date, c.cancels, o.number as cancels_number, c.reservation_id,
         c.document -> 'buyer' ->> 'name' as buyer, c.gross, c.document -> 'notes' ->> 0 as reason, c.issued_by
       from invoices c join invoices o on o.id = c.cancels
       where c.property_id = $1 and c.kind = 'cancellation' order by c.issued_at desc limit 500`,
      [propertyId],
    )).rows.map((r) => ({
      id: r.id,
      number: r.number,
      issueDate: r.issue_date,
      cancelsId: r.cancels,
      cancelsNumber: r.cancels_number,
      reservationId: r.reservation_id,
      billToName: r.buyer,
      gross: Number(r.gross),
      reason: r.reason ?? "",
      issuedBy: r.issued_by,
    })),
  );
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
    const issuedIds = issued.map((i) => i.id);
    for (const f of folios) {
      const b = (await tx.query<{ balance: string }>(
        `select (select coalesce(sum(amount), 0) from charges where folio_id = $1 and voided_at is null)
              - (select coalesce(sum(amount), 0) from payments where folio_id = $1
                   and (status = 'succeeded' or (refund_of is not null and status in ('pending', 'refund_pending_balance')))) as balance`,
        [f.id],
      )).rows[0]!;
      const balance = roundMoney(Number(b.balance));
      if (balance === 0) continue;
      const billTo = await billToOf(tx, f.id, ctx.country);
      if (billTo.isCompany && billTo.onAccount && balance > 0) continue;
      open.push({ folioNumber: f.number, billToName: billTo.party.name, balance });
    }
    if (open.length && !options.override) throw new CheckOutBlocked(open);
    // overridden: what stays unpaid is an open item, never lost
    if (open.length) await tx.query("update invoices set receivable = true where id = any($1::uuid[]) and due > 0", [issuedIds]);
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

/** The files of an issued invoice as first rendered (null until then). */
export async function invoiceFiles(pool: Pool, schema: string, invoiceId: string): Promise<{ pdf: Buffer | null; xml: string | null }> {
  if (!isUuid(invoiceId)) throw new Error("Invoice not found");
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ pdf: Buffer | null; xml: string | null }>("select pdf, xml from invoices where id = $1", [invoiceId])).rows[0];
    if (!r) throw new Error("Invoice not found");
    return r;
  });
}

/** Keep a rendered file; the first one kept stays (an invoice is handed out identically for good). */
export async function keepInvoiceFile(pool: Pool, schema: string, invoiceId: string, file: { pdf: Uint8Array } | { xml: string }): Promise<void> {
  await withTenant(pool, schema, (tx) =>
    "pdf" in file
      ? tx.query("update invoices set pdf = $2 where id = $1 and pdf is null", [invoiceId, Buffer.from(file.pdf)])
      : tx.query("update invoices set xml = $2 where id = $1 and xml is null", [invoiceId, file.xml]),
  );
}
