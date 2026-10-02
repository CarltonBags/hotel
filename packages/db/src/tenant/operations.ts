import type { Pool } from "pg";
import { addDays, includesBreakfast, occupancyPercent, personsByMealPlan, type MealPlan, type PersonsByMealPlan, type ReservationStatus } from "@hoteloftware/domain";
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
