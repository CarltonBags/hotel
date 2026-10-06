import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
import { ChannelError, FakeChannelManager } from "@hoteloftware/channels";
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
import { setRates, setRestrictions } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { createRoomBlock } from "../src/tenant/room-state";
import { channelOverview, connectChannels, pushChannels } from "../src/tenant/channels";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: connecting projects room types and (rate plan, room type) pairs;
 * every change reaches the outbox through the database; a push sends the
 * current values in one call per kind; failures keep the rows and tell once.
 */
describe("Channel manager connection and ARI outbox", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let dbl = "";
  let plan: RatePlan;
  const fd = "user_rev";
  const today = todayIn("Europe/Berlin");
  const s = () => tenant.schemaName;
  const ch = new FakeChannelManager();
  const extType = () => [...ch.roomTypes.keys()][0]!;
  const extPlan = () => [...ch.ratePlans.keys()][0]!;
  const pm: { userId: string; actor: Actor } = { userId: "user_pm", actor: { tenantRole: "owner", propertyRoles: [] } };
  const channelStatus = async (...a: [Pool, string, string]) => (await channelOverview(...a)).status;

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 3, maxAdults: 3, bedPlaces: 2, extraBeds: 1 })).id;
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: ["101", "102", "103"] });
    await applyTaxPreset(pool, s(), le, "DE");
    const codes = await listTaxCodes(pool, s(), le);
    const room = await createService(pool, s(), { propertyId, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    plan = await createRatePlan(pool, s(), {
      propertyId,
      code: "RO",
      name: "Room only",
      kind: "base",
      roomTypeIds: [dbl],
      mealPlan: "none",
      accommodationServiceId: room.id,
      paymentPolicyId: pay.id,
      cancellationPolicyId: cxl.id,
      supplements: [{ kind: "single", amount: -20 }, { kind: "extra_adult", amount: 30 }],
    });
    await setRates(pool, s(), propertyId, fd, Array.from({ length: 10 }, (_, n) => ({ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, n), price: 100 })));
  });
  afterAll(() => pool.end());

  it("connecting projects room types and pairs, then pushes the whole horizon in one call per kind", async () => {
    // before connecting nothing waits
    expect(await channelStatus(pool, s(), propertyId)).toMatchObject({ connected: false, pending: 0 });
    await connectChannels(pool, s(), { tenantId: tenant.id, propertyId, email: "pm@haus.example" }, ch, pm.userId);
    expect([...ch.roomTypes.values()]).toEqual([expect.objectContaining({ title: "Double", rooms: 3, maxAdults: 3 })]);
    expect([...ch.ratePlans.values()]).toEqual([expect.objectContaining({ title: "Room only · Double", primaryOccupancy: 2, maxAdults: 3 })]);
    expect((await channelStatus(pool, s(), propertyId)).pending).toBeGreaterThan(0);
    const r = await pushChannels(pool, s(), propertyId, ch);
    expect(r.error).toBeNull();
    expect(ch.calls.map((c) => c.kind)).toEqual(["availability", "restrictions"]);
    expect(ch.availabilityOn(extType(), today)).toBe(3);
    expect(ch.availabilityOn(extType(), addDays(today, 499))).toBe(3);
    expect(ch.restrictionOn(extPlan(), today)).toMatchObject({ rates: [{ occupancy: 1, rate: 80 }, { occupancy: 2, rate: 100 }, { occupancy: 3, rate: 130 }], stopSell: false });
    // no price beyond the entered days: closed
    expect(ch.restrictionOn(extPlan(), addDays(today, 20))).toMatchObject({ stopSell: true, rates: [] });
    expect(await channelStatus(pool, s(), propertyId)).toMatchObject({ connected: true, pending: 0, failing: false });
  });

  it("a burst of grid changes goes as one call per kind with only the changed days", async () => {
    ch.calls.length = 0;
    for (let n = 0; n < 15; n++) await setRates(pool, s(), propertyId, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, 2), price: 110 + n }]);
    await setRestrictions(pool, s(), propertyId, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, 3), patch: { minStayThrough: 2 } }]);
    expect((await channelStatus(pool, s(), propertyId)).pending).toBe(16);
    await pushChannels(pool, s(), propertyId, ch);
    expect(ch.calls.map((c) => c.kind)).toEqual(["restrictions"]);
    const sent = ch.calls[0]!.values as { dateFrom: string; dateTo: string; rates: { rate: number }[]; minStayThrough: number }[];
    expect(sent.map((v) => [v.dateFrom, v.dateTo])).toEqual([[addDays(today, 2), addDays(today, 2)], [addDays(today, 3), addDays(today, 3)]]);
    expect(sent[0]!.rates[1]!.rate).toBe(124);
    expect(sent[1]!.minStayThrough).toBe(2);
  });

  it("a booking and an Out of Order block lower availability at the channel manager", async () => {
    ch.calls.length = 0;
    const g = (await createGuest(pool, s(), { firstName: "Aiko", lastName: "Tanaka" }, { userId: fd, propertyId })).id;
    await createBooking(pool, s(), propertyId, fd, { booker: { guestId: g }, walkIn: false, notes: "", reservations: [{ arrival: addDays(today, 1), departure: addDays(today, 3), roomTypeId: dbl, ratePlanId: plan.id, adults: 2, childAges: [], primaryGuestId: g }] });
    const { rows } = await pool.query<{ id: string }>(`select id from ${s()}.rooms where number = '103'`);
    await createRoomBlock(pool, s(), { roomId: rows[0]!.id, kind: "out_of_order", from: addDays(today, 2), to: addDays(today, 4), reason: "Leak" }, pm);
    await pushChannels(pool, s(), propertyId, ch);
    expect(ch.calls.map((c) => c.kind)).toEqual(["availability"]);
    expect([0, 1, 2, 3, 4].map((n) => ch.availabilityOn(extType(), addDays(today, n)))).toEqual([3, 2, 1, 2, 3].map((v, i) => (i === 0 || i === 4 ? undefined : v)));
  });

  it("a failing push keeps the rows, tells once, and sends them when it works again", async () => {
    ch.calls.length = 0;
    await setRates(pool, s(), propertyId, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, 5), price: 150 }]);
    ch.failNext = new ChannelError("Channex refused (429)", true);
    const first = await pushChannels(pool, s(), propertyId, ch);
    expect(first).toMatchObject({ sent: 0, alert: true, error: "Channex refused (429)" });
    expect(await channelStatus(pool, s(), propertyId)).toMatchObject({ pending: 1, failing: true });
    ch.failNext = new ChannelError("Channex refused (429)", true);
    expect((await pushChannels(pool, s(), propertyId, ch)).alert).toBe(false);
    const ok = await pushChannels(pool, s(), propertyId, ch);
    expect(ok).toMatchObject({ sent: 1, error: null });
    expect(ch.restrictionOn(extPlan(), addDays(today, 5))!.rates[1]!.rate).toBe(150);
    expect(await channelStatus(pool, s(), propertyId)).toMatchObject({ pending: 0, failing: false });
  });

  it("a new rate plan sold on channels is mapped and pushed on the next run", async () => {
    const room = (await pool.query<{ accommodation_service_id: string; payment_policy_id: string; cancellation_policy_id: string }>(`select accommodation_service_id, payment_policy_id, cancellation_policy_id from ${s()}.rate_plans where id = $1`, [plan.id])).rows[0]!;
    await createRatePlan(pool, s(), { propertyId, code: "BB", name: "Breakfast", kind: "base", roomTypeIds: [dbl], mealPlan: "breakfast", accommodationServiceId: room.accommodation_service_id, paymentPolicyId: room.payment_policy_id, cancellationPolicyId: room.cancellation_policy_id });
    ch.calls.length = 0;
    await pushChannels(pool, s(), propertyId, ch);
    expect([...ch.ratePlans.values()].map((p) => p.title)).toEqual(["Room only · Double", "Breakfast · Double"]);
    expect(ch.calls.some((c) => c.kind === "restrictions")).toBe(true);
  });

  it("a refused value is set aside with its reason and does not hold back the rest", async () => {
    ch.calls.length = 0;
    await setRates(pool, s(), propertyId, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, 6), price: 160 }]);
    ch.failNext = new ChannelError("Channex refused POST /restrictions (422): rate too low", false);
    const r = await pushChannels(pool, s(), propertyId, ch);
    expect(r.error).toMatch(/422/);
    expect(await channelStatus(pool, s(), propertyId)).toMatchObject({ pending: 0, refused: 1, failing: true });
    await setRates(pool, s(), propertyId, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, 7), price: 170 }]);
    expect((await pushChannels(pool, s(), propertyId, ch)).sent).toBe(1);
    expect(await channelStatus(pool, s(), propertyId)).toMatchObject({ pending: 0, failing: false });
  });

  it("a plan taken off channels is closed there and dropped from the mapping", async () => {
    const bb = (await pool.query<{ id: string }>(`select id from ${s()}.rate_plans where code = 'BB'`)).rows[0]!.id;
    const ext = [...ch.ratePlans.entries()].find(([, p]) => p.title === "Breakfast · Double")![0];
    await pool.query(`update ${s()}.rate_plans set sold_on_channels = false where id = $1`, [bb]);
    ch.calls.length = 0;
    await pushChannels(pool, s(), propertyId, ch);
    expect(ch.restrictionOn(ext, today)).toMatchObject({ stopSell: true, rates: [] });
    expect(ch.restrictionOn(ext, addDays(today, 499))).toMatchObject({ stopSell: true });
    expect((await channelOverview(pool, s(), propertyId)).mappings.map((m) => m.ratePlanName)).toEqual([null, "Room only"]);
  });

  it("more adults in the room type: the rate plan's occupancies are updated and every price sent again", async () => {
    await pool.query(`update ${s()}.room_types set max_adults = 4, max_occupancy = 4 where id = $1`, [dbl]);
    ch.calls.length = 0;
    await pushChannels(pool, s(), propertyId, ch);
    expect(ch.ratePlans.get(extPlan())!.maxAdults).toBe(4);
    expect(ch.restrictionOn(extPlan(), today)!.rates.map((r) => r.occupancy)).toEqual([1, 2, 3, 4]);
  });

  it("unpaid from day 60 closes sales at the channels; paid again, everything goes in full", async () => {
    ch.calls.length = 0;
    const closed = await pushChannels(pool, s(), propertyId, ch, { acceptsReservations: false });
    expect(closed.closed).toBe(true);
    expect(ch.restrictionOn(extPlan(), today)).toMatchObject({ stopSell: true });
    // changes meanwhile wait
    await setRates(pool, s(), propertyId, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, 8), price: 180 }]);
    expect((await pushChannels(pool, s(), propertyId, ch, { acceptsReservations: false })).sent).toBe(0);
    const open = await pushChannels(pool, s(), propertyId, ch);
    expect(open.reopened).toBe(true);
    expect(ch.restrictionOn(extPlan(), today)).toMatchObject({ stopSell: false });
    expect(ch.restrictionOn(extPlan(), addDays(today, 8))!.rates[1]!.rate).toBe(180);
  });

  it("one push per property at a time", async () => {
    await pool.query(`update ${s()}.channel_connections set busy_until = now() + interval '1 minute'`);
    await setRates(pool, s(), propertyId, fd, [{ ratePlanId: plan.id, roomTypeId: dbl, date: addDays(today, 9), price: 190 }]);
    expect((await pushChannels(pool, s(), propertyId, ch)).sent).toBe(0);
    await pool.query(`update ${s()}.channel_connections set busy_until = null`);
    expect((await pushChannels(pool, s(), propertyId, ch)).sent).toBe(1);
  });
});
