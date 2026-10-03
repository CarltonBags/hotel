import type { Pool } from "pg";
import { addDays, includesBreakfast, occupancyPercent, personsByMealPlan, type MealPlan, type PersonsByMealPlan, type ReservationStatus, type WorkspaceRow } from "@hoteloftware/domain";
import { checkDate, isUuid } from "./catalogue-common";
import { withTenant } from "./with-tenant";

/**
 * Operational lists of a property (permission matrix "Operational lists"):
 * arrivals, departures, in-house, house list, breakfast list, and the Today
 * summary; plus reservation search across properties.
 */

export interface ListRow {
  reservationId: string;
  confirmationNumber: string;
  guestFirstName: string;
  guestLastName: string;
  /** Room number on the night the list is about, or null when unassigned. */
  room: string | null;
  roomTypeCode: string;
  adults: number;
  children: number;
  arrival: string;
  departure: string;
  nights: number;
  ratePlanName: string;
  mealPlan: MealPlan;
  status: ReservationStatus;
  bookerName: string;
  overbooked: boolean;
}

interface Row {
  id: string;
  confirmation_number: string;
  first_name: string;
  last_name: string;
  room: string | null;
  type_code: string;
  adults: number;
  children: number;
  arrival: string;
  departure: string;
  nights: number;
  plan_name: string;
  meal_plan: MealPlan;
  status: ReservationStatus;
  booker: string;
  overbooked: boolean;
}

/**
 * Which reservations each list holds; Today's counts use the same rules so a
 * figure always matches its list. `$D` is the list date.
 */
const RULES = {
  // still to arrive: a guest who has checked in is in house, no longer an arrival
  arrivals: "r.arrival = $D::date and r.status = 'confirmed'",
  departures: "r.departure = $D::date and r.status in ('confirmed', 'checked_in', 'checked_out')",
  inHouse: "r.status = 'checked_in'",
  staying: "r.arrival <= $D::date and r.departure > $D::date and r.status in ('confirmed', 'checked_in')",
} as const;
const rule = (name: keyof typeof RULES, param: string) => RULES[name].replaceAll("$D", param);

/** $1 property, $2 the night whose room is shown; callers add conditions using further parameters. */
const SELECT = `select r.id, b.confirmation_number, g.first_name, g.last_name,
    (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id and a.from_date <= $2::date and a.to_date > $2::date limit 1) as room,
    t.code as type_code, r.adults, cardinality(r.child_ages) as children,
    to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, (r.departure - r.arrival) as nights,
    p.name as plan_name, p.meal_plan, r.status, coalesce(c.name, trim(bg.first_name || ' ' || bg.last_name)) as booker, r.overbooked
  from reservations r
  join bookings b on b.id = r.booking_id
  join guests g on g.id = r.primary_guest_id
  join room_types t on t.id = r.room_type_id
  join rate_plans p on p.id = r.rate_plan_id
  left join companies c on c.id = b.booker_company_id
  left join guests bg on bg.id = b.booker_guest_id
  where r.property_id = $1`;

function toRow(r: Row): ListRow {
  return {
    reservationId: r.id,
    confirmationNumber: r.confirmation_number,
    guestFirstName: r.first_name,
    guestLastName: r.last_name,
    room: r.room,
    roomTypeCode: r.type_code,
    adults: r.adults,
    children: r.children,
    arrival: r.arrival,
    departure: r.departure,
    nights: r.nights,
    ratePlanName: r.plan_name,
    mealPlan: r.meal_plan,
    status: r.status,
    bookerName: r.booker,
    overbooked: r.overbooked,
  };
}

async function list(pool: Pool, schema: string, propertyId: string, roomNight: string, where: string, extra: unknown[] = [], order = "room nulls last, g.last_name"): Promise<ListRow[]> {
  if (!isUuid(propertyId)) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Row>(`${SELECT} and ${where} order by ${order}`, [propertyId, checkDate(roomNight), ...extra]);
    return rows.map(toRow);
  });
}

/** Reservations arriving on the date and not yet checked in. */
export function listArrivals(pool: Pool, schema: string, propertyId: string, date: string): Promise<ListRow[]> {
  return list(pool, schema, propertyId, date, rule("arrivals", "$2"));
}

/** Reservations leaving on the date; the room shown is the last night's. */
export function listDepartures(pool: Pool, schema: string, propertyId: string, date: string): Promise<ListRow[]> {
  return list(pool, schema, propertyId, addDays(checkDate(date), -1), rule("departures", "$3"), [date]);
}

/** Guests checked in now; `today` (the property's date) picks the room shown. */
export function listInHouse(pool: Pool, schema: string, propertyId: string, today: string): Promise<ListRow[]> {
  return list(pool, schema, propertyId, today, rule("inHouse", "$2"));
}

/** Everyone sleeping in the house on the night of the date, by room; unassigned stays last. */
export function houseList(pool: Pool, schema: string, propertyId: string, date: string): Promise<ListRow[]> {
  return list(pool, schema, propertyId, date, rule("staying", "$2"));
}

export interface BreakfastList {
  /** Guests who slept the night before the date and whose Meal Plan includes breakfast. */
  rows: ListRow[];
  /** Persons per Meal Plan among everyone who slept the night before. */
  counts: PersonsByMealPlan;
}

/**
 * Breakfast on the morning of the date: whoever slept in the house the night
 * before. For a morning still ahead it is a forecast of Confirmed stays too;
 * for today or past mornings only guests who checked in count, so a stay that
 * never arrived is not counted.
 */
export async function breakfastList(pool: Pool, schema: string, propertyId: string, date: string, today: string): Promise<BreakfastList> {
  const night = addDays(checkDate(date), -1);
  const statuses = date > checkDate(today) ? "('confirmed', 'checked_in', 'checked_out')" : "('checked_in', 'checked_out')";
  const all = await list(pool, schema, propertyId, night, `r.arrival <= $2::date and r.departure > $2::date and r.status in ${statuses}`);
  return { rows: all.filter((r) => includesBreakfast(r.mealPlan)), counts: personsByMealPlan(all) };
}

export interface TodaySummary {
  date: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  /** Reservations sleeping in the house tonight. */
  staying: number;
  rooms: number;
  /** Occupancy (figure) tonight, percent. TODO(housekeeping tickets): exclude Out of Order rooms from the rooms counted. */
  occupancy: number;
}

export async function todaySummary(pool: Pool, schema: string, propertyId: string, date: string): Promise<TodaySummary> {
  checkDate(date);
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ arrivals: number; departures: number; in_house: number; staying: number; rooms: number }>(
      `select
         (select count(*)::int from reservations r where r.property_id = $1 and ${rule("arrivals", "$2")}) as arrivals,
         (select count(*)::int from reservations r where r.property_id = $1 and ${rule("departures", "$2")}) as departures,
         (select count(*)::int from reservations r where r.property_id = $1 and ${rule("inHouse", "$2")}) as in_house,
         (select count(*)::int from reservations r where r.property_id = $1 and ${rule("staying", "$2")}) as staying,
         (select count(*)::int from rooms where property_id = $1) as rooms`,
      [propertyId, date],
    );
    const r = rows[0]!;
    return { date, arrivals: r.arrivals, departures: r.departures, inHouse: r.in_house, staying: r.staying, rooms: r.rooms, occupancy: occupancyPercent(r.staying, r.rooms) };
  });
}


export const WORKSPACE_LISTS = ["arrivals", "departures", "in_house", "checked_out"] as const;
export type WorkspaceList = (typeof WORKSPACE_LISTS)[number];

/** Which reservations each Today workspace list holds on the property's date `$2`. */
const WORKSPACE_RULES: Record<WorkspaceList, string> = {
  arrivals: RULES.arrivals.replaceAll("$D", "$2"),
  // expected departures: guests in house who leave today
  departures: "r.departure = $2::date and r.status = 'checked_in'",
  // the date parameter is unused here but typed, so every rule takes the same parameters
  in_house: `${RULES.inHouse} and $2::date is not null`,
  checked_out: "r.departure = $2::date and r.status = 'checked_out'",
};

/**
 * One list of the Today workspace with what the desk needs per row: room,
 * guest, the open amount on the guest's own folios, VIP, Booker. The room
 * shown is tonight's, or last night's for departures. Search, filters and
 * sorting run in the browser (domain workspaceRows).
 */
export async function workspaceList(pool: Pool, schema: string, propertyId: string, kind: WorkspaceList, today: string): Promise<WorkspaceRow[]> {
  if (!isUuid(propertyId)) return [];
  const night = kind === "departures" || kind === "checked_out" ? addDays(checkDate(today), -1) : checkDate(today);
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      confirmation_number: string;
      room: string | null;
      first_name: string;
      last_name: string;
      type_code: string;
      plan_name: string;
      booker: string;
      arrival: string;
      departure: string;
      vip: boolean;
      balance: string;
      card_hold: string | null;
    }>(
      `select r.id, b.confirmation_number, g.first_name, g.last_name, g.vip,
         (select m.number from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = r.id and a.from_date <= $3::date and a.to_date > $3::date limit 1) as room,
         t.code as type_code, p.name as plan_name, coalesce(c.name, trim(bg.first_name || ' ' || bg.last_name)) as booker,
         to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure,
         -- the guest's own folios: Charges less payments received (refunds count back)
         (select coalesce(sum(ch.amount), 0) from charges ch join folios f on f.id = ch.folio_id
           where ch.reservation_id = r.id and ch.voided_at is null and f.bill_to_guest_id is not null)
         - (select coalesce(sum(pa.amount), 0) from payments pa join folios f on f.id = pa.folio_id
           where pa.reservation_id = r.id and pa.status = 'succeeded' and f.bill_to_guest_id is not null) as balance,
         (select sum(h.amount) from card_holds h where h.reservation_id = r.id and h.status = 'active') as card_hold
       from reservations r
       join bookings b on b.id = r.booking_id
       join guests g on g.id = r.primary_guest_id
       join room_types t on t.id = r.room_type_id
       join rate_plans p on p.id = r.rate_plan_id
       left join companies c on c.id = b.booker_company_id
       left join guests bg on bg.id = b.booker_guest_id
       where r.property_id = $1 and ${WORKSPACE_RULES[kind]}`,
      [propertyId, checkDate(today), night],
    );
    return rows.map((r) => ({
      reservationId: r.id,
      confirmationNumber: r.confirmation_number,
      room: r.room,
      guestFirstName: r.first_name,
      guestLastName: r.last_name,
      roomTypeCode: r.type_code,
      ratePlanName: r.plan_name,
      bookerName: r.booker,
      arrival: r.arrival,
      departure: r.departure,
      vip: r.vip,
      balance: Number(r.balance),
      cardHold: r.card_hold === null ? null : Number(r.card_hold),
    }));
  });
}

/** Counts for the workspace buttons, by the same rules as the lists. */
export async function workspaceCounts(pool: Pool, schema: string, propertyId: string, today: string): Promise<Record<WorkspaceList, number>> {
  if (!isUuid(propertyId)) return { arrivals: 0, departures: 0, in_house: 0, checked_out: 0 };
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<Record<WorkspaceList, number>>(
      `select ${WORKSPACE_LISTS.map((k) => `(select count(*)::int from reservations r where r.property_id = $1 and ${WORKSPACE_RULES[k]}) as ${k}`).join(", ")}`,
      [propertyId, checkDate(today)],
    );
    return rows[0]!;
  });
}

export interface ReservationHit {
  id: string;
  confirmationNumber: string;
  guestFirstName: string;
  guestLastName: string;
  propertyId: string;
  propertyName: string;
  arrival: string;
  departure: string;
  status: ReservationStatus;
}

/** Reservations by confirmation number or guest name across the properties the caller may see. */
export async function searchReservations(pool: Pool, schema: string, query: string, propertyIds: string[], limit = 10): Promise<ReservationHit[]> {
  const q = query.trim();
  const props = propertyIds.filter(isUuid);
  if (q.length < 2 || props.length === 0) return [];
  const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; confirmation_number: string; first_name: string; last_name: string; property_id: string; property_name: string; arrival: string; departure: string; status: ReservationStatus }>(
      `select r.id, b.confirmation_number, g.first_name, g.last_name, r.property_id, pr.name as property_name,
         to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, r.status
       from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id join properties pr on pr.id = r.property_id
       where r.property_id = any($1::uuid[])
         and (b.confirmation_number = $2 or lower(g.last_name) like $3 or lower(g.first_name || ' ' || g.last_name) like $3)
       order by (b.confirmation_number = $2) desc, r.arrival desc limit $4`,
      [props, q, like, Math.min(limit, 50)],
    );
    return rows.map((r) => ({
      id: r.id,
      confirmationNumber: r.confirmation_number,
      guestFirstName: r.first_name,
      guestLastName: r.last_name,
      propertyId: r.property_id,
      propertyName: r.property_name,
      arrival: r.arrival,
      departure: r.departure,
      status: r.status,
    }));
  });
}
