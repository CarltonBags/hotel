/**
 * Price and bookability of one stay on one room type and rate plan
 * ("Reservation and inventory domain model", "Rates and restrictions model").
 * The New reservation screen shows this quote and the save stores it, so the
 * prices a reservation keeps are the prices the user saw.
 */
import { roundMoney } from "./money";
import { addDays } from "./rates-grid";
import { occupancyPrice, type AgeBandRef, type Restriction, type Supplement } from "./rates";

export interface QuoteInput {
  arrival: string;
  departure: string;
  adults: number;
  childAges: number[];
  roomType: { maxAdults: number; maxOccupancy: number };
  plan: {
    baseOccupancy: number;
    supplements: Supplement[];
    /** Fixed gross component per person and night; the room receives the remainder. */
    includedServices: { serviceId: string; componentPrice: number }[];
  };
  ageBands: AgeBandRef[];
  /** Stored Rate of the plan and room type for a night, or null. */
  rate(date: string): number | null;
  /** Restriction in effect (derived plans: inherited fields from the base) for a date. */
  restriction(date: string): Restriction;
  /** Rooms of the room type still free on a night. */
  available(date: string): number;
}

export type QuoteReason =
  | "no_adult"
  | "too_many_adults"
  | "too_many_persons"
  | "sold_out"
  | "no_price"
  | "stop_sell"
  | "closed_to_arrival"
  | "closed_to_departure"
  | "min_stay"
  | "max_stay"
  | "components_exceed_price";

export interface PriceComponent {
  kind: "room" | "service";
  serviceId: string | null;
  persons: number | null;
  unitPrice: number;
  amount: number;
}

export interface QuotedNight {
  date: string;
  total: number;
  components: PriceComponent[];
}

export interface StayQuote {
  bookable: boolean;
  reasons: QuoteReason[];
  /** Fewest free rooms over the nights. */
  available: number;
  nights: QuotedNight[];
  total: number;
}

const MAX_NIGHTS = 365;

/** The nights of a stay: arrival up to the night before departure. */
export function nightsOf(arrival: string, departure: string): string[] {
  if (departure <= arrival) throw new Error("Departure must be after arrival");
  const out: string[] = [];
  for (let d = arrival; d < departure; d = addDays(d, 1)) {
    out.push(d);
    if (out.length > MAX_NIGHTS) throw new Error(`At most ${MAX_NIGHTS} nights`);
  }
  return out;
}

/** Adults for occupancy: a child whose age fits no Age Band counts as an adult (as in occupancyPrice). */
function effectiveAdults(adults: number, childAges: number[], bands: AgeBandRef[]): { adults: number; children: number } {
  const banded = childAges.filter((age) => bands.some((b) => age >= b.minAge && (b.maxAge === null || age <= b.maxAge)));
  return { adults: adults + (childAges.length - banded.length), children: banded.length };
}

export function quoteStay(input: QuoteInput): StayQuote {
  const nights = nightsOf(input.arrival, input.departure);
  const reasons = new Set<QuoteReason>();
  const occ = effectiveAdults(input.adults, input.childAges, input.ageBands);
  const persons = input.adults + input.childAges.length;
  if (input.adults < 1) reasons.add("no_adult");
  if (occ.adults > input.roomType.maxAdults) reasons.add("too_many_adults");
  if (persons > input.roomType.maxOccupancy) reasons.add("too_many_persons");

  const available = Math.min(...nights.map((d) => input.available(d)));
  if (available <= 0) reasons.add("sold_out");

  const first = input.restriction(input.arrival);
  if (first.closedToArrival) reasons.add("closed_to_arrival");
  if (input.restriction(input.departure).closedToDeparture) reasons.add("closed_to_departure");
  if (first.minStayArrival !== null && nights.length < first.minStayArrival) reasons.add("min_stay");
  if (first.maxStay !== null && nights.length > first.maxStay) reasons.add("max_stay");

  const quoted: QuotedNight[] = [];
  for (const date of nights) {
    const r = input.restriction(date);
    if (r.stopSell) reasons.add("stop_sell");
    if (r.minStayThrough !== null && nights.length < r.minStayThrough) reasons.add("min_stay");
    const rate = input.rate(date);
    if (rate === null) {
      reasons.add("no_price");
      continue;
    }
    const total = occupancyPrice({ rate, baseOccupancy: input.plan.baseOccupancy, supplements: input.plan.supplements }, { adults: input.adults, childAges: input.childAges }, input.ageBands);
    const services: PriceComponent[] = input.plan.includedServices.map((s) => ({
      kind: "service",
      serviceId: s.serviceId,
      persons,
      unitPrice: s.componentPrice,
      amount: roundMoney(s.componentPrice * persons),
    }));
    const room = roundMoney(total - services.reduce((sum, s) => sum + s.amount, 0));
    if (room < 0) reasons.add("components_exceed_price");
    quoted.push({ date, total, components: [{ kind: "room", serviceId: null, persons: null, unitPrice: room, amount: room }, ...services] });
  }
  const list = [...reasons];
  return { bookable: list.length === 0, reasons: list, available, nights: quoted, total: roundMoney(quoted.reduce((s, n) => s + n.total, 0)) };
}
