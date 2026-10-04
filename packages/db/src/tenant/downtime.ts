import type { Pool } from "pg";
import type { PaymentProvider } from "@hoteloftware/payments";
import { CATCH_UP_TENDERS, catchUpProblem, downtimeOptions, sortGuestRows, type CatchUpKind, type DowntimeOptions, type WorkspaceRow } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { checkIn } from "./folios";
import { checkOut } from "./invoices";
import { workspaceList } from "./operations";
import { takePayment } from "./payments";
import { moveRoomInHouse } from "./reservation-changes";
import { withTenant } from "./with-tenant";

/**
 * Downtime Reports, the offline desk and Catch-up Entry (ticket 86): the
 * printable lists and the emergency report, the outage log, and entering
 * afterwards what happened while the desk was offline.
 */

export async function getDowntimeOptions(pool: Pool, schema: string, propertyId: string): Promise<DowntimeOptions> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  const row = await withTenant(pool, schema, async (tx) => (await tx.query<{ o: unknown }>("select downtime_options as o from properties where id = $1", [propertyId])).rows[0]);
  if (!row) throw new Error("Property not found");
  return downtimeOptions(row.o);
}

export async function setDowntimeOptions(pool: Pool, schema: string, propertyId: string, options: DowntimeOptions): Promise<void> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  // stored as normalised: whatever came in, the defaults rule
  await withTenant(pool, schema, (tx) => tx.query("update properties set downtime_options = $2 where id = $1", [propertyId, JSON.stringify(downtimeOptions(options))]));
}

export interface DowntimeGuestRow extends WorkspaceRow {
  notes: string;
  hkNotes: string[];
  adults: number;
  children: number;
}

export interface RoomRackRow {
  roomId: string;
  room: string;
  floor: string;
  roomType: string;
  cleanliness: string;
  block: string | null;
  /** Occupied tonight: surname, persons, departure. */
  guest: { name: string; persons: number; departure: string } | null;
  /** The next arrival in this room, from today on. */
  next: { name: string; arrival: string } | null;
}

export interface DowntimeSet {
  property: { id: string; name: string };
  businessDate: string;
  generatedAt: string;
  options: DowntimeOptions;
  arrivals: DowntimeGuestRow[];
  departures: DowntimeGuestRow[];
  inHouse: DowntimeGuestRow[];
  roomRack: RoomRackRow[];
}

/** The Downtime Reports of a property as of now: arrivals, expected departures, in-house, Room Rack by floor. */
export async function downtimeSet(pool: Pool, schema: string, propertyId: string): Promise<DowntimeSet> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  const base = await withTenant(pool, schema, async (tx) => {
    const p = (await tx.query<{ name: string; bd: string; o: unknown }>("select name, to_char(business_date, 'YYYY-MM-DD') as bd, downtime_options as o from properties where id = $1", [propertyId])).rows[0];
    if (!p) throw new Error("Property not found");
    const rack = (await tx.query<{ id: string; number: string; floor: string; type: string; cleanliness: string; block: string | null; guest: string | null; persons: number | null; departure: string | null; next_guest: string | null; next_arrival: string | null }>(
      `select m.id, m.number, m.floor, t.name as type, m.cleanliness,
         (select b.kind || ': ' || b.reason from room_blocks b where b.room_id = m.id and b.from_date <= $2 and b.to_date > $2 limit 1) as block,
         occ.guest, occ.persons, occ.departure, nxt.guest as next_guest, nxt.arrival as next_arrival
       from rooms m join room_types t on t.id = m.room_type_id
       left join lateral (
         select g.last_name as guest, r.adults + coalesce(array_length(r.child_ages, 1), 0) as persons, to_char(r.departure, 'YYYY-MM-DD') as departure
         from room_assignments a join reservations r on r.id = a.reservation_id join guests g on g.id = r.primary_guest_id
         where a.room_id = m.id and a.from_date <= $2 and a.to_date > $2 and r.status = 'checked_in' limit 1
       ) occ on true
       left join lateral (
         select g.last_name as guest, to_char(r.arrival, 'YYYY-MM-DD') as arrival
         from room_assignments a join reservations r on r.id = a.reservation_id join guests g on g.id = r.primary_guest_id
         where a.room_id = m.id and r.status = 'confirmed' and r.arrival >= $2 order by r.arrival limit 1
       ) nxt on true
       where m.property_id = $1
       order by m.floor, m.sort_order, m.number`,
      [propertyId, p.bd],
    )).rows;
    return { p, rack };
  });
  const options = downtimeOptions(base.p.o);
  const [arrivals, departures, inHouse] = await Promise.all([
    workspaceList(pool, schema, propertyId, "arrivals", base.p.bd),
    workspaceList(pool, schema, propertyId, "departures", base.p.bd),
    workspaceList(pool, schema, propertyId, "in_house", base.p.bd),
  ]);
  const ids = [...arrivals, ...departures, ...inHouse].map((r) => r.reservationId);
  const extra = await withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; notes: string; adults: number; children: number; hk: string[] | null }>(
      `select r.id, b.notes, r.adults, coalesce(array_length(r.child_ages, 1), 0) as children,
         (select array_agg(coalesce(n.code, n.text) order by n.created_at) from housekeeping_notes n where n.reservation_id = r.id) as hk
       from reservations r join bookings b on b.id = r.booking_id where r.id = any($1::uuid[])`,
      [ids],
    )).rows,
  );
  const more = new Map(extra.map((e) => [e.id, e]));
  const enrich = (rows: WorkspaceRow[]): DowntimeGuestRow[] =>
    sortGuestRows(
      rows.map((r) => {
        const e = more.get(r.reservationId);
        return { ...r, notes: e?.notes ?? "", hkNotes: e?.hk ?? [], adults: e?.adults ?? 0, children: e?.children ?? 0 };
      }),
      options.sort,
    );
  return {
    property: { id: propertyId, name: base.p.name },
    businessDate: base.p.bd,
    generatedAt: new Date().toISOString(),
    options,
    arrivals: enrich(arrivals),
    departures: enrich(departures),
    inHouse: enrich(inHouse),
    roomRack: base.rack.map((m) => ({
      roomId: m.id,
      room: m.number,
      floor: m.floor,
      roomType: m.type,
      cleanliness: m.cleanliness,
      block: m.block,
      guest: m.guest ? { name: m.guest, persons: m.persons ?? 0, departure: m.departure ?? "" } : null,
      next: m.next_guest ? { name: m.next_guest, arrival: m.next_arrival ?? "" } : null,
    })),
  };
}

export interface EmergencyReport extends DowntimeSet {
  /** Guests in house with how to reach them. */
  contacts: { name: string; room: string | null; phone: string; email: string }[];
  cardHolds: { name: string; room: string | null; amount: number; currency: string }[];
}

/** The emergency report: the Downtime Reports plus how to reach every guest in house and the open Card Holds. */
export async function emergencyReport(pool: Pool, schema: string, propertyId: string): Promise<EmergencyReport> {
  const set = await downtimeSet(pool, schema, propertyId);
  const rows = await withTenant(pool, schema, async (tx) => {
    const contacts = (await tx.query<{ name: string; room: string | null; phone: string | null; email: string | null }>(
      `select g.first_name || ' ' || g.last_name as name, g.phone, g.email,
         (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id and a.from_date <= $2 and a.to_date > $2 limit 1) as room
       from reservations r join guests g on g.id = r.primary_guest_id where r.property_id = $1 and r.status = 'checked_in' order by g.last_name`,
      [propertyId, set.businessDate],
    )).rows;
    const holds = (await tx.query<{ name: string; room: string | null; amount: string; currency: string }>(
      `select g.first_name || ' ' || g.last_name as name, h.amount, h.currency,
         (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id and a.from_date <= $2 and a.to_date > $2 limit 1) as room
       from card_holds h join reservations r on r.id = h.reservation_id join guests g on g.id = r.primary_guest_id
       where r.property_id = $1 and h.status = 'active' order by g.last_name`,
      [propertyId, set.businessDate],
    )).rows;
    return { contacts, holds };
  });
  return {
    ...set,
    contacts: rows.contacts.map((c) => ({ name: c.name, room: c.room, phone: c.phone ?? "", email: c.email ?? "" })),
    cardHolds: rows.holds.map((h) => ({ name: h.name, room: h.room, amount: Number(h.amount), currency: h.currency.trim() })),
  };
}

// ── outages ──

export interface Outage {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  cause: "hotel" | "ours" | "unknown";
  note: string;
  loggedBy: string;
}

export async function listOutages(pool: Pool, schema: string, propertyId: string, limit = 20): Promise<Outage[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) =>
    (await tx.query<{ id: string; started_at: Date; ended_at: Date | null; cause: Outage["cause"]; note: string; logged_by: string }>(
      "select id, started_at, ended_at, cause, note, logged_by from property_outages where property_id = $1 order by started_at desc limit $2",
      [propertyId, limit],
    )).rows.map((o) => ({ id: o.id, startedAt: o.started_at, endedAt: o.ended_at, cause: o.cause, note: o.note, loggedBy: o.logged_by })),
  );
}

/** Log an outage of a property: when it started and, once known, when it ended. */
export async function logOutage(pool: Pool, schema: string, propertyId: string, input: { startedAt: Date; endedAt: Date | null; cause: Outage["cause"]; note: string }, userId: string): Promise<string> {
  if (!isUuid(propertyId)) throw new Error("Property not found");
  if (Number.isNaN(input.startedAt.getTime()) || (input.endedAt && Number.isNaN(input.endedAt.getTime()))) throw new Error("Give the times of the outage");
  if (input.startedAt > new Date()) throw new Error("An outage starts in the past");
  if (input.endedAt && input.endedAt <= input.startedAt) throw new Error("An outage ends after it started");
  return withTenant(pool, schema, async (tx) => {
    const overlap = (await tx.query(
      "select 1 from property_outages where property_id = $1 and started_at < coalesce($3::timestamptz, 'infinity') and coalesce(ended_at, 'infinity') > $2",
      [propertyId, input.startedAt, input.endedAt],
    )).rowCount;
    if (overlap) throw new Error("This outage overlaps one already logged");
    const { rows } = await tx.query<{ id: string }>(
      "insert into property_outages (property_id, started_at, ended_at, cause, note, logged_by) values ($1, $2, $3, $4, $5, $6) returning id",
      [propertyId, input.startedAt, input.endedAt, input.cause, input.note.trim().slice(0, 500), userId],
    );
    return rows[0]!.id;
  });
}

export async function endOutage(pool: Pool, schema: string, propertyId: string, outageId: string, endedAt: Date): Promise<void> {
  if (!isUuid(outageId)) throw new Error("Outage not found");
  const n = await withTenant(pool, schema, async (tx) => (await tx.query("update property_outages set ended_at = $3 where id = $1 and property_id = $2 and ended_at is null and started_at < $3", [outageId, propertyId, endedAt])).rowCount);
  if (!n) throw new Error("This outage is already ended, or ends before it started");
}

// ── Catch-up Entry ──

export type CatchUpInput =
  | { kind: "check_in"; reservationId: string; realAt: Date }
  | { kind: "check_out"; reservationId: string; realAt: Date; override?: boolean }
  | { kind: "payment"; reservationId: string; realAt: Date; tender: string; amount: number; reference?: string }
  | { kind: "room_move"; reservationId: string; realAt: Date; roomId: string };

const ACTION: Record<CatchUpKind, string> = { check_in: "check_in", check_out: "check_out", room_move: "move_room", payment: "" };

/**
 * Enter afterwards what happened during an outage, with the time it really
 * happened: inside a logged outage of the property and within the open
 * Business Date (a closed day stays closed). The record keeps the real time
 * beside its entry time and is thereby marked as entered after an outage.
 */
export async function catchUp(pool: Pool, schema: string, provider: PaymentProvider, input: CatchUpInput, userId: string): Promise<void> {
  if (!isUuid(input.reservationId)) throw new Error("Reservation not found");
  if (Number.isNaN(input.realAt.getTime())) throw new Error("Give the time it really happened");
  const ctx = await withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [input.reservationId])).rows[0];
    if (!r) throw new Error("Reservation not found");
    const outages = (await tx.query<{ started_at: Date; ended_at: Date | null }>("select started_at, ended_at from property_outages where property_id = $1", [r.property_id])).rows;
    const lastClose = (await tx.query<{ at: Date | null }>("select max(closed_at) as at from night_audits where property_id = $1 and status = 'closed'", [r.property_id])).rows[0]!.at;
    return { propertyId: r.property_id, outages: outages.map((o) => ({ startedAt: o.started_at, endedAt: o.ended_at })), lastClose };
  });
  const problem = catchUpProblem(input.realAt, ctx.outages, new Date());
  if (problem === "future") throw new Error("A Catch-up Entry happened in the past");
  if (problem === "outside_outage") throw new Error("Log the outage first: the time lies outside every outage of this property");
  // it belongs to the Business Date that was open then: entered before that day's audit, or not at all
  if (ctx.lastClose && input.realAt < ctx.lastClose) throw new Error("The Business Date it belongs to is closed already; correct it on the open date instead");
  switch (input.kind) {
    case "check_in":
      await checkIn(pool, schema, input.reservationId, userId);
      break;
    case "check_out":
      await checkOut(pool, schema, input.reservationId, userId, { override: input.override ?? false });
      break;
    case "room_move": {
      const bd = await withTenant(pool, schema, async (tx) => (await tx.query<{ bd: string }>("select to_char(business_date, 'YYYY-MM-DD') as bd from properties where id = $1", [ctx.propertyId])).rows[0]!.bd);
      await moveRoomInHouse(pool, schema, input.reservationId, userId, input.roomId, bd);
      break;
    }
    case "payment": {
      if (!(CATCH_UP_TENDERS as readonly string[]).includes(input.tender)) throw new Error("No card was charged offline: cash or bank transfer only");
      const p = await takePayment(pool, schema, provider, { reservationId: input.reservationId, tender: input.tender, amount: input.amount, ...(input.reference ? { reference: input.reference } : {}) }, userId);
      await withTenant(pool, schema, (tx) => tx.query("update payments set real_at = $2 where id = $1", [p.id, input.realAt]));
      return;
    }
  }
  // the change just made by this user: its real time, and the stay's own check-in or check-out time
  await withTenant(pool, schema, async (tx) => {
    await tx.query(
      `update reservation_changes set real_at = $3 where id = (
         select id from reservation_changes where reservation_id = $1 and action = $2 and user_id = $4 order by at desc limit 1)`,
      [input.reservationId, ACTION[input.kind], input.realAt, userId],
    );
    if (input.kind === "check_in") await tx.query("update reservations set checked_in_at = $2 where id = $1", [input.reservationId, input.realAt]);
    if (input.kind === "check_out") await tx.query("update reservations set checked_out_at = $2 where id = $1", [input.reservationId, input.realAt]);
  });
}
