import type { Pool, PoolClient } from "pg";
import { checkDate, isUuid } from "./catalogue-common";
import { lockProperty } from "./property-lock";
import { withTenant } from "./with-tenant";
import {
  ROOM_BLOCK_KINDS,
  can,
  cleanlinessScope,
  isReady,
  roomViewScope,
  type Actor,
  type Cleanliness,
  type CleanlinessSource,
  type RoomBlockKind,
} from "@hoteloftware/domain";

/**
 * Room state (ticket 33, ADR 0011): each room's Cleanliness, its Occupancy
 * derived from reservations on the Business Date, its dated Room Blocks and
 * today's Housekeeping Task. Out of Order takes the room out of sale for its
 * nights; Out of Service only flags it. A Housekeeper sees and sets only the
 * rooms of their own tasks.
 */

/**
 * The one Out of Order test: block `b` takes its room out of sale on some
 * night of [from, to). A block cancelled before it began (no night) never does.
 */
export const outOfOrderOn = (b: string, from: string, to: string) => `(${b}.kind = 'out_of_order' and ${b}.to_date > ${b}.from_date and ${b}.from_date < ${to} and ${b}.to_date > ${from})`;
/** Any block (Out of Order or Service) on some night of [from, to). */
const blockOn = (b: string, from: string, to: string) => `(${b}.to_date > ${b}.from_date and ${b}.from_date < ${to} and ${b}.to_date > ${from})`;
const BLOCK_RIGHT = { out_of_order: "manage_out_of_order", out_of_service: "manage_out_of_service" } as const;

export interface Viewer {
  userId: string;
  actor: Actor;
}

/** Turn rooms Dirty (check-out, room move, block end, Night Audit), logged with their source. */
export async function markDirty(tx: PoolClient, roomIds: string[], source: CleanlinessSource, userId: string): Promise<void> {
  if (!roomIds.length) return;
  const { rows } = await tx.query<{ id: string; property_id: string; before: string }>(
    `update rooms m set cleanliness = 'dirty', cleanliness_at = clock_timestamp(), cleanliness_by = $2
     from (select id, cleanliness as before from rooms where id = any($1::uuid[]) and cleanliness <> 'dirty' for update) old
     where m.id = old.id returning m.id, m.property_id, old.before`,
    [[...new Set(roomIds)], userId],
  );
  for (const r of rows) {
    await tx.query("insert into room_cleanliness_changes (room_id, property_id, before, after, source, user_id) values ($1, $2, $3, 'dirty', $4, $5)", [r.id, r.property_id, r.before, source, userId]);
  }
}

/** The room a stay holds on a night. */
export async function roomOfNight(tx: PoolClient, reservationId: string, night: string): Promise<string | null> {
  return (await tx.query<{ room_id: string }>("select room_id from room_assignments where reservation_id = $1 and from_date <= $2 and to_date > $2", [reservationId, night])).rows[0]?.room_id ?? null;
}

async function businessDateOf(tx: PoolClient, propertyId: string): Promise<{ businessDate: string; inspectionRequired: boolean }> {
  const p = (await tx.query<{ business_date: string; inspection_required: boolean }>("select to_char(business_date, 'YYYY-MM-DD') as business_date, inspection_required from properties where id = $1", [propertyId])).rows[0];
  if (!p) throw new Error("Property not found");
  return { businessDate: p.business_date, inspectionRequired: p.inspection_required };
}

/** Rooms with a Housekeeping Task of the user on the property's Business Date. */
async function ownRooms(tx: PoolClient, propertyId: string, businessDate: string, userId: string): Promise<Set<string>> {
  return new Set(
    (await tx.query<{ room_id: string }>("select room_id from housekeeping_tasks where property_id = $1 and business_date = $2 and assignee_id = $3", [propertyId, businessDate, userId])).rows.map((r) => r.room_id),
  );
}

export interface RoomBlock {
  id: string;
  roomId: string;
  kind: RoomBlockKind;
  from: string;
  to: string;
  reason: string;
  createdBy: string;
  /** Stays still assigned to the room on blocked nights (Out of Order: to move), floor view. */
  conflicts: string[];
}

export interface RoomState {
  id: string;
  number: string;
  name: string;
  roomTypeId: string;
  roomTypeCode: string;
  floor: string;
  section: string | null;
  cleanliness: Cleanliness;
  ready: boolean;
  /** Occupied tonight (Business Date): the stay in it, floor view only (surname, dates, number of guests). */
  occupiedBy: { reservationId: string; confirmationNumber: string; guestSurname: string; departure: string; guests: number } | null;
  /** An arrival for tonight assigned to the room. */
  arrival: { reservationId: string; confirmationNumber: string; guestSurname: string } | null;
  /** Blocks in force tonight or later. */
  blocks: RoomBlock[];
  task: { id: string; assigneeId: string | null; status: string } | null;
}

const BLOCK_COLUMNS = "id, room_id, kind, to_char(from_date, 'YYYY-MM-DD') as from_date, to_char(to_date, 'YYYY-MM-DD') as to_date, reason, created_by";
type BlockRow = { id: string; room_id: string; kind: RoomBlockKind; from_date: string; to_date: string; reason: string; created_by: string };
const toBlock = (b: BlockRow & { conflicts?: string[] | null }): RoomBlock => ({ id: b.id, roomId: b.room_id, kind: b.kind, from: b.from_date, to: b.to_date, reason: b.reason, createdBy: b.created_by, conflicts: b.conflicts ?? [] });

/** The property's rooms with their state on the Business Date; a Housekeeper gets only their own rooms. */
export async function listRoomStates(pool: Pool, schema: string, propertyId: string, viewer: Viewer): Promise<{ businessDate: string; inspectionRequired: boolean; rooms: RoomState[] }> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  const scope = roomViewScope(viewer.actor, propertyId);
  if (scope === "none") throw new Error("Not allowed to see the rooms of this property");
  return withTenant(pool, schema, async (tx) => {
    const { businessDate, inspectionRequired } = await businessDateOf(tx, propertyId);
    const own = scope === "own" ? await ownRooms(tx, propertyId, businessDate, viewer.userId) : null;
    const rows = (await tx.query<{ id: string; number: string; name: string; room_type_id: string; type_code: string; floor: string; section: string | null; cleanliness: Cleanliness }>(
      `select m.id, m.number, m.name, m.room_type_id, t.code as type_code, m.floor, s.name as section, m.cleanliness
       from rooms m join room_types t on t.id = m.room_type_id left join sections s on s.id = m.section_id
       where m.property_id = $1 order by m.sort_order, m.number`,
      [propertyId],
    )).rows.filter((r) => !own || own.has(r.id));
    const ids = rows.map((r) => r.id);
    const stays = (await tx.query<{ room_id: string; reservation_id: string; confirmation_number: string; last_name: string; departure: string; status: string; arrival: string; guests: number }>(
      `select a.room_id, r.id as reservation_id, b.confirmation_number, g.last_name, to_char(r.departure, 'YYYY-MM-DD') as departure, r.status, to_char(r.arrival, 'YYYY-MM-DD') as arrival,
         r.adults + coalesce(array_length(r.child_ages, 1), 0) as guests
       from room_assignments a join reservations r on r.id = a.reservation_id join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id
       where a.room_id = any($1::uuid[]) and a.from_date <= $2 and a.to_date > $2 and r.status in ('checked_in', 'confirmed')`,
      [ids, businessDate],
    )).rows;
    const blocks = (await tx.query<BlockRow & { conflicts: string[] | null }>(
      `select ${BLOCK_COLUMNS},
         (select array_agg(bk.confirmation_number || ' · ' || g.last_name order by a.from_date) from room_assignments a join reservations r on r.id = a.reservation_id
            join bookings bk on bk.id = r.booking_id join guests g on g.id = r.primary_guest_id
           where a.room_id = room_blocks.room_id and a.from_date < room_blocks.to_date and a.to_date > room_blocks.from_date and r.status in ('confirmed', 'checked_in')) as conflicts
       from room_blocks where room_id = any($1::uuid[]) and to_date > $2 and to_date > from_date order by from_date`,
      [ids, businessDate],
    )).rows.map(toBlock);
    const tasks = (await tx.query<{ id: string; room_id: string; assignee_id: string | null; status: string }>(
      "select id, room_id, assignee_id, status from housekeeping_tasks where room_id = any($1::uuid[]) and business_date = $2 order by created_at",
      [ids, businessDate],
    )).rows;
    return {
      businessDate,
      inspectionRequired,
      rooms: rows.map((m) => {
        const inHouse = stays.find((s) => s.room_id === m.id && s.status === "checked_in");
        const arriving = stays.find((s) => s.room_id === m.id && s.status === "confirmed" && s.arrival <= businessDate);
        const task = tasks.find((t) => t.room_id === m.id);
        return {
          id: m.id,
          number: m.number,
          name: m.name,
          roomTypeId: m.room_type_id,
          roomTypeCode: m.type_code,
          floor: m.floor,
          section: m.section,
          cleanliness: m.cleanliness,
          ready: isReady(m.cleanliness, inspectionRequired),
          occupiedBy: inHouse ? { reservationId: inHouse.reservation_id, confirmationNumber: inHouse.confirmation_number, guestSurname: inHouse.last_name, departure: inHouse.departure, guests: inHouse.guests } : null,
          arrival: arriving ? { reservationId: arriving.reservation_id, confirmationNumber: arriving.confirmation_number, guestSurname: arriving.last_name } : null,
          blocks: blocks.filter((b) => b.roomId === m.id),
          task: task ? { id: task.id, assigneeId: task.assignee_id, status: task.status } : null,
        };
      }),
    };
  });
}

/** Set a room's Cleanliness by hand, within the viewer's rights (a Housekeeper only on own rooms, never Inspected). */
export async function setCleanliness(pool: Pool, schema: string, roomId: string, to: Cleanliness, viewer: Viewer): Promise<void> {
  if (!isUuid(roomId)) throw new Error("Room not found");
  if (to !== "dirty" && to !== "clean" && to !== "inspected") throw new Error("Dirty, Clean or Inspected");
  await withTenant(pool, schema, async (tx) => {
    const room = (await tx.query<{ property_id: string; cleanliness: Cleanliness }>("select property_id, cleanliness from rooms where id = $1 for update", [roomId])).rows[0];
    if (!room) throw new Error("Room not found");
    const scope = cleanlinessScope(viewer.actor, room.property_id, to);
    if (scope === "none") throw new Error("Not allowed to set this room's Cleanliness");
    if (scope === "own") {
      const { businessDate } = await businessDateOf(tx, room.property_id);
      if (!(await ownRooms(tx, room.property_id, businessDate, viewer.userId)).has(roomId)) throw new Error("Not one of your rooms today");
    }
    if (room.cleanliness === to) return;
    await tx.query("update rooms set cleanliness = $2, cleanliness_at = clock_timestamp(), cleanliness_by = $3 where id = $1", [roomId, to, viewer.userId]);
    await tx.query("insert into room_cleanliness_changes (room_id, property_id, before, after, source, user_id) values ($1, $2, $3, $4, 'manual', $5)", [roomId, room.property_id, room.cleanliness, to, viewer.userId]);
  });
}

export interface BlockConflict {
  reservationId: string;
  confirmationNumber: string;
  /** Floor view: the surname only. */
  guestName: string;
  from: string;
  to: string;
}

/**
 * Block a room for nights from `from` to the day before `to`. Out of Order
 * takes it out of sale (the assigned stays are returned as conflicts to
 * move); Out of Service only flags it. Blocks of a room do not overlap.
 */
export async function createRoomBlock(
  pool: Pool,
  schema: string,
  input: { roomId: string; kind: RoomBlockKind; from: string; to: string; reason: string },
  viewer: Viewer,
): Promise<{ id: string; conflicts: BlockConflict[] }> {
  if (!isUuid(input.roomId)) throw new Error("Room not found");
  if (!ROOM_BLOCK_KINDS.includes(input.kind)) throw new Error("Out of Order or Out of Service");
  checkDate(input.from);
  checkDate(input.to);
  if (input.to <= input.from) throw new Error("A block lasts at least one night");
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new Error("A Room Block needs a reason");
  return withTenant(pool, schema, async (tx) => {
    const room = (await tx.query<{ property_id: string }>("select property_id from rooms where id = $1", [input.roomId])).rows[0];
    if (!room) throw new Error("Room not found");
    // availability changes: the property lock first, as for every reservation writer
    await lockProperty(tx, room.property_id);
    if (!can(viewer.actor, BLOCK_RIGHT[input.kind], room.property_id)) throw new Error("Not allowed to set this Room Block");
    const { businessDate } = await businessDateOf(tx, room.property_id);
    if (input.from < businessDate) throw new Error("A block starts on the Business Date or later");
    const overlap = (await tx.query(`select 1 from room_blocks b where b.room_id = $1 and ${blockOn("b", "$2", "$3")}`, [input.roomId, input.from, input.to])).rows.length;
    if (overlap) throw new Error("The room is already blocked on some of those nights");
    const { rows } = await tx.query<{ id: string }>(
      "insert into room_blocks (property_id, room_id, kind, from_date, to_date, reason, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [room.property_id, input.roomId, input.kind, input.from, input.to, reason, viewer.userId],
    );
    const conflicts = (await tx.query<{ reservation_id: string; confirmation_number: string; guest: string; from_date: string; to_date: string }>(
      `select r.id as reservation_id, b.confirmation_number, g.last_name as guest, to_char(a.from_date, 'YYYY-MM-DD') as from_date, to_char(a.to_date, 'YYYY-MM-DD') as to_date
       from room_assignments a join reservations r on r.id = a.reservation_id join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id
       where a.room_id = $1 and a.from_date < $3 and a.to_date > $2 and r.status in ('confirmed', 'checked_in') order by a.from_date`,
      [input.roomId, input.from, input.to],
    )).rows.map((c) => ({ reservationId: c.reservation_id, confirmationNumber: c.confirmation_number, guestName: c.guest, from: c.from_date, to: c.to_date }));
    return { id: rows[0]!.id, conflicts };
  });
}

/** End a block early (from tonight on the room is unblocked); a block in force leaves the room Dirty. */
export async function endRoomBlock(pool: Pool, schema: string, blockId: string, viewer: Viewer): Promise<void> {
  if (!isUuid(blockId)) throw new Error("Block not found");
  await withTenant(pool, schema, async (tx) => {
    const owner = (await tx.query<{ property_id: string }>("select property_id from room_blocks where id = $1", [blockId])).rows[0];
    if (!owner) throw new Error("Block not found");
    await lockProperty(tx, owner.property_id);
    const b = (await tx.query<BlockRow & { property_id: string }>(`select ${BLOCK_COLUMNS}, property_id from room_blocks where id = $1 for update`, [blockId])).rows[0]!;
    if (!can(viewer.actor, BLOCK_RIGHT[b.kind], b.property_id)) throw new Error("Not allowed to end this Room Block");
    const { businessDate } = await businessDateOf(tx, b.property_id);
    if (b.to_date <= businessDate || b.to_date === b.from_date) throw new Error("The block has already ended");
    // a block not begun yet is cancelled; one in force ends tonight
    const end = b.from_date > businessDate ? b.from_date : businessDate;
    await tx.query("update room_blocks set to_date = $2, ended_at = clock_timestamp(), ended_by = $3 where id = $1", [blockId, end, viewer.userId]);
    if (b.from_date <= businessDate) await markDirty(tx, [b.room_id], "block_end", viewer.userId);
  });
}

/** Give a room's Housekeeping Task of the Business Date to a Housekeeper (null: unassigned); the caller checked the assignee is one at the property. */
export async function assignHousekeeping(pool: Pool, schema: string, roomId: string, assigneeId: string | null, viewer: Viewer): Promise<void> {
  if (!isUuid(roomId)) throw new Error("Room not found");
  await withTenant(pool, schema, async (tx) => {
    const room = (await tx.query<{ property_id: string }>("select property_id from rooms where id = $1", [roomId])).rows[0];
    if (!room) throw new Error("Room not found");
    if (!can(viewer.actor, "assign_housekeeping", room.property_id)) throw new Error("Not allowed to assign Housekeeping Tasks");
    const { businessDate } = await businessDateOf(tx, room.property_id);
    await tx.query(
      `insert into housekeeping_tasks (property_id, room_id, business_date, assignee_id, created_by) values ($1, $2, $3, $4, $5)
       on conflict (room_id, business_date, kind) do update set assignee_id = excluded.assignee_id`,
      [room.property_id, roomId, businessDate, assigneeId, viewer.userId],
    );
  });
}

/** Out of Order rooms of each room type per night of a range: not for sale. */
export async function outOfOrderByNight(tx: PoolClient, propertyId: string, from: string, to: string): Promise<Map<string, number>> {
  const { rows } = await tx.query<{ room_type_id: string; date: string; n: number }>(
    `select m.room_type_id, to_char(d, 'YYYY-MM-DD') as date, count(*)::int as n
     from room_blocks b join rooms m on m.id = b.room_id
     cross join lateral generate_series(greatest(b.from_date, $2::date), least(b.to_date, $3::date) - 1, interval '1 day') d
     where b.property_id = $1 and ${outOfOrderOn("b", "$2::date", "$3::date")}
       -- a room a stay still holds that night is already counted with the stays: one room, counted once
       and not exists (select 1 from room_assignments a join reservations r on r.id = a.reservation_id
                       where a.room_id = b.room_id and a.from_date <= d and a.to_date > d and r.status in ('confirmed', 'checked_in'))
     group by m.room_type_id, d`,
    [propertyId, from, to],
  );
  return new Map(rows.map((r) => [`${r.room_type_id}|${r.date}`, r.n]));
}

/** Refuse a room Out of Order on any of the nights. */
export async function assertNotOutOfOrder(tx: PoolClient, roomId: string, from: string, to: string): Promise<void> {
  const b = (await tx.query<{ from_date: string }>(`select to_char(b.from_date, 'YYYY-MM-DD') as from_date from room_blocks b where b.room_id = $1 and ${outOfOrderOn("b", "$2", "$3")} limit 1`, [roomId, from, to])).rows[0];
  if (b) throw new Error("The room is Out of Order on some of those nights");
}

/** The property's ready rule for check-in. */
export async function roomReadiness(tx: PoolClient, roomId: string): Promise<{ cleanliness: Cleanliness; ready: boolean }> {
  const r = (await tx.query<{ cleanliness: Cleanliness; inspection_required: boolean }>("select m.cleanliness, p.inspection_required from rooms m join properties p on p.id = m.property_id where m.id = $1", [roomId])).rows[0];
  if (!r) throw new Error("Room not found");
  return { cleanliness: r.cleanliness, ready: isReady(r.cleanliness, r.inspection_required) };
}

/** The property's inspection rule: Inspected rooms only, or Clean is enough (Property Manager). */
export async function setInspectionRequired(pool: Pool, schema: string, propertyId: string, required: boolean, viewer: Viewer): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  if (!can(viewer.actor, "manage_property_settings", propertyId)) throw new Error("Not allowed to change the property's settings");
  await withTenant(pool, schema, (tx) => tx.query("update properties set inspection_required = $2 where id = $1", [propertyId, required === true]));
}

/** The property of a room, or of a block's room (null when unknown): for the caller's rights check. */
export async function propertyOfRoom(pool: Pool, schema: string, ref: { roomId?: string; blockId?: string }): Promise<string | null> {
  const id = ref.roomId ?? ref.blockId;
  if (!id || !isUuid(id)) return null;
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ property_id: string }>(ref.roomId ? "select property_id from rooms where id = $1" : "select property_id from room_blocks where id = $1", [id])).rows[0]?.property_id ?? null,
  );
}
