import type { Pool, PoolClient } from "pg";
import {
  OCCUPYING_STATUSES,
  OPEN_RESTRICTION,
  addDays,
  effectiveRestriction,
  nightsOf,
  quoteStay,
  type BookingSource,
  type MealPlan,
  type QuoteReason,
  type QuotedNight,
  type ReservationStatus,
  type Restriction,
  type StayQuote,
  type Supplement,
} from "@hoteloftware/domain";
import { checkDate, isUuid } from "./catalogue-common";
import { lockProperty } from "./property-lock";
import { loadPlanIndex, toRestriction, type RestrictionRow } from "./rates";
import { withTenant } from "./with-tenant";
import { openFolios } from "./folios";

/**
 * Bookings and Reservations (ADR 0003). Availability lives on room types
 * only: rooms of the type minus Confirmed and Checked-in reservations on a
 * night. Each Reservation stores its price per night and component at
 * booking; later rate changes never touch it.
 */

export interface StayRequest {
  arrival: string;
  departure: string;
  adults: number;
  childAges: number[];
  rateCode?: string | undefined;
}

export interface QuotedPlan {
  ratePlanId: string;
  code: string;
  name: string;
  mealPlan: MealPlan;
  /** Shown because its Rate Code was entered. */
  hidden: boolean;
  quote: StayQuote;
}

export interface QuotedRoomType {
  roomTypeId: string;
  code: string;
  name: string;
  maxAdults: number;
  maxOccupancy: number;
  rooms: number;
  /** Fewest free rooms over the nights. */
  available: number;
  plans: QuotedPlan[];
}

export interface StayQuotes {
  roomTypes: QuotedRoomType[];
  /** The Rate Code entered, when it matched a plan, with the Company it attaches. */
  rateCode: { code: string; companyId: string | null; companyName: string | null } | null;
}

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  kind: "base" | "derived";
  base_plan_id: string | null;
  base_occupancy: number;
  meal_plan: MealPlan;
  public: boolean;
  rate_code: string | null;
  company_id: string | null;
  company_name: string | null;
  date_change_allowed: boolean;
  room_type_ids: string[];
  supplements: { kind: Supplement["kind"]; age_band_id: string | null; amount: string }[];
  included_services: { service_id: string; component_price: string }[];
}

/** Everything a quote needs, read in one transaction: rooms and their Availability, plans, rates, restrictions and Age Bands. */
/** `excludeReservationId`: a reservation being edited does not take its own room. */
export async function loadQuoteData(tx: PoolClient, propertyId: string, arrival: string, departure: string, excludeReservationId: string | null = null) {
  const lastNight = addDays(departure, -1);
  // one connection runs one query at a time: read in sequence
  const types = await tx.query<{ id: string; code: string; name: string; max_adults: number; max_occupancy: number; rooms: number }>(
      `select t.id, t.code, t.name, t.max_adults, t.max_occupancy, (select count(*)::int from rooms r where r.room_type_id = t.id) as rooms
       from room_types t where t.property_id = $1 order by t.sort_order, t.code`,
      [propertyId],
    );
  const occupied = await tx.query<{ room_type_id: string; date: string; n: number }>(
      `select r.room_type_id, to_char(d, 'YYYY-MM-DD') as date, count(*)::int as n
       from reservations r cross join lateral generate_series(greatest(r.arrival, $2::date), least(r.departure, $3::date) - 1, interval '1 day') d
       where r.property_id = $1 and r.status = any($4::text[]) and r.arrival < $3::date and r.departure > $2::date and ($5::uuid is null or r.id <> $5::uuid)
       group by r.room_type_id, d`,
      [propertyId, arrival, departure, OCCUPYING_STATUSES, excludeReservationId],
    );
  const plans = await tx.query<PlanRow>(
      `select p.id, p.code, p.name, p.kind, p.base_plan_id, p.base_occupancy, p.meal_plan, p.public, p.rate_code, p.company_id, c.name as company_name, p.date_change_allowed,
         coalesce((select array_agg(rt.room_type_id) from rate_plan_room_types rt where rt.rate_plan_id = p.id), '{}') as room_type_ids,
         coalesce((select json_agg(json_build_object('kind', s.kind, 'age_band_id', s.age_band_id, 'amount', s.amount)) from rate_plan_supplements s where s.rate_plan_id = p.id), '[]'::json) as supplements,
         coalesce((select json_agg(json_build_object('service_id', ps.service_id, 'component_price', ps.component_price)) from rate_plan_services ps where ps.rate_plan_id = p.id), '[]'::json) as included_services
       from rate_plans p left join companies c on c.id = p.company_id
       where p.property_id = $1 and p.active order by p.sort_order, p.code`,
      [propertyId],
    );
  const rates = await tx.query<{ rate_plan_id: string; room_type_id: string; date: string; price: string }>(
      `select r.rate_plan_id, r.room_type_id, to_char(r.date, 'YYYY-MM-DD') as date, r.price
       from rates r join rate_plans p on p.id = r.rate_plan_id where p.property_id = $1 and r.date between $2 and $3`,
      [propertyId, arrival, lastNight],
    );
  const restrictions = await tx.query<RestrictionRow>(
      `select r.rate_plan_id, r.room_type_id, to_char(r.date, 'YYYY-MM-DD') as date, r.stop_sell, r.closed_to_arrival, r.closed_to_departure, r.min_stay_arrival, r.min_stay_through, r.max_stay
       from restrictions r join rate_plans p on p.id = r.rate_plan_id where p.property_id = $1 and r.date between $2 and $3`,
      [propertyId, arrival, departure],
    );
  const bands = await tx.query<{ id: string; min_age: number; max_age: number | null }>("select id, min_age, max_age from age_bands where property_id = $1", [propertyId]);
  const index = await loadPlanIndex(tx, propertyId);
  const occ = new Map(occupied.rows.map((r) => [`${r.room_type_id}|${r.date}`, r.n]));
  const price = new Map(rates.rows.map((r) => [`${r.rate_plan_id}|${r.room_type_id}|${r.date}`, Number(r.price)]));
  const stored = new Map(restrictions.rows.map((r) => [`${r.rate_plan_id}|${r.room_type_id}|${r.date}`, toRestriction(r)]));
  const restriction = (planId: string, roomTypeId: string, date: string): Restriction => {
    const own = stored.get(`${planId}|${roomTypeId}|${date}`) ?? OPEN_RESTRICTION;
    const plan = index.get(planId);
    if (!plan || plan.kind !== "derived" || !plan.basePlanId) return own;
    return effectiveRestriction(own, stored.get(`${plan.basePlanId}|${roomTypeId}|${date}`) ?? OPEN_RESTRICTION, plan.inherits);
  };
  return {
    types: types.rows,
    plans: plans.rows,
    ageBands: bands.rows.map((b) => ({ id: b.id, minAge: b.min_age, maxAge: b.max_age })),
    /** Rooms of the type taken by reservations on a night. */
    roomsTaken: (roomTypeId: string, date: string) => occ.get(`${roomTypeId}|${date}`) ?? 0,
    price: (planId: string, roomTypeId: string, date: string) => price.get(`${planId}|${roomTypeId}|${date}`) ?? null,
    restriction,
  };
}

export type QuoteData = Awaited<ReturnType<typeof loadQuoteData>>;

/** `takenByThisBooking` counts rooms earlier reservations of the same booking already take. */
export function quoteFor(data: QuoteData, plan: PlanRow, type: QuoteData["types"][number], stay: StayRequest, takenByThisBooking: (date: string) => number): StayQuote {
  return quoteStay({
    arrival: stay.arrival,
    departure: stay.departure,
    adults: stay.adults,
    childAges: stay.childAges,
    roomType: { maxAdults: type.max_adults, maxOccupancy: type.max_occupancy },
    plan: {
      baseOccupancy: plan.base_occupancy,
      supplements: plan.supplements.map((s) => ({ kind: s.kind, ageBandId: s.age_band_id ?? undefined, amount: Number(s.amount) })),
      includedServices: plan.included_services.map((s) => ({ serviceId: s.service_id, componentPrice: Number(s.component_price) })),
    },
    ageBands: data.ageBands,
    rate: (d) => data.price(plan.id, type.id, d),
    restriction: (d) => data.restriction(plan.id, type.id, d),
    available: (d) => type.rooms - data.roomsTaken(type.id, d) - takenByThisBooking(d),
  });
}

function checkStayRequest(stay: StayRequest): StayRequest {
  checkDate(stay.arrival);
  checkDate(stay.departure);
  nightsOf(stay.arrival, stay.departure);
  if (!Number.isInteger(stay.adults) || stay.adults < 0 || stay.adults > 20) throw new Error("Adults must be a whole number");
  if (stay.childAges.length > 20 || stay.childAges.some((a) => !Number.isInteger(a) || a < 0 || a > 17)) throw new Error("Child ages are whole years from 0 to 17");
  return stay;
}

const sameCode = (a: string | null, b: string | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Availability and prices for a stay: per room type, the public plans plus any plan whose Rate Code was entered. */
export async function quoteStays(pool: Pool, schema: string, propertyId: string, stay: StayRequest): Promise<StayQuotes> {
  checkStayRequest(stay);
  return withTenant(pool, schema, async (tx) => {
    const data = await loadQuoteData(tx, propertyId, stay.arrival, stay.departure);
    const coded = data.plans.find((p) => !p.public && sameCode(p.rate_code, stay.rateCode));
    const roomTypes = data.types.map((t) => {
      const plans = data.plans
        .filter((p) => p.room_type_ids.includes(t.id) && (p.public || sameCode(p.rate_code, stay.rateCode)))
        .map((p) => ({ ratePlanId: p.id, code: p.code, name: p.name, mealPlan: p.meal_plan, hidden: !p.public, quote: quoteFor(data, p, t, stay, () => 0) }));
      const available = Math.min(...nightsOf(stay.arrival, stay.departure).map((d) => t.rooms - data.roomsTaken(t.id, d)));
      return { roomTypeId: t.id, code: t.code, name: t.name, maxAdults: t.max_adults, maxOccupancy: t.max_occupancy, rooms: t.rooms, available, plans };
    });
    return { roomTypes, rateCode: coded ? { code: coded.rate_code!, companyId: coded.company_id, companyName: coded.company_name } : null };
  });
}

export interface NewReservation extends Omit<StayRequest, "rateCode"> {
  roomTypeId: string;
  ratePlanId: string;
  primaryGuestId: string;
  /** The total the user saw; when given, a different current total refuses the booking instead of storing an unseen price. */
  expectedTotal?: number | undefined;
  /** Book past Availability after the user's explicit confirmation (Front Desk, Property Manager); flagged as overbooked. */
  force?: boolean | undefined;
}

/** A quote that fails only for lack of free rooms may still be booked when the user forced it. */
export function blockingReasons(quote: StayQuote, force: boolean): QuoteReason[] {
  return quote.reasons.filter((x) => !(force && x === "sold_out"));
}

export interface NewBooking {
  booker: { guestId: string } | { companyId: string };
  walkIn: boolean;
  notes: string;
  /** Unlocks hidden plans; the Company it attaches comes from the plan. */
  rateCode?: string | undefined;
  reservations: NewReservation[];
}

export const REASON_TEXT: Record<QuoteReason, string> = {
  no_adult: "at least one adult is needed",
  too_many_adults: "too many adults for the room type",
  too_many_persons: "too many persons for the room type",
  sold_out: "sold out on at least one night",
  no_price: "no price on at least one night",
  stop_sell: "stop sell on at least one night",
  closed_to_arrival: "closed to arrival",
  closed_to_departure: "closed to departure",
  min_stay: "shorter than the minimum stay",
  max_stay: "longer than the maximum stay",
  components_exceed_price: "included services cost more than the night",
};

/**
 * Create a Booking with its Reservations in state Confirmed. Prices are quoted
 * again under the property lock and stored per night and component; rooms
 * taken by earlier reservations of the same booking count against availability.
 */
export async function createBooking(pool: Pool, schema: string, propertyId: string, userId: string, input: NewBooking): Promise<{ id: string; confirmationNumber: string; reservations: { id: string }[] }> {
  if (input.reservations.length === 0) throw new Error("A booking needs at least one reservation");
  if (input.reservations.length > 20) throw new Error("At most 20 rooms in one booking");
  for (const r of input.reservations) checkStayRequest(r);
  return withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    // TODO(Night Audit ticket): use the property's Business Date instead of its wall-clock date
    const prop = await tx.query<{ today: string }>("select to_char((now() at time zone time_zone)::date, 'YYYY-MM-DD') as today from properties where id = $1", [propertyId]);
    if (!prop.rows[0]) throw new Error("Property not found");
    const today = prop.rows[0].today;
    if (input.reservations.some((r) => r.arrival < today)) throw new Error("Arrival cannot be in the past");
    if (input.walkIn && input.reservations.some((r) => r.arrival !== today)) throw new Error("A walk-in arrives today");
    const from = input.reservations.map((r) => r.arrival).sort()[0]!;
    const to = input.reservations.map((r) => r.departure).sort().at(-1)!;
    const data = await loadQuoteData(tx, propertyId, from, to);

    const guestIds = [...new Set(input.reservations.map((r) => r.primaryGuestId).concat("guestId" in input.booker ? [input.booker.guestId] : []))];
    const guests = await tx.query("select id from guests where id = any($1::uuid[])", [guestIds]);
    if (guests.rowCount !== guestIds.length) throw new Error("Guest not found");
    if ("companyId" in input.booker) {
      const c = await tx.query("select 1 from companies where id = $1", [input.booker.companyId]);
      if (!c.rowCount) throw new Error("Company not found");
    }

    const codedPlan = data.plans.find((p) => !p.public && sameCode(p.rate_code, input.rateCode));
    const taken = new Map<string, number>(); // room type and night → rooms this booking already takes
    const quotes = input.reservations.map((r, i) => {
      const type = data.types.find((t) => t.id === r.roomTypeId);
      if (!type) throw new Error("Room type not found at this property");
      const plan = data.plans.find((p) => p.id === r.ratePlanId);
      if (!plan || !plan.room_type_ids.includes(type.id)) throw new Error(`Rate Plan not sold for ${type.code}`);
      if (!plan.public && !sameCode(plan.rate_code, input.rateCode)) throw new Error(`${plan.code} needs its Rate Code`);
      const quote = quoteFor(data, plan, type, r, (d) => taken.get(`${type.id}|${d}`) ?? 0);
      const blocking = blockingReasons(quote, r.force === true);
      if (blocking.length) throw new Error(`Room ${i + 1} (${type.code}, ${plan.code}): ${blocking.map((x) => REASON_TEXT[x]).join(", ")}`);
      if (r.expectedTotal !== undefined && Math.abs(r.expectedTotal - quote.total) > 0.005) throw new Error(`Room ${i + 1} (${type.code}, ${plan.code}): the price changed since it was shown; search again`);
      for (const n of quote.nights) taken.set(`${type.id}|${n.date}`, (taken.get(`${type.id}|${n.date}`) ?? 0) + 1);
      return quote;
    });

    const booking = await tx.query<{ id: string; confirmation_number: string }>(
      `insert into bookings (property_id, booker_guest_id, booker_company_id, source, walk_in, rate_code, rate_code_company_id, notes, created_by)
       values ($1, $2, $3, 'direct', $4, $5, $6, $7, $8) returning id, confirmation_number`,
      [
        propertyId,
        "guestId" in input.booker ? input.booker.guestId : null,
        "companyId" in input.booker ? input.booker.companyId : null,
        input.walkIn,
        input.rateCode?.trim() || null,
        codedPlan?.company_id ?? null,
        input.notes.trim(),
        userId,
      ],
    );
    const bookingId = booking.rows[0]!.id;
    const created: { id: string }[] = [];
    for (const [i, r] of input.reservations.entries()) {
      const res = await tx.query<{ id: string }>(
        `insert into reservations (booking_id, property_id, room_type_id, rate_plan_id, arrival, departure, adults, child_ages, primary_guest_id, created_by, overbooked)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [bookingId, propertyId, r.roomTypeId, r.ratePlanId, r.arrival, r.departure, r.adults, r.childAges, r.primaryGuestId, userId, quotes[i]!.reasons.includes("sold_out")],
      );
      const id = res.rows[0]!.id;
      await writeNights(tx, id, quotes[i]!.nights);
      await openFolios(tx, id, userId);
      created.push({ id });
    }
    return { id: bookingId, confirmationNumber: booking.rows[0]!.confirmation_number, reservations: created };
  });
}

/** Store nights with their components; replaces what is stored for those dates. */
export async function writeNights(tx: PoolClient, reservationId: string, nights: QuotedNight[]): Promise<void> {
  if (nights.length === 0) return;
  const dates = nights.map((n) => n.date);
  await tx.query("delete from reservation_nights where reservation_id = $1 and date = any($2::date[])", [reservationId, dates]);
  await tx.query("insert into reservation_nights (reservation_id, date, total) select $1, unnest($2::date[]), unnest($3::numeric[])", [reservationId, dates, nights.map((n) => n.total)]);
  const comps = nights.flatMap((n) => n.components.map((c) => ({ date: n.date, ...c })));
  await tx.query(
    `insert into reservation_night_components (reservation_id, date, kind, service_id, persons, unit_price, amount)
     select $1, unnest($2::date[]), unnest($3::text[]), unnest($4::uuid[]), unnest($5::int[]), unnest($6::numeric[]), unnest($7::numeric[])`,
    [reservationId, comps.map((c) => c.date), comps.map((c) => c.kind), comps.map((c) => c.serviceId), comps.map((c) => c.persons), comps.map((c) => c.unitPrice), comps.map((c) => c.amount)],
  );
}

export interface ReservationDetail {
  id: string;
  propertyId: string;
  status: ReservationStatus;
  arrival: string;
  departure: string;
  adults: number;
  childAges: number[];
  roomType: { id: string; code: string; name: string };
  ratePlan: { id: string; code: string; name: string; mealPlan: MealPlan };
  primaryGuest: { id: string; firstName: string; lastName: string };
  booking: {
    id: string;
    confirmationNumber: string;
    bookerGuestId: string | null;
    bookerCompanyId: string | null;
    bookerName: string;
    source: BookingSource;
    walkIn: boolean;
    rateCode: string | null;
    /** The Company the Rate Code attaches. */
    rateCodeCompanyId: string | null;
    rateCodeCompanyName: string | null;
    notes: string;
    reservationIds: string[];
    /** Confirmed reservations of the booking (cancellable). */
    openReservations: number;
  };
  overbooked: boolean;
  cancelledAt: Date | null;
  cancellationFee: number | null;
  cancellationFeeStatus: "open" | "confirmed" | "waived" | null;
  assignments: { roomId: string; roomName: string; from: string; to: string }[];
  nights: { date: string; total: number; components: { kind: "room" | "service"; serviceId: string | null; serviceCode: string | null; persons: number | null; unitPrice: number; amount: number }[] }[];
  total: number;
  createdAt: Date;
}


export async function findReservation(pool: Pool, schema: string, id: string): Promise<ReservationDetail | null> {
  if (!isUuid(id)) return null;
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(
      `select r.id, r.property_id, r.status, r.overbooked, r.cancelled_at, r.cancellation_fee, r.cancellation_fee_status, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, r.adults, r.child_ages, r.created_at,
         t.id as rt_id, t.code as rt_code, t.name as rt_name, p.id as rp_id, p.code as rp_code, p.name as rp_name, p.meal_plan,
         g.id as g_id, g.first_name, g.last_name,
         b.id as b_id, b.confirmation_number, b.booker_guest_id, b.booker_company_id, b.source, b.walk_in, b.rate_code, b.rate_code_company_id, rc.name as rate_code_company_name, b.notes,
         coalesce(bc.name, trim(bg.first_name || ' ' || bg.last_name)) as booker_name,
         (select array_agg(x.id order by x.created_at, x.id) from reservations x where x.booking_id = b.id) as reservation_ids,
         (select count(*)::int from reservations x where x.booking_id = b.id and x.status = 'confirmed') as open_reservations
       from reservations r
       join room_types t on t.id = r.room_type_id
       join rate_plans p on p.id = r.rate_plan_id
       join guests g on g.id = r.primary_guest_id
       join bookings b on b.id = r.booking_id
       left join companies bc on bc.id = b.booker_company_id
       left join guests bg on bg.id = b.booker_guest_id
       left join companies rc on rc.id = b.rate_code_company_id
       where r.id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    const nights = await tx.query<{ date: string; total: string }>("select to_char(date, 'YYYY-MM-DD') as date, total from reservation_nights where reservation_id = $1 order by date", [id]);
    const comps = await tx.query<{ date: string; kind: "room" | "service"; service_id: string | null; code: string | null; persons: number | null; unit_price: string; amount: string }>(
      `select to_char(c.date, 'YYYY-MM-DD') as date, c.kind, c.service_id, s.code, c.persons, c.unit_price, c.amount
       from reservation_night_components c left join services s on s.id = c.service_id where c.reservation_id = $1 order by c.date, c.kind, s.code`,
      [id],
    );
    const assigned = await tx.query<{ room_id: string; name: string; from_date: string; to_date: string }>(
      "select a.room_id, m.number as name, to_char(a.from_date, 'YYYY-MM-DD') as from_date, to_char(a.to_date, 'YYYY-MM-DD') as to_date from room_assignments a join rooms m on m.id = a.room_id where a.reservation_id = $1 order by a.from_date",
      [id],
    );
    const list = nights.rows.map((n) => ({
      date: n.date,
      total: Number(n.total),
      components: comps.rows
        .filter((c) => c.date === n.date)
        .map((c) => ({ kind: c.kind, serviceId: c.service_id, serviceCode: c.code, persons: c.persons, unitPrice: Number(c.unit_price), amount: Number(c.amount) })),
    }));
    return {
      id: r.id,
      propertyId: r.property_id,
      status: r.status,
      overbooked: r.overbooked,
      cancelledAt: r.cancelled_at,
      cancellationFee: r.cancellation_fee === null ? null : Number(r.cancellation_fee),
      cancellationFeeStatus: r.cancellation_fee_status,
      assignments: assigned.rows.map((a) => ({ roomId: a.room_id, roomName: a.name, from: a.from_date, to: a.to_date })),
      arrival: r.arrival,
      departure: r.departure,
      adults: r.adults,
      childAges: r.child_ages,
      roomType: { id: r.rt_id, code: r.rt_code, name: r.rt_name },
      ratePlan: { id: r.rp_id, code: r.rp_code, name: r.rp_name, mealPlan: r.meal_plan },
      primaryGuest: { id: r.g_id, firstName: r.first_name, lastName: r.last_name },
      booking: {
        id: r.b_id,
        confirmationNumber: r.confirmation_number,
        bookerGuestId: r.booker_guest_id,
        bookerCompanyId: r.booker_company_id,
        bookerName: r.booker_name,
        source: r.source,
        walkIn: r.walk_in,
        rateCode: r.rate_code,
        rateCodeCompanyId: r.rate_code_company_id,
        rateCodeCompanyName: r.rate_code_company_name,
        notes: r.notes,
        reservationIds: r.reservation_ids,
        openReservations: r.open_reservations,
      },
      nights: list,
      total: Math.round(list.reduce((s, n) => s + n.total, 0) * 100) / 100,
      createdAt: r.created_at,
    };
  });
}

export interface GuestReservation {
  reservationId: string;
  confirmationNumber: string;
  propertyId: string;
  propertyName: string;
  roomTypeCode: string;
  arrival: string;
  departure: string;
  status: ReservationStatus;
}

/** A guest's reservations as Primary Guest at every property of the tenant, newest first. */
export async function listGuestReservations(pool: Pool, schema: string, guestId: string): Promise<GuestReservation[]> {
  if (!isUuid(guestId)) return [];
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; confirmation_number: string; property_id: string; property_name: string; code: string; arrival: string; departure: string; status: ReservationStatus }>(
      `select r.id, b.confirmation_number, r.property_id, pr.name as property_name, t.code, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, r.status
       from reservations r join bookings b on b.id = r.booking_id join properties pr on pr.id = r.property_id join room_types t on t.id = r.room_type_id
       where r.primary_guest_id = $1 order by r.arrival desc, b.confirmation_number limit 200`,
      [guestId],
    );
    return rows.map((r) => ({ reservationId: r.id, confirmationNumber: r.confirmation_number, propertyId: r.property_id, propertyName: r.property_name, roomTypeCode: r.code, arrival: r.arrival, departure: r.departure, status: r.status }));
  });
}
