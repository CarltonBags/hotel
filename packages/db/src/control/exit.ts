import type { Pool } from "pg";
import { REMINDER_DAYS, TENANT_DELETION_DAYS, addDays, daysOverdue, nonPaymentStage, type NonPaymentStage } from "@hoteloftware/domain";
import { deleteTenant } from "../tenant/provision";

/**
 * Non-payment ladder, end and deletion (ticket 89): the stage from the oldest
 * unpaid subscription invoice, reminders to the Owner, the end of a customer
 * (cancelled or terminated) and the deletion of its data 90 days later.
 */
export interface NonPaymentStatus {
  stage: NonPaymentStage;
  daysOverdue: number | null;
  unpaid: { id: string; number: string; dueDate: string; gross: number }[];
}

export async function nonPaymentStatus(pool: Pool, tenantId: string, today: string): Promise<NonPaymentStatus> {
  const { rows } = await pool.query<{ id: string; number: string; due_date: string; gross: string }>(
    "select id, number, document ->> 'dueDate' as due_date, document -> 'totals' ->> 'gross' as gross from control.subscription_invoices where tenant_id = $1 and paid_at is null order by document ->> 'dueDate', number",
    [tenantId],
  );
  const oldest = rows[0];
  const days = oldest ? daysOverdue(oldest.due_date, today) : null;
  return { stage: nonPaymentStage(days), daysOverdue: days, unpaid: rows.map((r) => ({ id: r.id, number: r.number, dueDate: r.due_date, gross: Number(r.gross) })) };
}

/** Our staff record a subscription invoice as paid (from the bank statement, until the provider reports it). */
export async function markSubscriptionInvoicePaid(pool: Pool, invoiceId: string, userId: string): Promise<void> {
  const n = (await pool.query("update control.subscription_invoices set paid_at = now(), paid_by = $2 where id = $1 and paid_at is null", [invoiceId, userId])).rowCount;
  if (!n) throw new Error("Invoice not found or paid already");
}

/**
 * Reminders due today: per unpaid invoice the latest reminder day reached and
 * not yet sent (a missed run sends one reminder, not a pile). Marked sent with
 * every earlier day.
 */
export async function claimDueReminders(pool: Pool, today: string): Promise<{ tenantId: string; number: string; dueDate: string; day: number }[]> {
  const { rows } = await pool.query<{ id: string; tenant_id: string; number: string; due_date: string; sent: number[] | null }>(
    `select i.id, i.tenant_id, i.number, i.document ->> 'dueDate' as due_date, (select array_agg(day) from control.subscription_reminders r where r.invoice_id = i.id) as sent
     from control.subscription_invoices i join control.tenants t on t.id = i.tenant_id where i.paid_at is null and t.ended_at is null`,
  );
  const out: { tenantId: string; number: string; dueDate: string; day: number }[] = [];
  for (const r of rows) {
    const overdue = daysOverdue(r.due_date, today);
    const reached = REMINDER_DAYS.filter((d) => d <= overdue && !(r.sent ?? []).includes(d));
    const day = reached.at(-1);
    if (day === undefined) continue;
    // claimed first: two runs never remind twice
    const claimed = (await pool.query("insert into control.subscription_reminders (invoice_id, day) select $1, unnest($2::int[]) on conflict do nothing returning day", [r.id, reached])).rows.map((x) => x.day);
    if (claimed.includes(day)) out.push({ tenantId: r.tenant_id, number: r.number, dueDate: r.due_date, day });
  }
  return out;
}

/**
 * The end of a customer: cancelled by the Owner (to the month's end is the
 * contract; here the moment the Owner confirms) or terminated by us after day
 * 90 of non-payment. The data is deleted 90 days later.
 */
export async function endTenant(pool: Pool, tenantId: string, input: { reason: "cancelled" | "terminated"; today: string }, userId: string): Promise<string> {
  if (input.reason === "terminated") {
    const s = await nonPaymentStatus(pool, tenantId, input.today);
    if (s.stage !== "termination") throw new Error("Termination by us only after 90 days of non-payment");
  }
  const due = addDays(input.today, TENANT_DELETION_DAYS);
  const n = (await pool.query("update control.tenants set ended_at = now(), ended_reason = $2, deletion_due = $3 where id = $1 and ended_at is null", [tenantId, `${input.reason} by ${userId}`, due])).rowCount;
  if (!n) throw new Error("This tenant has ended already");
  return due;
}

/** A reminder that could not be sent is released, so the next run sends it. */
export async function releaseReminder(pool: Pool, number: string, day: number): Promise<void> {
  await pool.query("delete from control.subscription_reminders r using control.subscription_invoices i where i.id = r.invoice_id and i.number = $1 and r.day = $2", [number, day]);
}

/** The end of a tenant, if any: when, and the day its data goes. */
export async function tenantEnd(pool: Pool, tenantId: string): Promise<{ endedAt: Date; deletionDue: string } | null> {
  const r = (await pool.query<{ ended_at: Date | null; deletion_due: string | null }>("select ended_at, to_char(deletion_due, 'YYYY-MM-DD') as deletion_due from control.tenants where id = $1", [tenantId])).rows[0];
  return r?.ended_at && r.deletion_due ? { endedAt: r.ended_at, deletionDue: r.deletion_due } : null;
}

/** Mark paid by the invoice number on the bank statement. */
export async function markSubscriptionInvoicePaidByNumber(pool: Pool, number: string, userId: string): Promise<void> {
  const row = (await pool.query<{ id: string }>("select id from control.subscription_invoices where number = $1", [number])).rows[0];
  if (!row) throw new Error("No invoice with this number");
  await markSubscriptionInvoicePaid(pool, row.id, userId);
}

/** The daily deletion: every tenant whose deletion day has come; logged. Returns their slugs. */
export async function deleteEndedTenants(pool: Pool, today: string): Promise<string[]> {
  const { rows } = await pool.query<{ id: string; slug: string }>("select id, slug from control.tenants where deletion_due <= $1", [today]);
  const done: string[] = [];
  for (const t of rows) {
    try {
      await deleteTenant(pool, t.id, "deletion job");
      done.push(t.slug);
    } catch (err) {
      console.error(`[deletion] ${t.slug}`, err);
    }
  }
  return done;
}

/**
 * The files of deleted tenants (ticket 36): their bucket prefix is emptied by
 * the daily job, once per deletion, and the deletion record says when.
 */
export async function deleteFilesOfDeletedTenants(pool: Pool, store: { deletePrefix(prefix: string): Promise<number> }): Promise<string[]> {
  const { rows } = await pool.query<{ id: string; tenant_id: string; slug: string }>("select id, tenant_id, slug from control.tenant_deletions where files_deleted_at is null order by deleted_at");
  const done: string[] = [];
  for (const r of rows) {
    // a tenant created again under the same id would be a new tenant: only ids no longer in use are emptied
    if ((await pool.query("select 1 from control.tenants where id = $1", [r.tenant_id])).rows.length) continue;
    await store.deletePrefix(`${r.tenant_id}/`);
    await pool.query("update control.tenant_deletions set files_deleted_at = now() where id = $1", [r.id]);
    done.push(r.slug);
  }
  return done;
}
