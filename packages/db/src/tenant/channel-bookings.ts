import type { Pool, PoolClient } from "pg";
import { addDays, channelNight, normaliseEmail, normalisePhone } from "@hoteloftware/domain";
import type { ChannelBookingRevision, ChannelManager, ChannelRoom } from "@hoteloftware/channels";
import { cityTaxOfNight } from "./city-tax";
import { openFolios } from "./folios";
import { syncHousekeepingTasks } from "./housekeeping";
import { assertDepositInvoiceable, depositIn } from "./invoices";
import { lockProperty } from "./property-lock";
import { cancelForChannelIn, logReservationChange } from "./reservation-changes";
import { loadQuoteData, writeNights } from "./reservations";
import { rateOn } from "./tax-rate";
import { withTenant } from "./with-tenant";

/**
 * Channel bookings inbound (ticket 38). Each revision from the channel
 * manager is applied once: a newer revision of a booking updates it, an older
 * one is ignored, a replay changes nothing. New bookings become a Booking with
 * Source Channel and the channel's name, Reservations with the channel's
 * nightly prices made ours (City Tax split out first, VAT added for net
 * channels, included Services at their own price), the guests, the channel's
 * notes and who collects the money. A booking site has sold the room already:
 * a channel booking is never refused for lack of rooms; it is kept, flagged
 * overbooked and listed for staff.
 */

/** Who books from the channel manager. */
export const CHANNEL_USER = "channel";

export interface ChannelSetting {
  channel: string;
  pricesIncludeVat: boolean;
  pricesIncludeCityTax: boolean;
  sendConfirmation: boolean;
  paidViaTool: boolean;
}

const DEFAULT_SETTING = (channel: string): ChannelSetting => ({ channel, pricesIncludeVat: true, pricesIncludeCityTax: false, sendConfirmation: true, paidViaTool: false });
const fromRow = (r: { channel: string; prices_include_vat: boolean; prices_include_city_tax: boolean; send_confirmation: boolean; paid_via_tool: boolean }): ChannelSetting => ({
  channel: r.channel,
  pricesIncludeVat: r.prices_include_vat,
  pricesIncludeCityTax: r.prices_include_city_tax,
  sendConfirmation: r.send_confirmation,
  paidViaTool: r.paid_via_tool,
});

async function settingIn(tx: PoolClient, propertyId: string, channel: string): Promise<ChannelSetting> {
  const { rows } = await tx.query("select channel, prices_include_vat, prices_include_city_tax, send_confirmation, paid_via_tool from channel_settings where property_id = $1 and channel = $2", [propertyId, channel]);
  return rows[0] ? fromRow(rows[0]) : DEFAULT_SETTING(channel);
}

/** The settings of every channel the property has set up or received bookings from (defaults where none is set). */
export async function channelSettings(pool: Pool, schema: string, propertyId: string): Promise<ChannelSetting[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(
      `select n.channel, coalesce(s.prices_include_vat, true) as prices_include_vat, coalesce(s.prices_include_city_tax, false) as prices_include_city_tax,
              coalesce(s.send_confirmation, true) as send_confirmation, coalesce(s.paid_via_tool, false) as paid_via_tool
       from (select channel from channel_settings where property_id = $1 union select channel from channel_bookings where property_id = $1) n
       left join channel_settings s on s.property_id = $1 and s.channel = n.channel
       order by n.channel`,
      [propertyId],
    );
    return rows.map(fromRow);
  });
}

export async function setChannelSetting(pool: Pool, schema: string, propertyId: string, s: ChannelSetting, userId: string): Promise<void> {
  const channel = s.channel.trim().slice(0, 80);
  if (!channel) throw new Error("Name the channel");
  await withTenant(pool, schema, (tx) =>
    tx.query(
      `insert into channel_settings (property_id, channel, prices_include_vat, prices_include_city_tax, send_confirmation, paid_via_tool, updated_by) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (property_id, channel) do update set prices_include_vat = $3, prices_include_city_tax = $4, send_confirmation = $5, paid_via_tool = $6, updated_at = now(), updated_by = $7`,
      [propertyId, channel, s.pricesIncludeVat, s.pricesIncludeCityTax, s.sendConfirmation, s.paidViaTool, userId],
    ),
  );
}

/** Google's free booking links: the property's wish; our support switches it on at the channel manager. Whether it changed. */
export async function setGoogleChannel(pool: Pool, schema: string, propertyId: string, on: boolean): Promise<boolean> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query<{ was: boolean }>("select google as was from channel_connections where property_id = $1 and external_id is not null for update", [propertyId]);
    if (!rows[0]) throw new Error("Connect the property to the channel manager first");
    await tx.query("update channel_connections set google = $2 where property_id = $1", [propertyId, on]);
    return rows[0].was !== on;
  });
}

export type RevisionOutcome = "applied" | "stale" | "refused" | "conflict" | "duplicate";

export interface AppliedRevision {
  outcome: RevisionOutcome;
  message: string;
  bookingId: string | null;
}

interface MappedRoom extends ChannelRoom {
  ourRoomTypeId: string;
  ourRatePlanId: string;
}

/** Apply one revision, once. */
export async function applyChannelRevision(pool: Pool, schema: string, propertyId: string, rev: ChannelBookingRevision, options: { acceptsReservations: boolean } = { acceptsReservations: true }): Promise<AppliedRevision> {
  return withTenant(pool, schema, async (tx) => {
    await lockProperty(tx, propertyId);
    if ((await tx.query("select 1 from channel_booking_revisions where id = $1", [rev.id])).rows.length) return { outcome: "duplicate", message: "", bookingId: null };
    const result = await applyIn(tx, propertyId, rev, options);
    await recordRevision(tx, propertyId, { id: rev.id, bookingId: rev.bookingId, status: rev.status, channel: rev.channel, receivedAt: rev.receivedAt }, result);
    if (result.outcome !== "stale" && result.bookingId) {
      await tx.query(
        `insert into channel_bookings (external_id, property_id, booking_id, channel, channel_code, last_revision_id, last_revision_at, status) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (external_id) do update set last_revision_id = $6, last_revision_at = $7, status = $8`,
        [rev.bookingId, propertyId, result.bookingId, rev.channel, rev.channelCode, rev.id, rev.receivedAt, rev.status],
      );
      await syncHousekeepingTasks(tx, propertyId, CHANNEL_USER);
    }
    return result;
  });
}

async function recordRevision(tx: PoolClient, propertyId: string, rev: { id: string; bookingId: string; status: string; channel: string; receivedAt: string }, result: { outcome: RevisionOutcome; message: string }): Promise<void> {
  await tx.query(
    "insert into channel_booking_revisions (id, property_id, external_booking_id, status, channel, received_at, outcome, message) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing",
    [rev.id, propertyId, rev.bookingId, rev.status, rev.channel, rev.receivedAt, result.outcome, result.message.slice(0, 1000)],
  );
}

async function applyIn(tx: PoolClient, propertyId: string, rev: ChannelBookingRevision, options: { acceptsReservations: boolean }): Promise<AppliedRevision> {
  const existing = (await tx.query<{ booking_id: string; last_revision_at: Date }>("select booking_id, last_revision_at from channel_bookings where external_id = $1 and property_id = $2", [rev.bookingId, propertyId])).rows[0];
  if (existing && existing.last_revision_at.getTime() > new Date(rev.receivedAt).getTime()) return { outcome: "stale", message: "An older revision than the one applied", bookingId: existing.booking_id };
  if (rev.status === "cancelled") {
    if (!existing) return { outcome: "refused", message: `Cancellation of ${rev.channel} ${rev.channelCode}: the booking is not here`, bookingId: null };
    const problems = await cancelRooms(tx, existing.booking_id, null);
    problems.push(...(await toolMoneyProblems(tx, existing.booking_id, 0)));
    return problems.length ? { outcome: "conflict", message: problems.join("; "), bookingId: existing.booking_id } : { outcome: "applied", message: "", bookingId: existing.booking_id };
  }
  if (!existing && !options.acceptsReservations) return { outcome: "refused", message: `New ${rev.channel} booking ${rev.channelCode} refused: online reservations are stopped (subscription unpaid)`, bookingId: null };
  const currency = (await tx.query<{ currency: string }>("select currency from properties where id = $1", [propertyId])).rows[0]!.currency.trim();
  if (rev.currency.toUpperCase() !== currency) return { outcome: "refused", message: `${rev.channel} ${rev.channelCode}: prices in ${rev.currency}, the property bills in ${currency}`, bookingId: existing?.booking_id ?? null };
  const mapped = await mapRooms(tx, propertyId, rev.rooms);
  if (typeof mapped === "string") return { outcome: "refused", message: `${rev.channel} ${rev.channelCode}: ${mapped}`, bookingId: existing?.booking_id ?? null };
  const setting = await settingIn(tx, propertyId, rev.channel);
  const booker = await guestFor(tx, propertyId, rev.customer, null);
  const bookingId = existing ? existing.booking_id : await createChannelBooking(tx, propertyId, rev, booker);
  if (existing) {
    // the channel's remarks and payment as it says now; staff's notes stay theirs
    await tx.query(
      `update bookings set channel_notes = $2, channel_collect = $3, virtual_card_from = $4, virtual_card_until = $5, virtual_card_amount = $6,
              channel_card_token = coalesce($7, channel_card_token), channel_card_brand = coalesce($8, channel_card_brand), channel_card_last4 = coalesce($9, channel_card_last4)
       where id = $1`,
      [bookingId, channelNotes(rev), rev.collect, rev.virtualCard?.activationDate ?? null, rev.virtualCard?.expiryDate ?? null, rev.virtualCard?.amount ?? null, rev.cardToken?.token ?? null, rev.cardToken?.brand ?? null, rev.cardToken?.last4 ?? null],
    );
  }
  const problems: string[] = [];
  const { rows: current } = await tx.query<{ id: string; key: string | null; status: string; room_type_id: string; arrival: string; departure: string }>(
    "select id, channel_room_key as key, status, room_type_id, to_char(arrival, 'YYYY-MM-DD') as arrival, to_char(departure, 'YYYY-MM-DD') as departure from reservations where booking_id = $1",
    [bookingId],
  );
  let channelTotal = 0;
  for (const room of mapped) {
    const res = current.find((c) => c.key === room.key);
    if (res && res.status !== "confirmed") {
      problems.push(res.status === "cancelled" ? `Room ${room.key} is cancelled here but still booked at ${rev.channel}: check with the guest` : `Room ${room.key} changed by ${rev.channel} while ${res.status.replace("_", " ")}: check it with the guest`);
      continue;
    }
    const guest = room.guestName ? await guestFor(tx, propertyId, { ...rev.customer, ...room.guestName, email: null, phone: null }, booker) : booker;
    const nights = await ourNights(tx, propertyId, room, setting, bookingId);
    channelTotal += room.nights.reduce((s, n) => s + n.price, 0);
    if (res) {
      await tx.query("update reservations set arrival = $2, departure = $3, room_type_id = $4, rate_plan_id = $5, adults = $6, child_ages = $7, primary_guest_id = $8 where id = $1", [
        res.id,
        room.arrival,
        room.departure,
        room.ourRoomTypeId,
        room.ourRatePlanId,
        room.adults,
        room.childAges,
        guest,
      ]);
      // the rooms held follow the new stay: another room type releases them, a shorter stay trims them
      if (room.ourRoomTypeId !== res.room_type_id) await tx.query("delete from room_assignments where reservation_id = $1", [res.id]);
      else {
        await tx.query("delete from room_assignments where reservation_id = $1 and (from_date >= $3 or to_date <= $2)", [res.id, room.arrival, room.departure]);
        await tx.query("update room_assignments set from_date = greatest(from_date, $2::date), to_date = least(to_date, $3::date) where reservation_id = $1", [res.id, room.arrival, room.departure]);
      }
      await tx.query("delete from reservation_nights where reservation_id = $1 and (date < $2 or date >= $3)", [res.id, room.arrival, room.departure]);
      await writeNights(tx, res.id, nights);
      await logReservationChange(tx, res.id, CHANNEL_USER, "edit", { arrival: res.arrival, departure: res.departure, roomTypeId: res.room_type_id }, { arrival: room.arrival, departure: room.departure, roomTypeId: room.ourRoomTypeId, channel: rev.channel });
    } else {
      const { rows } = await tx.query<{ id: string }>(
        `insert into reservations (booking_id, property_id, room_type_id, rate_plan_id, arrival, departure, adults, child_ages, primary_guest_id, created_by, channel_room_key)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [bookingId, propertyId, room.ourRoomTypeId, room.ourRatePlanId, room.arrival, room.departure, room.adults, room.childAges, guest, CHANNEL_USER, room.key],
      );
      await writeNights(tx, rows[0]!.id, nights);
      await openFolios(tx, rows[0]!.id, CHANNEL_USER);
    }
  }
  // rooms the channel no longer has
  const gone = current.filter((c) => c.status === "confirmed" && !mapped.some((m) => m.key === c.key)).map((c) => c.id);
  problems.push(...(await cancelRooms(tx, bookingId, gone)));
  if (setting.paidViaTool) problems.push(...(await toolMoneyProblems(tx, bookingId, channelTotal)));
  problems.push(...(await markOverbooked(tx, propertyId, bookingId)));
  return problems.length ? { outcome: "conflict", message: problems.join("; "), bookingId } : { outcome: "applied", message: "", bookingId };
}

const channelNotes = (rev: ChannelBookingRevision) => [`${rev.channel} ${rev.channelCode}`, rev.notes].filter(Boolean).join("\n").slice(0, 2000);

/** The channel's room types and rate plans in ours, through the mapping; a reason when one is unknown. */
async function mapRooms(tx: PoolClient, propertyId: string, rooms: ChannelRoom[]): Promise<MappedRoom[] | string> {
  const { rows } = await tx.query<{ room_type_id: string; rate_plan_id: string | null; external_id: string }>("select room_type_id, rate_plan_id, external_id from channel_mappings where property_id = $1", [propertyId]);
  const out: MappedRoom[] = [];
  for (const r of rooms) {
    const pair = rows.find((m) => m.rate_plan_id && m.external_id === r.ratePlanId);
    if (!pair) return `rate plan ${r.ratePlanId} is not one of ours (mapped)`;
    if (r.departure <= r.arrival) return `room ${r.key} has no nights`;
    out.push({ ...r, ourRoomTypeId: pair.room_type_id, ourRatePlanId: pair.rate_plan_id! });
  }
  return out;
}

/**
 * The guest of a channel booking: an existing profile with the same email
 * and last name (ADR 0004: one profile per person), else a new one; a room
 * guest named apart from the booker gets a profile of their own.
 */
async function guestFor(tx: PoolClient, propertyId: string, c: ChannelBookingRevision["customer"], booker: string | null): Promise<string> {
  const email = normaliseEmail(c.email);
  if (email) {
    const { rows } = await tx.query<{ id: string; phone: string | null }>("select id, phone from guests where email_normalised = $1 and lower(last_name) = lower($2) order by created_at limit 1", [email, c.lastName || "Guest"]);
    if (rows[0]) {
      // a newer phone from the channel is taken
      if (c.phone && rows[0].phone !== c.phone) await tx.query("update guests set phone = $2, phone_normalised = $3, updated_at = now() where id = $1", [rows[0].id, c.phone, normalisePhone(c.phone)]);
      return rows[0].id;
    }
  } else if (booker) {
    const { rows } = await tx.query<{ id: string }>("select id from guests where id = $1 and lower(first_name) = lower($2) and lower(last_name) = lower($3)", [booker, c.firstName, c.lastName]);
    if (rows[0]) return booker;
  }
  const { rows } = await tx.query<{ id: string }>(
    `insert into guests (first_name, last_name, email, email_normalised, phone, phone_normalised, language, country_of_residence, address_line1, city, postal_code, created_by, created_property_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
    [c.firstName, c.lastName || "Guest", c.email, email, c.phone, normalisePhone(c.phone), c.language, c.country, c.address ?? "", c.city ?? "", c.postalCode, CHANNEL_USER, propertyId],
  );
  return rows[0]!.id;
}

async function createChannelBooking(tx: PoolClient, propertyId: string, rev: ChannelBookingRevision, bookerGuestId: string): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `insert into bookings (property_id, booker_guest_id, source, channel_name, channel_notes, created_by, channel_collect, virtual_card_from, virtual_card_until, virtual_card_amount, channel_card_token, channel_card_brand, channel_card_last4)
     values ($1, $2, 'channel', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
    [
      propertyId,
      bookerGuestId,
      rev.channel,
      channelNotes(rev),
      CHANNEL_USER,
      rev.collect,
      rev.virtualCard?.activationDate ?? null,
      rev.virtualCard?.expiryDate ?? null,
      rev.virtualCard?.amount ?? null,
      rev.cardToken?.token ?? null,
      rev.cardToken?.brand ?? null,
      rev.cardToken?.last4 ?? null,
    ],
  );
  return rows[0]!.id;
}

/**
 * The channel's nightly prices in ours. What the channel says its prices
 * contain wins over the property's setting for the channel; the City Tax is
 * split out on the room's net price, VAT added for net channels, the included
 * Services keep their own price.
 */
async function ourNights(tx: PoolClient, propertyId: string, room: MappedRoom, setting: ChannelSetting, bookingId: string) {
  const { rows } = await tx.query<{ room_tax_code_id: string; booked_on: string }>(
    `select s.tax_code_id as room_tax_code_id, to_char((b.created_at at time zone p.time_zone)::date, 'YYYY-MM-DD') as booked_on
     from rate_plans rp join services s on s.id = rp.accommodation_service_id join properties p on p.id = rp.property_id join bookings b on b.id = $2
     where rp.id = $1`,
    [room.ourRatePlanId, bookingId],
  );
  const plan = rows[0]!;
  const { rows: services } = await tx.query<{ service_id: string; component_price: string; tax_code_id: string }>(
    "select ps.service_id, ps.component_price, s.tax_code_id from rate_plan_services ps join services s on s.id = ps.service_id where ps.rate_plan_id = $1",
    [room.ourRatePlanId],
  );
  const includesVat = room.includesVat ?? setting.pricesIncludeVat;
  const includesCityTax = room.includesCityTax ?? setting.pricesIncludeCityTax;
  const cityTax = includesCityTax ? await cityTaxOfNight(tx, propertyId, { bookedOn: plan.booked_on, adults: room.adults, childAges: room.childAges }) : null;
  const byDate = new Map(room.nights.map((n) => [n.date, n.price]));
  const out = [];
  for (let d = room.arrival; d < room.departure; d = addDays(d, 1)) {
    const date = d;
    const serviceVat = await Promise.all(services.map(async (s) => ({ serviceId: s.service_id, componentPrice: Number(s.component_price), vatPercent: await rateOn(tx, s.tax_code_id, date) })));
    out.push(
      channelNight({
        date,
        price: byDate.get(d) ?? 0,
        includesVat,
        includesCityTax,
        services: serviceVat,
        persons: room.adults + room.childAges.length,
        roomVatPercent: await rateOn(tx, plan.room_tax_code_id, d),
        cityTaxOnRoomNet: cityTax ? (net) => cityTax(date, net) : null,
      }),
    );
  }
  return out;
}

/**
 * Money the hotel's website tool took (the channel's whole price, City Tax
 * included): recorded as a Payment with its Deposit Invoice. More taken after
 * a change is recorded too; less (a change or a cancellation) is listed for
 * staff, since the tool refunds it.
 */
async function toolMoneyProblems(tx: PoolClient, bookingId: string, channelTotal: number): Promise<string[]> {
  const { rows } = await tx.query<{ paid: string; reservation_id: string | null }>(
    `select coalesce((select sum(p.amount) from payments p join reservations r on r.id = p.reservation_id where r.booking_id = $1 and p.tender = 'website_tool' and p.status = 'succeeded'), 0) as paid,
            (select id from reservations where booking_id = $1 and status = 'confirmed' order by created_at limit 1) as reservation_id`,
    [bookingId],
  );
  const paid = Number(rows[0]!.paid);
  const diff = Math.round((channelTotal - paid) * 100) / 100;
  if (diff > 0 && rows[0]!.reservation_id) {
    await recordToolPayment(tx, rows[0]!.reservation_id, diff);
    return [];
  }
  return diff < 0 ? [`The website tool took ${paid.toFixed(2)}, the booking is now ${channelTotal.toFixed(2)}: ${(-diff).toFixed(2)} to be refunded through the tool`] : [];
}

async function recordToolPayment(tx: PoolClient, reservationId: string, amount: number): Promise<void> {
  const { rows } = await tx.query<{ folio_id: string; property_id: string; currency: string }>(
    "select f.id as folio_id, r.property_id, p.currency from reservations r join folios f on f.reservation_id = r.id and f.number = 1 join properties p on p.id = r.property_id where r.id = $1",
    [reservationId],
  );
  const f = rows[0]!;
  await assertDepositInvoiceable(tx, reservationId, "website_tool");
  const { rows: p } = await tx.query<{ id: string }>(
    `insert into payments (folio_id, reservation_id, property_id, tender, amount, currency, status, reference, posted_by, settled_at)
     values ($1, $2, $3, 'website_tool', $4, $5, 'succeeded', 'website booking tool', $6, now()) returning id`,
    [f.folio_id, reservationId, f.property_id, amount, f.currency.trim(), CHANNEL_USER],
  );
  await depositIn(tx, p[0]!.id, CHANNEL_USER);
}

/** Cancel the booking's confirmed rooms (all, or those named); what could not be cancelled is told back. */
async function cancelRooms(tx: PoolClient, bookingId: string, ids: string[] | null): Promise<string[]> {
  const { rows } = await tx.query<{ id: string; status: string; key: string | null }>(
    "select id, status, channel_room_key as key from reservations where booking_id = $1 and ($2::uuid[] is null or id = any($2::uuid[]))",
    [bookingId, ids],
  );
  const problems: string[] = [];
  for (const r of rows) {
    if (r.status === "cancelled") continue;
    if (r.status !== "confirmed") {
      problems.push(`Cancelled by the channel while ${r.status.replace("_", " ")}: check with the guest`);
      continue;
    }
    await tx.query("savepoint channel_cancel");
    try {
      await cancelForChannelIn(tx, r.id, CHANNEL_USER);
      await tx.query("release savepoint channel_cancel");
    } catch (err) {
      await tx.query("rollback to savepoint channel_cancel");
      problems.push(`Room ${r.key ?? ""} not cancelled: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return problems;
}

/** A channel booking past availability is kept (the room was sold), flagged overbooked and told. */
async function markOverbooked(tx: PoolClient, propertyId: string, bookingId: string): Promise<string[]> {
  const { rows } = await tx.query<{ id: string; room_type_id: string; arrival: string; departure: string; key: string | null }>(
    "select id, room_type_id, to_char(arrival, 'YYYY-MM-DD') as arrival, to_char(departure, 'YYYY-MM-DD') as departure, channel_room_key as key from reservations where booking_id = $1 and status = 'confirmed'",
    [bookingId],
  );
  if (!rows.length) return [];
  const from = rows.map((r) => r.arrival).sort()[0]!;
  const to = rows.map((r) => r.departure).sort().at(-1)!;
  const data = await loadQuoteData(tx, propertyId, from, to);
  const problems: string[] = [];
  for (const r of rows) {
    const type = data.types.find((t) => t.id === r.room_type_id);
    if (!type) continue;
    const short: string[] = [];
    for (let d = r.arrival; d < r.departure; d = addDays(d, 1)) if (type.rooms - data.roomsTaken(r.room_type_id, d) < 0) short.push(d);
    await tx.query("update reservations set overbooked = $2 where id = $1", [r.id, short.length > 0]);
    if (short.length) problems.push(`Overbooked: no ${type.code} free on ${short.join(", ")} (room ${r.key ?? ""}); move or relocate`);
  }
  return problems;
}

/** Make sure the channel manager announces new booking revisions to our webhook (properties connected before it existed get it now). */
export async function ensureBookingWebhook(pool: Pool, schema: string, propertyId: string, manager: ChannelManager, webhook: { url: string; secret: string }): Promise<boolean> {
  const ext = await withTenant(pool, schema, async (tx) => (await tx.query<{ external_id: string | null }>("select external_id from channel_connections where property_id = $1 and webhook_at is null", [propertyId])).rows[0]?.external_id ?? null);
  if (!ext) return false;
  await manager.registerBookingWebhook(ext, webhook.url, { "x-hoteloftware-secret": webhook.secret });
  await withTenant(pool, schema, (tx) => tx.query("update channel_connections set webhook_at = now() where property_id = $1", [propertyId]));
  return true;
}

export interface FeedResult {
  applied: number;
  problems: { revisionId: string; outcome: RevisionOutcome; message: string; bookingId: string | null; reservationId: string | null }[];
}

/**
 * Take the property's unacknowledged revisions, apply them oldest first,
 * acknowledge each. A revision that fails, or that the channel manager sent
 * unreadable, is recorded for staff and acknowledged: it never holds back the
 * ones after it.
 */
export async function processChannelFeed(pool: Pool, schema: string, propertyId: string, manager: ChannelManager, options: { acceptsReservations: boolean }): Promise<FeedResult> {
  const ext = await withTenant(pool, schema, async (tx) => (await tx.query<{ external_id: string | null }>("select external_id from channel_connections where property_id = $1", [propertyId])).rows[0]?.external_id ?? null);
  if (!ext) return { applied: 0, problems: [] };
  const feed = await manager.bookingFeed(ext);
  const result: FeedResult = { applied: 0, problems: [] };
  for (const u of feed.unreadable) {
    await withTenant(pool, schema, (tx) => recordRevision(tx, propertyId, { id: u.id, bookingId: "", status: "unknown", channel: "Channel", receivedAt: new Date().toISOString() }, { outcome: "refused", message: u.reason }));
    await manager.ackRevision(u.id);
    result.problems.push({ revisionId: u.id, outcome: "refused", message: u.reason, bookingId: null, reservationId: null });
  }
  for (const rev of [...feed.revisions].sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0))) {
    let r: AppliedRevision;
    try {
      r = await applyChannelRevision(pool, schema, propertyId, rev, options);
    } catch (err) {
      console.error(`[channels] revision ${rev.id} failed`, err);
      r = { outcome: "refused", message: `${rev.channel} ${rev.channelCode}: could not be applied (${err instanceof Error ? err.message : String(err)}); enter it by hand`, bookingId: null };
      await withTenant(pool, schema, (tx) => recordRevision(tx, propertyId, rev, r));
    }
    await manager.ackRevision(rev.id);
    if (r.outcome === "applied") result.applied++;
    if (r.outcome === "refused" || r.outcome === "conflict") {
      const reservationId = r.bookingId ? await withTenant(pool, schema, async (tx) => (await tx.query<{ id: string }>("select id from reservations where booking_id = $1 order by created_at limit 1", [r.bookingId])).rows[0]?.id ?? null) : null;
      result.problems.push({ revisionId: rev.id, outcome: r.outcome, message: r.message, bookingId: r.bookingId, reservationId });
    }
  }
  return result;
}

export interface ChannelProblem {
  revisionId: string;
  channel: string;
  outcome: "refused" | "conflict";
  message: string;
  at: Date;
  bookingId: string | null;
  /** The booking's first reservation, to open it. */
  reservationId: string | null;
}

/** Channel bookings that need staff: refused or conflicting revisions not yet marked seen to. */
export async function channelProblems(pool: Pool, schema: string, propertyId: string): Promise<ChannelProblem[]> {
  return withTenant(pool, schema, async (tx) => {
    const { rows } = await tx.query(
      `select r.id, r.channel, r.outcome, r.message, r.applied_at, b.booking_id,
              (select x.id from reservations x where x.booking_id = b.booking_id order by x.created_at limit 1) as reservation_id
       from channel_booking_revisions r left join channel_bookings b on b.external_id = r.external_booking_id
       where r.property_id = $1 and r.outcome in ('refused', 'conflict') and r.resolved_at is null order by r.applied_at desc limit 100`,
      [propertyId],
    );
    return rows.map((r) => ({ revisionId: r.id, channel: r.channel, outcome: r.outcome, message: r.message, at: r.applied_at, bookingId: r.booking_id, reservationId: r.reservation_id }));
  });
}

export async function resolveChannelProblem(pool: Pool, schema: string, propertyId: string, revisionId: string, userId: string): Promise<void> {
  await withTenant(pool, schema, (tx) => tx.query("update channel_booking_revisions set resolved_at = now(), resolved_by = $3 where id = $1 and property_id = $2", [revisionId, propertyId, userId]));
}
