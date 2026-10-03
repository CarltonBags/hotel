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
import { followStay, syncStayCharges } from "./folios";
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

export { ShorteningNeedsConfirmation } from "./folios";

export interface ChangeOptions {
  force?: boolean | undefined;
  /** In house: a room-type change from this night on (with a room move); earlier nights keep type, price and Charges. */
  inHouseFrom?: string | undefined;
  /** A checked-in stay giving up nights: apply the proposed voids and the early-departure fee. */
  confirmShortening?: boolean | undefined;
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

/** Everything an edit would do, computed without writing: shared by the edit and its preview. */
async function planChange(tx: PoolClient, res: ResRow, patch: ReservationPatch, inHouseFrom?: string) {
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
  const unchanged = !datesMove && !roomTypeChanged && after.adults === before.adults && sameAges(after.childAges, before.childAges);
  const oldNights = await nightTotals(tx, res.id);
  if (unchanged) return { before, after, roomTypeChanged, unchanged, oldNights, repriced: [], needsOverbooking: false, overbooked: res.overbooked, total: sumTotals(oldNights) };
  if (res.status === "checked_in" && after.arrival !== before.arrival) throw new Error("The arrival of a checked-in guest cannot move");
  if (res.status === "checked_in" && roomTypeChanged && !inHouseFrom) throw new Error("A checked-in guest changes room type through a room move");
  // "today" is the property's Business Date (ticket 32)
  const today = (await tx.query<{ today: string }>("select to_char(business_date, 'YYYY-MM-DD') as today from properties where id = $1", [res.property_id])).rows[0]!.today;
  // in house, nights already slept (and nights before a room-type move) keep their price and Charges
  const keepBefore = res.status === "checked_in" ? (inHouseFrom && inHouseFrom > today ? inHouseFrom : today) : null;
  const fromMove = (d: string) => keepBefore === null || d >= keepBefore;
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
  const reprice = new Set(nightsToReprice(before, after).filter(fromMove));
  const blockers = quote.reasons.filter((x) => EDIT_BLOCKERS.has(x));
  if (blockers.length) throw new Error(blockers.map((x) => REASON_TEXT[x]).join(", "));
  const missingPrice = [...reprice].filter((d) => !quote.nights.some((n) => n.date === d));
  if (missingPrice.length) throw new Error(`No price on ${missingPrice.join(", ")}`);
  const repriced = quote.nights.filter((n) => reprice.has(n.date));
  const keptOld = oldNights.filter((n) => !reprice.has(n.date) && nightsOf(after.arrival, after.departure).includes(n.date));
  return {
    before,
    after,
    roomTypeChanged,
    unchanged,
    oldNights,
    repriced,
    needsOverbooking: nightsNeedingRoom(before, after).filter(fromMove).some(full),
    // the flag follows the stay: past Availability on any of its nights, or not
    overbooked: nightsOf(after.arrival, after.departure).filter(fromMove).some(full),
    total: sumTotals([...keptOld, ...repriced]),
  };
}

/**
 * Change dates, occupancy or room type in place. Nights needing a room the
 * reservation did not hold (domain nightsNeedingRoom) must be free unless
 * forced; nights the change touches (nightsToReprice) get current prices,
 * kept nights keep their stored price. Nights that fall away are removed, and
 * Room Assignments follow the stay. The overbooked flag is recomputed.
 */
export async function updateReservation(pool: Pool, schema: string, id: string, userId: string, patch: ReservationPatch, options: ChangeOptions = {}): Promise<{ overbooked: boolean }> {
  return withTenant(pool, schema, (tx) => changeIn(tx, id, userId, patch, options));
}

/**
 * A Calendar drop to other nights or another room type: the stay changes and
 * moves into the dropped room in one transaction, so a refused room leaves the
 * stay as it was.
 */
export async function changeStayIntoRoom(pool: Pool, schema: string, id: string, userId: string, patch: ReservationPatch, roomId: string, expectedTotal?: number): Promise<void> {
  if (!isUuid(roomId)) throw new Error("Room not found");
  await withTenant(pool, schema, async (tx) => {
    // a guest in house keeps the rooms of nights slept and confirms a shortening: that goes through the reservation tab
    const status = (await tx.query<{ status: string }>("select status from reservations where id = $1", [id])).rows[0]?.status;
    if (status === "checked_in") throw new Error("Change a checked-in stay on its reservation tab");
    await changeIn(tx, id, userId, patch, expectedTotal === undefined ? {} : { expectedTotal });
    const res = await loadForChange(tx, id);
    const before = await segments(tx, res.id);
    const after = [{ roomId, from: res.arrival, to: res.departure }];
    await writeSegments(tx, res, after);
    await logChange(tx, res.id, userId, "assign_room", { rooms: before }, { rooms: after });
  });
}

async function changeIn(tx: PoolClient, id: string, userId: string, patch: ReservationPatch, options: ChangeOptions & { expectedTotal?: number }): Promise<{ overbooked: boolean }> {
  {
    const res = await loadForChange(tx, id);
    requireOpen(res);
    const change = await planChange(tx, res, patch, options.inHouseFrom);
    if (change.unchanged) return { overbooked: res.overbooked };
    if (change.needsOverbooking && !options.force) throw new OverbookingNeeded();
    if (options.expectedTotal !== undefined && Math.abs(options.expectedTotal - change.total) > 0.005) throw new Error("The price changed since it was shown; try again");
    const { after } = change;
    const oldRooms = await segments(tx, res.id);
    await tx.query("delete from reservation_nights where reservation_id = $1 and not (date = any($2::date[]))", [res.id, nightsOf(after.arrival, after.departure)]);
    await writeNights(tx, res.id, change.repriced);
    await tx.query("update reservations set arrival = $2, departure = $3, adults = $4, child_ages = $5, room_type_id = $6, overbooked = $7 where id = $1", [
      res.id,
      after.arrival,
      after.departure,
      after.adults,
      after.childAges,
      after.roomTypeId,
      change.overbooked,
    ]);
    // an in-house move writes its own segments right after
    if (!options.inHouseFrom) await trimAssignments(tx, res.id, after, change.roomTypeChanged);
    await followStay(tx, res.id, { arrival: res.arrival, departure: res.departure }, after);
    await logChange(tx, res.id, userId, "edit", { ...snapshot(res, change.oldNights, oldRooms), ...(res.overbooked ? { overbooked: true } : {}) }, {
      ...after,
      total: sumTotals(await nightTotals(tx, res.id)),
      rooms: await segments(tx, res.id),
      ...(change.overbooked ? { overbooked: true } : {}),
    });
    // a checked-in stay's Charges follow its nights; giving up nights waits for confirmation (rolls the change back until then)
    await syncStayCharges(tx, res.id, userId, Boolean(options.confirmShortening));
    return { overbooked: change.overbooked };
  }
}

export interface ChangePreview {
  before: StayShape & { total: number };
  after: StayShape & { total: number };
  difference: number;
  needsOverbooking: boolean;
}

/** What an edit would change and cost, read without locks or writes (the Calendar's drag confirmation). */
export async function previewReservationChange(pool: Pool, schema: string, id: string, patch: ReservationPatch): Promise<ChangePreview> {
  return withTenant(pool, schema, async (tx) => {
    const res = await loadForRead(tx, id);
    requireOpen(res);
    const plan = await planChange(tx, res, patch);
    const beforeTotal = sumTotals(plan.oldNights);
    return { before: { ...plan.before, total: beforeTotal }, after: { ...plan.after, total: plan.total }, difference: roundMoney(plan.total - beforeTotal), needsOverbooking: plan.needsOverbooking };
  });
}

/**
 * Undo of a Calendar drag: put back the Room Assignments as they were. Only a
 * whole-stay assignment or none is accepted (what a drag replaces), and only
 * while the assignments are still those the drag produced; a checked-in guest
 * keeps a room.
 */
export async function restoreAssignments(pool: Pool, schema: string, id: string, userId: string, wanted: AssignmentSegment[], expectedCurrent: AssignmentSegment[]): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const res = await loadForChange(tx, id);
    requireOpen(res);
    const clean = wanted.map((w) => ({ roomId: String(w.roomId), from: checkDate(String(w.from)), to: checkDate(String(w.to)) })).sort((x, y) => x.from.localeCompare(y.from));
    const current = await segments(tx, res.id);
    const key = (list: AssignmentSegment[]) => list.map((x) => `${x.roomId}:${x.from}:${x.to}`).join("|");
    if (key(current) !== key([...expectedCurrent].sort((x, y) => x.from.localeCompare(y.from)))) throw new Error("The rooms of this stay changed since; nothing was undone");
    if (clean.length === 0 && res.status === "checked_in") throw new Error("A checked-in guest keeps a room");
    // segments must follow each other without gaps and cover the stay
    const contiguous = clean.every((w, i) => isUuid(w.roomId) && w.to > w.from && (i === 0 ? w.from === res.arrival : w.from === clean[i - 1]!.to));
    if (clean.length && (!contiguous || clean.at(-1)!.to !== res.departure)) throw new Error("Those room assignments do not fit the stay");
    await writeSegments(tx, res, clean);
    await logChange(tx, res.id, userId, "assign_room", { rooms: current }, { rooms: clean, undo: true });
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
  // Charges posted ahead of arrival must be voided (or moved) first, so a cancelled stay leaves none open
  const open = await tx.query("select 1 from charges where reservation_id = $1 and voided_at is null limit 1", [r.id]);
  if (open.rows.length) throw new Error("The reservation has open Charges; void them before cancelling");
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

/** `typeFrom`: segments ending by this night are nights already slept in a room of the earlier room type. */
async function writeSegments(tx: PoolClient, r: ResRow, segs: AssignmentSegment[], typeFrom?: string): Promise<void> {
  for (const s of segs) {
    const room = await tx.query("select 1 from rooms where id = $1 and room_type_id = $2", [s.roomId, r.room_type_id]);
    if (!room.rowCount && !(typeFrom && s.to <= typeFrom)) throw new Error("The room must be of the reservation's room type");
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
/**
 * A checked-in guest moves from a night on, possibly into a room of another
 * room type: the stay changes type from that night, those nights are
 * repriced and their Charges voided and posted again (syncStayCharges);
 * earlier nights keep room, price and Charges. One transaction.
 */
export async function moveRoomInHouse(pool: Pool, schema: string, id: string, userId: string, roomId: string, fromNight: string, options: { force?: boolean } = {}): Promise<void> {
  if (!isUuid(roomId)) throw new Error("Room not found");
  checkDate(fromNight);
  await withTenant(pool, schema, async (tx) => {
    const r = await loadForChange(tx, id);
    if (r.status !== "checked_in") throw new Error("Only a checked-in guest moves this way");
    const today = (await tx.query<{ today: string }>("select to_char(business_date, 'YYYY-MM-DD') as today from properties where id = $1", [r.property_id])).rows[0]!.today;
    if (fromNight < today) throw new Error("Nights already slept cannot move");
    if (fromNight <= r.arrival || fromNight >= r.departure) throw new Error("Choose a night of the stay after the first");
    const room = await tx.query<{ room_type_id: string }>("select room_type_id from rooms where id = $1 and property_id = $2", [roomId, r.property_id]);
    if (!room.rows[0]) throw new Error("Room not found");
    const newType = room.rows[0].room_type_id;
    if (newType !== r.room_type_id) await changeIn(tx, id, userId, { roomTypeId: newType }, { inHouseFrom: fromNight, force: options.force });
    const res = await loadForChange(tx, id);
    const before = await segments(tx, res.id);
    const after = splitAssignment(before, roomId, fromNight);
    await writeSegments(tx, res, after, fromNight);
    await logChange(tx, res.id, userId, "move_room", { rooms: before }, { rooms: after });
  });
}

export interface RoomChoice {
  id: string;
  number: string;
  /** Optional name beside the number. */
  name: string;
  roomTypeId: string;
  roomTypeCode: string;
  floor: string;
  section: string | null;
  features: string[];
  bedPlaces: number;
  /** No other stay holds the room on the nights asked for. */
  free: boolean;
  /** Who holds it when taken: confirmation number and guest. */
  occupiedBy: string | null;
}

/**
 * Rooms to choose from for a reservation from a night on (default: the whole
 * stay, or tonight on for a guest in house): every room of its room type,
 * of every type for a guest in house, with features, floor and section;
 * rooms another stay holds on those nights are marked taken. Free rooms first.
 */
export async function listRoomChoices(pool: Pool, schema: string, id: string, options: { from?: string | undefined } = {}): Promise<RoomChoice[]> {
  if (!isUuid(id)) return [];
  return withTenant(pool, schema, async (tx) => {
    const r = await loadForRead(tx, id);
    const today = (await tx.query<{ today: string }>("select to_char(business_date, 'YYYY-MM-DD') as today from properties where id = $1", [r.property_id])).rows[0]!.today;
    const inHouse = r.status === "checked_in";
    // a guest in house keeps the rooms of nights slept: choices start tonight at the earliest
    const earliest = inHouse && today > r.arrival ? today : r.arrival;
    const start = options.from && options.from > earliest ? checkDate(options.from) : earliest;
    const { rows } = await tx.query<{
      id: string;
      number: string;
      name: string;
      room_type_id: string;
      type_code: string;
      floor: string;
      section: string | null;
      features: string[];
      bed_places: number;
      occupied_by: string | null;
    }>(
      `select m.id, m.number, m.name, m.room_type_id, t.code as type_code, m.floor, sec.name as section, m.bed_places,
         coalesce((select array_agg(f.name order by f.name) from room_feature_assignments fa join room_features f on f.id = fa.feature_id where fa.room_id = m.id), '{}') as features,
         (select b.confirmation_number || ' · ' || g.last_name from room_assignments a
            join reservations x on x.id = a.reservation_id join bookings b on b.id = x.booking_id join guests g on g.id = x.primary_guest_id
           where a.room_id = m.id and a.from_date < $3 and a.to_date > $2 and x.status = any($5::text[]) and x.id <> $4
           order by a.from_date limit 1) as occupied_by
       from rooms m join room_types t on t.id = m.room_type_id left join sections sec on sec.id = m.section_id
       where m.property_id = $6 and (m.room_type_id = $1 or $7)
         and not exists (select 1 from room_assignments own where own.room_id = m.id and own.reservation_id = $4 and own.from_date < $3 and own.to_date > $2)
       order by m.room_type_id <> $1, m.number`,
      [r.room_type_id, start, r.departure, r.id, OCCUPYING_STATUSES, r.property_id, inHouse],
    );
    const choices = rows.map((x) => ({
      id: x.id,
      number: x.number,
      name: x.name,
      roomTypeId: x.room_type_id,
      roomTypeCode: x.type_code,
      floor: x.floor,
      section: x.section,
      features: x.features,
      bedPlaces: x.bed_places,
      free: x.occupied_by === null,
      occupiedBy: x.occupied_by,
    }));
    return [...choices.filter((c) => c.free), ...choices.filter((c) => !c.free)];
  });
}

/** Free rooms of the reservation's room type; `anyType` (a guest in house changing type) lists every type, named "number · type". */
export async function listFreeRooms(pool: Pool, schema: string, id: string, from?: string, options: { anyType?: boolean } = {}): Promise<{ id: string; name: string }[]> {
  if (!isUuid(id)) return [];
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ room_type_id: string; property_id: string; arrival: string; departure: string }>("select room_type_id, property_id, to_char(arrival, 'YYYY-MM-DD') as arrival, to_char(departure, 'YYYY-MM-DD') as departure from reservations where id = $1", [id])).rows[0];
    if (!r) return [];
    const start = from && from > r.arrival ? from : r.arrival;
    const { rows } = await tx.query<{ id: string; name: string }>(
      `select m.id, case when $6 then m.number || ' · ' || t.code else m.number end as name from rooms m join room_types t on t.id = m.room_type_id
       where (m.room_type_id = $1 or ($6 and m.property_id = $7))
         and not exists (select 1 from room_assignments a join reservations x on x.id = a.reservation_id
                         where a.room_id = m.id and a.from_date < $3 and a.to_date > $2 and x.status = any($5::text[]) and x.id <> $4)
         and not exists (select 1 from room_assignments own where own.room_id = m.id and own.reservation_id = $4 and own.from_date < $3 and own.to_date > $2)
       order by m.room_type_id <> $1, m.number`,
      [r.room_type_id, start, r.departure, id, OCCUPYING_STATUSES, options.anyType === true, r.property_id],
    );
    return rows;
  });
}

export interface ReservationChange {
  userId: string;
  /** The Property Manager who approved it beyond the user's limit. */
  approvedBy: string | null;
  at: Date;
  action: ReservationChangeAction;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export async function reservationHistory(pool: Pool, schema: string, id: string): Promise<ReservationChange[]> {
  if (!isUuid(id)) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ user_id: string; approved_by: string | null; at: Date; action: ReservationChangeAction; before: Record<string, unknown>; after: Record<string, unknown> }>(
      "select user_id, approved_by, at, action, before, after from reservation_changes where reservation_id = $1 order by at desc limit 200",
      [id],
    );
    return rows.map((r) => ({ userId: r.user_id, approvedBy: r.approved_by, at: r.at, action: r.action, before: r.before, after: r.after }));
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

/** The booking's notes, changed from one of its reservations and logged there. */
export async function updateBookingNotes(pool: Pool, schema: string, id: string, userId: string, notes: string): Promise<void> {
  const text = notes.trim();
  if (text.length > 2000) throw new Error("The notes are too long");
  await withTenant(pool, schema, async (tx) => {
    const r = await loadForChange(tx, id);
    const before = (await tx.query<{ notes: string }>("select notes from bookings where id = $1", [r.booking_id])).rows[0]!.notes;
    if (before === text) return;
    await tx.query("update bookings set notes = $2 where id = $1", [r.booking_id, text]);
    await logChange(tx, r.id, userId, "edit", { notes: before }, { notes: text });
  });
}
