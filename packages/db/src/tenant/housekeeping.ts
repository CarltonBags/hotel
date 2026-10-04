import type { Pool, PoolClient } from "pg";
import {
  DEFAULT_MINUTES,
  STAYOVER_RHYTHMS,
  TASK_KINDS,
  can,
  cleanlinessScope,
  proposeDistribution,
  tasksForDay,
  workload,
  type StayOnDay,
  type StayoverRhythm,
  type TaskKind,
  type TaskRules,
} from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { lockProperty } from "./property-lock";
import { withTenant } from "./with-tenant";
import { markDirty, type Viewer } from "./room-state";

/**
 * Housekeeping Tasks (ticket 34): generated for the Business Date after the
 * Night Audit by the property's rules, kept in step during the day (early
 * departures, room moves, new arrivals), distributed on the supervisor's
 * board (proposal by Section, drag between housekeepers) and published to
 * the housekeepers; after Publish every change is marked Changed.
 */

interface PropertyRules {
  businessDate: string;
  stayover: StayoverRhythm;
  linenEvery: number | null;
  shiftMinutes: number;
}

async function rulesOf(tx: PoolClient, propertyId: string): Promise<PropertyRules> {
  const p = (await tx.query<{ business_date: string; hk_stayover_rhythm: StayoverRhythm; hk_linen_every: number | null; hk_shift_minutes: number }>(
    "select to_char(business_date, 'YYYY-MM-DD') as business_date, hk_stayover_rhythm, hk_linen_every, hk_shift_minutes from properties where id = $1",
    [propertyId],
  )).rows[0];
  if (!p) throw new Error("Property not found");
  return { businessDate: p.business_date, stayover: p.hk_stayover_rhythm, linenEvery: p.hk_linen_every, shiftMinutes: p.hk_shift_minutes };
}

async function published(tx: PoolClient, propertyId: string, businessDate: string): Promise<boolean> {
  return (await tx.query("select 1 from housekeeping_plans where property_id = $1 and business_date = $2 and published_at is not null", [propertyId, businessDate])).rows.length > 0;
}

/**
 * Bring the Business Date's tasks in line with the stays (inside the
 * caller's transaction): tasks the day now calls for are added, open tasks
 * it no longer calls for are removed; started and done tasks stay, and so do
 * tasks added by hand. After Publish, new tasks are marked Changed.
 */
export async function syncHousekeepingTasks(tx: PoolClient, propertyId: string, userId: string): Promise<void> {
  const rules = await rulesOf(tx, propertyId);
  const day = rules.businessDate;
  const stays = (await tx.query<{ id: string; room_type_id: string; status: StayOnDay["status"]; arrival: string; departure: string; night_room: string | null; last_room: string | null }>(
    `select r.id, r.room_type_id, r.status, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure,
       (select a.room_id from room_assignments a where a.reservation_id = r.id and a.from_date <= $2 and a.to_date > $2) as night_room,
       (select a.room_id from room_assignments a where a.reservation_id = r.id order by a.to_date desc limit 1) as last_room
     from reservations r
     where r.property_id = $1 and (
       (r.status in ('confirmed', 'checked_in') and r.arrival <= $2 and r.departure >= $2)
       or (r.status = 'checked_out' and exists (select 1 from reservation_changes c where c.reservation_id = r.id and c.action = 'check_out' and c.business_date = $2)))`,
    [propertyId, day],
  )).rows.map((r) => ({
    reservationId: r.id,
    // a departure is cleaned in the room left; the others in tonight's room
    roomId: r.status === "checked_out" || r.departure === day ? r.last_room : r.night_room,
    roomTypeId: r.room_type_id,
    status: r.status,
    arrival: r.arrival,
    departure: r.departure,
  }));
  const typeRules = new Map(
    (await tx.query<{ id: string; hk_stayover_rhythm: StayoverRhythm | null; hk_linen_every: number | null }>("select id, hk_stayover_rhythm, hk_linen_every from room_types where property_id = $1", [propertyId])).rows.map((t) => [
      t.id,
      { stayover: t.hk_stayover_rhythm ?? rules.stayover, linenEvery: t.hk_linen_every ?? rules.linenEvery } satisfies TaskRules,
    ]),
  );
  const wanted = tasksForDay(day, stays, (t) => typeRules.get(t) ?? { stayover: rules.stayover, linenEvery: rules.linenEvery });
  const minutes = new Map(
    (await tx.query<{ room_id: string; kind: TaskKind; minutes: number }>(
      "select m.id as room_id, hm.kind, hm.minutes from rooms m join housekeeping_minutes hm on hm.room_type_id = m.room_type_id where m.property_id = $1",
      [propertyId],
    )).rows.map((r) => [`${r.room_id}|${r.kind}`, r.minutes]),
  );
  const existing = (await tx.query<{ id: string; room_id: string; kind: TaskKind; status: string }>(
    "select id, room_id, kind, status from housekeeping_tasks where property_id = $1 and business_date = $2 and kind <> 'clean'",
    [propertyId, day],
  )).rows;
  const key = (roomId: string, kind: string) => `${roomId}|${kind}`;
  const want = new Map(wanted.map((w) => [key(w.roomId, w.kind), w]));
  const isPublished = await published(tx, propertyId, day);
  for (const e of existing) {
    if (!want.has(key(e.room_id, e.kind)) && e.status === "open") await tx.query("delete from housekeeping_tasks where id = $1", [e.id]);
  }
  const have = new Set(existing.map((e) => key(e.room_id, e.kind)));
  for (const w of wanted) {
    if (have.has(key(w.roomId, w.kind))) continue;
    await tx.query(
      `insert into housekeeping_tasks (property_id, room_id, business_date, kind, minutes, reservation_id, changed, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (room_id, business_date, kind) do nothing`,
      [propertyId, w.roomId, day, w.kind, minutes.get(key(w.roomId, w.kind)) ?? DEFAULT_MINUTES[w.kind], w.reservationId, isPublished, userId],
    );
  }
}

export interface BoardTask {
  id: string;
  roomId: string;
  roomNumber: string;
  section: string | null;
  kind: TaskKind;
  minutes: number;
  assigneeId: string | null;
  status: "open" | "in_progress" | "done" | "skipped";
  changed: boolean;
  note: string;
  guestSurname: string | null;
}

export interface HousekeepingBoard {
  businessDate: string;
  published: boolean;
  shiftMinutes: number;
  /** The property's rules, for the settings form. */
  rules: { stayover: StayoverRhythm; linenEvery: number | null; shiftMinutes: number };
  tasks: BoardTask[];
  /** Minutes per housekeeper ("" unassigned) against the shift. */
  workload: { assigneeId: string; minutes: number; left: number }[];
  /** Rooms set to Clean, to inspect, with the housekeeper of their task. */
  toInspect: { roomId: string; roomNumber: string; assigneeId: string | null }[];
}

const TASK_COLUMNS = `t.id, t.room_id, m.number as room_number, s.name as section, t.kind, t.minutes, t.assignee_id, t.status, t.changed, t.note,
  (select g.last_name from reservations r join guests g on g.id = r.primary_guest_id where r.id = t.reservation_id) as guest_surname`;
type TaskRow = { id: string; room_id: string; room_number: string; section: string | null; kind: TaskKind; minutes: number; assignee_id: string | null; status: BoardTask["status"]; changed: boolean; note: string; guest_surname: string | null };
const toTask = (t: TaskRow): BoardTask => ({
  id: t.id,
  roomId: t.room_id,
  roomNumber: t.room_number,
  section: t.section,
  kind: t.kind,
  minutes: t.minutes,
  assigneeId: t.assignee_id,
  status: t.status,
  changed: t.changed,
  note: t.note,
  guestSurname: t.guest_surname,
});

function requireSupervisor(viewer: Viewer, propertyId: string): void {
  if (!can(viewer.actor, "assign_housekeeping", propertyId)) throw new Error("Not allowed to plan housekeeping");
}

/** The supervisor's board of the Business Date: tasks, minutes per housekeeper against the shift, rooms to inspect. */
export async function housekeepingBoard(pool: Pool, schema: string, propertyId: string, housekeeperIds: string[], viewer: Viewer): Promise<HousekeepingBoard> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  requireSupervisor(viewer, propertyId);
  return withTenant(pool, schema, async (tx) => {
    const rules = await rulesOf(tx, propertyId);
    const tasks = (await tx.query<TaskRow>(
      `select ${TASK_COLUMNS} from housekeeping_tasks t join rooms m on m.id = t.room_id left join sections s on s.id = m.section_id
       where t.property_id = $1 and t.business_date = $2 order by s.sort_order nulls last, m.sort_order, m.number, t.kind`,
      [propertyId, rules.businessDate],
    )).rows.map(toTask);
    const toInspect = (await tx.query<{ room_id: string; number: string; assignee_id: string | null }>(
      `select m.id as room_id, m.number, (select t.assignee_id from housekeeping_tasks t where t.room_id = m.id and t.business_date = $2 order by t.created_at limit 1) as assignee_id
       from rooms m where m.property_id = $1 and m.cleanliness = 'clean' order by m.sort_order, m.number`,
      [propertyId, rules.businessDate],
    )).rows.map((r) => ({ roomId: r.room_id, roomNumber: r.number, assigneeId: r.assignee_id }));
    return {
      businessDate: rules.businessDate,
      published: await published(tx, propertyId, rules.businessDate),
      shiftMinutes: rules.shiftMinutes,
      rules: { stayover: rules.stayover, linenEvery: rules.linenEvery, shiftMinutes: rules.shiftMinutes },
      tasks,
      workload: workload(tasks.filter((t) => t.status !== "skipped"), housekeeperIds, rules.shiftMinutes),
      toInspect,
    };
  });
}

/** Generate (or bring up to date) the Business Date's tasks by hand. */
export async function generateHousekeepingTasks(pool: Pool, schema: string, propertyId: string, viewer: Viewer): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  requireSupervisor(viewer, propertyId);
  await withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    await syncHousekeepingTasks(tx, propertyId, viewer.userId);
  });
}

/** The morning proposal for the unassigned tasks: by Section, balanced by minutes, among the given housekeepers. */
export async function proposeHousekeeping(pool: Pool, schema: string, propertyId: string, housekeeperIds: string[], viewer: Viewer): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  requireSupervisor(viewer, propertyId);
  await withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    const { businessDate } = await rulesOf(tx, propertyId);
    const tasks = (await tx.query<{ id: string; room_id: string; section: string | null; minutes: number; assignee_id: string | null }>(
      "select t.id, t.room_id, m.section_id as section, t.minutes, t.assignee_id from housekeeping_tasks t join rooms m on m.id = t.room_id where t.property_id = $1 and t.business_date = $2 and t.status <> 'skipped'",
      [propertyId, businessDate],
    )).rows;
    const plan = proposeDistribution(
      tasks.map((t) => ({ id: t.id, roomId: t.room_id, section: t.section, minutes: t.minutes, assigneeId: t.assignee_id })),
      housekeeperIds,
    );
    const isPublished = await published(tx, propertyId, businessDate);
    for (const [taskId, assignee] of plan) await tx.query("update housekeeping_tasks set assignee_id = $2, changed = changed or $3 where id = $1", [taskId, assignee, isPublished]);
  });
}

/** A started task is not moved away without confirmation. */
export class TaskStarted extends Error {
  constructor() {
    super("The task is already started; confirm to move it");
    this.name = "TaskStarted";
  }
}

/** Move a task to a housekeeper (null: Unassigned); after Publish the task is marked Changed. */
export async function moveHousekeepingTask(pool: Pool, schema: string, taskId: string, assigneeId: string | null, viewer: Viewer, options: { confirm?: boolean } = {}): Promise<void> {
  if (!isUuid(taskId)) throw new Error("Task not found");
  await withTenant(pool, schema, async (tx) => {
    const t = (await tx.query<{ property_id: string; business_date: string; status: string; assignee_id: string | null }>(
      "select property_id, to_char(business_date, 'YYYY-MM-DD') as business_date, status, assignee_id from housekeeping_tasks where id = $1 for update",
      [taskId],
    )).rows[0];
    if (!t) throw new Error("Task not found");
    requireSupervisor(viewer, t.property_id);
    if (t.assignee_id === assigneeId) return;
    if (t.status === "in_progress" && !options.confirm) throw new TaskStarted();
    await tx.query("update housekeeping_tasks set assignee_id = $2, changed = changed or $3 where id = $1", [taskId, assigneeId, await published(tx, t.property_id, t.business_date)]);
  });
}

/** Publish the day's plan: the housekeepers see their tasks from now on. */
export async function publishHousekeeping(pool: Pool, schema: string, propertyId: string, viewer: Viewer): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  requireSupervisor(viewer, propertyId);
  await withTenant(pool, schema, async (tx) => {
    const { businessDate } = await rulesOf(tx, propertyId);
    await tx.query(
      `insert into housekeeping_plans (property_id, business_date, published_at, published_by) values ($1, $2, clock_timestamp(), $3)
       on conflict (property_id, business_date) do update set published_at = coalesce(housekeeping_plans.published_at, excluded.published_at), published_by = coalesce(housekeeping_plans.published_by, excluded.published_by)`,
      [propertyId, businessDate, viewer.userId],
    );
  });
}

/**
 * Inspection failed: the room is Dirty again with the reason, and its task
 * of the day goes back to the housekeeper's list (open, Changed).
 */
export async function failInspection(pool: Pool, schema: string, roomId: string, reason: string, viewer: Viewer): Promise<void> {
  if (!isUuid(roomId)) throw new Error("Room not found");
  const why = reason.trim().slice(0, 300);
  if (!why) throw new Error("Say what is not right");
  await withTenant(pool, schema, async (tx) => {
    const room = (await tx.query<{ property_id: string; cleanliness: string }>("select property_id, cleanliness from rooms where id = $1 for update", [roomId])).rows[0];
    if (!room) throw new Error("Room not found");
    if (cleanlinessScope(viewer.actor, room.property_id, "inspected") !== "all") throw new Error("Not allowed to inspect");
    if (room.cleanliness !== "clean") throw new Error("Only a room set to Clean is inspected");
    await markDirty(tx, [roomId], "inspection", viewer.userId);
    await tx.query("update room_cleanliness_changes set reason = $2 where id = (select id from room_cleanliness_changes where room_id = $1 order by at desc limit 1)", [roomId, why]);
    const { businessDate } = await rulesOf(tx, room.property_id);
    const reopened = await tx.query(
      "update housekeeping_tasks set status = 'open', done_at = null, done_by = null, changed = true, note = $3 where room_id = $1 and business_date = $2 and status in ('done', 'in_progress', 'open')",
      [roomId, businessDate, why],
    );
    if (!reopened.rowCount) {
      await tx.query("insert into housekeeping_tasks (property_id, room_id, business_date, kind, minutes, changed, note, created_by) values ($1, $2, $3, 'clean', $4, true, $5, $6)", [
        room.property_id,
        roomId,
        businessDate,
        DEFAULT_MINUTES.clean,
        why,
        viewer.userId,
      ]);
    }
  });
}

/** A housekeeper's own task: start it, or finish it (the room turns Clean). */
export async function workHousekeepingTask(pool: Pool, schema: string, taskId: string, step: "start" | "done" | "skip", viewer: Viewer): Promise<void> {
  if (!isUuid(taskId)) throw new Error("Task not found");
  await withTenant(pool, schema, async (tx) => {
    const t = (await tx.query<{ property_id: string; room_id: string; assignee_id: string | null; status: string; kind: TaskKind }>(
      "select property_id, room_id, assignee_id, status, kind from housekeeping_tasks where id = $1 for update",
      [taskId],
    )).rows[0];
    if (!t) throw new Error("Task not found");
    const scope = cleanlinessScope(viewer.actor, t.property_id, "clean");
    if (scope === "none" || (scope === "own" && t.assignee_id !== viewer.userId)) throw new Error("Not your task");
    if (step === "skip" && t.kind !== "stayover" && t.kind !== "linen") throw new Error("Only a stayover or linen task can be skipped (guest declined, do not disturb)");
    if (step === "start") await tx.query("update housekeeping_tasks set status = 'in_progress', started_at = coalesce(started_at, clock_timestamp()) where id = $1", [taskId]);
    if (step === "skip") await tx.query("update housekeeping_tasks set status = 'skipped', done_at = clock_timestamp(), done_by = $2 where id = $1", [taskId, viewer.userId]);
    if (step === "done") {
      await tx.query("update housekeeping_tasks set status = 'done', done_at = clock_timestamp(), done_by = $2 where id = $1", [taskId, viewer.userId]);
      const room = (await tx.query<{ cleanliness: string }>("select cleanliness from rooms where id = $1 for update", [t.room_id])).rows[0]!;
      if (room.cleanliness === "dirty") {
        await tx.query("update rooms set cleanliness = 'clean', cleanliness_at = clock_timestamp(), cleanliness_by = $2 where id = $1", [t.room_id, viewer.userId]);
        await tx.query("insert into room_cleanliness_changes (room_id, property_id, before, after, source, user_id) values ($1, $2, 'dirty', 'clean', 'manual', $3)", [t.room_id, t.property_id, viewer.userId]);
      }
    }
  });
}

/** The property's rules: Stayover rhythm, Linen change every N nights (null: none), shift length. */
export async function setHousekeepingRules(pool: Pool, schema: string, propertyId: string, input: { stayover: StayoverRhythm; linenEvery: number | null; shiftMinutes: number }, viewer: Viewer): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  requireSupervisor(viewer, propertyId);
  if (!STAYOVER_RHYTHMS.includes(input.stayover)) throw new Error("Unknown stayover rhythm");
  if (input.linenEvery !== null && !(Number.isInteger(input.linenEvery) && input.linenEvery > 0)) throw new Error("Linen change every whole number of nights");
  if (!(Number.isInteger(input.shiftMinutes) && input.shiftMinutes > 0 && input.shiftMinutes <= 1440)) throw new Error("Shift length in minutes");
  await withTenant(pool, schema, (tx) =>
    tx.query("update properties set hk_stayover_rhythm = $2, hk_linen_every = $3, hk_shift_minutes = $4 where id = $1", [propertyId, input.stayover, input.linenEvery, input.shiftMinutes]),
  );
}

/** A room type's own rhythms (null: the property's) and minutes per task kind. */
export async function setRoomTypeHousekeeping(
  pool: Pool,
  schema: string,
  roomTypeId: string,
  input: { stayover: StayoverRhythm | null; linenEvery: number | null; minutes: Partial<Record<TaskKind, number>> },
  viewer: Viewer,
): Promise<void> {
  if (!isUuid(roomTypeId)) throw new Error("Room type not found");
  await withTenant(pool, schema, async (tx) => {
    const t = (await tx.query<{ property_id: string }>("select property_id from room_types where id = $1", [roomTypeId])).rows[0];
    if (!t) throw new Error("Room type not found");
    requireSupervisor(viewer, t.property_id);
    if (input.stayover !== null && !STAYOVER_RHYTHMS.includes(input.stayover)) throw new Error("Unknown stayover rhythm");
    await tx.query("update room_types set hk_stayover_rhythm = $2, hk_linen_every = $3 where id = $1", [roomTypeId, input.stayover, input.linenEvery]);
    for (const kind of TASK_KINDS) {
      const m = input.minutes[kind];
      if (m === undefined) continue;
      if (!(Number.isInteger(m) && m > 0 && m <= 600)) throw new Error("Minutes between 1 and 600");
      await tx.query("insert into housekeeping_minutes (room_type_id, kind, minutes) values ($1, $2, $3) on conflict (room_type_id, kind) do update set minutes = excluded.minutes", [roomTypeId, kind, m]);
    }
  });
}
