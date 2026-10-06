import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { OTP_ATTEMPTS, OTP_MINUTES, extrasOpen, isArrivalTime, isRegistrationCountry, portalLanguage, portalLinkOpen, registrationRetentionUntil, sameLastName, todayIn, type PortalLanguage } from "@hoteloftware/domain";
import { postServiceChargeIn } from "./folios";
import { loadGuest, updateGuestIn, type Guest } from "./guests";
import { fileIn, setFileRetention } from "./files";
import { queueGuestMessageIn, type PortalLinks } from "./messages";
import { amountDueIn, cardGuaranteeIn } from "./payments";
import { withTenant } from "./with-tenant";

/**
 * The Guest Portal (ticket 40): no accounts. A Portal Link per reservation,
 * and one per booking for the Booker, carries a random key; staff revoke it by
 * giving the reservation a new key. It opens until 30 days after departure.
 * Without the link: confirmation number and last name, then a one-time code
 * by email. What the guest enters goes to the Guest profile, logged as
 * entered by the guest. Guests cannot change dates or cancel here.
 */

/** Who changes data through the portal, as the change history shows it. */
export const PORTAL_USER = "guest-portal";

/** A companion as the guest entered them. */
export interface Companion {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  nationality: string | null;
}

export interface PortalProperty {
  id: string;
  name: string;
  country: string;
  timeZone: string;
  currency: string;
  /** What the hotel tells its guests, per language. */
  info: Partial<Record<PortalLanguage, string>>;
  /** Guests may upload a document picture: the property allows it and keeps registration records (DE, AT). */
  documentImages: boolean;
  /** The property's own landscape, if it set one. */
  photoFileId: string | null;
}

export interface PortalStay {
  reservationId: string;
  portalKey: string;
  confirmationNumber: string;
  status: string;
  arrival: string;
  departure: string;
  adults: number;
  childAges: number[];
  roomType: string;
  ratePlan: string;
  arrivalTime: string | null;
  precheckinAt: Date | null;
  guest: Guest;
  companions: Companion[];
  invoices: { id: string; number: string; kind: string; issueDate: string; gross: number }[];
  extras: { id: string; name: string; price: number }[];
  added: { description: string; quantity: number; amount: number }[];
  emailConsent: boolean | null;
  /** What is due now: ahead of arrival by the Payment Policy, in house the open folio balance. */
  amountDue: number;
  /** The card securing the stay (brand and last digits only). */
  guarantee: { brand: string | null; last4: string | null } | null;
}

/** What the Booker sees of each room: no guest's personal data, no room's own link. */
export interface BookingRoom {
  reservationId: string;
  status: string;
  arrival: string;
  departure: string;
  roomType: string;
  guestName: string;
  precheckinAt: Date | null;
}

export type PortalView =
  | { kind: "reservation"; property: PortalProperty; stay: PortalStay; today: string; language: PortalLanguage }
  | { kind: "booking"; property: PortalProperty; bookingKey: string; confirmationNumber: string; bookerName: string; stays: BookingRoom[]; today: string; language: PortalLanguage };

const KEY = /^[0-9a-f]{64}$/;

async function propertyOf(tx: PoolClient, propertyId: string): Promise<PortalProperty> {
  const { rows } = await tx.query("select id, name, country, time_zone, currency, portal_info, portal_document_images, portal_photo_file_id from properties where id = $1", [propertyId]);
  const p = rows[0]!;
  return {
    id: p.id,
    name: p.name,
    country: p.country,
    timeZone: p.time_zone,
    currency: p.currency.trim(),
    info: p.portal_info ?? {},
    documentImages: p.portal_document_images && isRegistrationCountry(p.country),
    photoFileId: p.portal_photo_file_id,
  };
}

/** What a Portal Link opens: the stay, or the Booker's whole booking; null when the key is unknown, revoked or past its time. */
export async function portalView(pool: Pool, schema: string, key: string): Promise<PortalView | null> {
  if (!KEY.test(key)) return null;
  return withTenant(pool, schema, async (tx) => {
    const { rows: res } = await tx.query<{ id: string; property_id: string; time_zone: string; departure: string }>(
      "select r.id, r.property_id, p.time_zone, to_char(r.departure, 'YYYY-MM-DD') as departure from reservations r join properties p on p.id = r.property_id where r.portal_key = $1",
      [key],
    );
    if (res[0]) {
      const today = todayIn(res[0].time_zone);
      if (!portalLinkOpen(res[0].departure, today)) return null;
      const stay = await stayOf(tx, res[0].id);
      return { kind: "reservation", property: await propertyOf(tx, res[0].property_id), stay, today, language: portalLanguage(null, stay.guest.language) };
    }
    const { rows: b } = await tx.query<{ id: string; property_id: string; time_zone: string; confirmation_number: string; departure: string | null; booker: string; language: string | null }>(
      `select b.id, b.property_id, p.time_zone, b.confirmation_number,
              to_char((select max(departure) from reservations r where r.booking_id = b.id and r.status <> 'cancelled'), 'YYYY-MM-DD') as departure,
              coalesce(nullif(trim(g.first_name || ' ' || g.last_name), ''), c.name, '') as booker, g.language
       from bookings b join properties p on p.id = b.property_id left join guests g on g.id = b.booker_guest_id left join companies c on c.id = b.booker_company_id where b.portal_key = $1`,
      [key],
    );
    const booking = b[0];
    if (!booking?.departure) return null;
    const today = todayIn(booking.time_zone);
    if (!portalLinkOpen(booking.departure, today)) return null;
    const { rows: rooms } = await tx.query(
      `select r.id, r.status, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, t.name as room_type,
              trim(g.first_name || ' ' || g.last_name) as guest_name, r.precheckin_at
       from reservations r join room_types t on t.id = r.room_type_id join guests g on g.id = r.primary_guest_id where r.booking_id = $1 order by r.created_at`,
      [booking.id],
    );
    const stays: BookingRoom[] = rooms.map((x) => ({ reservationId: x.id, status: x.status, arrival: x.arrival, departure: x.departure, roomType: x.room_type, guestName: x.guest_name, precheckinAt: x.precheckin_at }));
    return { kind: "booking", property: await propertyOf(tx, booking.property_id), bookingKey: key, confirmationNumber: booking.confirmation_number, bookerName: booking.booker, stays, today, language: portalLanguage(null, booking.language) };
  });
}

async function stayOf(tx: PoolClient, reservationId: string): Promise<PortalStay> {
  const { rows } = await tx.query(
    `select r.id, r.portal_key, b.confirmation_number, r.status, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, r.adults, r.child_ages,
            t.name as room_type, p.name as rate_plan, r.arrival_time, r.precheckin_at, r.primary_guest_id, r.property_id
     from reservations r join bookings b on b.id = r.booking_id join room_types t on t.id = r.room_type_id join rate_plans p on p.id = r.rate_plan_id where r.id = $1`,
    [reservationId],
  );
  const r = rows[0];
  const guest = (await loadGuest(tx, r.primary_guest_id))!;
  const { rows: comps } = await tx.query("select first_name, last_name, to_char(date_of_birth, 'YYYY-MM-DD') as dob, nationality from reservation_companions where reservation_id = $1 order by created_at", [reservationId]);
  const { rows: inv } = await tx.query("select id, number, kind, to_char(issue_date, 'YYYY-MM-DD') as issue_date, gross from invoices where reservation_id = $1 and not test order by issued_at", [reservationId]);
  const { rows: extras } = await tx.query("select id, name, default_price from services where property_id = $1 and active and bookable_online and default_price > 0 order by name", [r.property_id]);
  const { rows: added } = await tx.query("select description, quantity, amount from charges where reservation_id = $1 and posted_by = $2 and voided_at is null order by posted_at", [reservationId, PORTAL_USER]);
  const { rows: consent } = await tx.query<{ granted: boolean }>("select granted from messaging_consents where guest_id = $1 and transport = 'email' order by at desc limit 1", [r.primary_guest_id]);
  const card = await cardGuaranteeIn(tx, reservationId);
  return {
    amountDue: await amountDueIn(tx, reservationId),
    guarantee: card ? { brand: card.brand, last4: card.last4 } : null,
    reservationId: r.id,
    portalKey: r.portal_key,
    confirmationNumber: r.confirmation_number,
    status: r.status,
    arrival: r.arrival,
    departure: r.departure,
    adults: r.adults,
    childAges: r.child_ages,
    roomType: r.room_type,
    ratePlan: r.rate_plan,
    arrivalTime: r.arrival_time,
    precheckinAt: r.precheckin_at,
    guest,
    companions: comps.map((c) => ({ firstName: c.first_name, lastName: c.last_name, dateOfBirth: c.dob, nationality: c.nationality })),
    invoices: inv.map((i) => ({ id: i.id, number: i.number, kind: i.kind, issueDate: i.issue_date, gross: Number(i.gross) })),
    extras: extras.map((e) => ({ id: e.id, name: e.name, price: Number(e.default_price) })),
    added: added.map((a) => ({ description: a.description, quantity: Number(a.quantity), amount: Number(a.amount) })),
    emailConsent: consent[0]?.granted ?? null,
  };
}

export interface StayByKey {
  id: string;
  property_id: string;
  primary_guest_id: string;
  status: string;
  arrival: string;
  departure: string;
  time_zone: string;
  country: string;
  business_date: string;
  express_checkout_auto: boolean;
}

/** The stay a Portal Link opens, while the link is open; locked for a change with `lock`. */
export async function reservationByKey(tx: PoolClient, key: string, opts: { lock?: boolean } = {}): Promise<StayByKey> {
  if (!KEY.test(key)) throw new Error("This link does not open anything");
  const { rows } = await tx.query<StayByKey>(
    `select r.id, r.property_id, r.primary_guest_id, r.status, to_char(r.arrival, 'YYYY-MM-DD') as arrival, to_char(r.departure, 'YYYY-MM-DD') as departure, p.time_zone, p.country,
            to_char(coalesce(p.business_date, (now() at time zone p.time_zone)::date), 'YYYY-MM-DD') as business_date, p.express_checkout_auto
     from reservations r join properties p on p.id = r.property_id where r.portal_key = $1 ${opts.lock ? "for update of r" : ""}`,
    [key],
  );
  const r = rows[0];
  if (!r || !portalLinkOpen(r.departure, todayIn(r.time_zone))) throw new Error("This link does not open anything");
  return r;
}

export interface PrecheckinInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  nationality: string | null;
  countryOfResidence: string | null;
  addressLine1: string;
  postalCode: string;
  city: string;
  phone: string;
  documentType: "passport" | "id_card" | "driving_licence" | "other" | null;
  documentNumber: string;
  documentCountry: string | null;
  documentExpiry: string | null;
  arrivalTime: string | null;
  companions: Companion[];
  /** Messaging Consent for email, with the wording shown (the server's own text, not the form's). */
  emailConsent: { granted: boolean; wording: string } | null;
}

export const MAX_COMPANIONS = 10;

/** Pre-check-in: the guest's and companions' details, address, arrival time, document fields, consent; written to the profile as entered by the guest. */
export async function savePrecheckin(pool: Pool, schema: string, key: string, input: PrecheckinInput): Promise<void> {
  if (input.arrivalTime && !isArrivalTime(input.arrivalTime)) throw new Error("Give the arrival time as HH:MM");
  if (!input.lastName.trim()) throw new Error("Your last name is needed");
  if (input.companions.length > MAX_COMPANIONS || input.companions.some((c) => !c.lastName.trim())) throw new Error("Each companion needs a last name");
  await withTenant(pool, schema, async (tx) => {
    const r = await reservationByKey(tx, key, { lock: true });
    if (r.status !== "confirmed") throw new Error("This stay cannot be changed here any more; reception will help you");
    // what the guest gave; an empty field keeps what is stored (staff's data is never blanked from here)
    const given = Object.fromEntries(
      Object.entries({
        firstName: input.firstName,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        nationality: input.nationality,
        countryOfResidence: input.countryOfResidence,
        addressLine1: input.addressLine1,
        postalCode: input.postalCode,
        city: input.city,
        phone: input.phone,
        documentType: input.documentType,
        documentNumber: input.documentNumber,
        documentCountry: input.documentCountry,
        documentExpiry: input.documentExpiry,
      }).filter(([, v]) => v !== null && String(v).trim() !== ""),
    );
    await updateGuestIn(tx, r.primary_guest_id, given, { userId: PORTAL_USER });
    await tx.query("delete from reservation_companions where reservation_id = $1", [r.id]);
    for (const c of input.companions) {
      await tx.query("insert into reservation_companions (reservation_id, first_name, last_name, date_of_birth, nationality, created_by) values ($1, $2, $3, $4, $5, $6)", [
        r.id,
        c.firstName.trim().slice(0, 80),
        c.lastName.trim().slice(0, 80),
        c.dateOfBirth || null,
        c.nationality || null,
        PORTAL_USER,
      ]);
    }
    if (input.emailConsent) {
      // recorded when it changes, with time, source and the wording shown
      const last = (await tx.query<{ granted: boolean }>("select granted from messaging_consents where guest_id = $1 and transport = 'email' order by at desc limit 1", [r.primary_guest_id])).rows[0];
      if (last?.granted !== input.emailConsent.granted) {
        await tx.query("insert into messaging_consents (guest_id, transport, granted, source, wording) values ($1, 'email', $2, 'guest portal', $3)", [r.primary_guest_id, input.emailConsent.granted, input.emailConsent.wording.slice(0, 1000)]);
      }
    }
    await tx.query("update reservations set arrival_time = $2, precheckin_at = now() where id = $1", [r.id, input.arrivalTime || null]);
  });
}

/** An extra from the catalogue, until the arrival day: a Charge on the stay, on its arrival date. */
export async function addPortalExtra(pool: Pool, schema: string, key: string, serviceId: string, quantity: number): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) throw new Error("Choose 1 to 10");
  await withTenant(pool, schema, async (tx) => {
    const r = await reservationByKey(tx, key, { lock: true });
    if (!extrasOpen(r.status, r.arrival, todayIn(r.time_zone))) throw new Error("Extras can be added until the arrival day");
    const ok = (await tx.query("select 1 from services where id = $1 and property_id = $2 and active and bookable_online", [serviceId, r.property_id])).rows.length;
    if (!ok) throw new Error("This extra is not offered");
    await postServiceChargeIn(tx, r.id, { serviceId, quantity, serviceDate: r.arrival }, PORTAL_USER);
  });
}

/** An invoice of the guest's own stay (or of a stay of the Booker's booking). */
export async function portalInvoice(pool: Pool, schema: string, key: string, invoiceId: string): Promise<boolean> {
  if (!KEY.test(key) || !/^[0-9a-f-]{36}$/.test(invoiceId)) return false;
  return withTenant(pool, schema, async (tx) => {
    // the stay's own invoices, or (the Booker pays for all) every room's; the link still open
    const { rows } = await tx.query<{ departure: string; time_zone: string }>(
      `select to_char(case when r.portal_key = $2 then r.departure else (select max(x.departure) from reservations x where x.booking_id = b.id and x.status <> 'cancelled') end, 'YYYY-MM-DD') as departure, p.time_zone
       from invoices i join reservations r on r.id = i.reservation_id join bookings b on b.id = r.booking_id join properties p on p.id = r.property_id
       where i.id = $1 and not i.test and (r.portal_key = $2 or b.portal_key = $2)`,
      [invoiceId, key],
    );
    return !!rows[0]?.departure && portalLinkOpen(rows[0].departure, todayIn(rows[0].time_zone));
  });
}

/** Staff revoke a link: the stay's, or the Booker's of the whole booking. A new key; the old link opens nothing. The new key. */
export async function revokePortalLink(pool: Pool, schema: string, reservationId: string, which: "stay" | "booking" = "stay"): Promise<string> {
  const fresh = "replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')";
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ portal_key: string }>(
      which === "stay"
        ? `update reservations set portal_key = ${fresh} where id = $1 returning portal_key`
        : `update bookings set portal_key = ${fresh} where id = (select booking_id from reservations where id = $1) returning portal_key`,
      [reservationId],
    );
    if (!rows[0]) throw new Error("Reservation not found");
    return rows[0].portal_key;
  });
}

/** The keys staff copy from the reservation: the stay's, and the booking's for the Booker. */
export async function portalKeys(pool: Pool, schema: string, reservationId: string): Promise<{ reservation: string; booking: string } | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ r: string; b: string }>("select r.portal_key as r, b.portal_key as b from reservations r join bookings b on b.id = r.booking_id where r.id = $1", [reservationId]);
    return rows[0] ? { reservation: rows[0].r, booking: rows[0].b } : null;
  });
}

const hashCode = (reservationId: string, code: string) => createHash("sha256").update(`${reservationId}:${code}`).digest("hex");
const CODES_PER_HOUR = 5;

/**
 * Confirmation number and last name: a one-time code to the guest's email.
 * The answer is the same whether or not anything matched (no guessing of
 * bookings); at most five codes an hour per stay.
 */
export async function requestPortalCode(pool: Pool, schema: string, input: { confirmationNumber: string; lastName: string }, links: PortalLinks): Promise<void> {
  const number = input.confirmationNumber.trim();
  if (!/^[0-9A-Za-z-]{3,20}$/.test(number)) return;
  await withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; last_name: string; email: string | null; departure: string; time_zone: string; booker: boolean; booker_last: string | null; booker_email: string | null }>(
      `select r.id, g.last_name, nullif(trim(g.email), '') as email, to_char(r.departure, 'YYYY-MM-DD') as departure, p.time_zone,
              b.booker_guest_id = r.primary_guest_id as booker, bg.last_name as booker_last, nullif(trim(bg.email), '') as booker_email
       from bookings b join reservations r on r.booking_id = b.id join guests g on g.id = r.primary_guest_id join properties p on p.id = r.property_id
       left join guests bg on bg.id = b.booker_guest_id
       where b.confirmation_number = $1 order by r.created_at`,
      [number],
    );
    const open = rows.filter((x) => portalLinkOpen(x.departure, todayIn(x.time_zone)));
    // a room's guest opens their stay; the Booker (of a booking with more rooms, or not staying) the whole booking
    const room = open.find((x) => sameLastName(x.last_name, input.lastName) && x.email && !(x.booker && open.length > 1));
    const booker = !room && open[0]?.booker_email && sameLastName(open[0].booker_last ?? "", input.lastName) ? open[0] : null;
    const target = room ?? booker;
    if (!target) return;
    const recent = (await tx.query<{ n: number }>("select count(*)::int as n from portal_codes where reservation_id = $1 and created_at > now() - interval '1 hour'", [target.id])).rows[0]!.n;
    if (recent >= CODES_PER_HOUR) return;
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await tx.query("insert into portal_codes (reservation_id, code_hash, expires_at, for_booking) values ($1, $2, now() + make_interval(mins => $3), $4)", [target.id, hashCode(target.id, code), OTP_MINUTES, !room]);
    await queueGuestMessageIn(tx, { reservationId: target.id, type: "portal_code", triggerKey: `code:${Date.now()}`, now: new Date(), links, code, ...(room ? {} : { toEmail: target.booker_email! }) });
  });
}

/** The code checked: the stay's (or the Booker's booking) Portal Link key, or null (wrong, used, expired or too many tries). */
export async function verifyPortalCode(pool: Pool, schema: string, input: { confirmationNumber: string; lastName: string; code: string }): Promise<string | null> {
  if (!/^\d{6}$/.test(input.code.trim())) return null;
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; last_name: string; booker_last: string | null; portal_key: string; booking_key: string; code_id: string; for_booking: boolean }>(
      `select r.id, g.last_name, bg.last_name as booker_last, r.portal_key, b.portal_key as booking_key, c.id as code_id, c.for_booking
       from bookings b join reservations r on r.booking_id = b.id join guests g on g.id = r.primary_guest_id left join guests bg on bg.id = b.booker_guest_id
       join lateral (select * from portal_codes pc where pc.reservation_id = r.id and pc.used_at is null and pc.expires_at > now() order by pc.created_at desc limit 1) c on true
       where b.confirmation_number = $1`,
      [input.confirmationNumber.trim()],
    );
    const r = rows.find((x) => sameLastName(x.for_booking ? (x.booker_last ?? "") : x.last_name, input.lastName));
    if (!r) return null;
    // the try is counted before the comparison, in one statement: parallel guesses cannot pass the limit
    const counted = (await tx.query<{ code_hash: string }>("update portal_codes set attempts = attempts + 1 where id = $1 and attempts < $2 and used_at is null returning code_hash", [r.code_id, OTP_ATTEMPTS])).rows[0];
    if (!counted) return null;
    const given = Buffer.from(hashCode(r.id, input.code.trim()));
    const expected = Buffer.from(counted.code_hash);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const used = await tx.query("update portal_codes set used_at = now() where id = $1 and used_at is null", [r.code_id]);
    if (!used.rowCount) return null;
    return r.for_booking ? r.booking_key : r.portal_key;
  });
}

const INVITES_PER_DAY = 3;

/**
 * The Booker invites a room's guest. A guest known to the hotel with an
 * address gets it there (the Booker never redirects someone else's stay); a
 * room still in the Booker's own name, or a guest without an address, gets a
 * profile of their own with the address given, so the invited person never
 * sees or overwrites the Booker's data. Three invitations a day per room.
 */
export async function invitePortalGuest(pool: Pool, schema: string, bookingKey: string, reservationId: string, email: string, links: PortalLinks): Promise<void> {
  const to = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Enter an email address");
  if (!KEY.test(bookingKey)) throw new Error("This link does not open anything");
  await withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ id: string; property_id: string; email: string | null; booker: boolean }>(
      `select r.id, r.property_id, nullif(trim(g.email), '') as email, b.booker_guest_id = r.primary_guest_id as booker
       from reservations r join bookings b on b.id = r.booking_id join guests g on g.id = r.primary_guest_id where b.portal_key = $1 and r.id = $2 and r.status = 'confirmed' for update of r`,
      [bookingKey, reservationId],
    );
    const room = rows[0];
    if (!room) throw new Error("This room cannot be shared any more");
    const sent = (await tx.query<{ n: number }>("select count(*)::int as n from guest_messages where reservation_id = $1 and type = 'portal_invitation' and created_at > now() - interval '1 day'", [room.id])).rows[0]!.n;
    if (sent >= INVITES_PER_DAY) throw new Error("This room was shared often enough today");
    let recipient = room.email;
    if (room.booker || !room.email) {
      const { rows: g } = await tx.query<{ id: string }>("insert into guests (first_name, last_name, email, email_normalised, created_by, created_property_id) values ('', 'Guest', $1, $1, $2, $3) returning id", [to, PORTAL_USER, room.property_id]);
      await tx.query("update reservations set primary_guest_id = $2 where id = $1", [room.id, g[0]!.id]);
      recipient = to;
    }
    await queueGuestMessageIn(tx, { reservationId: room.id, type: "portal_invitation", triggerKey: `invite:${Date.now()}`, userId: PORTAL_USER, now: new Date(), links, toEmail: recipient! });
  });
}


/** A picture of the guest's document (where the property allows it), kept as long as a registration form would be. */
const DOCUMENTS_PER_STAY = 5;

export async function addPortalDocument(pool: Pool, schema: string, key: string, fileId: string): Promise<void> {
  await withTenant(pool, schema, async (tx) => {
    const r = await reservationByKey(tx, key, { lock: true });
    const p = await propertyOf(tx, r.property_id);
    if (!p.documentImages || !isRegistrationCountry(r.country)) throw new Error("This hotel takes documents at reception");
    const n = (await tx.query<{ n: number }>("select count(*)::int as n from reservation_documents where reservation_id = $1", [r.id])).rows[0]!.n;
    if (n >= DOCUMENTS_PER_STAY) throw new Error("Enough pictures for this stay");
    const f = await fileIn(tx, fileId);
    if (!f || f.kind !== "id_document" || f.createdBy !== `${PORTAL_USER}:${r.id}`) throw new Error("Picture not found");
    await tx.query("insert into reservation_documents (reservation_id, guest_id, file_id) values ($1, $2, $3)", [r.id, r.primary_guest_id, f.id]);
    await setFileRetention(tx, [f.id], registrationRetentionUntil(r.country as "DE" | "AT", r.departure));
  });
}

/** What the hotel tells guests in the portal (per language) and whether guests may upload a document picture. */
export async function portalSettings(pool: Pool, schema: string, propertyId: string): Promise<{ info: Partial<Record<PortalLanguage, string>>; documentImages: boolean; expressCheckoutAuto: boolean }> {
  return withTenant(pool, schema, async (tx) => {
    const p = await propertyOf(tx, propertyId);
    const auto = (await tx.query<{ a: boolean }>("select express_checkout_auto as a from properties where id = $1", [propertyId])).rows[0]!.a;
    return { info: p.info, documentImages: p.documentImages, expressCheckoutAuto: auto };
  });
}

export async function setPortalSettings(pool: Pool, schema: string, propertyId: string, input: { info: Partial<Record<PortalLanguage, string>>; documentImages: boolean; expressCheckoutAuto?: boolean; photoFileId?: string | null | undefined }): Promise<void> {
  const info = Object.fromEntries(Object.entries(input.info).map(([k, v]) => [k, (v ?? "").trim().slice(0, 4000)]).filter(([, v]) => v));
  await withTenant(pool, schema, async (tx) => {
    await tx.query("update properties set portal_info = $2, portal_document_images = $3, express_checkout_auto = coalesce($4, express_checkout_auto), updated_at = now() where id = $1", [propertyId, JSON.stringify(info), input.documentImages, input.expressCheckoutAuto ?? null]);
    if (input.photoFileId !== undefined) {
      const f = input.photoFileId ? await fileIn(tx, input.photoFileId) : null;
      if (input.photoFileId && (!f || f.kind !== "portal_photo")) throw new Error("Photo not found");
      await tx.query("update properties set portal_photo_file_id = $2 where id = $1", [propertyId, input.photoFileId]);
      // kept while it is the portal's photo
      if (f) await setFileRetention(tx, [f.id], null);
    }
  });
}

export interface PortalSummary {
  keys: { reservation: string; booking: string };
  precheckinAt: Date | null;
  arrivalTime: string | null;
  companions: Companion[];
  documents: string[];
  emailConsent: { granted: boolean; at: Date } | null;
  /** The guest asked for express checkout (the desk checks out). */
  expressCheckoutAt: Date | null;
}

/** What staff see of the portal on the reservation: the links, Pre-check-in, companions, document pictures, consent. */
export async function portalSummary(pool: Pool, schema: string, reservationId: string): Promise<PortalSummary | null> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(
      `select r.portal_key, b.portal_key as booking_key, r.precheckin_at, r.arrival_time, r.primary_guest_id, r.express_checkout_at
       from reservations r join bookings b on b.id = r.booking_id where r.id = $1`,
      [reservationId],
    );
    const r = rows[0];
    if (!r) return null;
    const { rows: comps } = await tx.query("select first_name, last_name, to_char(date_of_birth, 'YYYY-MM-DD') as dob, nationality from reservation_companions where reservation_id = $1 order by created_at", [reservationId]);
    const { rows: docs } = await tx.query<{ file_id: string }>("select file_id from reservation_documents where reservation_id = $1 order by created_at", [reservationId]);
    const { rows: consent } = await tx.query<{ granted: boolean; at: Date }>("select granted, at from messaging_consents where guest_id = $1 and transport = 'email' order by at desc limit 1", [r.primary_guest_id]);
    return {
      keys: { reservation: r.portal_key, booking: r.booking_key },
      precheckinAt: r.precheckin_at,
      arrivalTime: r.arrival_time,
      companions: comps.map((c) => ({ firstName: c.first_name, lastName: c.last_name, dateOfBirth: c.dob, nationality: c.nationality })),
      documents: docs.map((d) => d.file_id),
      emailConsent: consent[0] ?? null,
      expressCheckoutAt: r.express_checkout_at,
    };
  });
}

/** The property's portal photo, by any open link of it (the guest side has no sign-in). */
export async function portalPhoto(pool: Pool, schema: string, key: string): Promise<{ key: string; contentType: string } | null> {
  const view = await portalView(pool, schema, key);
  if (!view?.property.photoFileId) return null;
  return withTenant(pool, schema, async (tx) => {
    const f = await fileIn(tx, view.property.photoFileId!);
    return f ? { key: f.key, contentType: f.contentType } : null;
  });
}
