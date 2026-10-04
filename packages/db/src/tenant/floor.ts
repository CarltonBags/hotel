import type { Pool, PoolClient } from "pg";
import { HOUSEKEEPING_NOTE_CODES, can, cleanlinessScope, type HousekeepingNoteCode, type LostPick, type PhoneOp, type ProblemPick, type TaskKind, type Urgency } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { postServiceChargeIn } from "./folios";
import { TaskChangedMeanwhile, workHousekeepingTaskIn } from "./housekeeping";
import type { Viewer } from "./room-state";
import { withTenant } from "./with-tenant";

/**
 * The phone view for floor staff (ticket 35): the day's rooms with what the
 * floor needs to know about the guest, the minibar, the Maintenance queue,
 * and the changes phones send, possibly long after they were made offline.
 */

export interface FloorNote {
  code: HousekeepingNoteCode | null;
  text: string | null;
}

export interface FloorTask {
  id: string;
  version: number;
  roomId: string;
  roomNumber: string;
  section: string | null;
  kind: TaskKind;
  minutes: number;
  status: "open" | "in_progress" | "done" | "skipped";
  skipReason: "declined" | "dnd" | null;
  priority: boolean;
  changed: boolean;
  assigneeId: string | null;
  doneBy: string | null;
  /** The Floor View of the guest: surname, people, last night; no more. */
  guest: { surname: string; people: number; departure: string; vip: boolean } | null;
  notes: FloorNote[];
}

export interface FloorIssue {
  id: string;
  roomNumber: string | null;
  place: string;
  pick: ProblemPick;
  urgency: Urgency;
  note: string;
  status: "open" | "in_progress";
  reportedBy: string;
  reportedAt: Date;
  takenBy: string | null;
  hasPhoto: boolean;
  block: "out_of_order" | "out_of_service" | null;
}

export interface FloorDay {
  businessDate: string;
  published: boolean;
  tasks: FloorTask[];
  minibar: { id: string; name: string; names: Record<string, string>; price: number }[];
  issues: FloorIssue[] | null;
}

/**
 * What the phone of this user shows at the property: their own rooms of the
 * published plan (a supervisor sees every room), the minibar items, and for
 * Maintenance the open issues.
 */
export async function floorDay(pool: Pool, schema: string, propertyId: string, viewer: Viewer): Promise<FloorDay> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  const scope = cleanlinessScope(viewer.actor, propertyId, "clean");
  const maintenance = can(viewer.actor, "work_maintenance", propertyId);
  if (scope === "none" && !maintenance) throw new Error("Not allowed");
  return withTenant(pool, schema, async (tx) => {
    const p = (await tx.query<{ business_date: string }>("select to_char(business_date, 'YYYY-MM-DD') as business_date from properties where id = $1", [propertyId])).rows[0];
    if (!p) throw new Error("Property not found");
    const published = (await tx.query("select 1 from housekeeping_plans where property_id = $1 and business_date = $2 and published_at is not null", [propertyId, p.business_date])).rows.length > 0;
    const tasks =
      scope === "none" || (scope === "own" && !published)
        ? []
        : (
            await tx.query<{
              id: string; version: number; room_id: string; number: string; section: string | null; kind: TaskKind; minutes: number; status: FloorTask["status"]; skip_reason: FloorTask["skipReason"];
              priority: boolean; changed: boolean; assignee_id: string | null; done_by: string | null; reservation_id: string | null;
              last_name: string | null; adults: number | null; children: number | null; departure: string | null; vip: boolean | null;
            }>(
              `select t.id, t.version, t.room_id, m.number, s.name as section, t.kind, t.minutes, t.status, t.skip_reason, t.priority, t.changed, t.assignee_id, t.done_by, t.reservation_id,
                 g.last_name, r.adults, cardinality(r.child_ages) as children, to_char(r.departure, 'YYYY-MM-DD') as departure, g.vip
               from housekeeping_tasks t join rooms m on m.id = t.room_id left join sections s on s.id = m.section_id
               left join reservations r on r.id = t.reservation_id left join guests g on g.id = r.primary_guest_id
               where t.property_id = $1 and t.business_date = $2 and ($3::text is null or t.assignee_id = $3)`,
              [propertyId, p.business_date, scope === "own" ? viewer.userId : null],
            )
          ).rows;
    const notes = (await tx.query<{ reservation_id: string; code: HousekeepingNoteCode | null; text: string | null }>(
      "select reservation_id, code, text from housekeeping_notes where reservation_id = any($1::uuid[]) order by created_at",
      [tasks.map((t) => t.reservation_id).filter(Boolean)],
    )).rows;
    const minibar = (await tx.query<{ id: string; name: string; names: Record<string, string>; default_price: string }>(
      "select id, name, names, default_price from services where property_id = $1 and minibar and active order by sort_order, code",
      [propertyId],
    )).rows;
    const issues = maintenance ? await openIssues(tx, propertyId, p.business_date) : null;
    return {
      businessDate: p.business_date,
      published,
      tasks: tasks.map((t) => ({
        id: t.id,
        version: t.version,
        roomId: t.room_id,
        roomNumber: t.number,
        section: t.section,
        kind: t.kind,
        minutes: t.minutes,
        status: t.status,
        skipReason: t.skip_reason,
        priority: t.priority,
        changed: t.changed,
        assigneeId: t.assignee_id,
        doneBy: t.done_by,
        guest: t.last_name ? { surname: t.last_name, people: (t.adults ?? 0) + (t.children ?? 0), departure: t.departure!, vip: t.vip ?? false } : null,
        notes: notes.filter((n) => n.reservation_id === t.reservation_id).map((n) => ({ code: n.code, text: n.text })),
      })),
      minibar: minibar.map((m) => ({ id: m.id, name: m.name, names: m.names, price: Number(m.default_price) })),
      issues,
    };
  });
}

async function openIssues(tx: PoolClient, propertyId: string, businessDate: string): Promise<FloorIssue[]> {
  const { rows } = await tx.query<{ id: string; number: string | null; place: string; pick: ProblemPick; urgency: Urgency; note: string; status: "open" | "in_progress"; reported_by: string; reported_at: Date; taken_by: string | null; has_photo: boolean; block: FloorIssue["block"] }>(
    `select i.id, m.number, i.place, i.pick, i.urgency, i.note, i.status, i.reported_by, i.reported_at, i.taken_by, i.photo is not null as has_photo,
       (select b.kind from room_blocks b where b.room_id = i.room_id and b.from_date <= $2 and b.to_date > $2 order by b.kind limit 1) as block
     from maintenance_issues i left join rooms m on m.id = i.room_id
     where i.property_id = $1 and i.status <> 'done'
     order by case i.urgency when 'now' then 0 when 'today' then 1 else 2 end, i.reported_at`,
    [propertyId, businessDate],
  );
  return rows.map((r) => ({ id: r.id, roomNumber: r.number, place: r.place, pick: r.pick, urgency: r.urgency, note: r.note, status: r.status, reportedBy: r.reported_by, reportedAt: r.reported_at, takenBy: r.taken_by, hasPhoto: r.has_photo, block: r.block }));
}

export type PhoneChangeOutcome = { outcome: "applied" | "conflict" | "refused"; message: string };

/**
 * Apply a change a phone sent, once: the same change sent again (a retry
 * after a lost answer) returns the first outcome. A change to a task the
 * supervisor changed since the phone saw it is not applied (supervisor
 * wins) and the outcome says so; any other refusal says why.
 */
export async function applyPhoneChange(pool: Pool, schema: string, propertyId: string, op: PhoneOp, viewer: Viewer): Promise<PhoneChangeOutcome> {
  return withTenant(pool, schema, async (tx) => {
    const claimed = await tx.query(
      "insert into phone_changes (id, user_id, kind, made_at, outcome, message) values ($1, $2, $3, $4, 'refused', 'pending') on conflict (id) do nothing",
      [op.id, viewer.userId, op.kind, op.at],
    );
    if (!claimed.rowCount) {
      const before = (await tx.query<{ user_id: string; outcome: PhoneChangeOutcome["outcome"]; message: string }>("select user_id, outcome, message from phone_changes where id = $1", [op.id])).rows[0]!;
      return before.user_id === viewer.userId ? { outcome: before.outcome, message: before.message } : { outcome: "refused", message: "Change already received" };
    }
    // changes from the phone do not count as someone else's change to the task
    await tx.query("select set_config('hoteloftware.phone_change', 'on', true)");
    await tx.query("savepoint phone_change");
    let result: PhoneChangeOutcome;
    try {
      result = { outcome: "applied", message: await apply(tx, propertyId, op, viewer) };
      await tx.query("release savepoint phone_change");
    } catch (err) {
      await tx.query("rollback to savepoint phone_change");
      if (err instanceof TaskChangedMeanwhile) result = { outcome: "conflict", message: err.message };
      else if (err instanceof Error && !("code" in err)) result = { outcome: "refused", message: err.message };
      else throw err;
    }
    await tx.query("select set_config('hoteloftware.phone_change', '', true)");
    await tx.query("update phone_changes set outcome = $2, message = $3 where id = $1", [op.id, result.outcome, result.message]);
    return result;
  });
}

async function roomAt(tx: PoolClient, roomId: string, propertyId: string): Promise<{ number: string }> {
  const room = (await tx.query<{ number: string }>("select number from rooms where id = $1 and property_id = $2", [roomId, propertyId])).rows[0];
  if (!room) throw new Error("Room not found");
  return room;
}

function decodePhoto(photo: string | undefined): { bytes: Buffer | null; type: string | null } {
  if (!photo) return { bytes: null, type: null };
  const [head, data = ""] = photo.split(",");
  return { bytes: Buffer.from(data, "base64"), type: head!.slice(5, head!.indexOf(";")) };
}

async function apply(tx: PoolClient, propertyId: string, op: PhoneOp, viewer: Viewer): Promise<string> {
  switch (op.kind) {
    case "task": {
      const ofTask = (await tx.query<{ property_id: string }>("select property_id from housekeeping_tasks where id = $1", [op.taskId])).rows[0];
      if (!ofTask || ofTask.property_id !== propertyId) throw new Error("Task not found");
      const step = op.step === "declined" || op.step === "dnd" ? "skip" : op.step;
      await workHousekeepingTaskIn(tx, op.taskId, step, viewer, { reason: op.step === "declined" || op.step === "dnd" ? op.step : undefined, seen: op.seen });
      return "";
    }
    case "minibar": {
      if (!can(viewer.actor, "post_minibar", propertyId)) throw new Error("Not allowed");
      const room = await roomAt(tx, op.roomId, propertyId);
      const bd = (await tx.query<{ d: string }>("select to_char(business_date, 'YYYY-MM-DD') as d from properties where id = $1", [propertyId])).rows[0]!.d;
      // the stay in the room: a departing guest still checked in before the one arriving
      const stay = (await tx.query<{ id: string }>(
        `select r.id from room_assignments a join reservations r on r.id = a.reservation_id
         where a.room_id = $1 and r.status = 'checked_in' and a.from_date <= $2 and a.to_date >= $2 order by a.to_date, a.from_date limit 1`,
        [op.roomId, bd],
      )).rows[0];
      if (!stay) throw new Error(`No guest is checked in to room ${room.number}; tell the front desk`);
      for (const item of op.items) await postServiceChargeIn(tx, stay.id, { serviceId: item.serviceId, quantity: item.quantity, onlyMinibar: true }, viewer.userId);
      return "";
    }
    case "problem": {
      if (!can(viewer.actor, "report_maintenance_issues", propertyId)) throw new Error("Not allowed");
      await roomAt(tx, op.roomId, propertyId);
      const photo = decodePhoto(op.photo);
      await tx.query(
        "insert into maintenance_issues (property_id, room_id, pick, urgency, note, photo, photo_type, reported_at, reported_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        [propertyId, op.roomId, op.pick, op.urgency, op.note, photo.bytes, photo.type, op.at, viewer.userId],
      );
      return "";
    }
    case "lost": {
      if (!can(viewer.actor, "record_lost_items", propertyId)) throw new Error("Not allowed");
      await roomAt(tx, op.roomId, propertyId);
      const photo = decodePhoto(op.photo);
      await tx.query(
        "insert into lost_items (property_id, room_id, pick, note, photo, photo_type, found_at, found_by) values ($1, $2, $3, $4, $5, $6, $7, $8)",
        [propertyId, op.roomId, op.pick, op.note, photo.bytes, photo.type, op.at, viewer.userId],
      );
      return "";
    }
    case "issue": {
      if (!can(viewer.actor, "work_maintenance", propertyId)) throw new Error("Not allowed");
      const issue = (await tx.query<{ status: string }>("select status from maintenance_issues where id = $1 and property_id = $2 for update", [op.issueId, propertyId])).rows[0];
      if (!issue) throw new Error("Issue not found");
      if (issue.status === "done") throw new Error("Already fixed");
      if (op.step === "take") await tx.query("update maintenance_issues set status = 'in_progress', taken_at = $2, taken_by = $3 where id = $1", [op.issueId, op.at, viewer.userId]);
      else await tx.query("update maintenance_issues set status = 'done', fixed_at = $2, fixed_by = $3, fix_note = $4, taken_by = coalesce(taken_by, $3), taken_at = coalesce(taken_at, $2) where id = $1", [op.issueId, op.at, viewer.userId, op.note]);
      return "";
    }
  }
}

/** A photo kept with an issue or a found item, for whoever may see it. */
export async function floorPhoto(pool: Pool, schema: string, what: "issue" | "lost", id: string, viewer: Viewer): Promise<{ bytes: Buffer; type: string } | null> {
  if (!isUuid(id)) return null;
  return withTenant(pool, schema, async (tx) => {
    const row = (await tx.query<{ property_id: string; photo: Buffer | null; photo_type: string | null }>(
      what === "issue" ? "select property_id, photo, photo_type from maintenance_issues where id = $1" : "select property_id, photo, photo_type from lost_items where id = $1",
      [id],
    )).rows[0];
    if (!row?.photo || !row.photo_type) return null;
    const allowed = what === "issue" ? can(viewer.actor, "work_maintenance", row.property_id) || can(viewer.actor, "assign_housekeeping", row.property_id) : can(viewer.actor, "view_lost_items", row.property_id);
    return allowed ? { bytes: row.photo, type: row.photo_type } : null;
  });
}

export interface LostItem {
  id: string;
  roomNumber: string;
  pick: LostPick;
  note: string;
  foundAt: Date;
  foundBy: string;
  hasPhoto: boolean;
  status: "kept" | "returned" | "disposed";
}

/** Lost and Found of the property, newest first. */
export async function listLostItems(pool: Pool, schema: string, propertyId: string): Promise<LostItem[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; number: string; pick: LostPick; note: string; found_at: Date; found_by: string; has_photo: boolean; status: LostItem["status"] }>(
      `select l.id, m.number, l.pick, l.note, l.found_at, l.found_by, l.photo is not null as has_photo, l.status
       from lost_items l join rooms m on m.id = l.room_id where l.property_id = $1 order by l.found_at desc limit 200`,
      [propertyId],
    );
    return rows.map((r) => ({ id: r.id, roomNumber: r.number, pick: r.pick, note: r.note, foundAt: r.found_at, foundBy: r.found_by, hasPhoto: r.has_photo, status: r.status }));
  });
}

/** Returned to the guest or disposed of. */
export async function setLostItemStatus(pool: Pool, schema: string, id: string, status: LostItem["status"], viewer: Viewer): Promise<void> {
  if (!isUuid(id)) throw new Error("Item not found");
  if (!["kept", "returned", "disposed"].includes(status)) throw new Error("Unknown status");
  await withTenant(pool, schema, async (tx) => {
    const row = (await tx.query<{ property_id: string }>("select property_id from lost_items where id = $1", [id])).rows[0];
    if (!row || !can(viewer.actor, "view_lost_items", row.property_id)) throw new Error("Item not found");
    await tx.query("update lost_items set status = $2 where id = $1", [id, status]);
  });
}

/** Housekeeping Notes of a reservation. */
export async function listHousekeepingNotes(pool: Pool, schema: string, reservationId: string): Promise<(FloorNote & { id: string })[]> {
  if (!isUuid(reservationId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; code: HousekeepingNoteCode | null; text: string | null }>("select id, code, text from housekeeping_notes where reservation_id = $1 order by created_at", [reservationId])).rows,
  );
}

/** Add a note from the fixed list (each once) or as free text. */
export async function addHousekeepingNote(pool: Pool, schema: string, reservationId: string, note: { code: string } | { text: string }, viewer: Viewer): Promise<void> {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  await withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [reservationId])).rows[0];
    if (!r || !can(viewer.actor, "manage_housekeeping_notes", r.property_id)) throw new Error("Reservation not found");
    if ("code" in note) {
      if (!(HOUSEKEEPING_NOTE_CODES as readonly string[]).includes(note.code)) throw new Error("Unknown note");
      const exists = await tx.query("select 1 from housekeeping_notes where reservation_id = $1 and code = $2", [reservationId, note.code]);
      if (exists.rowCount) return;
      await tx.query("insert into housekeeping_notes (reservation_id, code, created_by) values ($1, $2, $3)", [reservationId, note.code, viewer.userId]);
    } else {
      const text = note.text.trim().slice(0, 200);
      if (!text) throw new Error("Write the note");
      await tx.query("insert into housekeeping_notes (reservation_id, text, created_by) values ($1, $2, $3)", [reservationId, text, viewer.userId]);
    }
  });
}

export async function removeHousekeepingNote(pool: Pool, schema: string, noteId: string, viewer: Viewer): Promise<void> {
  if (!isUuid(noteId)) throw new Error("Note not found");
  await withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ property_id: string }>("select r.property_id from housekeeping_notes n join reservations r on r.id = n.reservation_id where n.id = $1", [noteId])).rows[0];
    if (!r || !can(viewer.actor, "manage_housekeeping_notes", r.property_id)) throw new Error("Note not found");
    await tx.query("delete from housekeeping_notes where id = $1", [noteId]);
  });
}
