/**
 * Channex certification run on staging (tickets 37 and 38). With CHANNEX_API_KEY (and
 * CHANNEX_URL for staging) in .env, it connects a property of the dev database
 * and makes the ARI test changes the way the app makes them, pushing after
 * each one and printing what went to Channex: calls per kind, values, and
 * Channex's answer. Paste the output into docs/channex-certification.md, then
 * repeat the changes by hand in the app during Channex's live screenshare.
 * For the booking cases, make the test bookings (new, modified, cancelled) in
 * Channex's staging first; the last step takes them from the feed, applies and
 * acknowledges them.
 *
 *   npx tsx scripts/channex-staging.ts <tenant slug> <property id> <contact email>
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { Pool } from "pg";
import { addDays, todayIn } from "@hoteloftware/domain";
import { ChannexManager, type AvailabilityValue, type ChannelManager, type ChannelProperty, type ChannelRatePlan, type ChannelRoomType, type RestrictionValue } from "@hoteloftware/channels";
import { channelConnection, connectChannels, createRoomBlock, findTenantBySlug, processChannelFeed, pushChannels, setRates, setRestrictions } from "@hoteloftware/db";

config({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });
const [slug, propertyId, email] = process.argv.slice(2);
if (!slug || !propertyId || !email) throw new Error("usage: channex-staging.ts <tenant slug> <property id> <contact email>");
if (!process.env.CHANNEX_API_KEY) throw new Error("CHANNEX_API_KEY is not set");

/** Counts calls and values per kind. */
class Counting implements ChannelManager {
  readonly name: string;
  calls: { kind: string; values: number }[] = [];
  constructor(private readonly inner: ChannelManager) {
    this.name = inner.name;
  }
  createProperty(p: ChannelProperty) {
    return this.inner.createProperty(p);
  }
  createRoomType(r: ChannelRoomType) {
    return this.inner.createRoomType(r);
  }
  updateRoomType(id: string, r: ChannelRoomType) {
    return this.inner.updateRoomType(id, r);
  }
  createRatePlan(r: ChannelRatePlan) {
    return this.inner.createRatePlan(r);
  }
  updateRatePlan(id: string, r: ChannelRatePlan) {
    return this.inner.updateRatePlan(id, r);
  }
  async pushAvailability(v: AvailabilityValue[]) {
    if (v.length) this.calls.push({ kind: "availability", values: v.length });
    await this.inner.pushAvailability(v);
  }
  async pushRestrictions(v: RestrictionValue[]) {
    if (v.length) this.calls.push({ kind: "restrictions", values: v.length });
    await this.inner.pushRestrictions(v);
  }
  bookingFeed(propertyId: string) {
    return this.inner.bookingFeed(propertyId);
  }
  async ackRevision(id: string) {
    this.calls.push({ kind: "ack", values: 1 });
    await this.inner.ackRevision(id);
  }
  registerBookingWebhook(propertyId: string, url: string, headers: Record<string, string>) {
    return this.inner.registerBookingWebhook(propertyId, url, headers);
  }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tenant = await findTenantBySlug(pool, slug);
if (!tenant) throw new Error("No such tenant");
const s = tenant.schemaName;
const manager = new Counting(new ChannexManager(process.env.CHANNEX_API_KEY, process.env.CHANNEX_URL ?? "https://staging.channex.io/api/v1"));
const user = "channex-certification";
const owner = { userId: user, actor: { tenantRole: "owner" as const, propertyRoles: [] } };
const step = async (name: string, change: () => Promise<unknown>) => {
  await change();
  manager.calls = [];
  const r = await pushChannels(pool, s, propertyId, manager);
  console.log(`| ${name} | ${manager.calls.map((c) => `${c.kind}: ${c.values} value(s)`).join(", ") || "no call"} | ${r.error ?? "accepted"} |`);
};

const { rows: pairs } = await pool.query<{ rate_plan_id: string; room_type_id: string }>(
  `select rt.rate_plan_id, rt.room_type_id from ${s}.rate_plan_room_types rt join ${s}.rate_plans p on p.id = rt.rate_plan_id where p.property_id = $1 and p.active and p.sold_on_channels and p.kind = 'base'`,
  [propertyId],
);
const today = todayIn("Europe/Berlin");
console.log("| Step | Sent | Channex |\n|---|---|---|");
if (!(await channelConnection(pool, s, propertyId))?.externalId) await step("Connect and full sync (500 days)", () => connectChannels(pool, s, { tenantId: tenant.id, propertyId, email }, manager, user));
else await step("Full sync (500 days)", async () => undefined);
const [first] = pairs;
if (!first) throw new Error("No rate plan sold on channels");
await step("Single date rate", () => setRates(pool, s, propertyId, user, [{ ratePlanId: first.rate_plan_id, roomTypeId: first.room_type_id, date: addDays(today, 10), price: 133 }]));
await step("Rates for several dates and plans at once", () => setRates(pool, s, propertyId, user, pairs.flatMap((p) => [11, 12, 13].map((n) => ({ ratePlanId: p.rate_plan_id, roomTypeId: p.room_type_id, date: addDays(today, n), price: 140 + n })))));
await step("Minimum stay arrival and through", () => setRestrictions(pool, s, propertyId, user, [{ ratePlanId: first.rate_plan_id, roomTypeId: first.room_type_id, date: addDays(today, 14), patch: { minStayArrival: 2, minStayThrough: 3 } }]));
await step("Closed to arrival and departure, maximum stay", () => setRestrictions(pool, s, propertyId, user, [{ ratePlanId: first.rate_plan_id, roomTypeId: first.room_type_id, date: addDays(today, 15), patch: { closedToArrival: true, closedToDeparture: true, maxStay: 7 } }]));
await step("Stop sell", () => setRestrictions(pool, s, propertyId, user, [{ ratePlanId: first.rate_plan_id, roomTypeId: first.room_type_id, date: addDays(today, 16), patch: { stopSell: true } }]));
const room = (await pool.query<{ id: string }>(`select id from ${s}.rooms where room_type_id = $1 limit 1`, [first.room_type_id])).rows[0]!;
await step("Availability: a room Out of Order", () => createRoomBlock(pool, s, { roomId: room.id, kind: "out_of_order", from: addDays(today, 20), to: addDays(today, 22), reason: "Certification" }, owner));
manager.calls = [];
const feed = await processChannelFeed(pool, s, propertyId, manager, { acceptsReservations: true });
console.log(`| Test bookings from the feed | ${feed.applied} applied, ${manager.calls.filter((c) => c.kind === "ack").length} acknowledged | ${feed.problems.map((p) => p.message).join("; ") || "no problems"} |`);
await pool.end();
