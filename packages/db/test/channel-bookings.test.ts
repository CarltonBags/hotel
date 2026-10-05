import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
import { FakeChannelManager, type ChannelBookingRevision } from "@hoteloftware/channels";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, type RatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createCityTaxRule } from "../src/tenant/city-tax";
import { connectChannels } from "../src/tenant/channels";
import { applyChannelRevision, channelProblems, processChannelFeed, setChannelSetting } from "../src/tenant/channel-bookings";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a revision applied once (replay changes nothing, an older one is
 * ignored, a newer one updates); prices made ours per channel settings, City
 * Tax split so the guest pays the channel price; cancellation frees the room;
 * never refused for lack of rooms but listed; the feed is acknowledged.
 */
describe("Channel bookings inbound", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let dbl = "";
  let plan: RatePlan;
  const today = todayIn("Europe/Berlin");
  const s = () => tenant.schemaName;
  const ch = new FakeChannelManager();
  const pm: { userId: string; actor: Actor } = { userId: "user_pm", actor: { tenantRole: "owner", propertyRoles: [] } };
  let extProperty = "";
  let extPlan = "";
  let n = 0;
  const rev = (over: Partial<ChannelBookingRevision> & { nights?: number[]; from?: number }): ChannelBookingRevision => {
    n++;
    const from = addDays(today, over.from ?? 5);
    const prices = over.nights ?? [100, 110];
    return {
      id: `rev-${n}`,
      bookingId: "bk-1",
      propertyId: extProperty,
      status: "new",
      channel: "Booking.com",
      channelCode: "4021778899",
      currency: "EUR",
      customer: { firstName: "Aiko", lastName: "Tanaka", email: "aiko@guest.booking.com", phone: "+81 3 1234 5678", country: "JP", language: "en", address: null, city: "Tokyo", postalCode: null },
      rooms: [{ key: "r-1", roomTypeId: "x", ratePlanId: extPlan, arrival: from, departure: addDays(from, prices.length), adults: 2, childAges: [], nights: prices.map((p, i) => ({ date: addDays(from, i), price: p })), guestName: null }],
      notes: "Late arrival",
      collect: "channel",
      virtualCard: { activationDate: addDays(from, 1), amount: 210 },
      receivedAt: new Date(Date.UTC(2026, 9, 5, 10, n)).toISOString(),
      ...over,
    };
  };
  const nights = async (bookingCode: string) =>
    (await pool.query<{ total: string }>(`select n.total from ${s()}.reservation_nights n join ${s()}.reservations r on r.id = n.reservation_id join ${s()}.channel_bookings c on c.booking_id = r.booking_id where c.external_id = $1 and r.status <> 'cancelled' order by n.date`, [bookingCode])).rows.map((r) => Number(r.total));

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 3, maxAdults: 3, bedPlaces: 2, extraBeds: 1 })).id;
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101", "102"] });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    plan = await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id });
    await setRates(pool, s(), propertyId, "user_rev", Array.from({ length: 20 }, (_, i) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, i), price: 100 })));
    await createCityTaxRule(pool, s(), propertyId, { preset: "berlin", taxCodeId: codes.find((c) => c.code === "ZERO")!.id }, pm.userId);
    await connectChannels(pool, s(), { tenantId: tenant.id, propertyId, email: "pm@haus.example" }, ch, pm.userId);
    extProperty = [...ch.properties.keys()][0]!;
    extPlan = [...ch.ratePlans.keys()][0]!;
  });
  afterAll(() => pool.end());

  it("a new booking arrives with the channel's name, prices, guest, notes and who collects; a replay changes nothing", async () => {
    const first = rev({});
    const r = await applyChannelRevision(pool, s(), propertyId, first);
    expect(r.outcome).toBe("applied");
    const { rows } = await pool.query(
      `select b.source, b.channel_name, b.notes, b.channel_collect, to_char(b.virtual_card_from, 'YYYY-MM-DD') as vcc_from, b.virtual_card_amount, g.last_name, g.email, g.language, r.adults, r.created_by
       from ${s()}.bookings b join ${s()}.guests g on g.id = b.booker_guest_id join ${s()}.reservations r on r.booking_id = b.id where b.id = $1`,
      [r.bookingId],
    );
    expect(rows[0]).toMatchObject({ source: "channel", channel_name: "Booking.com", channel_collect: "channel", vcc_from: addDays(today, 6), virtual_card_amount: "210.00", last_name: "Tanaka", email: "aiko@guest.booking.com", language: "en", adults: 2, created_by: "channel" });
    expect(rows[0].notes).toContain("4021778899");
    expect(await nights("bk-1")).toEqual([100, 110]);
    expect((await applyChannelRevision(pool, s(), propertyId, first)).outcome).toBe("duplicate");
    expect((await pool.query(`select count(*)::int as n from ${s()}.bookings where source = 'channel'`)).rows[0].n).toBe(1);
  });

  it("a newer revision updates the reservation; an older one is ignored", async () => {
    const older = rev({ status: "modified", nights: [90, 90, 90], receivedAt: "2026-10-01T00:00:00.000Z" });
    expect((await applyChannelRevision(pool, s(), propertyId, older)).outcome).toBe("stale");
    expect(await nights("bk-1")).toEqual([100, 110]);
    expect((await applyChannelRevision(pool, s(), propertyId, rev({ status: "modified", nights: [120, 120, 125] }))).outcome).toBe("applied");
    expect(await nights("bk-1")).toEqual([120, 120, 125]);
    const res = (await pool.query(`select to_char(departure, 'YYYY-MM-DD') as d from ${s()}.reservations where channel_room_key = 'r-1'`)).rows[0];
    expect(res.d).toBe(addDays(today, 8));
  });

  it("a channel price including City Tax is split so the guest pays exactly the channel price", async () => {
    await setChannelSetting(pool, s(), propertyId, { channel: "Expedia", pricesIncludeVat: true, pricesIncludeCityTax: true, sendConfirmation: true, paidViaTool: false }, pm.userId);
    await applyChannelRevision(pool, s(), propertyId, rev({ bookingId: "bk-ct", channel: "Expedia", nights: [107.01] }));
    // gross 100 at 7 % VAT: net 93.46, Berlin 7.5 % = 7.01 → 107.01
    expect(await nights("bk-ct")).toEqual([100]);
  });

  it("a cancellation from the channel cancels the reservation, without a fee of ours, and frees the room", async () => {
    expect((await applyChannelRevision(pool, s(), propertyId, rev({ status: "cancelled", rooms: [] }))).outcome).toBe("applied");
    const r = (await pool.query(`select status, cancelled_by, cancellation_fee from ${s()}.reservations where channel_room_key = 'r-1' and booking_id = (select booking_id from ${s()}.channel_bookings where external_id = 'bk-1')`)).rows[0];
    expect(r).toEqual({ status: "cancelled", cancelled_by: "channel", cancellation_fee: null });
    const free = (await pool.query(`select count(*)::int as n from ${s()}.reservations where status = 'confirmed' and arrival <= $1 and departure > $1`, [addDays(today, 6)])).rows[0].n;
    expect(free).toBe(0);
  });

  it("the website tool's money is recorded as its payment", async () => {
    await setChannelSetting(pool, s(), propertyId, { channel: "Hotel website", pricesIncludeVat: true, pricesIncludeCityTax: false, sendConfirmation: false, paidViaTool: true }, pm.userId);
    const r = await applyChannelRevision(pool, s(), propertyId, rev({ bookingId: "bk-web", channel: "Hotel website", collect: "property", virtualCard: null, nights: [150, 150], from: 12 }));
    const p = (await pool.query(`select p.tender, p.amount from ${s()}.payments p join ${s()}.reservations r on r.id = p.reservation_id where r.booking_id = $1`, [r.bookingId])).rows;
    expect(p).toEqual([{ tender: "website_tool", amount: "300.00" }]);
  });

  it("never refuses for lack of rooms: the booking is kept, flagged overbooked and listed", async () => {
    for (const id of ["bk-a", "bk-b", "bk-c"]) await applyChannelRevision(pool, s(), propertyId, rev({ bookingId: id, nights: [100], from: 15 }));
    const over = (await pool.query(`select c.external_id from ${s()}.reservations r join ${s()}.channel_bookings c on c.booking_id = r.booking_id where r.overbooked order by 1`)).rows;
    expect(over).toEqual([{ external_id: "bk-c" }]);
    expect((await channelProblems(pool, s(), propertyId)).map((p) => [p.outcome, p.message.startsWith("Overbooked")])).toEqual([["conflict", true]]);
  });

  it("an unknown rate plan is refused and listed; unpaid from day 60 new bookings are refused, changes still apply", async () => {
    expect((await applyChannelRevision(pool, s(), propertyId, rev({ bookingId: "bk-x", rooms: [{ ...rev({}).rooms[0]!, ratePlanId: "unknown" }] }))).outcome).toBe("refused");
    expect((await applyChannelRevision(pool, s(), propertyId, rev({ bookingId: "bk-new" }), { acceptsReservations: false })).outcome).toBe("refused");
    expect((await applyChannelRevision(pool, s(), propertyId, rev({ bookingId: "bk-ct", channel: "Expedia", status: "modified", nights: [107.01, 107.01] }), { acceptsReservations: false })).outcome).toBe("applied");
  });

  it("the feed is applied oldest first and every revision acknowledged", async () => {
    ch.revisions.push(rev({ bookingId: "bk-f", nights: [100], from: 18 }), rev({ bookingId: "bk-f", status: "modified", nights: [130], from: 18 }));
    const r = await processChannelFeed(pool, s(), propertyId, ch, { acceptsReservations: true });
    expect(r.applied).toBe(2);
    expect(ch.acked.size).toBe(2);
    expect(await nights("bk-f")).toEqual([130]);
    expect((await processChannelFeed(pool, s(), propertyId, ch, { acceptsReservations: true })).applied).toBe(0);
  });
});
