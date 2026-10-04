/**
 * Housekeeping Tasks (ticket 34, decided in "Housekeeping model"): after the
 * Night Audit each room gets the day's tasks by the property's rules
 * (Departure clean, Stayover clean, Arrival preparation, Linen change) with
 * minutes per room type; the supervisor's board proposes a distribution by
 * Section, balanced by minutes, and publishes it.
 */
export const TASK_KINDS = ["departure", "stayover", "arrival", "linen", "clean"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const STAYOVER_RHYTHMS = ["daily", "every_2", "every_3", "on_request"] as const;
export type StayoverRhythm = (typeof STAYOVER_RHYTHMS)[number];

/** Minutes when the property set none for a room type. */
export const DEFAULT_MINUTES: Record<TaskKind, number> = { departure: 30, stayover: 20, arrival: 10, linen: 15, clean: 20 };

export interface StayOnDay {
  reservationId: string;
  /** Tonight's room; for a stay that leaves today, the room slept in last night. */
  roomId: string | null;
  /** The room of last night when the stay moved rooms from tonight on: it needs cleaning. */
  vacatedRoomId?: string | null;
  /** The guest is here and waits for the room (Arrived, Waiting for Room). */
  waiting?: boolean;
  roomTypeId: string;
  /** checked_out: only stays that left on this day (an early departure included). */
  status: "confirmed" | "checked_in" | "checked_out";
  arrival: string;
  departure: string;
}

export interface TaskRules {
  stayover: StayoverRhythm;
  /** A linen change every this many nights of a stay (null: none). */
  linenEvery: number | null;
}

/** A Stayover clean every this many nights (null: on request only). */
const STAYOVER_EVERY: Record<StayoverRhythm, number | null> = { daily: 1, every_2: 2, every_3: 3, on_request: null };

const nightIndex = (arrival: string, day: string) => Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`)) / 86_400_000);

/**
 * The tasks a day calls for: a Departure clean for the room left today, an
 * Arrival preparation for the room of today's arrival, a Stayover clean for
 * a guest staying on by the rhythm, a Linen change by its rhythm. Rules per
 * room type override the property's.
 */
export function tasksForDay(day: string, stays: StayOnDay[], rules: (roomTypeId: string) => TaskRules): { reservationId: string; roomId: string; kind: TaskKind; priority: boolean }[] {
  const out: { reservationId: string; roomId: string; kind: TaskKind; priority: boolean }[] = [];
  const add = (s: StayOnDay, roomId: string, kind: TaskKind, priority = false) => out.push({ reservationId: s.reservationId, roomId, kind, priority });
  for (const s of stays) {
    if (!s.roomId) continue;
    if ((s.departure === day && s.status === "checked_in") || s.status === "checked_out") add(s, s.roomId, "departure");
    else if (s.arrival <= day && s.status === "confirmed") add(s, s.roomId, "arrival", s.waiting === true);
    else if (s.status === "checked_in" && s.arrival < day && day < s.departure) {
      // moved rooms from tonight: the room left is cleaned like a departure, tonight's is not a stayover
      if (s.vacatedRoomId && s.vacatedRoomId !== s.roomId) {
        add(s, s.vacatedRoomId, "departure");
        continue;
      }
      const n = nightIndex(s.arrival, day);
      const r = rules(s.roomTypeId);
      const every = STAYOVER_EVERY[r.stayover];
      if (every !== null && n % every === 0) add(s, s.roomId, "stayover");
      if (r.linenEvery !== null && n % r.linenEvery === 0) add(s, s.roomId, "linen");
    }
  }
  return out;
}

export interface PlanTask {
  id: string;
  roomId: string;
  section: string | null;
  minutes: number;
  assigneeId: string | null;
}

/** Minutes per housekeeper (and "" for unassigned), against the shift. */
export function workload(tasks: Pick<PlanTask, "minutes" | "assigneeId">[], housekeepers: string[], shiftMinutes: number): { assigneeId: string; minutes: number; left: number }[] {
  const per = new Map<string, number>([...housekeepers, ""].map((h) => [h, 0]));
  for (const t of tasks) per.set(t.assigneeId ?? "", (per.get(t.assigneeId ?? "") ?? 0) + t.minutes);
  return [...per].map(([assigneeId, minutes]) => ({ assigneeId, minutes, left: assigneeId ? shiftMinutes - minutes : 0 }));
}

/**
 * The morning proposal: unassigned tasks go to housekeepers by Section,
 * the biggest first, each whole to the least loaded; a Section well over a
 * fair share is split room by room. A room's tasks stay together; tasks
 * already assigned keep theirs.
 */
export function proposeDistribution(tasks: PlanTask[], housekeepers: string[]): Map<string, string> {
  const result = new Map<string, string>();
  if (!housekeepers.length) return result;
  const load = new Map(housekeepers.map((h) => [h, 0]));
  for (const t of tasks) if (t.assigneeId !== null && load.has(t.assigneeId)) load.set(t.assigneeId, load.get(t.assigneeId)! + t.minutes);
  // a task of someone who is not among the housekeepers counts as unassigned
  const known = (t: PlanTask) => t.assigneeId !== null && load.has(t.assigneeId);
  // a room already given to someone keeps its other tasks with them
  const roomOwner = new Map(tasks.filter(known).map((t) => [t.roomId, t.assigneeId!]));
  const open: PlanTask[] = [];
  for (const t of tasks) {
    if (known(t)) continue;
    const owner = roomOwner.get(t.roomId);
    if (owner) {
      result.set(t.id, owner);
      load.set(owner, load.get(owner)! + t.minutes);
    } else open.push(t);
  }
  const rooms = new Map<string, PlanTask[]>();
  for (const t of open) rooms.set(t.roomId, [...(rooms.get(t.roomId) ?? []), t]);
  const sections = new Map<string, PlanTask[][]>();
  for (const roomTasks of rooms.values()) {
    const key = roomTasks[0]!.section ?? "";
    sections.set(key, [...(sections.get(key) ?? []), roomTasks]);
  }
  const minutesOf = (ts: PlanTask[]) => ts.reduce((s, t) => s + t.minutes, 0);
  const total = [...load.values()].reduce((s, m) => s + m, 0) + open.reduce((s, t) => s + t.minutes, 0);
  const fair = total / housekeepers.length;
  const lightest = () => [...load].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]![0];
  const give = (h: string, ts: PlanTask[]) => {
    for (const t of ts) result.set(t.id, h);
    load.set(h, load.get(h)! + minutesOf(ts));
  };
  // biggest Sections first, each whole to whoever is lightest; only a Section well over a fair share is split room by room
  const ordered = [...sections].sort((a, b) => minutesOf(b[1].flat()) - minutesOf(a[1].flat()) || a[0].localeCompare(b[0]));
  for (const [, roomsOfSection] of ordered) {
    if (minutesOf(roomsOfSection.flat()) <= fair * 1.25) {
      give(lightest(), roomsOfSection.flat());
      continue;
    }
    let current = lightest();
    for (const room of roomsOfSection) {
      if (load.get(current)! + minutesOf(room) > fair + 1e-9) current = lightest();
      give(current, room);
    }
  }
  return result;
}
