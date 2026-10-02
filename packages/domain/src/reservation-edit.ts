/**
 * Reservation edits ("Reservation and inventory domain model"): dates,
 * occupancy and room type change in place, repricing only changed nights;
 * a room move adds a Room Assignment segment; cancellation shows the
 * Cancellation Policy fee.
 */
import { roundMoney } from "./money";
import type { FeeKind } from "./rates";
import { nightsOf } from "./stay-quote";

export interface StayShape {
  arrival: string;
  departure: string;
  adults: number;
  childAges: number[];
  roomTypeId: string;
}

const sameOccupancy = (a: StayShape, b: StayShape) => a.adults === b.adults && a.roomTypeId === b.roomTypeId && sameAges(a.childAges, b.childAges);

/**
 * Nights of the new stay that get current prices: all of them when room type
 * or occupancy changed (the price depends on both), otherwise only nights the
 * old stay did not have. Kept nights keep their stored price.
 */
export function nightsToReprice(before: StayShape, after: StayShape): string[] {
  const next = nightsOf(after.arrival, after.departure);
  if (!sameOccupancy(before, after)) return next;
  const old = new Set(nightsOf(before.arrival, before.departure));
  return next.filter((d) => !old.has(d));
}

export interface FeePolicy {
  /** null = never free of charge */
  freeUntilDays: number | null;
  /** HH:MM, property time */
  freeUntilTime: string;
  feeKind: FeeKind;
  feePercent: number | null;
}

/** Offset (ms) of a time zone at an instant: zone wall clock minus UTC. */
function offsetAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return Date.parse(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:00Z`) - instant.getTime();
}

/**
 * UTC instant of a wall-clock time in a time zone (the property's clock).
 * The offset is taken at the result and corrected once more, so times next to
 * a daylight-saving change resolve right; a time skipped by the change maps
 * to the moment after the gap.
 */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const wall = Date.parse(`${date}T${time}:00Z`);
  let instant = wall - offsetAt(new Date(wall), timeZone);
  instant = wall - offsetAt(new Date(instant), timeZone);
  return new Date(instant);
}

/** Actions a reservation's change history records (migration 0009). */
export const RESERVATION_CHANGE_ACTIONS = ["edit", "cancel", "assign_room", "move_room", "unassign_room", "fee_confirmed", "fee_waived", "check_in"] as const;
export type ReservationChangeAction = (typeof RESERVATION_CHANGE_ACTIONS)[number];

/** Same child ages regardless of the order they were entered in. */
export function sameAges(a: number[], b: number[]): boolean {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Nights of the new stay that need a room of the type the reservation did not
 * hold before: every night when the room type changes, else the added nights.
 * Occupancy changes take no extra room.
 */
export function nightsNeedingRoom(before: StayShape, after: StayShape): string[] {
  const next = nightsOf(after.arrival, after.departure);
  if (before.roomTypeId !== after.roomTypeId) return next;
  const old = new Set(nightsOf(before.arrival, before.departure));
  return next.filter((d) => !old.has(d));
}

/** The fee a cancellation at `now` costs under the policy, and the free-cancellation deadline (ISO) if any. */
export function cancellationFee(
  policy: FeePolicy,
  stay: { arrival: string; nights: { date: string; total: number }[]; timeZone: string },
  now: Date,
): { amount: number; deadline: string | null } {
  let deadline: Date | null = null;
  if (policy.freeUntilDays !== null) {
    const d = new Date(`${stay.arrival}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - policy.freeUntilDays);
    deadline = zonedInstant(d.toISOString().slice(0, 10), policy.freeUntilTime, stay.timeZone);
    if (now.getTime() <= deadline.getTime()) return { amount: 0, deadline: deadline.toISOString() };
  }
  const total = stay.nights.reduce((s, n) => s + n.total, 0);
  const amount =
    policy.feeKind === "first_night" ? (stay.nights[0]?.total ?? 0) : policy.feeKind === "percent" ? (total * (policy.feePercent ?? 0)) / 100 : policy.feeKind === "full_stay" ? total : 0;
  return { amount: roundMoney(amount), deadline: deadline ? deadline.toISOString() : null };
}

export interface AssignmentSegment {
  roomId: string;
  /** first night */
  from: string;
  /** day after the last night */
  to: string;
}

/** Move to another room from a night on: the segment containing that night ends there and a new one starts. */
export function splitAssignment(segments: AssignmentSegment[], roomId: string, fromNight: string): AssignmentSegment[] {
  const current = segments.find((s) => s.from <= fromNight && fromNight < s.to);
  if (!current) throw new Error("The move date must be a night inside the stay with a room assigned");
  const out: AssignmentSegment[] = [];
  for (const s of segments) {
    if (s !== current) {
      out.push(s);
      continue;
    }
    if (s.from < fromNight) out.push({ roomId: s.roomId, from: s.from, to: fromNight });
    out.push({ roomId, from: fromNight, to: s.to });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}
