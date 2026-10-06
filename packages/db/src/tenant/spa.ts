import type { Pool, PoolClient } from "pg";
import { appointmentProblem, can, mayManageOutlet, rolesAt, type AppointmentProblem, type Interval } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { addBillItem, openOutletBill, type Outlet } from "./outlets";

type SpaOutlet = Outlet;
import type { Viewer } from "./room-state";
import { withTenant } from "./with-tenant";

/**
 * The spa (ticket 63): an outlet of kind spa keeps therapists, treatment
 * rooms and treatments (items of its menu with how long they take); the
 * therapists' hours bound the appointment book, released hours are open to
 * guests (ticket 64). An appointment is for a hotel guest's stay or a day
 * visitor; when given it becomes a bill of the spa, paid or charged to the
 * room like any outlet's. The desk sees a stay's appointments.
 */

const PROBLEM_TEXT: Record<AppointmentProblem, string> = {
  outside_hours: "The therapist does not work then",
  therapist_busy: "The therapist has another appointment then",
  room_busy: "No treatment room is free then",
};

/** The time is not free (outside the hours, therapist or room taken): another therapist or time may do. */
export class AppointmentRefused extends Error {
  constructor(readonly problem: AppointmentProblem) {
    super(PROBLEM_TEXT[problem]);
  }
}

async function spaIn(tx: PoolClient, outletId: string): Promise<SpaOutlet> {
  if (!isUuid(outletId)) throw new Error("Spa not found");
  const o = (await tx.query<{ id: string; property_id: string; name: string; kind: string; cash_register_id: string | null; active: boolean; managers: string[]; discount_percent: string }>(
    "select o.id, o.property_id, o.name, o.kind, o.cash_register_id, o.active, o.discount_percent, coalesce((select array_agg(m.user_id) from outlet_managers m where m.outlet_id = o.id), '{}') as managers from outlets o where o.id = $1",
    [outletId],
  )).rows[0];
  if (!o || o.kind !== "spa") throw new Error("Spa not found");
  return { id: o.id, propertyId: o.property_id, name: o.name, kind: "spa", cashRegisterId: o.cash_register_id, active: o.active, managers: o.managers, discountPercent: Number(o.discount_percent) };
}

/** The appointment book: Spa Staff and the Property Manager, an Outlet Manager at own spas (matrix "Spa appointment book, spa sales"). */
function needBook(viewer: Viewer, o: SpaOutlet): void {
  if (can(viewer.actor, "manage_outlets", o.propertyId) || rolesAt(viewer.actor, o.propertyId).includes("spa_staff") || mayManageOutlet(viewer.actor, viewer.userId, o)) return;
  throw new Error("Not allowed at this spa");
}

/** Therapists, rooms, treatments and hours: the spa's Property Manager or own Outlet Manager. */
function needManage(viewer: Viewer, o: SpaOutlet): void {
  if (!mayManageOutlet(viewer.actor, viewer.userId, o)) throw new Error("Only the Property Manager or this spa's Outlet Manager may change it");
}

// ── setup ──

const cleanName = (s: string, what: string) => {
  const v = s.trim();
  if (!v || v.length > 60) throw new Error(`${what} needs a name of up to 60 characters`);
  return v;
};

export async function saveTherapist(pool: Pool, schema: string, outletId: string, input: { id?: string | undefined; name: string; active: boolean }, viewer: Viewer): Promise<string> {
  const name = cleanName(input.name, "A therapist");
  return withTenant(pool, schema, async (tx) => {
    const o = await spaIn(tx, outletId);
    needManage(viewer, o);
    if (input.id) {
      if (!(await tx.query("update spa_therapists set name = $3, active = $4 where id = $1 and outlet_id = $2", [input.id, o.id, name, input.active])).rowCount) throw new Error("Therapist not found");
      return input.id;
    }
    return (await tx.query<{ id: string }>("insert into spa_therapists (outlet_id, name, active) values ($1, $2, $3) returning id", [o.id, name, input.active])).rows[0]!.id;
  });
}

export async function saveSpaRoom(pool: Pool, schema: string, outletId: string, input: { id?: string | undefined; name: string; active: boolean }, viewer: Viewer): Promise<string> {
  const name = cleanName(input.name, "A treatment room");
  return withTenant(pool, schema, async (tx) => {
    const o = await spaIn(tx, outletId);
    needManage(viewer, o);
    if (input.id) {
      if (!(await tx.query("update spa_rooms set name = $3, active = $4 where id = $1 and outlet_id = $2", [input.id, o.id, name, input.active])).rowCount) throw new Error("Treatment room not found");
      return input.id;
    }
    return (await tx.query<{ id: string }>("insert into spa_rooms (outlet_id, name, active) values ($1, $2, $3) returning id", [o.id, name, input.active])).rows[0]!.id;
  });
}

/** A treatment: an item of the spa's menu (its Tax Code and price) with its minutes and whether it needs a room. */
export async function saveTreatment(pool: Pool, schema: string, outletId: string, input: { menuItemId: string; minutes: number; needsRoom: boolean; active: boolean }, viewer: Viewer): Promise<string> {
  const minutes = Number(input.minutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) throw new Error("A treatment takes 5 to 480 minutes");
  return withTenant(pool, schema, async (tx) => {
    const o = await spaIn(tx, outletId);
    needManage(viewer, o);
    if (!isUuid(input.menuItemId) || !(await tx.query("select 1 from outlet_menu_items where id = $1 and outlet_id = $2", [input.menuItemId, o.id])).rows.length) throw new Error("Menu item not found at this spa");
    return (await tx.query<{ id: string }>(
      `insert into spa_treatments (outlet_id, menu_item_id, minutes, needs_room, active) values ($1, $2, $3, $4, $5)
       on conflict (menu_item_id) do update set minutes = excluded.minutes, needs_room = excluded.needs_room, active = excluded.active returning id`,
      [o.id, input.menuItemId, minutes, input.needsRoom, input.active],
    )).rows[0]!.id;
  });
}

/** A therapist's working hours (Spa Staff keep them); released ones are open to guests' own bookings. */
export async function addSpaHours(pool: Pool, schema: string, therapistId: string, input: { startsAt: Date; endsAt: Date; released: boolean }, viewer: Viewer): Promise<string> {
  if (!isUuid(therapistId)) throw new Error("Therapist not found");
  if (!(input.endsAt > input.startsAt) || input.endsAt.getTime() - input.startsAt.getTime() > 16 * 3600_000) throw new Error("Hours end after they start, within 16 hours");
  return withTenant(pool, schema, async (tx) => {
    // the therapist locked: two overlapping hours never both go in
    const t = (await tx.query<{ outlet_id: string }>("select outlet_id from spa_therapists where id = $1 for update", [therapistId])).rows[0];
    if (!t) throw new Error("Therapist not found");
    needBook(viewer, await spaIn(tx, t.outlet_id));
    const clash = await tx.query("select 1 from spa_hours where therapist_id = $1 and starts_at < $3 and ends_at > $2", [therapistId, input.startsAt, input.endsAt]);
    if (clash.rows.length) throw new Error("These hours overlap hours the therapist has already");
    return (await tx.query<{ id: string }>("insert into spa_hours (therapist_id, starts_at, ends_at, released) values ($1, $2, $3, $4) returning id", [therapistId, input.startsAt, input.endsAt, input.released])).rows[0]!.id;
  });
}

// ── the day ──

export interface SpaAppointment {
  id: string;
  treatment: string;
  treatmentId: string;
  therapistId: string;
  roomId: string | null;
  room: string | null;
  startsAt: string;
  endsAt: string;
  reservationId: string | null;
  /** The hotel guest's room and surname, or the day visitor's name. */
  guest: string;
  status: "booked" | "done" | "cancelled" | "no_show";
  billId: string | null;
  bookedVia: "staff" | "portal";
}

export interface SpaDay {
  outlet: SpaOutlet;
  therapists: { id: string; name: string; hours: { id: string; startsAt: string; endsAt: string; released: boolean }[] }[];
  rooms: { id: string; name: string }[];
  treatments: { id: string; menuItemId: string; name: string; price: number; minutes: number; needsRoom: boolean }[];
  appointments: SpaAppointment[];
}

const APPOINTMENT_SELECT = `select a.id, i.name as treatment, a.treatment_id, a.therapist_id, a.room_id, r.name as room, a.starts_at, a.ends_at, a.reservation_id,
    coalesce(nullif(a.guest_name, ''), trim(coalesce((select m.number from room_assignments x join rooms m on m.id = x.room_id where x.reservation_id = a.reservation_id order by x.to_date desc limit 1), '') || ' ' || coalesce(g.last_name, ''))) as guest,
    a.status, a.bill_id, a.booked_via
  from spa_appointments a join spa_treatments t on t.id = a.treatment_id join outlet_menu_items i on i.id = t.menu_item_id left join spa_rooms r on r.id = a.room_id
  left join reservations res on res.id = a.reservation_id left join guests g on g.id = res.primary_guest_id`;

const toAppointment = (a: { id: string; treatment: string; treatment_id: string; therapist_id: string; room_id: string | null; room: string | null; starts_at: Date; ends_at: Date; reservation_id: string | null; guest: string; status: SpaAppointment["status"]; bill_id: string | null; booked_via: SpaAppointment["bookedVia"] }): SpaAppointment => ({
  id: a.id,
  treatment: a.treatment,
  treatmentId: a.treatment_id,
  therapistId: a.therapist_id,
  roomId: a.room_id,
  room: a.room,
  startsAt: a.starts_at.toISOString(),
  endsAt: a.ends_at.toISOString(),
  reservationId: a.reservation_id,
  guest: a.guest.trim(),
  status: a.status,
  billId: a.bill_id,
  bookedVia: a.booked_via,
});

/** The appointment book of a day (in the property's time zone): therapists with their hours, rooms, treatments and appointments. */
export async function spaDay(pool: Pool, schema: string, outletId: string, date: string, viewer: Viewer): Promise<SpaDay> {
  return withTenant(pool, schema, async (tx) => {
    const o = await spaIn(tx, outletId);
    needBook(viewer, o);
    const tz = (await tx.query<{ tz: string }>("select time_zone as tz from properties where id = $1", [o.propertyId])).rows[0]!.tz;
    const range = [date, tz];
    const therapists = (await tx.query<{ id: string; name: string }>("select id, name from spa_therapists where outlet_id = $1 and active order by name", [o.id])).rows;
    const hours = (await tx.query<{ id: string; therapist_id: string; starts_at: Date; ends_at: Date; released: boolean }>(
      `select h.id, h.therapist_id, h.starts_at, h.ends_at, h.released from spa_hours h join spa_therapists t on t.id = h.therapist_id
       where t.outlet_id = $1 and h.starts_at < (($2::date + 1)::timestamp at time zone $3) and h.ends_at > ($2::date::timestamp at time zone $3) order by h.starts_at`,
      [o.id, ...range],
    )).rows;
    const rooms = (await tx.query<{ id: string; name: string }>("select id, name from spa_rooms where outlet_id = $1 and active order by name", [o.id])).rows;
    const treatments = (await tx.query<{ id: string; menu_item_id: string; name: string; price: string; minutes: number; needs_room: boolean }>(
      "select t.id, t.menu_item_id, i.name, i.price, t.minutes, t.needs_room from spa_treatments t join outlet_menu_items i on i.id = t.menu_item_id where t.outlet_id = $1 and t.active and i.active order by i.category, i.sort_order, i.name",
      [o.id],
    )).rows;
    const appointments = (await tx.query(
      `${APPOINTMENT_SELECT} where a.outlet_id = $1 and a.starts_at < (($2::date + 1)::timestamp at time zone $3) and a.ends_at > ($2::date::timestamp at time zone $3) order by a.starts_at`,
      [o.id, ...range],
    )).rows.map(toAppointment);
    return {
      outlet: o,
      therapists: therapists.map((t) => ({ ...t, hours: hours.filter((h) => h.therapist_id === t.id).map((h) => ({ id: h.id, startsAt: h.starts_at.toISOString(), endsAt: h.ends_at.toISOString(), released: h.released })) })),
      rooms,
      treatments: treatments.map((t) => ({ id: t.id, menuItemId: t.menu_item_id, name: t.name, price: Number(t.price), minutes: t.minutes, needsRoom: t.needs_room })),
      appointments,
    };
  });
}

// ── booking ──

export interface AppointmentInput {
  treatmentId: string;
  therapistId: string;
  /** A treatment room; none given: the first free one (for treatments that need one). */
  roomId?: string | null | undefined;
  startsAt: Date;
  reservationId?: string | null | undefined;
  guestName?: string | undefined;
  note?: string | undefined;
}

/**
 * Book an appointment inside the therapist's hours (released ones only for a
 * guest's own booking), never over another of the therapist's or the room's.
 * The therapist and the rooms are locked, so two bookings at once never take
 * the same time.
 */
export async function bookAppointmentIn(tx: PoolClient, outletId: string, input: AppointmentInput, by: { userId: string; via: "staff" | "portal" }): Promise<string> {
  if (!isUuid(input.treatmentId) || !isUuid(input.therapistId)) throw new Error("Choose a treatment and a therapist");
  const t = (await tx.query<{ minutes: number; needs_room: boolean }>("select minutes, needs_room from spa_treatments where id = $1 and outlet_id = $2 and active", [input.treatmentId, outletId])).rows[0];
  if (!t) throw new Error("Treatment not found at this spa");
  const th = (await tx.query("select 1 from spa_therapists where id = $1 and outlet_id = $2 and active for update", [input.therapistId, outletId])).rows[0];
  if (!th) throw new Error("Therapist not found at this spa");
  const slot: Interval = { start: input.startsAt, end: new Date(input.startsAt.getTime() + t.minutes * 60_000) };
  if (Number.isNaN(slot.start.getTime())) throw new Error("Choose a time");
  const hours = (await tx.query<{ starts_at: Date; ends_at: Date }>(`select starts_at, ends_at from spa_hours where therapist_id = $1${by.via === "portal" ? " and released" : ""}`, [input.therapistId])).rows.map((h) => ({ start: h.starts_at, end: h.ends_at }));
  const busy = async (column: "therapist_id" | "room_id", id: string) =>
    (await tx.query<{ starts_at: Date; ends_at: Date }>(`select starts_at, ends_at from spa_appointments where ${column} = $1 and status in ('booked', 'done') and starts_at < $3 and ends_at > $2`, [id, slot.start, slot.end])).rows.map((a) => ({ start: a.starts_at, end: a.ends_at }));
  // not in the past (a quarter of an hour's grace for the one being entered now)
  if (slot.start.getTime() < Date.now() - 15 * 60_000) throw new Error("The time has passed");
  let roomId: string | null = null;
  if (t.needs_room) {
    if (input.roomId && !isUuid(input.roomId)) throw new Error("Treatment room not found");
    const rooms = (await tx.query<{ id: string }>("select id from spa_rooms where outlet_id = $1 and active and ($2::uuid is null or id = $2) order by name for update", [outletId, input.roomId ?? null])).rows;
    if (input.roomId && !rooms.length) throw new Error("Treatment room not found");
    for (const r of rooms) {
      if (!(await busy("room_id", r.id)).length) {
        roomId = r.id;
        break;
      }
    }
  }
  const problem = appointmentProblem(slot, { hours, therapistBusy: await busy("therapist_id", input.therapistId), roomBusy: t.needs_room && !roomId ? [slot] : [] });
  if (problem) throw new AppointmentRefused(problem);
  const reservationId = input.reservationId && isUuid(input.reservationId) ? input.reservationId : null;
  const guestName = (input.guestName ?? "").trim().slice(0, 100);
  if (reservationId) {
    // a current stay of the property, the treatment within its days
    const ok = (await tx.query(
      `select 1 from reservations r join outlets o on o.property_id = r.property_id join properties p on p.id = r.property_id
       where r.id = $1 and o.id = $2 and r.status in ('confirmed', 'checked_in') and ($3::timestamptz at time zone p.time_zone)::date between r.arrival and r.departure`,
      [reservationId, outletId, slot.start],
    )).rows.length;
    if (!ok) throw new Error("The stay is not at this property, not current, or not on that day");
  } else if (!guestName) throw new Error("Name the day visitor, or choose a hotel guest");
  return (await tx.query<{ id: string }>(
    `insert into spa_appointments (outlet_id, treatment_id, therapist_id, room_id, starts_at, ends_at, reservation_id, guest_name, note, booked_via, booked_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [outletId, input.treatmentId, input.therapistId, roomId, slot.start, slot.end, reservationId, guestName, (input.note ?? "").trim().slice(0, 300), by.via, by.userId],
  )).rows[0]!.id;
}

export async function bookAppointment(pool: Pool, schema: string, outletId: string, input: AppointmentInput, viewer: Viewer): Promise<string> {
  return withTenant(pool, schema, async (tx) => {
    const o = await spaIn(tx, outletId);
    needBook(viewer, o);
    return bookAppointmentIn(tx, o.id, input, { userId: viewer.userId, via: "staff" });
  });
}

export async function cancelAppointment(pool: Pool, schema: string, appointmentId: string, viewer: Viewer): Promise<void> {
  if (!isUuid(appointmentId)) throw new Error("Appointment not found");
  await withTenant(pool, schema, async (tx) => {
    const a = (await tx.query<{ outlet_id: string; status: string }>("select outlet_id, status from spa_appointments where id = $1 for update", [appointmentId])).rows[0];
    if (!a) throw new Error("Appointment not found");
    needBook(viewer, await spaIn(tx, a.outlet_id));
    if (a.status !== "booked") throw new Error("Only a booked appointment is cancelled");
    await tx.query("update spa_appointments set status = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = $2 where id = $1", [appointmentId, viewer.userId]);
  });
}

/**
 * The treatment given: a bill of the spa with it (more items, products, may
 * follow), to pay or charge to the room like any outlet's; the appointment
 * is done. One bill per appointment: a second call (a double click) waits
 * for the first and gets its bill. For a hotel guest the bill is labelled
 * with room and surname and charged to that stay by default.
 */
export async function billAppointment(pool: Pool, schema: string, appointmentId: string, viewer: Viewer): Promise<string> {
  if (!isUuid(appointmentId)) throw new Error("Appointment not found");
  const c = await pool.connect();
  try {
    await c.query("select pg_advisory_lock(hashtext($1))", [`${schema}:spa-bill:${appointmentId}`]);
    const a = await withTenant(pool, schema, async (tx) => {
      const row = (await tx.query(`${APPOINTMENT_SELECT} where a.id = $1`, [appointmentId])).rows[0];
      if (!row) throw new Error("Appointment not found");
      const o = (await tx.query<{ outlet_id: string; menu_item_id: string }>("select a.outlet_id, t.menu_item_id from spa_appointments a join spa_treatments t on t.id = a.treatment_id where a.id = $1", [appointmentId])).rows[0]!;
      needBook(viewer, await spaIn(tx, o.outlet_id));
      return { ...toAppointment(row), outletId: o.outlet_id, menuItemId: o.menu_item_id };
    });
    if (a.billId) return a.billId;
    if (a.status !== "booked") throw new Error(`The appointment is ${a.status.replace("_", " ")}`);
    const billId = await openOutletBill(pool, schema, a.outletId, { tableId: null, label: a.guest }, viewer);
    try {
      await addBillItem(pool, schema, billId, { menuItemId: a.menuItemId, quantity: 1, modifiers: [], note: "" }, viewer);
    } catch (err) {
      // nothing left behind: the empty bill goes again
      await withTenant(pool, schema, (tx) => tx.query("delete from outlet_bills b where id = $1 and not exists (select 1 from outlet_bill_lines l where l.bill_id = b.id)", [billId]));
      throw err;
    }
    await withTenant(pool, schema, (tx) => tx.query("update spa_appointments set bill_id = $2, status = 'done' where id = $1 and bill_id is null", [appointmentId, billId]));
    return billId;
  } finally {
    await c.query("select pg_advisory_unlock(hashtext($1))", [`${schema}:spa-bill:${appointmentId}`]).catch(() => undefined);
    c.release();
  }
}

/** The guest did not come: the appointment is closed as a no-show (its time free again for whoever comes instead). */
export async function markNoShow(pool: Pool, schema: string, appointmentId: string, viewer: Viewer): Promise<void> {
  if (!isUuid(appointmentId)) throw new Error("Appointment not found");
  await withTenant(pool, schema, async (tx) => {
    const a = (await tx.query<{ outlet_id: string; status: string }>("select outlet_id, status from spa_appointments where id = $1 for update", [appointmentId])).rows[0];
    if (!a) throw new Error("Appointment not found");
    needBook(viewer, await spaIn(tx, a.outlet_id));
    if (a.status !== "booked") throw new Error("Only a booked appointment is a no-show");
    await tx.query("update spa_appointments set status = 'no_show' where id = $1", [appointmentId]);
  });
}

/** Hours taken back (a therapist off) or released to guests or not; hours with appointments booked in them stay. */
export async function changeSpaHours(pool: Pool, schema: string, hoursId: string, change: { released: boolean } | "remove", viewer: Viewer): Promise<void> {
  if (!isUuid(hoursId)) throw new Error("Hours not found");
  await withTenant(pool, schema, async (tx) => {
    const h = (await tx.query<{ outlet_id: string; therapist_id: string; starts_at: Date; ends_at: Date }>("select t.outlet_id, h.therapist_id, h.starts_at, h.ends_at from spa_hours h join spa_therapists t on t.id = h.therapist_id where h.id = $1 for update of h", [hoursId])).rows[0];
    if (!h) throw new Error("Hours not found");
    needBook(viewer, await spaIn(tx, h.outlet_id));
    if (change === "remove") {
      const booked = await tx.query("select 1 from spa_appointments where therapist_id = $1 and status = 'booked' and starts_at < $3 and ends_at > $2", [h.therapist_id, h.starts_at, h.ends_at]);
      if (booked.rows.length) throw new Error("Appointments are booked in these hours: move or cancel them first");
      await tx.query("delete from spa_hours where id = $1", [hoursId]);
    } else await tx.query("update spa_hours set released = $2 where id = $1", [hoursId, change.released]);
  });
}

/** A stay's spa appointments, for its reservation tab (who sees the reservation). */
export async function appointmentsOfReservation(pool: Pool, schema: string, reservationId: string, viewer: Viewer): Promise<SpaAppointment[]> {
  if (!isUuid(reservationId)) return [];
  return withTenant(pool, schema, async (tx) => {
    const r = (await tx.query<{ property_id: string }>("select property_id from reservations where id = $1", [reservationId])).rows[0];
    if (!r || !can(viewer.actor, "view_reservations", r.property_id)) return [];
    return (await tx.query(`${APPOINTMENT_SELECT} where a.reservation_id = $1 and a.status <> 'cancelled' order by a.starts_at`, [reservationId])).rows.map(toAppointment);
  });
}

/** Hotel guests to book a treatment for: stays at the spa's property, in house or still to come, by surname or room. */
export async function spaGuests(pool: Pool, schema: string, outletId: string, query: string, viewer: Viewer): Promise<{ reservationId: string; lastName: string; room: string | null; arrival: string; departure: string }[]> {
  // two letters at least; stays from today to two months ahead only
  const q = query.trim().slice(0, 40);
  if (q.length < 2) return [];
  return withTenant(pool, schema, async (tx) => {
    const o = await spaIn(tx, outletId);
    needBook(viewer, o);
    return (await tx.query<{ id: string; last_name: string; room: string | null; arrival: string; departure: string }>(
      `select r.id, g.last_name, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure,
         (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id order by a.to_date desc limit 1) as room
       from reservations r join guests g on g.id = r.primary_guest_id
       join properties p on p.id = r.property_id
       where r.property_id = $1 and r.status in ('confirmed', 'checked_in')
         and r.departure >= p.business_date and r.arrival <= p.business_date + 60
         and (g.last_name ilike $2 || '%' or exists (select 1 from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id and m.number = $3))
       order by r.arrival, g.last_name limit 10`,
      [o.propertyId, q.replace(/[\\%_]/g, ""), q],
    )).rows.map((r) => ({ reservationId: r.id, lastName: r.last_name, room: r.room, arrival: r.arrival, departure: r.departure }));
  });
}

/** The spa's therapists, treatment rooms and treatments, for its setup page (whoever may see the outlet's setup). */
export async function spaSetup(pool: Pool, schema: string, outletId: string, viewer: Viewer): Promise<{ cancelHours: number; therapists: { id: string; name: string; active: boolean }[]; rooms: { id: string; name: string; active: boolean }[]; treatments: { menuItemId: string; minutes: number; needsRoom: boolean; active: boolean }[] }> {
  return withTenant(pool, schema, async (tx) => {
    const o = await spaIn(tx, outletId);
    needManage(viewer, o);
    return {
      cancelHours: (await tx.query<{ h: number }>("select spa_cancel_hours as h from outlets where id = $1", [o.id])).rows[0]!.h,
      therapists: (await tx.query<{ id: string; name: string; active: boolean }>("select id, name, active from spa_therapists where outlet_id = $1 order by name", [o.id])).rows,
      rooms: (await tx.query<{ id: string; name: string; active: boolean }>("select id, name, active from spa_rooms where outlet_id = $1 order by name", [o.id])).rows,
      treatments: (await tx.query<{ menu_item_id: string; minutes: number; needs_room: boolean; active: boolean }>("select menu_item_id, minutes, needs_room, active from spa_treatments where outlet_id = $1", [o.id])).rows.map((t) => ({ menuItemId: t.menu_item_id, minutes: t.minutes, needsRoom: t.needs_room, active: t.active })),
    };
  });
}

/** Until how many hours before an appointment a guest cancels it in the Guest Portal (ticket 64); later only the spa does. */
export async function setSpaCancelHours(pool: Pool, schema: string, outletId: string, hours: number, viewer: Viewer): Promise<void> {
  if (!Number.isInteger(hours) || hours < 0 || hours > 168) throw new Error("Choose 0 to 168 hours");
  await withTenant(pool, schema, async (tx) => {
    needManage(viewer, await spaIn(tx, outletId));
    await tx.query("update outlets set spa_cancel_hours = $2 where id = $1", [outletId, hours]);
  });
}
