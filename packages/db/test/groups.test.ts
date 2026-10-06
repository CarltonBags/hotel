import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { addDays, todayIn, type Actor } from "@hoteloftware/domain";
import { FakeChannelManager } from "@hoteloftware/channels";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms } from "../src/tenant/rooms";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan, listRatePlans } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createCompany } from "../src/tenant/companies";
import { quoteStays } from "../src/tenant/reservations";
import { connectChannels, pushChannels } from "../src/tenant/channels";
import { addHolding, bookFromGroup, createGroup, createSeries, groupView, runGroupDuties, setGroupPrices, setGroupStatus, setHeldRooms, setReleaseDate } from "../src/tenant/groups";
import { runReport } from "../src/tenant/reports";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: a Definite group's Held Rooms leave availability everywhere,
 * channels included; a Tentative one only warns when demand passes what is
 * free; its reservations pick the Held Rooms up at the contract price; the
 * release returns the unsold rooms and tells the channels; a Series makes one
 * holding per departure.
 */
describe("Groups", () => {
  let pool: Pool;
  let tenant: Tenant;
  let propertyId = "";
  let dbl = "";
  let basePlan = "";
  let company = "";
  const s = () => tenant.schemaName;
  const today = todayIn("Europe/Berlin");
  const ch = new FakeChannelManager();
  const fd: { userId: string; actor: Actor } = { userId: "user_fd", actor: { propertyRoles: [] } };
  const revenue: { userId: string; actor: Actor } = { userId: "user_rev", actor: { propertyRoles: [] } };
  const extType = () => [...ch.roomTypes.keys()][0]!;
  const free = async (arrival: string) => (await quoteStays(pool, s(), propertyId, { arrival, departure: addDays(arrival, 1), adults: 2, childAges: [] })).roomTypes.find((t) => t.roomTypeId === dbl)!.available;

  beforeAll(async () => {
    pool = testPool(10);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "A GmbH", country: "DE", addressLine1: "Ring 1", postalCode: "10115", city: "Berlin", vatId: "DE1", taxNumber: "1" })).id;
    propertyId = (await createProperty(pool, s(), { name: "Haus am Ring", legalEntityId: le, country: "DE", timeZone: "Europe/Berlin", currency: "EUR" })).id;
    fd.actor = { propertyRoles: [{ propertyId, role: "front_desk" }] };
    revenue.actor = { propertyRoles: [{ propertyId, role: "revenue" }] };
    dbl = (await createRoomType(pool, s(), { propertyId, code: "DBL", name: "Double", maxOccupancy: 2, maxAdults: 2, bedPlaces: 2, extraBeds: 0 })).id;
    await createRooms(pool, s(), { propertyId, roomTypeId: dbl, numbers: Array.from({ length: 20 }, (_, i) => String(101 + i)) });
    const pay = await createPaymentPolicy(pool, s(), { propertyId, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    basePlan = (await createRatePlan(pool, s(), { propertyId, code: "RO", name: "Room only", kind: "base", roomTypeIds: [dbl], mealPlan: "none", paymentPolicyId: pay.id, cancellationPolicyId: cxl.id })).id;
    await setRates(pool, s(), propertyId, "user_rev", Array.from({ length: 80 }, (_, n) => ({ ratePlanId: basePlan, roomTypeId: dbl, date: addDays(today, n), price: 120 })));
    company = (await createCompany(pool, s(), { name: "Reisen AG" }, { userId: fd.userId })).id;
    await connectChannels(pool, s(), { tenantId: tenant.id, propertyId, email: "pm@haus.example" }, ch, "user_pm");
    await pushChannels(pool, s(), propertyId, ch);
  });
  afterAll(() => pool.end());

  let group = "";
  let holding = "";
  const arrival = addDays(today, 20);

  it("a Definite group of 10 Doubles lowers availability by 10 and reaches the channel", async () => {
    const g = await createGroup(pool, s(), { propertyId, name: "Chor Leipzig", organiser: { companyId: company }, contact: "Frau Lange", optionDate: addDays(today, 10), terms: "30 % deposit", reductionRules: "Up to 2 rooms free until 30 days", releaseDays: 14, basePlanId: basePlan }, fd);
    group = g.id;
    // the group's prices are not a plan staff pick from the grid
    expect((await listRatePlans(pool, s(), propertyId)).map((p) => p.id)).not.toContain(g.ratePlanId);
    holding = await addHolding(pool, s(), group, { arrival, departure: addDays(arrival, 2), rooms: [{ roomTypeId: dbl, rooms: 10 }] }, fd);
    expect(await free(arrival)).toBe(20);
    await setGroupStatus(pool, s(), group, "definite", fd);
    expect(await free(arrival)).toBe(10);
    await pushChannels(pool, s(), propertyId, ch);
    expect(ch.availabilityOn(extType(), arrival)).toBe(10);
    // pace counts them as sold, shown apart
    const pace = await runReport(pool, s(), { kind: "pickup", from: arrival, to: arrival, propertyIds: [propertyId], grain: "day", compare: { previous: false, lastYear: false }, language: "en" });
    expect(pace.rows[0]!.cells).toMatchObject({ otb: 0, held: 10, occ: 50 });
    // Revenue edits the contract prices, not the group itself
    await setGroupPrices(pool, s(), group, [arrival, addDays(arrival, 1)].map((date) => ({ roomTypeId: dbl, date, price: 89 })), revenue);
    await expect(setGroupStatus(pool, s(), group, "cancelled", revenue)).rejects.toThrow(/Not allowed/);
  });

  it("its reservations pick the Held Rooms up at the contract price; the release returns the unsold rooms and tells the channel", async () => {
    for (let i = 0; i < 6; i++) await bookFromGroup(pool, s(), holding, { roomTypeId: dbl, firstName: "Sänger", lastName: `Nr ${i + 1}`, adults: 2 }, fd);
    // picking up changes nothing for others: 6 booked, 4 still held
    expect(await free(arrival)).toBe(10);
    const night = (await groupView(pool, s(), group, fd)).holdings[0]!.roomTypes[0]!.nights[0]!;
    expect(night).toMatchObject({ held: 10, pickedUp: 6, unsold: 4, price: 89 });
    const total = (await pool.query(`select sum(total)::numeric as t from ${s()}.reservation_nights n join ${s()}.reservations r on r.id = n.reservation_id where r.group_holding_id = $1`, [holding])).rows[0].t;
    expect(Number(total)).toBe(6 * 2 * 89);
    // three days before the release, staff are warned once; then the release date comes
    await setReleaseDate(pool, s(), holding, addDays(today, 2), revenue);
    expect((await runGroupDuties(pool, s())).releasingSoon).toMatchObject([{ groupName: "Chor Leipzig", unsold: 4 }]);
    expect((await runGroupDuties(pool, s())).releasingSoon).toEqual([]);
    await pool.query(`update ${s()}.properties set business_date = $2 where id = $1`, [propertyId, addDays(today, 2)]);
    const duties = await runGroupDuties(pool, s());
    expect(duties.released).toMatchObject([{ groupName: "Chor Leipzig", rooms: 4 }]);
    expect(await free(arrival)).toBe(14);
    await pushChannels(pool, s(), propertyId, ch);
    expect(ch.availabilityOn(extType(), arrival)).toBe(14);
    await pool.query(`update ${s()}.properties set business_date = $2 where id = $1`, [propertyId, today]);
  });

  it("a group is made Definite only where its Held Rooms are free; a booking beyond them is refused", async () => {
    const day = addDays(today, 45);
    const g = await createGroup(pool, s(), { propertyId, name: "Zu groß", organiser: null, contact: "", optionDate: null, terms: "", reductionRules: "", releaseDays: 7, basePlanId: basePlan }, fd);
    const h = await addHolding(pool, s(), g.id, { arrival: day, departure: addDays(day, 1), rooms: [{ roomTypeId: dbl, rooms: 21 }] }, fd);
    await expect(setGroupStatus(pool, s(), g.id, "definite", fd)).rejects.toThrow(/Not enough rooms free to hold: DBL/);
    await setHeldRooms(pool, s(), h, [{ roomTypeId: dbl, date: day, rooms: 1 }], fd);
    await setGroupStatus(pool, s(), g.id, "definite", fd);
    await setGroupPrices(pool, s(), g.id, [{ roomTypeId: dbl, date: day, price: 80 }], revenue);
    await bookFromGroup(pool, s(), h, { roomTypeId: dbl, firstName: "A", lastName: "B", adults: 2 }, fd);
    await expect(bookFromGroup(pool, s(), h, { roomTypeId: dbl, firstName: "C", lastName: "D", adults: 2 }, fd)).rejects.toThrow(/No Held Room/);
  });

  it("Tentative demand above availability shows the warning without blocking", async () => {
    const day = addDays(today, 30);
    const g = await createGroup(pool, s(), { propertyId, name: "Kongress", organiser: null, contact: "", optionDate: addDays(today, 5), terms: "", reductionRules: "", releaseDays: 7, basePlanId: basePlan }, fd);
    const h = await addHolding(pool, s(), g.id, { arrival: day, departure: addDays(day, 1), rooms: [{ roomTypeId: dbl, rooms: 25 }] }, fd);
    expect(h).toBeTruthy();
    // nothing is taken out of sale
    expect(await free(day)).toBe(20);
    const night = (await groupView(pool, s(), g.id, fd)).holdings[0]!.roomTypes[0]!.nights[0]!;
    expect(night).toMatchObject({ held: 25, free: 20, shortfall: 5 });
    // past its option date it lapses
    await pool.query(`update ${s()}.properties set business_date = $2 where id = $1`, [propertyId, addDays(today, 6)]);
    expect((await runGroupDuties(pool, s())).lapsed).toMatchObject([{ groupName: "Kongress" }]);
    await pool.query(`update ${s()}.properties set business_date = $2 where id = $1`, [propertyId, today]);
  });

  it("a Series of 8 Saturdays creates 8 holdings with their own release dates", async () => {
    const g = await createGroup(pool, s(), { propertyId, name: "Reisen AG Wochenende", organiser: { companyId: company }, contact: "", optionDate: null, terms: "", reductionRules: "", releaseDays: 7, basePlanId: basePlan }, fd);
    const from = addDays(today, 7);
    const n = await createSeries(pool, s(), g.id, { from, to: addDays(from, 7 * 8 - 1), weekday: 6, nights: 2, rooms: [{ roomTypeId: dbl, rooms: 3 }] }, fd);
    expect(n).toBe(8);
    const v = await groupView(pool, s(), g.id, fd);
    expect(v.series).toBe(true);
    expect(v.holdings).toHaveLength(8);
    expect(new Set(v.holdings.map((h) => h.releaseDate)).size).toBe(8);
    expect(v.holdings.every((h) => h.releaseDate === addDays(h.arrival, -7))).toBe(true);
  });
});
