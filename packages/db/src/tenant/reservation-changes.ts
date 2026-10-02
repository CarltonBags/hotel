import type { Pool, PoolClient } from "pg";
import {
  OCCUPYING_STATUSES,
  cancellationFee,
  nightsNeedingRoom,
  nightsOf,
  nightsToReprice,
  roundMoney,
  sameAges,
  splitAssignment,
  type AssignmentSegment,
  type FeeKind,
  type QuoteReason,
  type ReservationChangeAction,
  type StayShape,
} from "@hoteloftware/domain";
import { checkDate, isUuid } from "./catalogue-common";
import { lockProperty } from "./property-lock";
import { REASON_TEXT, loadQuoteData, quoteFor, writeNights } from "./reservations";
import { withTenant } from "./with-tenant";

/**
 * Changes to a Reservation after booking ("Reservation and inventory domain
 * model"): in-place edits of dates, occupancy and room type with an
 * Availability re-check and repricing of changed nights only; forced
 * overbooking; cancellation with the Cancellation Policy fee; Room
 * Assignments as date-ranged segments. Every change writes one
 * reservation_changes entry with the state before and after. All writers
 * take the property lock that bookings and rate writes take.
 */

interface ResRow {
  id: string;
  property_id: string;
  booking_id: string;
  room_type_id: string;
  rate_plan_id: string;
  arrival: string;
  departure: string;
  adults: number;
  child_ages: number[];
  status: string;
  overbooked: boolean;
  cancellation_fee: string | null;
  cancellation_fee_status: string | null;
  time_zone: string;
}

const RES_COLUMNS = `r.id, r.property_id, r.booking_id, r.room_type_id, r.rate_plan_id, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure,
       r.adults, r.child_ages, r.status, r.overbooked, r.cancellation_fee, r.cancellation_fee_status, p.time_zone`;

/** For a write: takes the property lock (as bookings and rate writes do), then the row. */
async function loadForChange(tx: PoolClient, id: string): Promise<ResRow> {
  if (!isUuid(id)) throw new Error("Reservation not found");
  const pre = await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [id]);
  if (!pre.rows[0]) throw new Error("Reservation not found");
  await lockProperty(tx, pre.rows[0].property_id);
  const { rows } = await tx.query<ResRow>(`select ${RES_COLUMNS} from reservations r join properties p on p.id = r.property_id where r.id = $1 for update of r`, [id]);
  return rows[0]!;
}

/** For a read such as a fee preview: no locks, so bookings and rate writes are not held up. */
async function loadForRead(tx: PoolClient, id: string): Promise<ResRow> {
  if (!isUuid(id)) throw new Error("Reservation not found");
  const { rows } = await tx.query<ResRow>(`select ${RES_COLUMNS} from reservations r join properties p on p.id = r.property_id where r.id = $1`, [id]);
  if (!rows[0]) throw new Error("Reservation not found");
  return rows[0];
}

async function nightTotals(tx: PoolClient, id: string): Promise<{ date: string; total: number }[]> {
  const { rows } = await tx.query<{ date: string; total: string }>("select to_char(date, 'YYYY-MM-DD') as date, total from reservation_nights where reservation_id = $1 order by date", [id]);
  return rows.map((r) => ({ date: r.date, total: Number(r.total) }));
}

async function segments(tx: PoolClient, id: string): Promise<AssignmentSegment[]> {
  const { rows } = await tx.query<{ room_id: string; from_date: string; to_date: string }>(
    "select room_id, to_char(from_date, 'YYYY-MM-DD') as from_date, to_char(to_date, 'YYYY-MM-DD') as to_date from room_assignments where reservation_id = $1 order by from_date",
    [id],
  );
  return rows.map((r) => ({ roomId: r.room_id, from: r.from_date, to: r.to_date }));
}

async function logChange(tx: PoolClient, id: string, userId: string, action: ReservationChangeAction, before: unknown, after: unknown): Promise<void> {
  await tx.query("insert into reservation_changes (reservation_id, user_id, action, before, after) values ($1, $2, $3, $4, $5)", [id, userId, action, JSON.stringify(before), JSON.stringify(after)]);
}

const sumTotals = (nights: { total: number }[]) => roundMoney(nights.reduce((sum, n) => sum + n.total, 0));

function snapshot(r: ResRow, nights: { date: string; total: number }[], rooms: AssignmentSegment[]) {
  return { arrival: r.arrival, departure: r.departure, adults: r.adults, childAges: r.child_ages, roomTypeId: r.room_type_id, total: sumTotals(nights), rooms };
}

function requireOpen(r: ResRow): void {
  if (r.status === "cancelled" || r.status === "no_show" || r.status === "checked_out") throw new Error(`The reservation is ${r.status.replace("_", " ")} and cannot be changed`);
}

export interface ReservationPatch {
  arrival?: string | undefined;
  departure?: string | undefined;
  adults?: number | undefined;
  childAges?: number[] | undefined;
  roomTypeId?: string | undefined;
}

/** Thrown when a change needs rooms the room type no longer has; the caller may ask the user and retry with force. */
export class OverbookingNeeded extends Error {
  constructor() {
    super("The room type is sold out on at least one new night; confirm to overbook");
    this.name = "OverbookingNeeded";
  }
}

/** Quote reasons that stop a staff edit. Restrictions (stop sell, minimum stay, closed to arrival) steer selling, not staff changes, so they do not apply here. */
const EDIT_BLOCKERS = new Set<QuoteReason>(["no_adult", "too_many_adults", "too_many_persons", "components_exceed_price"]);

/** Room Assignments after an edit: none on a new room type, otherwise trimmed to the new stay. */
async function trimAssignments(tx: PoolClient, id: string, after: StayShape, roomTypeChanged: boolean): Promise<void> {
  if (roomTypeChanged) {
    await tx.query("delete from room_assignments where reservation_id = $1", [id]);
    return;
  }
  await tx.query("delete from room_assignments where reservation_id = $1 and (to_date <= $2 or from_date >= $3)", [id, after.arrival, after.departure]);
  await tx.query("update room_assignments set from_date = greatest(from_date, $2::date), to_date = least(to_date, $3::date) where reservation_id = $1", [id, after.arrival, after.departure]);
}

/**
 * Change dates, occupancy or room type in place. Nights needing a room the
 * reservation did not hold (domain nightsNeedingRoom) must be free unless
 * forced; nights the change touches (nightsToReprice) get current prices,
 * kept nights keep their stored price. Nights that fall away are removed, and
 * Room Assignments follow the stay. The overbooked flag is recomputed.
 */
export async function updateReservation(pool: Pool, schema: string, id: string, userId: string, patch: ReservationPatch, options: { force?: boolean } = {}): Promise<{ overbooked: boolean }> {
  return withTenant(pool, schema, async (tx) => {
    const res = await loadForChange(tx, id);
    requireOpen(res);
    const before: StayShape = { arrival: res.arrival, departure: res.departure, adults: res.adults, childAges: res.child_ages, roomTypeId: res.room_type_id };
    const after: StayShape = {
      arrival: patch.arrival !== undefined ? checkDate(patch.arrival) : res.arrival,
      departure: patch.departure !== undefined ? checkDate(patch.departure) : res.departure,
      adults: patch.adults ?? res.adults,
      childAges: patch.childAges ?? res.child_ages,
      roomTypeId: patch.roomTypeId ?? res.room_type_id,
    };
    const roomTypeChanged = after.roomTypeId !== before.roomTypeId;
    const datesMove = after.arrival !== before.arrival || after.departure !== before.departure;
    if (!datesMove && !roomTypeChanged && after.adults === before.adults && sameAges(after.childAges, before.childAges)) return { overbooked: res.overbooked };
    if (res.status === "checked_in" && after.arrival !== before.arrival) throw new Error("The arrival of a checked-in guest cannot move");
    if (res.status === "checked_in" && roomTypeChanged) throw new Error("A checked-in guest changes room type through a room move");
    // TODO(Night Audit ticket): use the property's Business Date instead of its wall-clock date
    const today = (await tx.query<{ today: string }>("select to_char((now() at time zone $1)::date, 'YYYY-MM-DD') as today", [res.time_zone])).rows[0]!.today;
    if (after.arrival !== before.arrival && after.arrival < today) throw new Error("Arrival cannot move into the past");
    if (after.departure !== before.departure && after.departure < today) throw new Error("Departure cannot move into the past");

    const data = await loadQuoteData(tx, res.property_id, after.arrival, after.departure, res.id);
    const type = data.types.find((t) => t.id === after.roomTypeId);
    if (!type) throw new Error("Room type not found at this property");
    const plan = data.plans.find((p) => p.id === res.rate_plan_id) ?? null;
    if (!plan || !plan.room_type_ids.includes(type.id)) throw new Error(`The Rate Plan of this reservation does not sell ${type.code}`);
    if (datesMove && !plan.date_change_allowed) throw new Error(`${plan.code} does not allow date changes`);
    const quote = quoteFor(data, plan, type, { arrival: after.arrival, departure: after.departure, adults: after.adults, childAges: after.childAges }, () => 0);

    const full = (d: string) => type.rooms - data.roomsTaken(type.id, d) <= 0;
    const reprice = new Set(nightsToReprice(before, after));
    const blockers = quote.reasons.filter((x) => EDIT_BLOCKERS.has(x));
    if (blockers.length) throw new Error(blockers.map((x) => REASON_TEXT[x]).join(", "));
    const missingPrice = [...reprice].filter((d) => !quote.nights.some((n) => n.date === d));
    if (missingPrice.length) throw new Error(`No price on ${missingPrice.join(", ")}`);
    if (nightsNeedingRoom(before, after).some(full) && !options.force) throw new OverbookingNeeded();

    const oldNights = await nightTotals(tx, res.id);
    const oldRooms = await segments(tx, res.id);
    await tx.query("delete from reservation_nights where reservation_id = $1 and not (date = any($2::date[]))", [res.id, nightsOf(after.arrival, after.departure)]);
    await writeNights(tx, res.id, quote.nights.filter((n) => reprice.has(n.date)));
    // the flag follows the stay: past Availability on any of its nights, or not
    const overbooked = nightsOf(after.arrival, after.departure).some(full);
    await tx.query("update reservations set arrival = $2, departure = $3, adults = $4, child_ages = $5, room_type_id = $6, overbooked = $7 where id = $1", [
      res.id,
      after.arrival,
      after.departure,
      after.adults,
      after.childAges,
      after.roomTypeId,
      overbooked,
    ]);
    await trimAssignments(tx, res.id, after, roomTypeChanged);
    await logChange(tx, res.id, userId, "edit", { ...snapshot(res, oldNights, oldRooms), ...(res.overbooked ? { overbooked: true } : {}) }, {
      ...after,
      total: sumTotals(await nightTotals(tx, res.id)),
      rooms: await segments(tx, res.id),
      ...(overbooked ? { overbooked: true } : {}),
    });
    return { overbooked };
  });
}

interface PolicyRow {
  free_until_days: number | null;
  free_until_time: string;
  fee_kind: FeeKind;
  fee_percent: string | null;
}

async function feeFor(tx: PoolClient, r: ResRow, now: Date) {
  const { rows } = await tx.query<PolicyRow>(
    `select c.free_until_days, to_char(c.free_until_time, 'HH24:MI') as free_until_time, c.fee_kind, c.fee_percent
     from rate_plans p join cancellation_policies c on c.id = p.cancellation_policy_id where p.id = $1`,
    [r.rate_plan_id],
  );
  const p = rows[0]!;
  return cancellationFee(
    { freeUntilDays: p.free_until_days, freeUntilTime: p.free_until_time, feeKind: p.fee_kind, feePercent: p.fee_percent === null ? null : Number(p.fee_percent) },
    { arrival: r.arrival, nights: await nightTotals(tx, r.id), timeZone: r.time_zone },
    now,
  );
}

/** What cancelling every Confirmed reservation of the booking now would cost, summed. */
export async function previewBookingCancellation(pool: Pool, schema: string, bookingId: string, now = new Date()): Promise<{ amount: number; reservations: number }> {
  if (!isUuid(bookingId)) throw new Error("Booking not found");
  return withTenant(pool, schema, async (tx) => {
    const ids = await tx.query<{ id: string }>("select id from reservations where booking_id = $1 and status = 'confirmed'", [bookingId]);
    let amount = 0;
    for (const row of ids.rows) amount += (await feeFor(tx, await loadForRead(tx, row.id), now)).amount;
    return { amount: roundMoney(amount), reservations: ids.rowCount ?? 0 };
  });
}

/** What cancelling now would cost under the reservation's Cancellation Policy. */
export async function previewCancellation(pool: Pool, schema: string, id: string, now = new Date()): Promise<{ amount: number; deadline: string | null }> {
  return withTenant(pool, schema, async (tx) => feeFor(tx, await loadForRead(tx, id), now));
}

async function cancelIn(tx: PoolClient, r: ResRow, userId: string, now: Date): Promise<number> {
  if (r.status !== "confirmed") throw new Error(r.status === "cancelled" ? "The reservation is already cancelled" : "Only a confirmed reservation can be cancelled");
  const fee = await feeFor(tx, r, now);
  await tx.query(
    "update reservations set status = 'cancelled', cancelled_at = $2, cancelled_by = $3, cancellation_fee = $4, cancellation_fee_status = $5 where id = $1",
    [r.id, now, userId, fee.amount > 0 ? fee.amount : null, fee.amount > 0 ? "open" : null],
  );
  const segs = await segments(tx, r.id);
  await tx.query("delete from room_assignments where reservation_id = $1", [r.id]);
  await logChange(tx, r.id, userId, "cancel", { status: r.status, rooms: segs }, { status: "cancelled", fee: fee.amount, deadline: fee.deadline });
  return fee.amount;
}

/** Cancel one reservation; the fee (if any) waits for staff to confirm or waive. */
export async function cancelReservation(pool: Pool, schema: string, id: string, userId: string, options: { now?: Date } = {}): Promise<{ fee: number }> {
  return withTenant(pool, schema, async (tx) => {
    const r = await loadForChange(tx, id);
    return { fee: await cancelIn(tx, r, userId, options.now ?? new Date()) };
  });
}

/** Cancel every Confirmed reservation of a booking. */
export async function cancelBooking(pool: Pool, schema: string, bookingId: string, userId: string, options: { now?: Date } = {}): Promise<{ cancelled: number; fee: number }> {
  if (!isUuid(bookingId)) throw new Error("Booking not found");
  return withTenant(pool, schema, async (tx) => {
    const booking = await tx.query<{ property_id: string }>("select property_id from bookings where id = $1", [bookingId]);
    if (!booking.rows[0]) throw new Error("Booking not found");
    // lock before choosing what to cancel, so a concurrent cancel cannot slip in between
    await lockProperty(tx, booking.rows[0].property_id);
    const ids = await tx.query<{ id: string }>("select id from reservations where booking_id = $1 and status = 'confirmed' order by created_at", [bookingId]);
    if (!ids.rowCount) throw new Error("Nothing to cancel in this booking");
    let fee = 0;
    for (const row of ids.rows) fee += await cancelIn(tx, await loadForChange(tx, row.id), userId, options.now ?? new Date());
    return { cancelled: ids.rowCount ?? 0, fee: roundMoney(fee) };
  });
}

/** Confirm (the folio will post it) or waive an open cancellation fee. */
export async function setCancellationFeeStatus(pool: Pool, schema: string, id: string, userId: string, status: "confirmed" | "waived"): Promise<void> {
  if (status !== "confirmed" && status !== "waived") throw new Error("Confirm or waive");
  await withTenant(pool, schema, async (tx) => {
    const r = await loadForChange(tx, id);
    if (r.cancellation_fee_status !== "open") throw new Error("There is no open cancellation fee");
    await tx.query("update reservations set cancellation_fee_status = $2 where id = $1", [r.id, status]);
    await logChange(tx, r.id, userId, status === "confirmed" ? "fee_confirmed" : "fee_waived", { fee: Number(r.cancellation_fee), status: "open" }, { fee: Number(r.cancellation_fee), status });
  });
}

/** Rooms of other active reservations that overlap these nights. */
async function roomTaken(tx: PoolClient, roomId: string, from: string, to: string, exceptReservation: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    `select 1 from room_assignments a join reservations r on r.id = a.reservation_id
     where a.room_id = $1 and a.from_date < $3 and a.to_date > $2 and a.reservation_id <> $4 and r.status = any($5::text[]) limit 1`,
    [roomId, from, to, exceptReservation, OCCUPYING_STATUSES],
  );
  return (rowCount ?? 0) > 0;
}

async function writeSegments(tx: PoolClient, r: ResRow, segs: AssignmentSegment[]): Promise<void> {
  for (const s of segs) {
    const room = await tx.query("select 1 from rooms where id = $1 and room_type_id = $2", [s.roomId, r.room_type_id]);
    if (!room.rowCount) throw new Error("The room must be of the reservation's room type");
    if (await roomTaken(tx, s.roomId, s.from, s.to, r.id)) throw new Error("The room is taken by another reservation on those nights");
  }
  await tx.query("delete from room_assignments where reservation_id = $1", [r.id]);
  for (const s of segs) await tx.query("insert into room_assignments (reservation_id, room_id, from_date, to_date) values ($1, $2, $3, $4)", [r.id, s.roomId, s.from, s.to]);
}

/** Assign one room for the whole stay (replacing earlier assignments). */
export async function assignRoom(pool: Pool, schema: string, id: string, userId: string, roomId: string): Promise<void> {
  if (!isUuid(roomId)) throw new Error("Room not found");
  await withTenant(pool, schema, async (tx) => {
    const r = await loadForChange(tx, id);
    requireOpen(r);
    // nights already slept keep their room: an in-house guest changes rooms by a move
    if (r.status === "checked_in") throw new Error("A checked-in guest changes rooms by a move from a night on");
    const before = await segments(tx, r.id);
    const after = [{ roomId, from: r.arrival, to: r.departure }];
    await writeSegments(tx, r, after);
    await logChange(tx, r.id, userId, "assign_room", { rooms: before }, { rooms: after });
  });
}

/** Move to another room from a night on: a mid-stay move adds a segment on the same reservation. */
export async function moveRoom(pool: Pool, schema: string, id: string, userId: string, roomId: string, fromNight: string): Promise<void> {
  if (!isUuid(roomId)) throw new Error("Room not found");
  checkDate(fromNight);
  await withTenant(pool, schema, async (tx) => {
    const r = await loadForChange(tx, id);
    requireOpen(r);
    const before = await segments(tx, r.id);
    const after = splitAssignment(before, roomId, fromNight);
    await writeSegments(tx, r, after);
    await logChange(tx, r.id, userId, "move_room", { rooms: before }, { rooms: after });
  });
}

export async function unassignRooms(pool: Pool, schema: string, id: string, userId: string): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const r = await loadForChange(tx, id);
    requireOpen(r);
    if (r.status === "checked_in") throw new Error("A checked-in guest keeps a room");
    const before = await segments(tx, r.id);
    if (before.length === 0) return;
    await tx.query("delete from room_assignments where reservation_id = $1", [r.id]);
    await logChange(tx, r.id, userId, "unassign_room", { rooms: before }, { rooms: [] });
  });
}

/** Rooms (by number) of the reservation's type free for its nights from `from` (default: the whole stay), not already its own. */
export async function listFreeRooms(pool: Pool, schema: string, id: string, from?: string): Promise<{ id: string; name: string }[]> {
  if (!isUuid(id)) return [];
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ room_type_id: string; arrival: string; departure: string }>("select room_type_id, to_char(arrival, 'YYYY-MM-DD') as arrival, to_char(departure, 'YYYY-MM-DD') as departure from reservations where id = $1", [id])).rows[0];
    if (!r) return [];
    const start = from && from > r.arrival ? from : r.arrival;
    const { rows } = await tx.query<{ id: string; name: string }>(
      `select m.id, m.number as name from rooms m
       where m.room_type_id = $1
         and not exists (select 1 from room_assignments a join reservations x on x.id = a.reservation_id
                         where a.room_id = m.id and a.from_date < $3 and a.to_date > $2 and x.status = any($5::text[]) and x.id <> $4)
         and not exists (select 1 from room_assignments own where own.room_id = m.id and own.reservation_id = $4 and own.from_date < $3 and own.to_date > $2)
       order by m.number`,
      [r.room_type_id, start, r.departure, id, OCCUPYING_STATUSES],
    );
    return rows;
  });
}

export interface ReservationChange {
  userId: string;
  at: Date;
  action: ReservationChangeAction;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export async function reservationHistory(pool: Pool, schema: string, id: string): Promise<ReservationChange[]> {
  if (!isUuid(id)) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ user_id: string; at: Date; action: ReservationChangeAction; before: Record<string, unknown>; after: Record<string, unknown> }>(
      "select user_id, at, action, before, after from reservation_changes where reservation_id = $1 order by at desc limit 200",
      [id],
    );
    return rows.map((r) => ({ userId: r.user_id, at: r.at, action: r.action, before: r.before, after: r.after }));
  });
}

export interface OverbookedReservation {
  reservationId: string;
  confirmationNumber: string;
  guestName: string;
  roomTypeCode: string;
  arrival: string;
  departure: string;
}

/** Reservations forced past Availability that are still ahead or in house: the dashboard's flag list. `today` is the property's date (Business Date once Night Audit exists). */
export async function listOverbooked(pool: Pool, schema: string, propertyId: string, today: string): Promise<OverbookedReservation[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; confirmation_number: string; guest: string; code: string; arrival: string; departure: string }>(
      `select r.id, b.confirmation_number, trim(g.first_name || ' ' || g.last_name) as guest, t.code, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure
       from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id join room_types t on t.id = r.room_type_id
       where r.property_id = $1 and r.overbooked and r.status = any($3::text[]) and r.departure > $2
       order by r.arrival, b.confirmation_number`,
      [propertyId, checkDate(today), OCCUPYING_STATUSES],
    );
    return rows.map((r) => ({ reservationId: r.id, confirmationNumber: r.confirmation_number, guestName: r.guest, roomTypeCode: r.code, arrival: r.arrival, departure: r.departure }));
  });
}
