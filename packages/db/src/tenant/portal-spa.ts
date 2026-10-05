import type { Pool, PoolClient } from "pg";
import { addDays, guestCancelDeadline, guestMayCancel, instantAt, moduleState, openSpaSlots, todayIn, type Interval } from "@hoteloftware/domain";
import { isUuid } from "./catalogue-common";
import { PORTAL_USER, reservationByKey, type StayByKey } from "./portal";
import { AppointmentRefused, bookAppointmentIn } from "./spa";
import { withTenant } from "./with-tenant";

/**
 * Spa self-booking in the Guest Portal (ticket 64): the guest of a Portal
 * Link takes an Appointment in the hours the spa has released, on a day of
 * the stay before departure; it belongs to the reservation and is charged to
 * the room at the visit. The guest cancels it up to the spa's hours before.
 */

/** Why the Portal refused: the guest reads it in their own language. */
export type PortalSpaRefusalCode = "taken" | "passed" | "clash" | "too_many" | "unavailable" | "not_found" | "too_late" | "no_longer";

export class PortalSpaRefusal extends Error {
  constructor(
    readonly code: PortalSpaRefusalCode,
    /** For "too_late": the spa's hours. */
    readonly hours = 0,
  ) {
    super(code === "too_late" ? `Appointments can be cancelled up to ${hours} hours before; please contact the spa` : code);
  }
}

/** Guests choose starts every this many minutes. */
const SLOT_STEP = 30;
/** No stay books more than this many treatments at once. */
const MAX_BOOKED = 10;

export interface PortalSpa {
  spas: { id: string; name: string; cancelHours: number; treatments: { id: string; name: string; price: number; minutes: number }[] }[];
  /** The days of the stay still to come, to choose from. */
  days: string[];
  date: string;
  /** Where a treatment can start on that day. */
  slots: { outletId: string; treatmentId: string; startsAt: string }[];
  /** The stay's own appointments to come. */
  appointments: { id: string; spa: string; treatment: string; startsAt: string; endsAt: string; status: "booked" | "done"; cancelHours: number; cancelUntil: string; mayCancel: boolean }[];
}

/** The stay's spas with the Point of Sale Module on: active spa outlets with active treatments. */
async function spasIn(tx: PoolClient, r: StayByKey): Promise<{ id: string; name: string; cancel_hours: number }[]> {
  const periods = (await tx.query<{ module: "point_of_sale"; on_since: string; off_at: string | null }>(
    "select module, to_char(on_since, 'YYYY-MM-DD') as on_since, to_char(off_at, 'YYYY-MM-DD') as off_at from property_modules where property_id = $1 and module = 'point_of_sale'",
    [r.property_id],
  )).rows.map((p) => ({ module: p.module, onSince: p.on_since, offAt: p.off_at }));
  if (moduleState(periods, "point_of_sale", todayIn(r.time_zone)) !== "on") return [];
  return (await tx.query<{ id: string; name: string; cancel_hours: number }>(
    "select o.id, o.name, o.spa_cancel_hours as cancel_hours from outlets o where o.property_id = $1 and o.kind = 'spa' and o.active and exists (select 1 from spa_treatments t where t.outlet_id = o.id and t.active) order by o.name",
    [r.property_id],
  )).rows;
}

/** The days of the stay an appointment can still be taken for: from today (or arrival) to the last night; on departure day the room is no longer charged. */
function stayDays(r: StayByKey): string[] {
  const today = todayIn(r.time_zone);
  const out: string[] = [];
  for (let d = r.arrival > today ? r.arrival : today; d < r.departure && out.length < 31; d = addDays(d, 1)) out.push(d);
  return out;
}

const bookable = (r: StayByKey) => r.status === "confirmed" || r.status === "checked_in";

/** What the Portal shows of the spa: treatments, the free released times of a day, the stay's appointments. Null where nothing is offered. */
export async function portalSpa(pool: Pool, schema: string, key: string, date: string | null, now = new Date()): Promise<PortalSpa | null> {
  return withTenant(pool, schema, async (tx) => {
    const r = await reservationByKey(tx, key).catch(() => null);
    if (!r || !bookable(r)) return null;
    const spas = await spasIn(tx, r);
    const days = stayDays(r);
    if (!spas.length || !days.length) return null;
    const day = date && days.includes(date) ? date : days[0]!;
    const ids = spas.map((o) => o.id);
    const treatments = (await tx.query<{ id: string; outlet_id: string; name: string; price: string; minutes: number; needs_room: boolean }>(
      "select t.id, t.outlet_id, i.name, i.price, t.minutes, t.needs_room from spa_treatments t join outlet_menu_items i on i.id = t.menu_item_id where t.outlet_id = any($1::uuid[]) and t.active and i.active order by i.category, i.sort_order, i.name",
      [ids],
    )).rows;
    // the day in the property's zone; only released hours, only times still to come
    const dayParams = [day, r.time_zone];
    const dayStart = instantAt(day, "00:00", r.time_zone);
    const dayEnd = instantAt(addDays(day, 1), "00:00", r.time_zone);
    const hours = (await tx.query<{ therapist_id: string; outlet_id: string; starts_at: Date; ends_at: Date }>(
      `select h.therapist_id, t.outlet_id, h.starts_at, h.ends_at from spa_hours h join spa_therapists t on t.id = h.therapist_id
       where t.outlet_id = any($1::uuid[]) and t.active and h.released and h.starts_at < (($2::date + 1)::timestamp at time zone $3) and h.ends_at > ($2::date::timestamp at time zone $3)`,
      [ids, ...dayParams],
    )).rows;
    const taken = (await tx.query<{ therapist_id: string; room_id: string | null; starts_at: Date; ends_at: Date }>(
      `select therapist_id, room_id, starts_at, ends_at from spa_appointments
       where outlet_id = any($1::uuid[]) and status in ('booked', 'done') and starts_at < (($2::date + 1)::timestamp at time zone $3) and ends_at > ($2::date::timestamp at time zone $3)`,
      [ids, ...dayParams],
    )).rows;
    const rooms = (await tx.query<{ id: string; outlet_id: string }>("select id, outlet_id from spa_rooms where outlet_id = any($1::uuid[]) and active", [ids])).rows;
    const iv = (x: { starts_at: Date; ends_at: Date }): Interval => ({ start: x.starts_at, end: x.ends_at });
    const slots: PortalSpa["slots"] = [];
    for (const t of treatments) {
      const starts = new Set<number>();
      for (const therapist of new Set(hours.filter((h) => h.outlet_id === t.outlet_id).map((h) => h.therapist_id))) {
        const free = openSpaSlots(
          {
            hours: hours.filter((h) => h.therapist_id === therapist).map(iv),
            therapistBusy: taken.filter((a) => a.therapist_id === therapist).map(iv),
            rooms: t.needs_room ? rooms.filter((x) => x.outlet_id === t.outlet_id).map((x) => ({ id: x.id, busy: taken.filter((a) => a.room_id === x.id).map(iv) })) : null,
          },
          t.minutes,
          SLOT_STEP,
        );
        // hours past midnight belong to the next day's list
        for (const f of free) if (f.start > now && f.start >= dayStart && f.start < dayEnd) starts.add(f.start.getTime());
      }
      for (const s of [...starts].sort((a, b) => a - b)) slots.push({ outletId: t.outlet_id, treatmentId: t.id, startsAt: new Date(s).toISOString() });
    }
    const appointments = (await tx.query<{ id: string; spa: string; treatment: string; starts_at: Date; ends_at: Date; status: "booked" | "done"; cancel_hours: number }>(
      `select a.id, o.name as spa, i.name as treatment, a.starts_at, a.ends_at, a.status, o.spa_cancel_hours as cancel_hours
       from spa_appointments a join outlets o on o.id = a.outlet_id join spa_treatments t on t.id = a.treatment_id join outlet_menu_items i on i.id = t.menu_item_id
       where a.reservation_id = $1 and a.status in ('booked', 'done') and a.ends_at > $2 order by a.starts_at`,
      [r.id, now],
    )).rows.map((a) => ({
      id: a.id,
      spa: a.spa,
      treatment: a.treatment,
      startsAt: a.starts_at.toISOString(),
      endsAt: a.ends_at.toISOString(),
      status: a.status,
      cancelHours: a.cancel_hours,
      cancelUntil: guestCancelDeadline(a.starts_at, a.cancel_hours).toISOString(),
      mayCancel: a.status === "booked" && guestMayCancel(a.starts_at, now, a.cancel_hours),
    }));
    return {
      spas: spas.map((o) => ({ id: o.id, name: o.name, cancelHours: o.cancel_hours, treatments: treatments.filter((t) => t.outlet_id === o.id).map((t) => ({ id: t.id, name: t.name, price: Number(t.price), minutes: t.minutes })) })),
      days,
      date: day,
      slots,
      appointments,
    };
  });
}

/**
 * The guest takes an Appointment at a time: the first therapist free then in
 * released hours takes it (and a free room where it needs one). Taken in the
 * meantime: refused, the guest chooses again. The spa's property, for the
 * live update of its book.
 */
export async function bookPortalAppointment(pool: Pool, schema: string, key: string, input: { outletId: string; treatmentId: string; startsAt: Date }, now = new Date()): Promise<{ appointmentId: string; propertyId: string }> {
  if (!isUuid(input.outletId) || !isUuid(input.treatmentId) || Number.isNaN(input.startsAt.getTime())) throw new PortalSpaRefusal("not_found");
  return withTenant(pool, schema, async (tx) => {
    const r = await reservationByKey(tx, key, { lock: true });
    if (!bookable(r)) throw new PortalSpaRefusal("unavailable");
    if (!(await spasIn(tx, r)).some((o) => o.id === input.outletId)) throw new PortalSpaRefusal("unavailable");
    // only what the Portal offers: a time to come, on a day of the stay before departure
    if (input.startsAt <= now) throw new PortalSpaRefusal("passed");
    if (!stayDays(r).some((d) => input.startsAt >= instantAt(d, "00:00", r.time_zone) && input.startsAt < instantAt(addDays(d, 1), "00:00", r.time_zone))) throw new PortalSpaRefusal("unavailable");
    const booked = (await tx.query<{ n: number }>("select count(*)::int as n from spa_appointments where reservation_id = $1 and status = 'booked'", [r.id])).rows[0]!.n;
    if (booked >= MAX_BOOKED) throw new PortalSpaRefusal("too_many");
    // the guest is in one treatment at a time
    const clash = (await tx.query(
      "select 1 from spa_appointments a join spa_treatments t on t.id = $3 where a.reservation_id = $1 and a.status = 'booked' and a.starts_at < $2::timestamptz + make_interval(mins => t.minutes) and a.ends_at > $2",
      [r.id, input.startsAt, input.treatmentId],
    )).rows.length;
    if (clash) throw new PortalSpaRefusal("clash");
    const therapists = (await tx.query<{ id: string }>(
      "select distinct t.id, t.name from spa_therapists t join spa_hours h on h.therapist_id = t.id where t.outlet_id = $1 and t.active and h.released and h.starts_at <= $2 and h.ends_at > $2 order by t.name",
      [input.outletId, input.startsAt],
    )).rows;
    for (const t of therapists) {
      await tx.query("savepoint portal_spa");
      try {
        const appointmentId = await bookAppointmentIn(tx, input.outletId, { treatmentId: input.treatmentId, therapistId: t.id, startsAt: input.startsAt, reservationId: r.id }, { userId: PORTAL_USER, via: "portal" });
        await tx.query("release savepoint portal_spa");
        return { appointmentId, propertyId: r.property_id };
      } catch (err) {
        await tx.query("rollback to savepoint portal_spa");
        // this therapist is not free then: the next one; anything else is the answer
        if (!(err instanceof AppointmentRefused)) throw err;
      }
    }
    throw new PortalSpaRefusal("taken");
  });
}

/** The guest cancels their own appointment, up to the spa's hours before it. The spa's property, for the live update. */
export async function cancelPortalAppointment(pool: Pool, schema: string, key: string, appointmentId: string, now = new Date()): Promise<{ propertyId: string }> {
  if (!isUuid(appointmentId)) throw new PortalSpaRefusal("not_found");
  return withTenant(pool, schema, async (tx) => {
    const r = await reservationByKey(tx, key);
    if (!bookable(r)) throw new PortalSpaRefusal("no_longer");
    const a = (await tx.query<{ status: string; starts_at: Date; cancel_hours: number }>(
      "select a.status, a.starts_at, o.spa_cancel_hours as cancel_hours from spa_appointments a join outlets o on o.id = a.outlet_id where a.id = $1 and a.reservation_id = $2 for update of a",
      [appointmentId, r.id],
    )).rows[0];
    if (!a) throw new PortalSpaRefusal("not_found");
    if (a.status !== "booked") throw new PortalSpaRefusal("no_longer");
    if (!guestMayCancel(a.starts_at, now, a.cancel_hours)) throw new PortalSpaRefusal("too_late", a.cancel_hours);
    await tx.query("update spa_appointments set status = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = $2 where id = $1", [appointmentId, PORTAL_USER]);
    return { propertyId: r.property_id };
  });
}
