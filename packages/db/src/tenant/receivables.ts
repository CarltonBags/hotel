import type { Pool, PoolClient } from "pg";
import { addDays, ageing, bucketOf, daysOverdue, nextReminderLevel, roundMoney, type AgeingBucket, type ReminderLevel } from "@hoteloftware/domain";
import type { InvoiceDocument, ReminderDocument } from "@hoteloftware/invoices/document";
import { isUuid } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/**
 * Receivables (ticket 29): issued invoices to an on-account Bill-to, still
 * open after the transfers matched to them by hand. Accounting sees them by
 * Company with their ageing, and sends reminder letters at levels 1 to 3
 * once they are overdue; each letter is frozen like an invoice.
 */

/** Days a reminder gives to pay. */
const PAY_WITHIN_DAYS = 10;

const OPEN = `i.kind = 'final' and i.receivable and i.cancelled_by is null`;
const MATCHED = `(select coalesce(sum(m.amount), 0) from receivable_matches m where m.invoice_id = i.id)`;

export interface ReceivableRow {
  invoiceId: string;
  reservationId: string;
  number: string;
  billToName: string;
  issueDate: string;
  dueDate: string;
  due: number;
  open: number;
  daysOverdue: number;
  bucket: AgeingBucket;
  reminders: { id: string; level: ReminderLevel; issuedAt: string }[];
}

export interface Receivables {
  today: string;
  currency: string;
  rows: ReceivableRow[];
  ageing: ReturnType<typeof ageing>;
}

async function propertyToday(tx: PoolClient, propertyId: string): Promise<{ today: string; currency: string }> {
  const p = (await tx.query<{ today: string; currency: string }>(
    "select to_char((now() at time zone time_zone)::date, 'YYYY-MM-DD') as today, currency from properties where id = $1",
    [propertyId],
  )).rows[0];
  if (!p) throw new Error("Property not found");
  // TODO(Night Audit ticket): the Business Date
  return { today: p.today, currency: p.currency.trim() };
}

/** The open Receivables of a property, oldest due first, with their ageing. */
export async function listReceivables(pool: Pool, schema: string, propertyId: string): Promise<Receivables> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  return withTenant(pool, schema, async (tx) => {
    const { today, currency } = await propertyToday(tx, propertyId);
    const rows = (await tx.query<{ id: string; reservation_id: string; number: string; buyer: string; issue_date: string; due_date: string; due: string; open: string }>(
      `select i.id, i.reservation_id, i.number, i.document -> 'buyer' ->> 'name' as buyer, to_char(i.issue_date, 'YYYY-MM-DD') as issue_date,
         to_char(i.due_date, 'YYYY-MM-DD') as due_date, i.due, i.due - ${MATCHED} as open
       from invoices i where i.property_id = $1 and ${OPEN} and i.due - ${MATCHED} > 0 order by i.due_date, i.number`,
      [propertyId],
    )).rows;
    const reminders = (await tx.query<{ id: string; invoice_id: string; level: ReminderLevel; issued_at: Date }>(
      "select id, invoice_id, level, issued_at from reminders where invoice_id = any($1::uuid[]) order by level",
      [rows.map((r) => r.id)],
    )).rows;
    const out: ReceivableRow[] = rows.map((r) => {
      const days = daysOverdue(r.due_date, today);
      return {
        invoiceId: r.id,
        reservationId: r.reservation_id,
        number: r.number,
        billToName: r.buyer,
        issueDate: r.issue_date,
        dueDate: r.due_date,
        due: Number(r.due),
        open: Number(r.open),
        daysOverdue: days,
        bucket: bucketOf(days),
        reminders: reminders.filter((x) => x.invoice_id === r.id).map((x) => ({ id: x.id, level: x.level, issuedAt: x.issued_at.toISOString() })),
      };
    });
    return { today, currency, rows: out, ageing: ageing(out, today) };
  });
}

export interface TransferMatch {
  receivedOn: string;
  reference: string;
  allocations: { invoiceId: string; amount: number }[];
}

/** Match an incoming transfer by hand, over one or more Receivables; never more than is open on each. */
export async function matchTransfer(pool: Pool, schema: string, input: TransferMatch, userId: string): Promise<void> {
  const reference = input.reference.trim();
  if (!reference) throw new Error("Give the transfer's reference");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) throw new Error("Give the day the transfer was received");
  const allocations = input.allocations.filter((a) => a.amount !== 0);
  if (allocations.length === 0) throw new Error("Allocate the transfer to at least one invoice");
  if (allocations.some((a) => !isUuid(a.invoiceId) || !(a.amount > 0) || roundMoney(a.amount) !== a.amount)) throw new Error("Amounts must be positive, in cents");
  if (new Set(allocations.map((a) => a.invoiceId)).size !== allocations.length) throw new Error("Each invoice once per transfer");
  await withTenant(pool, schema, async (tx) => {
    // locked in one order, so two matches over the same invoices never deadlock
    for (const a of [...allocations].sort((x, y) => x.invoiceId.localeCompare(y.invoiceId))) {
      const inv = (await tx.query<{ number: string; open: string; is_open: boolean }>(
        `select i.number, i.due - ${MATCHED} as open, (${OPEN}) as is_open from invoices i where i.id = $1 for update`,
        [a.invoiceId],
      )).rows[0];
      if (!inv || !inv.is_open) throw new Error("Only an open Receivable can be matched");
      if (a.amount > Number(inv.open)) throw new Error(`${inv.number}: that is more than is open (${Number(inv.open).toFixed(2)})`);
      await tx.query("insert into receivable_matches (invoice_id, amount, received_on, reference, created_by) values ($1, $2, $3, $4, $5)", [a.invoiceId, a.amount, input.receivedOn, reference, userId]);
    }
  });
}

/** Send the next reminder letter for an overdue Receivable: level 1, 2, then 3. */
export async function issueReminder(pool: Pool, schema: string, invoiceId: string, userId: string): Promise<{ id: string; level: ReminderLevel }> {
  if (!isUuid(invoiceId)) throw new Error("Invoice not found");
  return withTenant(pool, schema, async (tx) => {
    const inv = (await tx.query<{ property_id: string; document: InvoiceDocument; due_date: string; open: string; is_open: boolean }>(
      `select i.property_id, i.document, to_char(i.due_date, 'YYYY-MM-DD') as due_date, i.due - ${MATCHED} as open, (${OPEN}) as is_open
       from invoices i where i.id = $1 for update`,
      [invoiceId],
    )).rows[0];
    if (!inv) throw new Error("Invoice not found");
    const open = Number(inv.open);
    if (!inv.is_open || open <= 0) throw new Error("Only an open Receivable gets a reminder");
    const { today } = await propertyToday(tx, inv.property_id);
    if (daysOverdue(inv.due_date, today) === 0) throw new Error("This invoice is not overdue yet");
    const sent = (await tx.query<{ level: number }>("select level from reminders where invoice_id = $1", [invoiceId])).rows.map((r) => r.level);
    const level = nextReminderLevel(sent);
    if (!level) throw new Error("The last reminder has been sent; hand the claim on");
    const d = inv.document;
    const document: ReminderDocument = {
      level,
      issueDate: today,
      payBy: addDays(today, PAY_WITHIN_DAYS),
      currency: d.currency,
      language: d.language,
      seller: d.seller,
      buyer: d.buyer,
      invoices: [{ number: d.number, issueDate: d.issueDate, dueDate: inv.due_date, open }],
    };
    const { rows } = await tx.query<{ id: string }>("insert into reminders (invoice_id, level, document, issued_by) values ($1, $2, $3, $4) returning id", [invoiceId, level, JSON.stringify(document), userId]);
    return { id: rows[0]!.id, level };
  });
}

/** A reminder letter's frozen document and its PDF as first rendered. */
export async function reminderDocument(pool: Pool, schema: string, reminderId: string): Promise<{ document: ReminderDocument; propertyId: string; pdf: Buffer | null }> {
  if (!isUuid(reminderId)) throw new Error("Reminder not found");
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ document: ReminderDocument; property_id: string; pdf: Buffer | null }>(
      "select r.document, i.property_id, r.pdf from reminders r join invoices i on i.id = r.invoice_id where r.id = $1",
      [reminderId],
    )).rows[0];
    if (!r) throw new Error("Reminder not found");
    return { document: r.document, propertyId: r.property_id, pdf: r.pdf };
  });
}

/** Keep a reminder's PDF as first rendered; it is handed out identically for good. */
export async function keepReminderPdf(pool: Pool, schema: string, reminderId: string, pdf: Uint8Array): Promise<void> {
  await withTenant(pool, schema, (tx) => tx.query("update reminders set pdf = $2 where id = $1 and pdf is null", [reminderId, Buffer.from(pdf)]));
}
