import { addDays } from "./rates-grid";

/**
 * Groups (ticket 58): a contract with Held Rooms per room type and night.
 * Tentative: the Held Rooms are only wanted (a warning when availability
 * falls below them); Definite: they are out of sale everywhere until their
 * Release Date, when the unsold ones return. A Series repeats the holding
 * on a pattern of arrivals.
 */
export const GROUP_STATUSES = ["tentative", "definite", "lapsed", "cancelled"] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

/** Days before the Release Date staff are warned. */
export const RELEASE_WARNING_DAYS = 3;

/** Held Rooms not yet booked by the group's reservations. */
export function unsoldHeld(held: number, pickedUp: number): number {
  return Math.max(0, held - pickedUp);
}

/** Which statuses a group may move to: a lapsed or cancelled group is closed. */
export function groupStatusAllowed(from: GroupStatus, to: GroupStatus): boolean {
  if (from === to) return false;
  if (from === "lapsed" || from === "cancelled") return false;
  return to !== "lapsed" || from === "tentative";
}

/** A Tentative group's demand above what is still free: the night's warning (nothing is blocked). */
export function tentativeShortfall(free: number, demand: number): number {
  return Math.max(0, demand - Math.max(0, free));
}

/** The arrivals of a Series: every given weekday (0 Sunday … 6 Saturday) from the first date through the last. */
export function seriesArrivals(from: string, to: string, weekday: number): string[] {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error("Choose a weekday");
  if (to < from) throw new Error("The series ends before it starts");
  const out: string[] = [];
  let d = from;
  while (new Date(`${d}T12:00:00Z`).getUTCDay() !== weekday) d = addDays(d, 1);
  for (; d <= to; d = addDays(d, 7)) out.push(d);
  if (out.length > 104) throw new Error("A series has at most 104 departures");
  return out;
}

/** A holding's Release Date: the given days before arrival, never sooner than tomorrow (so staff can extend it) and never after arrival. */
export function releaseDateFor(arrival: string, days: number, today: string): string {
  const d = addDays(arrival, -days);
  const earliest = addDays(today, 1);
  if (d >= earliest) return d;
  return earliest > arrival ? arrival : earliest;
}

/** Staff are warned from this many days before the Release Date. */
export function releaseWarningDue(releaseDate: string, today: string): boolean {
  return today >= addDays(releaseDate, -RELEASE_WARNING_DAYS) && today < releaseDate;
}
