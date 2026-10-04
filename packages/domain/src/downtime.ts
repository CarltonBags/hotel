/**
 * Downtime Reports and the offline desk (ticket 86, "Front desk without
 * internet"): what the printed lists show, their order, the shift reminder,
 * and the rules for entering afterwards what happened during an outage.
 */
export const DOWNTIME_LISTS = ["arrivals", "departures", "in_house", "room_rack", "registration_forms"] as const;
export type DowntimeList = (typeof DOWNTIME_LISTS)[number];

export interface DowntimeOptions {
  /** Optional columns of the guest lists. */
  show: { balance: boolean; notes: boolean; hkNotes: boolean };
  sort: "room" | "name";
  /** Local time of the shift-start reminder ("HH:MM"), or none. */
  reminderAt: string | null;
  /** Blank registration forms in the set. */
  blankForms: number;
}

export const DEFAULT_DOWNTIME_OPTIONS: DowntimeOptions = { show: { balance: true, notes: true, hkNotes: false }, sort: "room", reminderAt: null, blankForms: 2 };

/** The property's stored options, filled with defaults; anything malformed falls back. */
export function downtimeOptions(stored: unknown): DowntimeOptions {
  const o = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const show = (o.show && typeof o.show === "object" ? o.show : {}) as Record<string, unknown>;
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const forms = Number(o.blankForms);
  return {
    show: { balance: bool(show.balance, true), notes: bool(show.notes, true), hkNotes: bool(show.hkNotes, false) },
    sort: o.sort === "name" ? "name" : "room",
    reminderAt: typeof o.reminderAt === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.reminderAt) ? o.reminderAt : null,
    blankForms: Number.isInteger(forms) && forms >= 0 && forms <= 20 ? forms : 2,
  };
}

/** Guest lists in the property's order: by room (unassigned last) or by surname. */
export function sortGuestRows<T extends { room: string | null; guestLastName: string; guestFirstName: string }>(rows: T[], sort: DowntimeOptions["sort"]): T[] {
  const byName = (a: T, b: T) => a.guestLastName.localeCompare(b.guestLastName) || a.guestFirstName.localeCompare(b.guestFirstName);
  if (sort === "name") return [...rows].sort(byName);
  return [...rows].sort((a, b) => (a.room === null ? 1 : 0) - (b.room === null ? 1 : 0) || (a.room ?? "").localeCompare(b.room ?? "", undefined, { numeric: true }) || byName(a, b));
}

/** The shift reminder shows from its time on, until the set was printed that day. */
export function downtimeReminderDue(reminderAt: string | null, localTime: string, printedToday: boolean): boolean {
  return reminderAt !== null && !printedToday && localTime >= reminderAt;
}

/** How old the kept lists are, in whole minutes. */
export function ageMinutes(savedAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(savedAt)) / 60_000));
}

/** The emergency report is renewed every 2 hours while online (and after each Night Audit). */
export const EMERGENCY_REFRESH_MINUTES = 120;

export const CATCH_UP_KINDS = ["check_in", "check_out", "payment", "room_move"] as const;
export type CatchUpKind = (typeof CATCH_UP_KINDS)[number];

/** Payments entered afterwards: no card can have been charged while offline. */
export const CATCH_UP_TENDERS = ["cash", "bank_transfer"] as const;

/**
 * A Catch-up Entry must say when it really happened: inside an outage logged
 * for the property, and not in the future. Returns the reason it is refused.
 */
export function catchUpProblem(realAt: Date, outages: { startedAt: Date; endedAt: Date | null }[], now: Date): "future" | "outside_outage" | null {
  if (realAt.getTime() > now.getTime()) return "future";
  const inside = outages.some((o) => realAt >= o.startedAt && realAt <= (o.endedAt ?? now));
  return inside ? null : "outside_outage";
}
