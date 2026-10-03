import type { Pool } from "pg";
import { checkDate, isUuid } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/**
 * The property-wide audit log (ticket 31): every recorded change at the
 * property in one list, newest first, from the records' own history
 * (reservation changes, Charge events, payments and refunds, invoices,
 * matched transfers, rate changes, Approvals). Accounting sees the money
 * entries only.
 */

export type AuditArea = "reservation" | "money" | "rates" | "approval";

export interface AuditEntry {
  at: Date;
  area: AuditArea;
  /** reservation change actions; charge_post/void/move; payment, refund; invoice_issued, cancellation_issued, transfer_matched; rate_change; approval_requested/approved/rejected/granted */
  action: string;
  userId: string;
  approvedBy: string | null;
  /** An Approval decision: the user who asked for it. */
  requestedBy: string | null;
  recordType: "reservation" | "payment" | "invoice" | "rate" | "approval";
  recordId: string | null;
  recordLabel: string;
  amount: number | null;
  /** What changed, readable. */
  detail: string;
}

export interface AuditFilter {
  /** Property dates, inclusive. */
  from: string;
  to: string;
  userId?: string | null;
  /** Text in the record's label: a confirmation or invoice number, a guest name. */
  record?: string | null;
  area?: AuditArea | null;
}

const show = (v: unknown): string => (v === null || v === undefined ? "–" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Before and after of a reservation change, as "field: old → new" for what differs. */
function describeChange(before: Record<string, unknown>, after: Record<string, unknown>): string {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys
    .filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
    .map((k) => (k in (before ?? {}) ? `${k}: ${show(before[k])} → ${show(after?.[k])}` : `${k}: ${show(after?.[k])}`))
    .join("; ");
}

export async function auditLog(pool: Pool, schema: string, propertyId: string, filter: AuditFilter, scope: { moneyOnly: boolean }): Promise<AuditEntry[]> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  checkDate(filter.from);
  checkDate(filter.to);
  if (filter.to < filter.from) throw new Error("The period ends before it starts");
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{
      at: Date;
      area: AuditArea;
      action: string;
      user_id: string;
      approved_by: string | null;
      record_type: AuditEntry["recordType"];
      record_id: string | null;
      record_label: string;
      amount: string | null;
      detail: Record<string, unknown>;
    }>(
      `with tz as (select time_zone from properties where id = $1),
       entries as (
         select rc.at, 'reservation' as area, rc.action, rc.user_id, rc.approved_by, 'reservation' as record_type, r.id as record_id,
           b.confirmation_number || ' · ' || trim(g.first_name || ' ' || g.last_name) as record_label, null::numeric as amount,
           jsonb_build_object('before', rc.before, 'after', rc.after) as detail
         from reservation_changes rc join reservations r on r.id = rc.reservation_id join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id
         where r.property_id = $1
         union all
         select ce.at, 'money', 'charge_' || ce.action, ce.user_id, null, 'reservation', r.id,
           b.confirmation_number || ' · ' || c.description, c.amount,
           (ce.detail - 'folioId') || jsonb_build_object('serviceDate', to_char(c.service_date, 'YYYY-MM-DD'), 'voidReason', case when ce.action = 'void' then c.void_reason end)
         from charge_events ce join charges c on c.id = ce.charge_id join reservations r on r.id = c.reservation_id join bookings b on b.id = r.booking_id
         where c.property_id = $1
         union all
         select p.posted_at, 'money', case when p.refund_of is null then 'payment' else 'refund' end, p.posted_by, p.approved_by, 'payment', p.id,
           b.confirmation_number || ' · ' || p.tender, p.amount, jsonb_build_object('tender', p.tender, 'status', p.status, 'reference', p.reference)
         from payments p join reservations r on r.id = p.reservation_id join bookings b on b.id = r.booking_id
         where p.property_id = $1
         union all
         select i.issued_at, 'money', case when i.kind = 'cancellation' then 'cancellation_issued' else 'invoice_issued' end, i.issued_by, null, 'invoice', i.id,
           i.number || ' · ' || (i.document -> 'buyer' ->> 'name'), i.gross,
           jsonb_build_object('kind', i.kind, 'reason', case when i.kind = 'cancellation' then i.document -> 'notes' ->> 0 end)
         from invoices i where i.property_id = $1
         union all
         select m.created_at, 'money', 'transfer_matched', m.created_by, null, 'invoice', i.id,
           i.number || ' · ' || (i.document -> 'buyer' ->> 'name'), m.amount, jsonb_build_object('reference', m.reference, 'receivedOn', to_char(m.received_on, 'YYYY-MM-DD'))
         from receivable_matches m join invoices i on i.id = m.invoice_id where i.property_id = $1
         union all
         select rc.at, 'rates', 'rate_change', rc.user_id, null, 'rate', null,
           pl.code || ' · ' || t.code || ' · ' || to_char(rc.date, 'YYYY-MM-DD'), null,
           jsonb_build_object('field', rc.field, 'old', rc.old_value, 'new', rc.new_value, 'reason', rc.reason)
         from rate_changes rc join rate_plans pl on pl.id = rc.rate_plan_id join room_types t on t.id = rc.room_type_id where rc.property_id = $1
         union all
         select a.requested_at, 'approval', 'approval_requested', a.requested_by, null, 'approval', a.id, a.summary, null, jsonb_build_object('kind', a.kind)
         from approvals a where a.property_id = $1 and not a.in_place
         union all
         select a.decided_at, 'approval', case when a.in_place then 'approval_granted' when a.status = 'rejected' then 'approval_rejected' else 'approval_approved' end,
           a.decided_by, null, 'approval', a.id, a.summary, null, jsonb_build_object('kind', a.kind, 'requestedBy', a.requested_by, 'note', a.note)
         from approvals a where a.property_id = $1 and a.decided_by is not null
       )
       select e.* from entries e, tz
       where (e.at at time zone tz.time_zone)::date between $2 and $3
         and ($4::text is null or e.user_id = $4)
         and ($5::text is null or e.record_label ilike '%' || $5 || '%')
         and ($6::text is null or e.area = $6)
         and (not $7 or e.area = 'money')
       order by e.at desc limit 1000`,
      [propertyId, filter.from, filter.to, filter.userId || null, filter.record?.trim() || null, filter.area || null, scope.moneyOnly],
    );
    return rows.map((r) => {
      const { requestedBy, ...d } = (r.detail ?? {}) as Record<string, unknown>;
      const detail =
        r.area === "reservation"
          ? describeChange((d.before ?? {}) as Record<string, unknown>, (d.after ?? {}) as Record<string, unknown>)
          : Object.entries(d)
              .filter(([, v]) => v !== null && v !== undefined && v !== "")
              .map(([k, v]) => `${k}: ${show(v)}`)
              .join("; ");
      return {
        at: r.at,
        area: r.area,
        action: r.action,
        userId: r.user_id,
        approvedBy: r.approved_by,
        requestedBy: r.area === "approval" && typeof requestedBy === "string" ? requestedBy : null,
        recordType: r.record_type,
        recordId: r.record_id,
        recordLabel: r.record_label ?? "",
        amount: r.amount === null ? null : Number(r.amount),
        detail,
      };
    });
  });
}
