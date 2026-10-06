/**
 * The spa's appointment book (ticket 63) and the slots guests may book
 * themselves (ticket 64): an appointment lies inside its therapist's hours,
 * beside the therapist's other appointments and, where the treatment needs a
 * room, the room's.
 */

export interface Interval {
  start: Date;
  end: Date;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const inside = (a: Interval, b: Interval) => a.start >= b.start && a.end <= b.end;

export type AppointmentProblem = "outside_hours" | "therapist_busy" | "room_busy";

/** Hours that touch or overlap are one stretch (09–12 and 12–17 hold a treatment at 11:30). */
function merged(hours: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const h of [...hours].sort((x, y) => x.start.getTime() - y.start.getTime())) {
    const last = out.at(-1);
    if (last && h.start <= last.end) last.end = h.end > last.end ? h.end : last.end;
    else out.push({ start: h.start, end: h.end });
  }
  return out;
}

export function appointmentProblem(a: Interval, around: { hours: Interval[]; therapistBusy: Interval[]; roomBusy: Interval[] }): AppointmentProblem | null {
  if (!merged(around.hours).some((h) => inside(a, h))) return "outside_hours";
  if (around.therapistBusy.some((b) => overlaps(a, b))) return "therapist_busy";
  if (around.roomBusy.some((b) => overlaps(a, b))) return "room_busy";
  return null;
}

/**
 * Where a treatment of the given minutes can start, every step minutes
 * within the hours: the therapist free and, unless no room is needed
 * (rooms null), a room free (the first one that is).
 */
export function openSpaSlots(around: { hours: Interval[]; therapistBusy: Interval[]; rooms: { id: string; busy: Interval[] }[] | null }, minutes: number, step: number): { start: Date; end: Date; roomId: string | null }[] {
  const out: { start: Date; end: Date; roomId: string | null }[] = [];
  for (const h of around.hours) {
    for (let s = h.start.getTime(); s + minutes * 60_000 <= h.end.getTime(); s += step * 60_000) {
      const slot = { start: new Date(s), end: new Date(s + minutes * 60_000) };
      if (around.therapistBusy.some((b) => overlaps(slot, b))) continue;
      if (around.rooms === null) {
        out.push({ ...slot, roomId: null });
        continue;
      }
      const room = around.rooms.find((r) => !r.busy.some((b) => overlaps(slot, b)));
      if (room) out.push({ ...slot, roomId: room.id });
    }
  }
  return out;
}

/** A wall-clock time on a date at the property (its time zone) as an instant: what a spa's time fields mean. */
export function instantAt(date: string, hhmm: string, timeZone: string): Date {
  const wanted = Date.parse(`${date}T${hhmm}:00Z`);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  // the zone's offset at an instant: how far its wall clock is from UTC there
  const offset = (at: number) => {
    const p = fmt.formatToParts(new Date(at));
    const part = (t: string) => Number(p.find((x) => x.type === t)!.value);
    return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) - at;
  };
  // the offset read at the first guess may be the other side of a change: read again where that lands
  let at = wanted - offset(wanted);
  at = wanted - offset(at);
  return new Date(at);
}
