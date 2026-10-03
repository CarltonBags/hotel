import type { Pool, PoolClient } from "pg";
import {
  auditOpen,
  auditOverdue,
  daysBehind,
  earlyDepartureFee,
  registrationGaps,
  roundMoney,
  undecidedArrivals,
  type ArrivalDecision,
  type FeeKind,
} from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { postNoShowFee } from "./folios";
import { loadGuest } from "./guests";
import { lockProperty } from "./property-lock";
import { withTenant } from "./with-tenant";

/**
 * Night Audit (ticket 32, decided in "Night audit and business date"): the
 * staff-run close of a property's Business Date. Missing arrivals are
 * decided one by one (No-show, its fee confirmed or waived with a reason, or
 * Late Arrival), overdue departures are checked out or extended first, and
 * warnings are shown and carried forward. Decisions are kept as a draft, so
 * an interrupted audit resumes. The close is one transaction: No-shows
 * marked and their rooms released, fees posted, Late Arrivals flagged, the
 * report stored, the Business Date advanced, or nothing at all. A closed
 * Business Date cannot be reopened; missed days are caught up in order.
 */

export interface MissingArrival {
  reservationId: string;
  confirmationNumber: string;
  guestName: string;
  roomNumber: string | null;
  arrival: string;
  departure: string;
  lateArrival: boolean;
  /** The Cancellation Policy's No-show fee on the stay's prices. */
  noShowFee: number;
}

export interface OverdueDeparture {
  reservationId: string;
  confirmationNumber: string;
  guestName: string;
  roomNumber: string | null;
  departure: string;
}

export interface AuditWarnings {
  openBalances: { reservationId: string; confirmationNumber: string; guestName: string; balance: number }[];
  expiringHolds: { reservationId: string; confirmationNumber: string; guestName: string; amount: number; expiresAt: string }[];
  incompleteRegistrations: { reservationId: string; confirmationNumber: string; guestName: string; missing: string[] }[];
  arrivalsWithoutRoom: { reservationId: string; confirmationNumber: string; guestName: string }[];
}

export interface NightAuditView {
  propertyId: string;
  businessDate: string;
  calendarDate: string;
  /** Days the Business Date lags the calendar. */
  behind: number;
  /** The audit may start now (its window opened, or the date is behind). */
  open: boolean;
  overdue: boolean;
  windowFrom: string;
  deadline: string;
  decisions: Record<string, ArrivalDecision>;
  missingArrivals: MissingArrival[];
  overdueDepartures: OverdueDeparture[];
  warnings: AuditWarnings;
}

interface PropertyRow {
  id: string;
  name: string;
  currency: string;
  country: string;
  time_zone: string;
  business_date: string;
  calendar_date: string;
  window_from: string;
  deadline: string;
}

async function propertyOf(tx: PoolClient, propertyId: string): Promise<PropertyRow> {
  const p = (await tx.query<PropertyRow>(
    `select id, name, currency, country, time_zone, to_char(business_date, 'YYYY-MM-DD') as business_date, to_char((now() at time zone time_zone)::date, 'YYYY-MM-DD') as calendar_date,
       to_char(night_audit_from, 'HH24:MI') as window_from, to_char(night_audit_deadline, 'HH24:MI') as deadline
     from properties where id = $1`,
    [propertyId],
  )).rows[0];
  if (!p) throw new Error("Property not found");
  return p;
}

const STAY = `r.id as reservation_id, b.confirmation_number, trim(g.first_name || ' ' || g.last_name) as guest_name,
  to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure,
  (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id order by a.from_date desc limit 1) as room_number`;
const FROM = "from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id";

interface StayRow {
  reservation_id: string;
  confirmation_number: string;
  guest_name: string;
  arrival: string;
  departure: string;
  room_number: string | null;
}

async function viewIn(tx: PoolClient, p: PropertyRow, now: Date): Promise<NightAuditView> {
  const bd = p.business_date;
  const clock = { businessDate: bd, timeZone: p.time_zone, windowFrom: p.window_from, deadline: p.deadline };
  const draft = (await tx.query<{ decisions: Record<string, ArrivalDecision> }>("select decisions from night_audits where property_id = $1 and business_date = $2 and status = 'draft'", [p.id, bd])).rows[0];

  // every Confirmed stay due by the Business Date, Late Arrivals of earlier audits included
  const missing = (await tx.query<StayRow & { late_arrival: boolean; no_show_fee_kind: FeeKind; no_show_fee_percent: string | null }>(
    `select ${STAY}, r.late_arrival, c.no_show_fee_kind, c.no_show_fee_percent
     ${FROM} join rate_plans pl on pl.id = r.rate_plan_id join cancellation_policies c on c.id = pl.cancellation_policy_id
     where r.property_id = $1 and r.status = 'confirmed' and r.arrival <= $2 order by r.arrival, b.confirmation_number`,
    [p.id, bd],
  )).rows;
  const missingArrivals: MissingArrival[] = [];
  for (const m of missing) {
    const nights = (await tx.query<{ total: string }>("select total from reservation_nights where reservation_id = $1 order by date", [m.reservation_id])).rows.map((n) => Number(n.total));
    missingArrivals.push({
      reservationId: m.reservation_id,
      confirmationNumber: m.confirmation_number,
      guestName: m.guest_name,
      roomNumber: m.room_number,
      arrival: m.arrival,
      departure: m.departure,
      lateArrival: m.late_arrival,
      noShowFee: earlyDepartureFee(m.no_show_fee_kind, m.no_show_fee_percent === null ? null : Number(m.no_show_fee_percent), nights),
    });
  }
  const overdueDepartures = (await tx.query<StayRow>(`select ${STAY} ${FROM} where r.property_id = $1 and r.status = 'checked_in' and r.departure <= $2 order by b.confirmation_number`, [p.id, bd])).rows.map(
    (d) => ({ reservationId: d.reservation_id, confirmationNumber: d.confirmation_number, guestName: d.guest_name, roomNumber: d.room_number, departure: d.departure }),
  );
  return {
    propertyId: p.id,
    businessDate: bd,
    calendarDate: p.calendar_date,
    behind: daysBehind(bd, p.calendar_date),
    open: daysBehind(bd, p.calendar_date) > 0 || auditOpen(clock, now),
    overdue: auditOverdue(clock, now),
    windowFrom: p.window_from,
    deadline: p.deadline,
    decisions: draft?.decisions ?? {},
    missingArrivals,
    overdueDepartures,
    warnings: await warningsIn(tx, p),
  };
}

async function warningsIn(tx: PoolClient, p: PropertyRow): Promise<AuditWarnings> {
  const bd = p.business_date;
  const openBalances = (await tx.query<{ reservation_id: string; confirmation_number: string; guest_name: string; balance: string }>(
    `select r.id as reservation_id, b.confirmation_number, trim(g.first_name || ' ' || g.last_name) as guest_name,
       (select coalesce(sum(amount), 0) from charges where reservation_id = r.id and voided_at is null)
       - (select coalesce(sum(amount), 0) from payments where reservation_id = r.id and (status = 'succeeded' or (refund_of is not null and status in ('pending', 'refund_pending_balance')))) as balance
     ${FROM} where r.property_id = $1 and r.status in ('checked_in', 'checked_out', 'no_show')
       and (r.status = 'checked_in' or r.departure >= $2::date - 30 or r.arrival >= $2::date - 30)`,
    [p.id, bd],
  )).rows
    .map((r) => ({ reservationId: r.reservation_id, confirmationNumber: r.confirmation_number, guestName: r.guest_name, balance: roundMoney(Number(r.balance)) }))
    .filter((r) => r.balance !== 0);
  const expiringHolds = (await tx.query<{ reservation_id: string; confirmation_number: string; guest_name: string; amount: string; expires_at: Date }>(
    `select r.id as reservation_id, b.confirmation_number, trim(g.first_name || ' ' || g.last_name) as guest_name, h.amount, h.expires_at
     from card_holds h join reservations r on r.id = h.reservation_id join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id
     where r.property_id = $1 and h.status = 'active' and h.expires_at < now() + interval '48 hours' order by h.expires_at`,
    [p.id],
  )).rows.map((h) => ({ reservationId: h.reservation_id, confirmationNumber: h.confirmation_number, guestName: h.guest_name, amount: Number(h.amount), expiresAt: h.expires_at.toISOString() }));
  const incompleteRegistrations: AuditWarnings["incompleteRegistrations"] = [];
  for (const r of (await tx.query<{ reservation_id: string; confirmation_number: string; guest_id: string }>(
    `select r.id as reservation_id, b.confirmation_number, r.primary_guest_id as guest_id from reservations r join bookings b on b.id = r.booking_id
     where r.property_id = $1 and r.status = 'checked_in' order by b.confirmation_number`,
    [p.id],
  )).rows) {
    const guest = await loadGuest(tx, r.guest_id);
    const missingFields = guest ? registrationGaps(guest, p.country) : [];
    if (guest && missingFields.length) incompleteRegistrations.push({ reservationId: r.reservation_id, confirmationNumber: r.confirmation_number, guestName: `${guest.firstName} ${guest.lastName}`.trim(), missing: missingFields });
  }
  const arrivalsWithoutRoom = (await tx.query<StayRow>(
    `select ${STAY} ${FROM} where r.property_id = $1 and r.status = 'confirmed' and r.arrival = $2::date + 1
       and not exists (select 1 from room_assignments a where a.reservation_id = r.id and a.from_date <= r.arrival and a.to_date > r.arrival)
     order by b.confirmation_number`,
    [p.id, bd],
  )).rows.map((r) => ({ reservationId: r.reservation_id, confirmationNumber: r.confirmation_number, guestName: r.guest_name }));
  // TODO(Arrived and Waiting for Room, open Shifts): with their tickets
  return { openBalances, expiringHolds, incompleteRegistrations, arrivalsWithoutRoom };
}

/** Where the property's Night Audit stands: the Business Date, the window, the decisions so far and what is left. */
export async function nightAuditView(pool: Pool, schema: string, propertyId: string, now = new Date()): Promise<NightAuditView> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  return withTenant(pool, schema, async (tx) => viewIn(tx, await propertyOf(tx, propertyId), now));
}

/** Save the decision on a missing arrival in the audit's draft (null takes it back). */
export async function saveArrivalDecision(pool: Pool, schema: string, propertyId: string, reservationId: string, decision: ArrivalDecision | null, userId: string): Promise<void> {
  if (!isUuid(propertyId) || !isUuid(reservationId)) throw new Error("Reservation not found");
  if (decision !== null) {
    if (decision.kind === "late_arrival") decision = { kind: "late_arrival" };
    else if (decision.kind === "no_show" && (decision.fee === "confirm" || decision.fee === "waive")) {
      decision = decision.fee === "waive" ? { kind: "no_show", fee: "waive", waiveReason: String(decision.waiveReason ?? "").trim().slice(0, 300) } : { kind: "no_show", fee: "confirm" };
    } else throw new Error("Decide No-show (fee confirmed or waived) or Late Arrival");
  }
  await withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    const p = await propertyOf(tx, propertyId);
    const due = (await tx.query("select 1 from reservations where id = $1 and property_id = $2 and status = 'confirmed' and arrival <= $3", [reservationId, propertyId, p.business_date])).rows.length;
    if (!due) throw new Error("Not a missing arrival of this Business Date");
    await tx.query(
      `insert into night_audits (property_id, business_date, started_by, decisions) values ($1, $2, $3, $4)
       on conflict (property_id, business_date) do update
         set decisions = case when $5::jsonb is null then night_audits.decisions - $6 else night_audits.decisions || jsonb_build_object($6, $5::jsonb) end
       where night_audits.status = 'draft'`,
      [propertyId, p.business_date, userId, decision === null ? {} : { [reservationId]: decision }, decision === null ? null : JSON.stringify(decision), reservationId],
    );
  });
}

/** A step of the close; a test injects a failure at one to see the close roll back as a whole. */
export type CloseStep = "no_shows" | "late_arrivals" | "report" | "advance";

/**
 * Close the Business Date: all or nothing. Refused before the window opens
 * (unless the date is behind), while a missing arrival is undecided or a
 * guest is in house past departure.
 */
export async function closeNightAudit(
  pool: Pool,
  schema: string,
  propertyId: string,
  userId: string,
  options: { now?: Date; inject?: (step: CloseStep) => void } = {},
): Promise<{ auditId: string; businessDate: string }> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  const now = options.now ?? new Date();
  const step = (s: CloseStep) => options.inject?.(s);
  return withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    const p = await propertyOf(tx, propertyId);
    const view = await viewIn(tx, p, now);
    if (!view.open) throw new Error(`The Night Audit of ${p.business_date} opens at ${p.window_from}`);
    const open = undecidedArrivals(
      view.missingArrivals.map((a) => a.reservationId),
      view.decisions,
    );
    if (open.length) throw new Error(`Decide every missing arrival first (${open.length} open)`);
    if (view.overdueDepartures.length) throw new Error(`Check out or extend every guest past departure first (${view.overdueDepartures.length} open)`);

    step("no_shows");
    const noShows: { reservationId: string; confirmationNumber: string; guestName: string; fee: number; feeStatus: "confirmed" | "waived" | null; waiveReason: string | null }[] = [];
    const lateArrivals: { reservationId: string; confirmationNumber: string; guestName: string }[] = [];
    for (const a of view.missingArrivals) {
      const d = view.decisions[a.reservationId]!;
      if (d.kind !== "no_show") {
        lateArrivals.push({ reservationId: a.reservationId, confirmationNumber: a.confirmationNumber, guestName: a.guestName });
        continue;
      }
      const fee = a.noShowFee;
      const feeStatus = fee > 0 ? (d.fee === "confirm" ? "confirmed" : "waived") : null;
      const waiveReason = d.fee === "waive" ? (d.waiveReason ?? null) : null;
      await tx.query("update reservations set status = 'no_show', late_arrival = false, cancellation_fee = $2, cancellation_fee_status = $3 where id = $1", [a.reservationId, fee > 0 ? fee : null, feeStatus]);
      // its nights are released: no room stays held for a No-show
      const rooms = (await tx.query("delete from room_assignments where reservation_id = $1 returning room_id, to_char(from_date, 'YYYY-MM-DD') as from, to_char(to_date, 'YYYY-MM-DD') as to", [a.reservationId])).rows;
      await tx.query("insert into reservation_changes (reservation_id, user_id, action, before, after) values ($1, $2, 'no_show', $3, $4)", [
        a.reservationId,
        userId,
        JSON.stringify({ status: "confirmed", rooms }),
        JSON.stringify({ status: "no_show", businessDate: p.business_date, fee, feeStatus, ...(waiveReason ? { waiveReason } : {}) }),
      ]);
      if (feeStatus === "confirmed") await postNoShowFee(tx, a.reservationId, fee, userId);
      // TODO(Card Guarantee ticket): charge the confirmed fee against the guarantee after the close; until then it is an open balance
      noShows.push({ reservationId: a.reservationId, confirmationNumber: a.confirmationNumber, guestName: a.guestName, fee, feeStatus, waiveReason });
    }

    step("late_arrivals");
    for (const l of lateArrivals) {
      await tx.query("update reservations set late_arrival = true where id = $1", [l.reservationId]);
      await tx.query("insert into reservation_changes (reservation_id, user_id, action, before, after) values ($1, $2, 'late_arrival', $3, $4)", [
        l.reservationId,
        userId,
        JSON.stringify({ lateArrival: false }),
        JSON.stringify({ lateArrival: true, businessDate: p.business_date }),
      ]);
    }

    step("report");
    const report = await reportIn(tx, p, view, { noShows, lateArrivals, userId, now });
    const { rows } = await tx.query<{ id: string }>(
      `insert into night_audits (property_id, business_date, started_by, decisions, status, report, closed_at, closed_by)
       values ($1, $2, $3, $4, 'closed', $5, clock_timestamp(), $3)
       on conflict (property_id, business_date) do update set status = 'closed', report = excluded.report, closed_at = excluded.closed_at, closed_by = excluded.closed_by
       returning id`,
      [propertyId, p.business_date, userId, JSON.stringify(view.decisions), JSON.stringify(report)],
    );

    step("advance");
    await tx.query("update properties set business_date = business_date + 1, night_audit_alerted_for = null where id = $1", [propertyId]);
    // TODO(ticket 33): occupied rooms turn Dirty; TODO(ticket 34): the new day's Housekeeping Tasks; TODO(ticket 37): availability changes queued for the channel manager
    return { auditId: rows[0]!.id, businessDate: p.business_date };
  });
}

/** The audit report: stored as data with the closed audit (and as PDF at first view). */
async function reportIn(
  tx: PoolClient,
  p: PropertyRow,
  view: NightAuditView,
  closing: { noShows: unknown[]; lateArrivals: unknown[]; userId: string; now: Date },
): Promise<Record<string, unknown>> {
  const bd = p.business_date;
  // the day's entries: since the previous close, or since the Business Date began for the first audit
  const since = (await tx.query<{ since: Date }>(
    `select coalesce((select closed_at from night_audits where property_id = $1 and status = 'closed' order by business_date desc limit 1), ($2::date)::timestamp at time zone $3) as since`,
    [p.id, bd, p.time_zone],
  )).rows[0]!.since;
  const rooms = Number((await tx.query<{ n: string }>("select count(*) as n from rooms where property_id = $1", [p.id])).rows[0]!.n);
  const occupied = Number((await tx.query<{ n: string }>(
    "select count(*) as n from reservation_nights n join reservations r on r.id = n.reservation_id where r.property_id = $1 and n.date = $2 and r.status in ('checked_in', 'checked_out')",
    [p.id, bd],
  )).rows[0]!.n);
  const stays = async (where: string) =>
    (await tx.query<StayRow>(`select ${STAY} ${FROM} where r.property_id = $1 and ${where} order by b.confirmation_number`, [p.id, bd])).rows.map((r) => ({
      reservationId: r.reservation_id,
      confirmationNumber: r.confirmation_number,
      guestName: r.guest_name,
      roomNumber: r.room_number,
    }));
  const revenue = (await tx.query<{ description: string; tax_code: string; tax_rate: string; gross: string }>(
    `select ch.description, t.code as tax_code, ch.tax_rate, sum(ch.amount) as gross from charges ch join tax_codes t on t.id = ch.tax_code_id
     where ch.property_id = $1 and ch.service_date = $2 and ch.voided_at is null group by ch.description, t.code, ch.tax_rate order by t.code, ch.description`,
    [p.id, bd],
  )).rows.map((r) => ({ service: r.description, taxCode: r.tax_code, taxRate: Number(r.tax_rate), gross: Number(r.gross) }));
  const payments = (await tx.query<{ tender: string; amount: string; count: string }>(
    `select tender, sum(amount) as amount, count(*) as count from payments
     where property_id = $1 and business_date = $2 and (status = 'succeeded' or (refund_of is not null and status in ('pending', 'refund_pending_balance'))) group by tender order by tender`,
    [p.id, bd],
  )).rows.map((r) => ({ tender: r.tender, amount: Number(r.amount), count: Number(r.count) }));
  const cityTax = (await tx.query<{ charged: string; absorbed: string; nights: string }>(
    "select coalesce(sum(tax) filter (where not absorbed), 0) as charged, coalesce(sum(tax) filter (where absorbed), 0) as absorbed, count(*) as nights from city_tax_nights where property_id = $1 and date = $2",
    [p.id, bd],
  )).rows[0]!;
  const voids = (await tx.query<{ confirmation_number: string; description: string; amount: string; reason: string | null; user_id: string }>(
    `select b.confirmation_number, c.description, c.amount, c.void_reason as reason, e.user_id from charge_events e join charges c on c.id = e.charge_id
     join reservations r on r.id = c.reservation_id join bookings b on b.id = r.booking_id
     where c.property_id = $1 and e.action = 'void' and c.auto_void is null and e.at > $2 order by e.at`,
    [p.id, since],
  )).rows;
  const corrections = (await tx.query<{ confirmation_number: string; description: string; amount: string; service_date: string; user_id: string }>(
    `select b.confirmation_number, c.description, c.amount, to_char(c.service_date, 'YYYY-MM-DD') as service_date, c.posted_by as user_id from charges c
     join reservations r on r.id = c.reservation_id join bookings b on b.id = r.booking_id
     where c.property_id = $1 and c.origin = 'correction' and c.business_date = $2 order by c.posted_at`,
    [p.id, bd],
  )).rows;
  const priceOverrides = (await tx.query<{ confirmation_number: string; after: Record<string, unknown>; user_id: string; approved_by: string | null }>(
    `select b.confirmation_number, rc.after, rc.user_id, rc.approved_by from reservation_changes rc join reservations r on r.id = rc.reservation_id join bookings b on b.id = r.booking_id
     where r.property_id = $1 and rc.action = 'price_override' and rc.at > $2 order by rc.at`,
    [p.id, since],
  )).rows;
  const refunds = (await tx.query<{ confirmation_number: string; amount: string; tender: string; reference: string | null; user_id: string; approved_by: string | null }>(
    `select b.confirmation_number, x.amount, x.tender, x.reference, x.posted_by as user_id, x.approved_by from payments x join reservations r on r.id = x.reservation_id join bookings b on b.id = r.booking_id
     where x.property_id = $1 and x.refund_of is not null and x.business_date = $2 order by x.posted_at`,
    [p.id, bd],
  )).rows;
  const cancellations = (await tx.query<{ number: string; gross: string; reason: string | null; user_id: string }>(
    "select number, gross, document -> 'notes' ->> 0 as reason, issued_by as user_id from invoices where property_id = $1 and kind = 'cancellation' and business_date = $2 order by issued_at",
    [p.id, bd],
  )).rows;
  const approvals = (await tx.query<{ summary: string; status: string; requested_by: string; decided_by: string | null }>(
    "select summary, status, requested_by, decided_by from approvals where property_id = $1 and coalesce(decided_at, requested_at) > $2 order by requested_at",
    [p.id, since],
  )).rows;
  const money = (v: string) => Number(v);
  return {
    property: { id: p.id, name: p.name, currency: p.currency.trim() },
    businessDate: bd,
    closedAt: closing.now.toISOString(),
    closedBy: closing.userId,
    occupancy: { rooms, occupied, percent: rooms ? roundMoney((occupied / rooms) * 100) : 0 },
    arrivals: await stays("r.arrival = $2 and r.status in ('checked_in', 'checked_out')"),
    departures: await stays("r.departure = $2 and r.status = 'checked_out'"),
    noShows: closing.noShows,
    lateArrivals: closing.lateArrivals,
    revenue,
    payments,
    cityTax: { charged: money(cityTax.charged), absorbed: money(cityTax.absorbed), nights: Number(cityTax.nights) },
    openBalances: view.warnings.openBalances,
    expiringHolds: view.warnings.expiringHolds,
    changes: {
      voids: voids.map((v) => ({ confirmationNumber: v.confirmation_number, description: v.description, amount: money(v.amount), reason: v.reason, userId: v.user_id })),
      corrections: corrections.map((c) => ({ confirmationNumber: c.confirmation_number, description: c.description, amount: money(c.amount), serviceDate: c.service_date, userId: c.user_id })),
      priceOverrides: priceOverrides.map((o) => ({ confirmationNumber: o.confirmation_number, nights: o.after.nights, reason: o.after.reason, userId: o.user_id, approvedBy: o.approved_by })),
      refunds: refunds.map((r) => ({ confirmationNumber: r.confirmation_number, amount: money(r.amount), tender: r.tender, reason: r.reference, userId: r.user_id, approvedBy: r.approved_by })),
      cancellationInvoices: cancellations.map((c) => ({ number: c.number, gross: money(c.gross), reason: c.reason, userId: c.user_id })),
      approvals: approvals.map((a) => ({ summary: a.summary, status: a.status, requestedBy: a.requested_by, decidedBy: a.decided_by })),
    },
    warnings: { incompleteRegistrations: view.warnings.incompleteRegistrations, arrivalsWithoutRoom: view.warnings.arrivalsWithoutRoom },
  };
}

export interface NightAuditReportRow {
  id: string;
  businessDate: string;
  closedAt: Date;
  closedBy: string;
}

/** The property's audit reports, newest Business Date first. */
export async function listNightAuditReports(pool: Pool, schema: string, propertyId: string): Promise<NightAuditReportRow[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; business_date: string; closed_at: Date; closed_by: string }>(
      "select id, to_char(business_date, 'YYYY-MM-DD') as business_date, closed_at, closed_by from night_audits where property_id = $1 and status = 'closed' order by business_date desc limit 400",
      [propertyId],
    )).rows.map((r) => ({ id: r.id, businessDate: r.business_date, closedAt: r.closed_at, closedBy: r.closed_by })),
  );
}

/** The stored report: sections as data (shape set by the close). */
export type NightAuditReport = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A closed audit's report as data, and its PDF as first rendered. */
export async function nightAuditReport(pool: Pool, schema: string, auditId: string): Promise<{ id: string; propertyId: string; businessDate: string; report: NightAuditReport; pdf: Buffer | null }> {
  if (!isUuid(auditId)) throw new Error("Report not found");
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ id: string; property_id: string; business_date: string; report: NightAuditReport; report_pdf: Buffer | null }>(
      "select id, property_id, to_char(business_date, 'YYYY-MM-DD') as business_date, report, report_pdf from night_audits where id = $1 and status = 'closed'",
      [auditId],
    )).rows[0];
    if (!r) throw new Error("Report not found");
    return { id: r.id, propertyId: r.property_id, businessDate: r.business_date, report: r.report, pdf: r.report_pdf };
  });
}

/** Keep a report's PDF as first rendered. */
export async function keepNightAuditPdf(pool: Pool, schema: string, auditId: string, pdf: Uint8Array): Promise<void> {
  await withTenant(pool, schema, (tx) => tx.query("update night_audits set report_pdf = $2 where id = $1 and report_pdf is null", [auditId, Buffer.from(pdf)]));
}

/** Properties whose audit is overdue and not yet alerted for its Business Date: the worker alerts Front Desk and Property Manager once per date. */
export async function overdueAudits(pool: Pool, schema: string, now = new Date()): Promise<{ propertyId: string; name: string; businessDate: string; behind: number }[]> {
  return withTenant(pool, schema, async (tx) => {
    const props = (await tx.query<PropertyRow & { alerted: string | null }>(
      `select id, name, currency, country, time_zone, to_char(business_date, 'YYYY-MM-DD') as business_date, to_char((now() at time zone time_zone)::date, 'YYYY-MM-DD') as calendar_date,
         to_char(night_audit_from, 'HH24:MI') as window_from, to_char(night_audit_deadline, 'HH24:MI') as deadline, to_char(night_audit_alerted_for, 'YYYY-MM-DD') as alerted
       from properties`,
    )).rows;
    return props
      .filter((p) => p.alerted !== p.business_date && auditOverdue({ businessDate: p.business_date, timeZone: p.time_zone, windowFrom: p.window_from, deadline: p.deadline }, now))
      .map((p) => ({ propertyId: p.id, name: p.name, businessDate: p.business_date, behind: daysBehind(p.business_date, p.calendar_date) }));
  });
}

/** Mark the overdue alert of the property's Business Date as sent. */
export async function markAuditAlerted(pool: Pool, schema: string, propertyId: string, businessDate: string): Promise<void> {
  await withTenant(pool, schema, (tx) => tx.query("update properties set night_audit_alerted_for = $2 where id = $1", [propertyId, businessDate]));
}

