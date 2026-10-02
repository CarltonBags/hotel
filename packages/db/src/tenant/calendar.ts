import type { Pool } from "pg";
import { addDays, datesFrom, type AssignmentSegment, type ReservationStatus } from "@hoteloftware/domain";
import { checkDate } from "./catalogue-common";
import { loadQuoteData } from "./reservations";
import { withTenant } from "./with-tenant";

/**
 * Data for the Calendar Rooms view ("Calendar screen prototype"): rooms by
 * room type with free rooms, lowest public price and its restriction marks
 * per day, and the reservations overlapping the range with their Room
 * Assignment segments. Read in one transaction.
 */

export interface CalendarRoom {
  id: string;
  number: string;
  floor: string;
  sectionId: string | null;
  featureIds: string[];
}

export interface CalendarDay {
  date: string;
  /** Rooms of the type not taken by Confirmed or Checked-in reservations. */
  free: number;
  /** Lowest price of the public, active Rate Plans at base occupancy; null without a price. */
  lowestPrice: number | null;
  /** Stop sell on every public plan that has a price. */
  stopSell: boolean;
  /** Restriction marks of the lowest-priced plan: minimum stay on arrival above one night, closed to arrival or departure, maximum stay. */
  minStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  maxStay: number | null;
}

export interface CalendarRoomType {
  id: string;
  code: string;
  name: string;
  rooms: CalendarRoom[];
  days: CalendarDay[];
}

export interface CalendarReservation {
  id: string;
  confirmationNumber: string;
  guestLastName: string;
  guestFirstName: string;
  guests: number;
  status: ReservationStatus;
  roomTypeId: string;
  arrival: string;
  departure: string;
  overbooked: boolean;
  total: number;
  segments: AssignmentSegment[];
}

export interface CalendarData {
  from: string;
  days: number;
  roomTypes: CalendarRoomType[];
  reservations: CalendarReservation[];
  sections: { id: string; name: string }[];
  features: { id: string; name: string }[];
}

export async function loadCalendar(pool: Pool, schema: string, propertyId: string, from: string, days: number): Promise<CalendarData> {
  checkDate(from);
  if (!Number.isInteger(days) || days < 1 || days > 62) throw new Error("Between 1 and 62 days");
  const to = addDays(from, days);
  const dates = datesFrom(from, days);
  return withTenant(pool, schema, async (tx) => {
    // one connection runs one query at a time: read in sequence
    const data = await loadQuoteData(tx, propertyId, from, to);
    const rooms = await tx.query<{ id: string; room_type_id: string; number: string; floor: string; section_id: string | null; feature_ids: string[] }>(
        `select m.id, m.room_type_id, m.number, m.floor, m.section_id,
           coalesce((select array_agg(f.feature_id) from room_feature_assignments f where f.room_id = m.id), '{}') as feature_ids
         from rooms m where m.property_id = $1 order by m.number`,
        [propertyId],
      );
    const reservations = await tx.query<{
        id: string;
        confirmation_number: string;
        last_name: string;
        first_name: string;
        guests: number;
        status: ReservationStatus;
        room_type_id: string;
        arrival: string;
        departure: string;
        overbooked: boolean;
        total: string;
        segments: AssignmentSegment[];
      }>(
        `select r.id, b.confirmation_number, g.last_name, g.first_name, r.adults + cardinality(r.child_ages) as guests, r.status, r.room_type_id,
           to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, r.overbooked,
           coalesce((select sum(n.total) from reservation_nights n where n.reservation_id = r.id), 0) as total,
           coalesce((select json_agg(json_build_object('roomId', a.room_id, 'from', to_char(a.from_date, 'YYYY-MM-DD'), 'to', to_char(a.to_date, 'YYYY-MM-DD')) order by a.from_date)
                     from room_assignments a where a.reservation_id = r.id), '[]'::json) as segments
         from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id
         where r.property_id = $1 and r.arrival < $3 and r.departure > $2 and r.status in ('confirmed', 'checked_in', 'checked_out')
         order by r.arrival, b.confirmation_number`,
        [propertyId, from, to],
      );
    const sections = await tx.query<{ id: string; name: string }>("select id, name from sections where property_id = $1 order by sort_order, name", [propertyId]);
    const features = await tx.query<{ id: string; name: string }>("select id, name from room_features where property_id = $1 order by name", [propertyId]);
    const publicPlans = data.plans.filter((p) => p.public);
    const roomTypes = data.types.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      rooms: rooms.rows
        .filter((m) => m.room_type_id === t.id)
        .map((m) => ({ id: m.id, number: m.number, floor: m.floor, sectionId: m.section_id, featureIds: m.feature_ids })),
      days: dates.map((date) => {
        const priced = publicPlans
          .filter((p) => p.room_type_ids.includes(t.id))
          .map((p) => ({ price: data.price(p.id, t.id, date), restriction: data.restriction(p.id, t.id, date) }))
          .filter((x): x is { price: number; restriction: ReturnType<typeof data.restriction> } => x.price !== null);
        // the lowest price still on sale; when every plan is stop-sold, the lowest of them
        const selling = priced.filter((x) => !x.restriction.stopSell);
        const lowest = (selling.length ? selling : priced).reduce<(typeof priced)[number] | null>((best, x) => (best === null || x.price < best.price ? x : best), null);
        return {
          date,
          free: t.rooms - data.roomsTaken(t.id, date),
          lowestPrice: lowest?.price ?? null,
          stopSell: priced.length > 0 && priced.every((x) => x.restriction.stopSell),
          minStay: lowest && lowest.restriction.minStayArrival !== null && lowest.restriction.minStayArrival > 1 ? lowest.restriction.minStayArrival : null,
          closedToArrival: lowest?.restriction.closedToArrival ?? false,
          closedToDeparture: lowest?.restriction.closedToDeparture ?? false,
          maxStay: lowest?.restriction.maxStay ?? null,
        };
      }),
    }));
    return {
      from,
      days,
      roomTypes,
      reservations: reservations.rows.map((r) => ({
        id: r.id,
        confirmationNumber: r.confirmation_number,
        guestLastName: r.last_name,
        guestFirstName: r.first_name,
        guests: r.guests,
        status: r.status,
        roomTypeId: r.room_type_id,
        arrival: r.arrival,
        departure: r.departure,
        overbooked: r.overbooked,
        total: Number(r.total),
        segments: r.segments,
      })),
      sections: sections.rows,
      features: features.rows,
    };
  });
}
