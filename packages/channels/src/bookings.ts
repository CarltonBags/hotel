/**
 * Booking revisions from the channel manager (ticket 38): each new,
 * modified or cancelled booking from a booking site or the hotel's website
 * tool arrives as a revision; we take the unacknowledged ones from the feed,
 * apply them, then acknowledge. Card numbers never come to us: only whether
 * the booking site collects, or pays with a virtual card, and when that card
 * can be charged.
 */
export interface ChannelGuest {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  language: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
}

export interface ChannelRoom {
  /** The booking site's id of the room within the booking; matches a room over revisions. */
  key: string;
  roomTypeId: string;
  ratePlanId: string;
  arrival: string;
  departure: string;
  adults: number;
  childAges: number[];
  /** Children the channel sent without an age: counted as adults, so the City Tax assumes they are taxable. */
  childrenWithoutAge: number;
  /** What the channel says its prices contain; null where it says nothing (the property's setting for the channel applies). */
  includesVat: boolean | null;
  includesCityTax: boolean | null;
  /** Price per night as the channel sent it. */
  nights: { date: string; price: number }[];
  guestName: { firstName: string; lastName: string } | null;
}

export interface ChannelBookingRevision {
  id: string;
  bookingId: string;
  propertyId: string;
  status: "new" | "modified" | "cancelled";
  /** The booking site or tool, e.g. "Booking.com". */
  channel: string;
  /** The booking site's own booking number. */
  channelCode: string;
  currency: string;
  customer: ChannelGuest;
  rooms: ChannelRoom[];
  notes: string;
  /** Who takes the guest's money: the hotel, or the booking site (then perhaps with a virtual card). */
  collect: "property" | "channel";
  /** A booking site's virtual card: from when it can be charged, until when, how much. */
  virtualCard: { activationDate: string | null; expiryDate: string | null; amount: number | null } | null;
  /**
   * A card the channel manager tokenised into the hotel's payment provider
   * (Stripe Tokenization App): its token and last digits only, never the number.
   */
  cardToken: { token: string; brand: string | null; last4: string | null } | null;
  /** When the channel manager received it; later revisions of a booking have later times. */
  receivedAt: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const day = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** A Channex booking revision (`data` of the feed or of one revision) in our terms; null when it lacks what we need. */
export function parseChannexRevision(raw: unknown): ChannelBookingRevision | null {
  const r = raw as { id?: unknown; attributes?: Record<string, unknown> } | null;
  const a = r?.attributes;
  if (!r || !a) return null;
  const id = str(r.id) ?? str(a.id);
  const status = a.status === "new" || a.status === "modified" || a.status === "cancelled" ? a.status : null;
  const bookingId = str(a.booking_id);
  const propertyId = str(a.property_id);
  if (!id || !status || !bookingId || !propertyId) return null;
  const c = (a.customer ?? {}) as Record<string, unknown>;
  const rooms = (Array.isArray(a.rooms) ? a.rooms : []).map((x: Record<string, unknown>, i: number): ChannelRoom | null => {
    const occupancy = (x.occupancy ?? {}) as Record<string, unknown>;
    const days = (x.days ?? {}) as Record<string, unknown>;
    const arrival = day(x.checkin_date) ?? day(a.arrival_date);
    const departure = day(x.checkout_date) ?? day(a.departure_date);
    const roomTypeId = str(x.room_type_id);
    const ratePlanId = str(x.rate_plan_id);
    if (!arrival || !departure || !roomTypeId || !ratePlanId) return null;
    const ages = Array.isArray(occupancy.ages) ? occupancy.ages.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 18) : [];
    const children = num(occupancy.children) ?? 0;
    const taxes = Array.isArray(x.taxes) ? (x.taxes as Record<string, unknown>[]) : [];
    const inclusive = (kind: RegExp) => {
      const t = taxes.find((t) => kind.test(String(t.type ?? t.name ?? "")));
      return t && typeof t.is_inclusive === "boolean" ? t.is_inclusive : null;
    };
    const guest = Array.isArray(x.guests) && x.guests[0] ? (x.guests[0] as Record<string, unknown>) : null;
    return {
      key: str(x.booking_room_id) ?? str(x.ota_unique_id) ?? String(i + 1),
      roomTypeId,
      ratePlanId,
      arrival,
      departure,
      adults: Math.max(1, num(occupancy.adults) ?? 1) + Math.max(0, children - ages.length),
      childAges: ages,
      childrenWithoutAge: Math.max(0, children - ages.length),
      includesVat: inclusive(/vat|mwst|ust/i),
      includesCityTax: inclusive(/city|tourist|ortstaxe|kurtaxe|übernachtung/i),
      nights: Object.entries(days)
        .map(([date, price]) => ({ date: date.slice(0, 10), price: num(price) ?? 0 }))
        .sort((p, q) => (p.date < q.date ? -1 : 1)),
      guestName: guest && (str(guest.name) || str(guest.surname)) ? { firstName: str(guest.name) ?? "", lastName: str(guest.surname) ?? str(guest.name) ?? "" } : null,
    };
  });
  if (status !== "cancelled" && (!rooms.length || rooms.some((x) => x === null))) return null;
  const guarantee = (a.guarantee ?? {}) as Record<string, unknown>;
  const meta = (a.meta ?? {}) as Record<string, unknown>;
  const virtual = guarantee.is_virtual === true || meta.virtual_card === true || str(meta.virtual_card_effective_date) !== null;
  return {
    id,
    bookingId,
    propertyId,
    status,
    channel: str(a.ota_name) ?? "Channel",
    channelCode: str(a.ota_reservation_code) ?? bookingId,
    currency: str(a.currency) ?? "EUR",
    customer: {
      firstName: str(c.name) ?? "",
      lastName: str(c.surname) ?? str(c.name) ?? "Guest",
      email: str(c.mail),
      phone: str(c.phone),
      country: str(c.country)?.slice(0, 2).toUpperCase() ?? null,
      language: str(c.language)?.slice(0, 2).toLowerCase() ?? null,
      address: str(c.address),
      city: str(c.city),
      postalCode: str(c.zip),
    },
    rooms: rooms.filter((x): x is ChannelRoom => x !== null),
    notes: str(a.notes) ?? "",
    collect: a.payment_collect === "ota" ? "channel" : "property",
    virtualCard: virtual
      ? { activationDate: day(meta.virtual_card_effective_date) ?? day(guarantee.effective_date), expiryDate: day(meta.virtual_card_expiration_date) ?? day(guarantee.expiration_date), amount: num(meta.virtual_card_current_balance) ?? num(guarantee.amount) }
      : null,
    // only a token and the last digits; a full card number is never read
    cardToken: str(guarantee.token)
      ? { token: str(guarantee.token)!, brand: str(guarantee.card_type), last4: (str(guarantee.card_number) ?? "").replace(/\D/g, "").slice(-4) || null }
      : null,
    receivedAt: str(a.inserted_at) ?? new Date(0).toISOString(),
  };
}
