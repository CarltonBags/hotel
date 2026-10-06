import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  OCCUPYING_STATUSES,
  ROUTING_CATEGORIES,
  can,
  checkRoomingList,
  depositStatus,
  isOneOf,
  normaliseEmail,
  parseRoomingList,
  roomsTogether,
  roundMoney,
  tourLeaderRegisters,
  type DepositInstallment,
  type PropertyAction,
  type RoomingProblem,
  type RoomingRow,
  type RoutingCategory,
} from "@hoteloftware/domain";
import { checkDate, isUuid } from "./catalogue-common";
import { checkIn, masterFolioIn } from "./folios";
import { inTestMode } from "./go-live";
import { bookFromGroup } from "./groups";
import { createGuest } from "./guests";
import { depositIn, issueInvoice, type IssuedInvoice } from "./invoices";
import { lockProperty } from "./property-lock";
import { assignRoomIn, freeRoomsIn, updateReservation } from "./reservation-changes";
import { createBooking } from "./reservations";
import type { Viewer } from "./room-state";
import { rateOn } from "./tax-rate";
import { withTenant } from "./with-tenant";

/**
 * A group's rooms and money (ticket 59, "Groups and allotments"): its Held
 * Rooms become reservations under placeholder names, named from the
 * organiser's rooming list (imported or filled in through the organiser's
 * link) until check-in; the Master Folio billed to the organiser takes the
 * categories of the group's Routing Rules (a reservation may deviate) and
 * becomes one invoice listing rooms and nights; a deposit schedule is
 * reminded; a shrink or cancellation shows the contract and staff post the
 * fee; the arrival is checked in together, rooms kept together by floor or
 * Section, and in Germany the tour leader of a group above ten registers.
 */

function need(viewer: Viewer, action: PropertyAction, propertyId: string): void {
  if (!can(viewer.actor, action, propertyId)) throw new Error("Not allowed to do this with groups");
}

interface GroupRow {
  id: string;
  property_id: string;
  name: string;
  status: string;
  rate_plan_id: string;
  organiser_company_id: string | null;
  organiser_guest_id: string | null;
}

async function groupOf(tx: PoolClient, groupId: string): Promise<GroupRow> {
  if (!isUuid(groupId)) throw new Error("Group not found");
  const g = (await tx.query<GroupRow>("select id, property_id, name, status, rate_plan_id, organiser_company_id, organiser_guest_id from groups where id = $1", [groupId])).rows[0];
  if (!g) throw new Error("Group not found");
  return g;
}

interface HoldingRow {
  id: string;
  group_id: string;
  arrival: string;
  departure: string;
  released: boolean;
}

async function holdingOf(tx: PoolClient, holdingId: string): Promise<HoldingRow & { group: GroupRow }> {
  if (!isUuid(holdingId)) throw new Error("Holding not found");
  const h = (await tx.query<HoldingRow>(
    "select id, group_id, to_char(arrival, 'YYYY-MM-DD') as arrival, to_char(departure, 'YYYY-MM-DD') as departure, released_at is not null as released from group_holdings where id = $1",
    [holdingId],
  )).rows[0];
  if (!h) throw new Error("Holding not found");
  return { ...h, group: await groupOf(tx, h.group_id) };
}

/** Who names a room through the organiser's link (no user account). */
const ORGANISER = "organiser";

/**
 * One at a time per holding, across app instances: a session advisory lock on
 * its own connection while the work runs in transactions of its own (a double
 * click makes no second set of reservations).
 */
async function oneAtATime<T>(pool: Pool, key: string, fn: () => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("select pg_advisory_lock(hashtext($1))", [key]);
    return await fn();
  } finally {
    await c.query("select pg_advisory_unlock(hashtext($1))", [key]).catch(() => undefined);
    c.release();
  }
}

// ── Routing Rules ──

/**
 * The group's Routing Rules: Charges of these categories of its reservations
 * go to the Master Folio. Reservations not yet checked out follow: a category
 * added goes to the Master Folio unless the reservation routes it elsewhere,
 * one removed comes back to the guest.
 */
export async function setGroupRouting(pool: Pool, schema: string, groupId: string, categories: string[], viewer: Viewer): Promise<void> {
  const wanted = [...new Set(categories)];
  if (!wanted.every((c) => isOneOf(ROUTING_CATEGORIES, c))) throw new Error("Unknown routing category");
  await withTenant(pool, schema, async (tx) => {
    const g = await groupOf(tx, groupId);
    need(viewer, "manage_groups", g.property_id);
    await tx.query("select 1 from groups where id = $1 for update", [g.id]);
    const before = (await tx.query<{ category: RoutingCategory }>("select category from group_routing where group_id = $1", [g.id])).rows.map((r) => r.category);
    const master = wanted.length || before.length ? await masterFolioIn(tx, g.id, viewer.userId) : null;
    await tx.query("delete from group_routing where group_id = $1", [g.id]);
    if (wanted.length) await tx.query("insert into group_routing (group_id, category) select $1, unnest($2::text[])", [g.id, wanted]);
    const removed = before.filter((c) => !wanted.includes(c));
    const added = wanted.filter((c) => !before.includes(c));
    const open = `select r.id from reservations r join group_holdings h on h.id = r.group_holding_id where h.group_id = $1 and r.status in ('confirmed', 'checked_in')`;
    if (removed.length) await tx.query(`delete from reservation_routing where folio_id = $2 and category = any($3::text[]) and reservation_id in (${open})`, [g.id, master, removed]);
    if (added.length) {
      // only reservations with folios already: the others are routed when their folios are made
      await tx.query(
        `insert into reservation_routing (reservation_id, category, folio_id)
         select x.id, c, $2 from (${open} and exists (select 1 from folios f where f.reservation_id = r.id)) x cross join unnest($3::text[]) c
         on conflict (reservation_id, category) do nothing`,
        [g.id, master, added],
      );
    }
  });
}

// ── reservations, placeholders and the rooming list ──

interface TypeSlots {
  roomTypeId: string;
  code: string;
  /** Held Rooms on every night of the holding (a reservation runs the whole holding). */
  held: number;
  named: number;
  /** Reservations still under a placeholder name, oldest first. */
  pending: string[];
}

async function slotsOf(tx: PoolClient, holdingId: string): Promise<TypeSlots[]> {
  const rows = (await tx.query<{ room_type_id: string; code: string; held: number }>(
    `select h.room_type_id, t.code, min(h.rooms)::int as held from group_held_rooms h join room_types t on t.id = h.room_type_id
     where h.holding_id = $1 group by h.room_type_id, t.code, t.sort_order order by t.sort_order, t.code`,
    [holdingId],
  )).rows;
  const res = (await tx.query<{ id: string; room_type_id: string; name_pending: boolean }>(
    "select id, room_type_id, name_pending from reservations where group_holding_id = $1 and status = any($2::text[]) order by created_at, id",
    [holdingId, OCCUPYING_STATUSES],
  )).rows;
  return rows.map((t) => {
    const own = res.filter((r) => r.room_type_id === t.room_type_id);
    return { roomTypeId: t.room_type_id, code: t.code, held: t.held, named: own.filter((r) => !r.name_pending).length, pending: own.filter((r) => r.name_pending).map((r) => r.id) };
  });
}

/**
 * The Held Rooms not yet booked become reservations at once, under
 * placeholder names (the group's name and a number), each with a guest
 * profile of its own that the rooming list later names.
 */
export async function createPlaceholderReservations(pool: Pool, schema: string, holdingId: string, viewer: Viewer): Promise<number> {
  if (!isUuid(holdingId)) throw new Error("Holding not found");
  return oneAtATime(pool, `${schema}:placeholders:${holdingId}`, () => placeholdersFor(pool, schema, holdingId, viewer));
}

async function placeholdersFor(pool: Pool, schema: string, holdingId: string, viewer: Viewer): Promise<number> {
  const { h, slots } = await withTenant(pool, schema, async (tx) => {
    const h = await holdingOf(tx, holdingId);
    need(viewer, "manage_groups", h.group.property_id);
    if (h.released) throw new Error("The Held Rooms are released");
    if (h.group.status === "cancelled" || h.group.status === "lapsed") throw new Error(`The group is ${h.group.status}`);
    return { h, slots: await slotsOf(tx, holdingId) };
  });
  const wanted = slots.flatMap((s) => Array.from({ length: Math.max(0, s.held - s.named - s.pending.length) }, (_, i) => ({ type: s, n: s.named + s.pending.length + i + 1 })));
  if (!wanted.length) throw new Error("Every Held Room has a reservation already");
  if (wanted.length > 200) throw new Error("At most 200 reservations at once");
  const guests: string[] = [];
  try {
    for (const w of wanted) guests.push((await createGuest(pool, schema, { firstName: `${w.type.code} ${w.n}`, lastName: h.group.name.slice(0, 100) }, { userId: viewer.userId, propertyId: h.group.property_id })).id);
    const booker = h.group.organiser_company_id ? { companyId: h.group.organiser_company_id } : { guestId: h.group.organiser_guest_id ?? guests[0]! };
    const b = await createBooking(pool, schema, h.group.property_id, viewer.userId, {
      booker,
      walkIn: false,
      notes: "",
      reservations: wanted.map((w, i) => ({ arrival: h.arrival, departure: h.departure, roomTypeId: w.type.roomTypeId, ratePlanId: h.group.rate_plan_id, adults: 1, childAges: [], primaryGuestId: guests[i]!, groupHoldingId: holdingId })),
    });
    await withTenant(pool, schema, (tx) => tx.query("update reservations set name_pending = true where id = any($1::uuid[])", [b.reservations.map((r) => r.id)]));
    return b.reservations.length;
  } catch (err) {
    // the placeholder guests of a booking that failed go again
    await withTenant(pool, schema, (tx) => tx.query("delete from guests g where id = any($1::uuid[]) and not exists (select 1 from reservations r where r.primary_guest_id = g.id)", [guests])).catch(() => undefined);
    throw err;
  }
}

export interface GuestName {
  firstName: string;
  lastName: string;
  email?: string | undefined;
}

/**
 * Name a group's reservation (until check-in): a guest profile only this
 * stay uses is named in place; one used elsewhere (a real person's) is left
 * alone and the stay gets a new profile, on its guest folio too while
 * nothing is invoiced there.
 */
async function nameReservationIn(tx: PoolClient, reservationId: string, name: GuestName, userId: string, newGuestId: () => Promise<string>): Promise<void> {
  const first = name.firstName.trim().slice(0, 100);
  const last = name.lastName.trim().slice(0, 100);
  if (!last) throw new Error("A last name is required");
  const r = (await tx.query<{ status: string; name_pending: boolean; primary_guest_id: string; first_name: string; last_name: string }>(
    "select r.status, r.name_pending, r.primary_guest_id, g.first_name, g.last_name from reservations r join guests g on g.id = r.primary_guest_id where r.id = $1 for update of r",
    [reservationId],
  )).rows[0];
  if (!r) throw new Error("Reservation not found");
  if (r.status !== "confirmed") throw new Error("Names change until check-in");
  if (r.first_name === first && r.last_name === last && !r.name_pending) return;
  const email = name.email?.trim() ? name.email.trim().slice(0, 200) : null;
  // the guest profile is this stay's own (a placeholder, or made for it from a list): named in place, no profile left behind
  const own = r.name_pending || !(await tx.query(
    `select 1 where exists (select 1 from reservations x where x.primary_guest_id = $1 and x.id <> $2)
        or exists (select 1 from bookings b where b.booker_guest_id = $1)
        or exists (select 1 from folios f where f.bill_to_guest_id = $1 and (f.reservation_id is distinct from $2 or exists (select 1 from invoices i where i.folio_id = f.id)))`,
    [r.primary_guest_id, reservationId],
  )).rows.length;
  if (own) {
    await tx.query("update guests set first_name = $2, last_name = $3, email = coalesce($4, email), email_normalised = coalesce($5, email_normalised), updated_at = now() where id = $1", [r.primary_guest_id, first, last, email, email ? normaliseEmail(email) : null]);
  } else {
    const guestId = await newGuestId();
    await tx.query("update reservations set primary_guest_id = $2 where id = $1", [reservationId, guestId]);
    await tx.query("update folios set bill_to_guest_id = $2 where reservation_id = $1 and number = 1 and not exists (select 1 from invoices i where i.folio_id = folios.id)", [reservationId, guestId]);
  }
  await tx.query("update reservations set name_pending = false where id = $1", [reservationId]);
  await tx.query("insert into reservation_changes (reservation_id, user_id, action, before, after) values ($1, $2, 'edit', $3, $4)", [
    reservationId,
    userId,
    JSON.stringify({ guest: `${r.first_name} ${r.last_name}`.trim() }),
    JSON.stringify({ guest: `${first} ${last}`.trim() }),
  ]);
}

/** A guest profile for a new name, made before the naming transaction (a profile is never shared by mistake). */
const guestMaker = (pool: Pool, schema: string, name: GuestName, ctx: { userId: string; propertyId: string }) => async () =>
  (await createGuest(pool, schema, { firstName: name.firstName.trim(), lastName: name.lastName.trim(), ...(name.email?.trim() ? { email: name.email.trim() } : {}) }, ctx)).id;

/** Staff rename a group's reservation (until check-in). */
export async function nameGroupReservation(pool: Pool, schema: string, reservationId: string, name: GuestName, viewer: Viewer): Promise<void> {
  if (!isUuid(reservationId)) throw new Error("Reservation not found");
  const propertyId = await withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ property_id: string; group_holding_id: string | null }>("select property_id, group_holding_id from reservations where id = $1", [reservationId])).rows[0];
    if (!r?.group_holding_id) throw new Error("Not a group's reservation");
    return r.property_id;
  });
  need(viewer, "manage_groups", propertyId);
  await withTenant(pool, schema, (tx) => nameReservationIn(tx, reservationId, name, viewer.userId, guestMaker(pool, schema, name, { userId: viewer.userId, propertyId })));
}

export interface RoomingPreview {
  rows: (RoomingRow & { problem: RoomingProblem | null })[];
  /** Per room type: Held Rooms, names already given and what the list may still name. */
  types: { code: string; held: number; named: number; open: number }[];
}

async function previewIn(tx: PoolClient, holdingId: string, text: string): Promise<RoomingPreview & { slots: TypeSlots[] }> {
  const slots = await slotsOf(tx, holdingId);
  const open = Object.fromEntries(slots.map((s) => [s.code, Math.max(0, s.held - s.named)]));
  return { rows: checkRoomingList(parseRoomingList(text), open), types: slots.map((s) => ({ code: s.code, held: s.held, named: s.named, open: open[s.code]! })), slots };
}

/** The mismatch preview of a rooming list: rows whose room type the group does not hold, or beyond the Held Rooms still without a name, are flagged. */
export async function previewRoomingList(pool: Pool, schema: string, holdingId: string, text: string, viewer: Viewer): Promise<RoomingPreview> {
  return withTenant(pool, schema, async (tx) => {
    const h = await holdingOf(tx, holdingId);
    need(viewer, "manage_groups", h.group.property_id);
    const { rows, types } = await previewIn(tx, holdingId, text);
    return { rows, types };
  });
}

/**
 * Import the rooming list: every row without a problem names a placeholder
 * reservation of its room type, or books a new one while Held Rooms of the
 * type are left; flagged rows are skipped.
 */
export async function importRoomingList(pool: Pool, schema: string, holdingId: string, text: string, viewer: Viewer): Promise<{ named: number; booked: number; skipped: number }> {
  const { h, preview } = await withTenant(pool, schema, async (tx) => {
    const h = await holdingOf(tx, holdingId);
    need(viewer, "manage_groups", h.group.property_id);
    if (h.released) throw new Error("The Held Rooms are released");
    return { h, preview: await previewIn(tx, holdingId, text) };
  });
  const out = { named: 0, booked: 0, skipped: preview.rows.filter((r) => r.problem).length };
  const pending = new Map(preview.slots.map((s) => [s.code, [...s.pending]]));
  for (const row of preview.rows.filter((r) => !r.problem)) {
    const slot = preview.slots.find((s) => s.code === row.roomType)!;
    const id = pending.get(row.roomType)!.shift();
    try {
      if (id) {
        const adults = await withTenant(pool, schema, async (tx) => {
          await nameReservationIn(tx, id, row, viewer.userId, guestMaker(pool, schema, row, { userId: viewer.userId, propertyId: h.group.property_id }));
          return (await tx.query<{ adults: number }>("select adults from reservations where id = $1", [id])).rows[0]!.adults;
        });
        // the list's persons per room: the stay is repriced like any change of guests
        if (adults !== row.adults) await updateReservation(pool, schema, id, viewer.userId, { adults: row.adults });
        out.named++;
      } else {
        await bookFromGroup(pool, schema, holdingId, { roomTypeId: slot.roomTypeId, firstName: row.firstName, lastName: row.lastName, adults: row.adults }, viewer);
        out.booked++;
      }
    } catch (err) {
      throw new Error(`Line ${row.line} (${row.firstName} ${row.lastName}): ${err instanceof Error ? err.message : String(err)}; the lines before it are imported`);
    }
  }
  return out;
}

/** The template staff send the organiser (CSV, opens in Excel). */
export function roomingTemplate(roomTypes: string[]): string {
  return `Zimmerkategorie / Room type;Vorname / First name;Nachname / Last name;Erwachsene / Adults;E-Mail\n${roomTypes.map((t) => `${t};;;1;`).join("\n")}\n`;
}

/** The organiser's link to fill in names (made once, kept). */
export async function roomingLink(pool: Pool, schema: string, groupId: string, viewer: Viewer): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const g = await groupOf(tx, groupId);
    need(viewer, "manage_groups", g.property_id);
    const token = randomBytes(18).toString("base64url");
    return (await tx.query<{ rooming_token: string }>("update groups set rooming_token = coalesce(rooming_token, $2) where id = $1 returning rooming_token", [g.id, token])).rows[0]!.rooming_token;
  });
}

export interface OrganiserRooming {
  propertyId: string;
  groupName: string;
  propertyName: string;
  holdings: { arrival: string; departure: string; rooms: { reservationId: string; roomType: string; firstName: string; lastName: string; pending: boolean; open: boolean }[] }[];
}

async function groupByToken(tx: PoolClient, token: string): Promise<{ id: string; name: string; property: string; property_id: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  return (await tx.query<{ id: string; name: string; property: string; property_id: string }>(
    // open until the group's last departure
    `select g.id, g.name, p.name as property, g.property_id from groups g join properties p on p.id = g.property_id
     where g.rooming_token = $1 and g.status in ('tentative', 'definite')
       and exists (select 1 from group_holdings h where h.group_id = g.id and h.departure > coalesce(p.business_date, (now() at time zone p.time_zone)::date))`,
    [token],
  )).rows[0] ?? null;
}

/** What the organiser sees through the link: the group's reservations per arrival, with names; open until check-in. */
export async function roomingByToken(pool: Pool, schema: string, token: string): Promise<OrganiserRooming | null> {
  return withTenant(pool, schema, async (tx) => {
    const g = await groupByToken(tx, token);
    if (!g) return null;
    const rows = (await tx.query<{ holding_id: string; arrival: string; departure: string; id: string | null; code: string | null; first_name: string | null; last_name: string | null; name_pending: boolean | null; status: string | null }>(
      `select h.id as holding_id, to_char(h.arrival, 'YYYY-MM-DD') as arrival, to_char(h.departure, 'YYYY-MM-DD') as departure, r.id, t.code, gu.first_name, gu.last_name, r.name_pending, r.status
       from group_holdings h left join reservations r on r.group_holding_id = h.id and r.status = any($2::text[]) left join room_types t on t.id = r.room_type_id left join guests gu on gu.id = r.primary_guest_id
       where h.group_id = $1 order by h.arrival, t.sort_order, r.created_at, r.id`,
      [g.id, OCCUPYING_STATUSES],
    )).rows;
    const holdings = new Map<string, OrganiserRooming["holdings"][number]>();
    for (const r of rows) {
      if (!holdings.has(r.holding_id)) holdings.set(r.holding_id, { arrival: r.arrival, departure: r.departure, rooms: [] });
      if (r.id) holdings.get(r.holding_id)!.rooms.push({ reservationId: r.id, roomType: r.code!, firstName: r.name_pending ? "" : r.first_name!, lastName: r.name_pending ? "" : r.last_name!, pending: r.name_pending!, open: r.status === "confirmed" });
    }
    return { propertyId: g.property_id, groupName: g.name, propertyName: g.property, holdings: [...holdings.values()] };
  });
}

/** The organiser fills in names through the link; a row left empty is skipped, a guest already checked in keeps the name. */
export async function fillRoomingByToken(pool: Pool, schema: string, token: string, entries: ({ reservationId: string } & GuestName)[]): Promise<number> {
  const g = await withTenant(pool, schema, (tx) => groupByToken(tx, token));
  if (!g) throw new Error("The link is no longer valid");
  let n = 0;
  for (const e of entries.slice(0, 500)) {
    if (!isUuid(e.reservationId) || !e.lastName.trim()) continue;
    const done = await withTenant(pool, schema, async (tx) => {
      const ok = (await tx.query("select 1 from reservations r join group_holdings h on h.id = r.group_holding_id where r.id = $1 and h.group_id = $2 and r.status = 'confirmed'", [e.reservationId, g.id])).rows.length;
      if (!ok) return false;
      await nameReservationIn(tx, e.reservationId, e, ORGANISER, guestMaker(pool, schema, e, { userId: ORGANISER, propertyId: g.property_id }));
      return true;
    });
    if (done) n++;
  }
  return n;
}

// ── the Master Folio ──

export interface MasterFolioView {
  folioId: string | null;
  billToName: string | null;
  routing: RoutingCategory[];
  charges: { id: string; reservationId: string | null; room: string | null; guest: string | null; description: string; serviceDate: string; amount: number; taxCode: string; voided: boolean; invoiced: boolean }[];
  payments: { id: string; tender: string; amount: number; reference: string; postedAt: string; invoiced: boolean }[];
  invoices: { id: string; kind: string; number: string; issueDate: string; gross: number; cancelled: boolean }[];
  /** Charges less money received. */
  balance: number;
  paid: number;
  deposits: DepositInstallment[];
}

/** A group's Master Folio with its Charges per room, payments, invoices and deposit schedule. */
export async function masterFolio(pool: Pool, schema: string, groupId: string, viewer: Viewer): Promise<MasterFolioView> {
  return withTenant(pool, schema, async (tx) => {
    const g = await groupOf(tx, groupId);
    need(viewer, "view_folio", g.property_id);
    const routing = (await tx.query<{ category: RoutingCategory }>("select category from group_routing where group_id = $1 order by category", [g.id])).rows.map((r) => r.category);
    const f = (await tx.query<{ id: string; name: string }>(
      "select f.id, coalesce(c.name, trim(gu.first_name || ' ' || gu.last_name)) as name from folios f left join companies c on c.id = f.bill_to_company_id left join guests gu on gu.id = f.bill_to_guest_id where f.group_id = $1",
      [g.id],
    )).rows[0];
    const today = (await tx.query<{ d: string }>("select to_char(coalesce(business_date, (now() at time zone time_zone)::date), 'YYYY-MM-DD') as d from properties where id = $1", [g.property_id])).rows[0]!.d;
    const schedule = (await tx.query<{ id: string; due_date: string; amount: string }>("select id, to_char(due_date, 'YYYY-MM-DD') as due_date, amount from group_deposits where group_id = $1", [g.id])).rows.map((d) => ({ id: d.id, dueDate: d.due_date, amount: Number(d.amount) }));
    if (!f) return { folioId: null, billToName: null, routing, charges: [], payments: [], invoices: [], balance: 0, paid: 0, deposits: depositStatus(schedule, 0, today) };
    const charges = (await tx.query<{ id: string; reservation_id: string | null; room: string | null; guest: string | null; description: string; service_date: string; amount: string; code: string; voided: boolean; invoiced: boolean }>(
      `select ch.id, ch.reservation_id,
         (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = ch.reservation_id and a.from_date <= ch.service_date and a.to_date > ch.service_date limit 1) as room,
         (select trim(gu.first_name || ' ' || gu.last_name) from reservations r join guests gu on gu.id = r.primary_guest_id where r.id = ch.reservation_id) as guest,
         ch.description, to_char(ch.service_date, 'YYYY-MM-DD') as service_date, ch.amount, t.code, ch.voided_at is not null as voided, ch.invoice_id is not null as invoiced
       from charges ch join tax_codes t on t.id = ch.tax_code_id where ch.folio_id = $1 order by ch.service_date, room nulls last, ch.posted_at`,
      [f.id],
    )).rows;
    const payments = (await tx.query<{ id: string; tender: string; amount: string; reference: string; posted_at: Date; invoiced: boolean }>(
      "select id, tender, amount, reference, posted_at, invoice_id is not null as invoiced from payments where folio_id = $1 and status = 'succeeded' order by posted_at",
      [f.id],
    )).rows;
    const invoices = (await tx.query<{ id: string; kind: string; number: string; issue_date: string; gross: string; cancelled: boolean }>(
      "select id, kind, number, to_char(issue_date, 'YYYY-MM-DD') as issue_date, gross, cancelled_by is not null as cancelled from invoices where folio_id = $1 order by issued_at",
      [f.id],
    )).rows;
    const charged = roundMoney(charges.filter((c) => !c.voided).reduce((s, c) => s + Number(c.amount), 0));
    const paid = roundMoney(payments.reduce((s, p) => s + Number(p.amount), 0));
    return {
      folioId: f.id,
      billToName: f.name,
      routing,
      charges: charges.map((c) => ({ id: c.id, reservationId: c.reservation_id, room: c.room, guest: c.guest, description: c.description, serviceDate: c.service_date, amount: Number(c.amount), taxCode: c.code, voided: c.voided, invoiced: c.invoiced })),
      payments: payments.map((p) => ({ id: p.id, tender: p.tender, amount: Number(p.amount), reference: p.reference, postedAt: p.posted_at.toISOString(), invoiced: p.invoiced })),
      invoices: invoices.map((i) => ({ id: i.id, kind: i.kind, number: i.number, issueDate: i.issue_date, gross: Number(i.gross), cancelled: i.cancelled })),
      balance: roundMoney(charged - paid),
      paid,
      deposits: depositStatus(schedule, paid, today),
    };
  });
}

/** The organiser's bank transfer on the Master Folio; before the group's first arrival it gets its Deposit Invoice. */
export async function takeGroupPayment(pool: Pool, schema: string, groupId: string, input: { amount: number; reference: string }, viewer: Viewer): Promise<{ paymentId: string; depositInvoice: IssuedInvoice | null }> {
  const amount = roundMoney(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) throw new Error("Enter an amount above zero");
  const reference = input.reference.trim().slice(0, 200);
  if (!reference) throw new Error("A bank transfer needs its reference");
  return withTenant(pool, schema, async (tx) => {
    const g = await groupOf(tx, groupId);
    need(viewer, "take_payments", g.property_id);
    await lockProperty(tx, g.property_id);
    const folio = await masterFolioIn(tx, g.id, viewer.userId);
    const currency = (await tx.query<{ currency: string }>("select currency from properties where id = $1", [g.property_id])).rows[0]!.currency.trim();
    const id = (await tx.query<{ id: string }>(
      "insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, reference, posted_by, settled_at) values ($1, null, $2, 'bank_transfer', $3, $4, 'succeeded', $5, $6, now()) returning id",
      [folio, g.property_id, amount, currency, reference, viewer.userId],
    )).rows[0]!.id;
    return { paymentId: id, depositInvoice: await depositIn(tx, id, viewer.userId) };
  });
}

/** Invoice the Master Folio's open Charges: one invoice listing every room and night, deposits netted. */
export async function invoiceMasterFolio(pool: Pool, schema: string, groupId: string, viewer: Viewer): Promise<IssuedInvoice> {
  const folio = await withTenant(pool, schema, async (tx) => {
    const g = await groupOf(tx, groupId);
    need(viewer, "issue_invoices", g.property_id);
    const f = (await tx.query<{ id: string }>("select id from folios where group_id = $1", [g.id])).rows[0];
    if (!f) throw new Error("The group has no Master Folio yet");
    return f.id;
  });
  return issueInvoice(pool, schema, folio, viewer.userId);
}

/**
 * The fee of a shrink or cancellation, decided by staff from the contract
 * text, on the Master Folio (taxed like the group's accommodation).
 */
export async function postGroupFee(pool: Pool, schema: string, groupId: string, input: { description: string; amount: number }, viewer: Viewer): Promise<string> {
  const description = input.description.trim();
  if (!description) throw new Error("A description is required");
  if (description.length > 200) throw new Error("The description is too long");
  const amount = roundMoney(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new Error("Enter an amount above zero");
  return withTenant(pool, schema, async (tx) => {
    const g = await groupOf(tx, groupId);
    need(viewer, "post_charges", g.property_id);
    need(viewer, "manage_groups", g.property_id);
    const folio = await masterFolioIn(tx, g.id, viewer.userId);
    const s = (await tx.query<{ id: string; tax_code_id: string; revenue_account: string; date: string }>(
      `select s.id, s.tax_code_id, s.revenue_account, to_char(coalesce(p.business_date, (now() at time zone p.time_zone)::date), 'YYYY-MM-DD') as date
       from rate_plans pl left join rate_plans b on b.id = pl.base_plan_id join services s on s.id = coalesce(pl.accommodation_service_id, b.accommodation_service_id) join properties p on p.id = $2
       where pl.id = $1`,
      [g.rate_plan_id, g.property_id],
    )).rows[0];
    if (!s) throw new Error("The group's Rate Plan has no accommodation Service; set one in the Rate Plan settings");
    // TODO(gate 03): the tax advisor confirms the Tax Code of a group's contract fee; the accommodation one for now, as for the No-show fee
    const id = (await tx.query<{ id: string }>(
      `insert into charges (folio_id, reservation_id, property_id, service_id, description, service_date, quantity, unit_price, amount, tax_code_id, tax_rate, revenue_account, category, origin, posted_by)
       values ($1, null, $2, $3, $4, $5, 1, $6, $6, $7, $8, $9, 'accommodation', 'free_text', $10) returning id`,
      [folio, g.property_id, s.id, description, s.date, amount, s.tax_code_id, await rateOn(tx, s.tax_code_id, s.date), s.revenue_account, viewer.userId],
    )).rows[0]!.id;
    await tx.query("insert into charge_events (charge_id, user_id, action, detail) values ($1, $2, 'post', $3)", [id, viewer.userId, JSON.stringify({ folioId: folio, groupFee: true })]);
    return id;
  });
}

// ── deposit schedule ──

/** The deposit schedule of the contract (Revenue too): what the organiser pays by when. */
export async function setDepositSchedule(pool: Pool, schema: string, groupId: string, items: { dueDate: string; amount: number }[], viewer: Viewer): Promise<void> {
  const clean = items.filter((i) => i.dueDate || i.amount).map((i) => ({ dueDate: checkDate(i.dueDate), amount: roundMoney(Number(i.amount)) }));
  if (clean.some((i) => !Number.isFinite(i.amount) || i.amount <= 0)) throw new Error("Every installment needs an amount above zero");
  if (clean.length > 24) throw new Error("At most 24 installments");
  await withTenant(pool, schema, async (tx) => {
    const g = await groupOf(tx, groupId);
    need(viewer, "edit_group_contract", g.property_id);
    const before = (await tx.query<{ due_date: string; reminded_at: Date | null }>("select to_char(due_date, 'YYYY-MM-DD') as due_date, reminded_at from group_deposits where group_id = $1", [g.id])).rows;
    await tx.query("delete from group_deposits where group_id = $1", [g.id]);
    for (const i of clean) {
      // an installment kept at its date stays reminded
      const was = before.find((b) => b.due_date === i.dueDate)?.reminded_at ?? null;
      await tx.query("insert into group_deposits (group_id, due_date, amount, reminded_at, created_by) values ($1, $2, $3, $4, $5)", [g.id, i.dueDate, i.amount, was, viewer.userId]);
    }
  });
}

export interface DepositReminder {
  groupId: string;
  propertyId: string;
  groupName: string;
  dueDate: string;
  open: number;
  /** The organiser was mailed (an address on file). */
  mailed: boolean;
}

/** The worker's daily look at deposit schedules: an installment open after its date is reminded once, to the organiser by mail and to staff. */
export async function remindGroupDeposits(pool: Pool, schema: string): Promise<DepositReminder[]> {
  return withTenant(pool, schema, async (tx) => {
    const groups = (await tx.query<{ id: string; property_id: string; name: string; today: string; property: string; currency: string; email: string | null }>(
      `select g.id, g.property_id, g.name, to_char(coalesce(p.business_date, (now() at time zone p.time_zone)::date), 'YYYY-MM-DD') as today, p.name as property, p.currency,
         coalesce(nullif(c.billing_email, ''), gu.email) as email
       from groups g join properties p on p.id = g.property_id left join companies c on c.id = g.organiser_company_id left join guests gu on gu.id = g.organiser_guest_id
       where g.status in ('tentative', 'definite')
         and exists (select 1 from group_deposits d where d.group_id = g.id and d.reminded_at is null and d.due_date < coalesce(p.business_date, (now() at time zone p.time_zone)::date))
       for update of g`,
    )).rows;
    // in Test Mode nothing is due for real: the installments stay unreminded for after go-live
    if (await inTestMode(tx)) return [];
    const out: DepositReminder[] = [];
    for (const g of groups) {
      const schedule = (await tx.query<{ id: string; due_date: string; amount: string; reminded_at: Date | null }>("select id, to_char(due_date, 'YYYY-MM-DD') as due_date, amount, reminded_at from group_deposits where group_id = $1", [g.id])).rows;
      const paid = Number((await tx.query<{ n: string }>("select coalesce(sum(p.amount), 0) as n from payments p join folios f on f.id = p.folio_id where f.group_id = $1 and p.status = 'succeeded'", [g.id])).rows[0]!.n);
      const status = depositStatus(schedule.map((d) => ({ id: d.id, dueDate: d.due_date, amount: Number(d.amount) })), paid, g.today);
      for (const s of status.filter((x) => x.overdue && !schedule.find((d) => d.id === x.id)!.reminded_at)) {
        await tx.query("update group_deposits set reminded_at = now() where id = $1", [s.id]);
        const mailed = !!g.email;
        if (mailed) {
          const amount = `${s.open.toFixed(2)} ${g.currency.trim()}`;
          await tx.query("insert into mail_outbox (to_email, subject, body, property_id, group_id) values ($1, $2, $3, $4, $5)", [
            g.email,
            `Anzahlung offen · Deposit due: ${g.name} (${g.property})`,
            `Guten Tag,\n\nfür Ihre Gruppe „${g.name}“ war am ${s.dueDate} eine Anzahlung fällig; offen sind noch ${amount}. Bitte überweisen Sie den Betrag mit dem Gruppennamen als Verwendungszweck.\n\nHello,\n\na deposit for your group "${g.name}" was due on ${s.dueDate}; ${amount} is still open. Please transfer it with the group's name as the reference.\n\n${g.property}`,
            g.property_id,
            g.id,
          ]);
        }
        out.push({ groupId: g.id, propertyId: g.property_id, groupName: g.name, dueDate: s.dueDate, open: s.open, mailed });
      }
      // installments covered meanwhile need no reminder any more
      await tx.query("update group_deposits set reminded_at = now() where id = any($1::uuid[]) and reminded_at is null", [status.filter((x) => x.open === 0).map((x) => x.id)]);
    }
    return out;
  });
}

// ── arrival and check-in ──

export interface GroupArrival {
  reservationId: string;
  confirmationNumber: string;
  guest: string;
  pending: boolean;
  roomTypeId: string;
  roomType: string;
  room: string | null;
  floor: string | null;
  status: string;
  persons: number;
}

export interface GroupRegistration {
  leaderFirstName: string;
  leaderLastName: string;
  leaderNationality: string;
  leaderBirthDate: string | null;
  leaderAddress: string;
  members: { nationality: string; count: number }[];
  signedOnPaperAt: string | null;
}

export interface GroupArrivalView {
  holdingId: string;
  groupId: string;
  groupName: string;
  propertyId: string;
  arrival: string;
  departure: string;
  businessDate: string;
  reservations: GroupArrival[];
  persons: number;
  /** Germany, above ten persons: the tour leader registers for the group. */
  registrationNeeded: boolean;
  registration: GroupRegistration | null;
}

/** The group check-in screen: every reservation of the arrival with its room. */
export async function groupArrival(pool: Pool, schema: string, holdingId: string, viewer: Viewer): Promise<GroupArrivalView> {
  return withTenant(pool, schema, async (tx) => {
    const h = await holdingOf(tx, holdingId);
    need(viewer, "view_groups", h.group.property_id);
    const p = (await tx.query<{ country: string; d: string }>("select country, to_char(business_date, 'YYYY-MM-DD') as d from properties where id = $1", [h.group.property_id])).rows[0]!;
    const res = (await tx.query<{ id: string; confirmation_number: string; guest: string; name_pending: boolean; room_type_id: string; code: string; room: string | null; floor: string | null; status: string; persons: number }>(
      `select r.id, b.confirmation_number, trim(g.first_name || ' ' || g.last_name) as guest, r.name_pending, r.room_type_id, t.code,
         m.number as room, m.floor, r.status, (r.adults + coalesce(array_length(r.child_ages, 1), 0))::int as persons
       from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id join room_types t on t.id = r.room_type_id
       left join lateral (select a.room_id from room_assignments a where a.reservation_id = r.id order by a.from_date limit 1) a on true left join rooms m on m.id = a.room_id
       where r.group_holding_id = $1 and r.status = any($2::text[]) order by t.sort_order, m.number nulls last, r.created_at`,
      [holdingId, [...OCCUPYING_STATUSES, "checked_out"]],
    )).rows;
    const reg = (await tx.query<{ leader_first_name: string; leader_last_name: string; leader_nationality: string; leader_birth_date: string | null; leader_address: string; members: { nationality: string; count: number }[]; signed_on_paper_at: Date | null }>(
      "select leader_first_name, leader_last_name, leader_nationality, to_char(leader_birth_date, 'YYYY-MM-DD') as leader_birth_date, leader_address, members, signed_on_paper_at from group_registrations where holding_id = $1",
      [holdingId],
    )).rows[0];
    const persons = res.filter((r) => r.status !== "checked_out").reduce((s, r) => s + r.persons, 0);
    return {
      holdingId,
      groupId: h.group.id,
      groupName: h.group.name,
      propertyId: h.group.property_id,
      arrival: h.arrival,
      departure: h.departure,
      businessDate: p.d,
      reservations: res.map((r) => ({ reservationId: r.id, confirmationNumber: r.confirmation_number, guest: r.guest, pending: r.name_pending, roomTypeId: r.room_type_id, roomType: r.code, room: r.room, floor: r.floor, status: r.status, persons: r.persons })),
      persons,
      registrationNeeded: tourLeaderRegisters(p.country.trim(), persons),
      registration: reg
        ? {
            leaderFirstName: reg.leader_first_name,
            leaderLastName: reg.leader_last_name,
            leaderNationality: reg.leader_nationality,
            leaderBirthDate: reg.leader_birth_date,
            leaderAddress: reg.leader_address,
            members: reg.members,
            signedOnPaperAt: reg.signed_on_paper_at?.toISOString() ?? null,
          }
        : null,
    };
  });
}

/** Rooms for every reservation of the arrival still without one, kept together by floor or Section. */
export async function assignGroupRooms(pool: Pool, schema: string, holdingId: string, by: "floor" | "section", viewer: Viewer): Promise<{ assigned: number; without: number }> {
  return withTenant(pool, schema, async (tx) => {
    const h = await holdingOf(tx, holdingId);
    need(viewer, "check_in", h.group.property_id);
    await lockProperty(tx, h.group.property_id);
    const open = (await tx.query<{ id: string; room_type_id: string }>(
      `select r.id, r.room_type_id from reservations r where r.group_holding_id = $1 and r.status = 'confirmed'
         and not exists (select 1 from room_assignments a where a.reservation_id = r.id)
       order by r.created_at, r.id`,
      [holdingId],
    )).rows;
    if (!open.length) return { assigned: 0, without: 0 };
    // the free rooms of each type for the holding's nights (every reservation of the type runs the same nights)
    const ids = new Set<string>();
    for (const t of new Set(open.map((r) => r.room_type_id))) for (const room of await freeRoomsIn(tx, open.find((r) => r.room_type_id === t)!.id)) ids.add(room.id);
    const free = (await tx.query<{ id: string; floor: string; section_id: string | null; room_type_id: string }>("select id, floor, section_id, room_type_id from rooms where id = any($1::uuid[]) order by sort_order, number", [[...ids]])).rows;
    const picks = roomsTogether(free.map((r) => ({ id: r.id, floor: r.floor, sectionId: r.section_id, roomTypeId: r.room_type_id })), open.map((r) => r.room_type_id), by);
    let assigned = 0;
    for (const [i, roomId] of picks.entries()) {
      if (!roomId) continue;
      await assignRoomIn(tx, open[i]!.id, viewer.userId, roomId);
      assigned++;
    }
    return { assigned, without: open.length - assigned };
  });
}

/** Check in the arrival's reservations, chosen or all: each on its own, so one not ready leaves the others in. */
export async function checkInGroup(pool: Pool, schema: string, holdingId: string, reservationIds: string[] | null, viewer: Viewer): Promise<{ checkedIn: number; failed: { reservationId: string; guest: string; error: string }[] }> {
  const list = await withTenant(pool, schema, async (tx) => {
    const h = await holdingOf(tx, holdingId);
    need(viewer, "check_in", h.group.property_id);
    return (await tx.query<{ id: string; guest: string }>(
      "select r.id, trim(g.first_name || ' ' || g.last_name) as guest from reservations r join guests g on g.id = r.primary_guest_id where r.group_holding_id = $1 and r.status = 'confirmed' and ($2::uuid[] is null or r.id = any($2::uuid[])) order by r.created_at, r.id",
      [holdingId, reservationIds ? reservationIds.filter(isUuid) : null],
    )).rows;
  });
  const out = { checkedIn: 0, failed: [] as { reservationId: string; guest: string; error: string }[] };
  for (const r of list) {
    try {
      await checkIn(pool, schema, r.id, viewer.userId);
      out.checkedIn++;
    } catch (err) {
      out.failed.push({ reservationId: r.id, guest: r.guest, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/** Germany (BMG §30(3)): the tour leader's registration for the group, with the members' number per nationality. */
export async function saveGroupRegistration(pool: Pool, schema: string, holdingId: string, input: Omit<GroupRegistration, "signedOnPaperAt">, viewer: Viewer): Promise<void> {
  const nat = (s: string) => {
    const v = s.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(v)) throw new Error("Nationality as a two-letter country code (DE, FR …)");
    return v;
  };
  const first = input.leaderFirstName.trim().slice(0, 100);
  const last = input.leaderLastName.trim().slice(0, 100);
  if (!first || !last) throw new Error("The tour leader's first and last name are required");
  const members = input.members.filter((m) => m.nationality.trim() || m.count).map((m) => ({ nationality: nat(m.nationality), count: Number(m.count) }));
  if (members.some((m) => !Number.isInteger(m.count) || m.count < 1 || m.count > 999)) throw new Error("Members per nationality: a whole number from 1");
  await withTenant(pool, schema, async (tx) => {
    const h = await holdingOf(tx, holdingId);
    need(viewer, "check_in", h.group.property_id);
    await tx.query(
      `insert into group_registrations (holding_id, leader_first_name, leader_last_name, leader_nationality, leader_birth_date, leader_address, members, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (holding_id) do update set leader_first_name = excluded.leader_first_name, leader_last_name = excluded.leader_last_name, leader_nationality = excluded.leader_nationality,
         leader_birth_date = excluded.leader_birth_date, leader_address = excluded.leader_address, members = excluded.members, signed_on_paper_at = null, updated_at = clock_timestamp()`,
      [holdingId, first, last, nat(input.leaderNationality), input.leaderBirthDate ? checkDate(input.leaderBirthDate) : null, input.leaderAddress.trim().slice(0, 300), JSON.stringify(members), viewer.userId],
    );
  });
}

/** The tour leader signed the printed registration. */
export async function markGroupRegistrationSigned(pool: Pool, schema: string, holdingId: string, viewer: Viewer): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const h = await holdingOf(tx, holdingId);
    need(viewer, "check_in", h.group.property_id);
    const n = (await tx.query("update group_registrations set signed_on_paper_at = clock_timestamp() where holding_id = $1", [holdingId])).rowCount;
    if (!n) throw new Error("Fill in the registration first");
  });
}
