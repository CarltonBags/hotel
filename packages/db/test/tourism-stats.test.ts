import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { migrateControl } from "../src/control/migrate-control";
import { controlMigrations, tenantMigrations } from "../src/migrations/load";
import { provisionTenant, type Tenant } from "../src/tenant/provision";
import { createLegalEntity } from "../src/tenant/legal-entities";
import { createProperty } from "../src/tenant/properties";
import { createRoomType, createRooms } from "../src/tenant/rooms";
import { applyTaxPreset, listTaxCodes } from "../src/tenant/tax-codes";
import { createService } from "../src/tenant/services";
import { createCancellationPolicy, createPaymentPolicy } from "../src/tenant/policies";
import { createRatePlan } from "../src/tenant/rate-plans";
import { setRates } from "../src/tenant/rates";
import { createGuest } from "../src/tenant/guests";
import { createBooking } from "../src/tenant/reservations";
import { addPropertyClosure, dueTourismReport, setStatsExclusion, setStatsSettings, submitTourismReport, tourismReport } from "../src/tenant/tourism-stats";
import { resetTestDatabase, testPool } from "./helpers";

/**
 * Seams: the month's report counted from the stays (persons by residence,
 * arrivals and nights), Austria's split by state and region, frozen
 * versions, the reminder on the deadline day.
 */
describe("tourism statistics", () => {
  let pool: Pool;
  let tenant: Tenant;
  const fd = "user_frida";
  const s = () => tenant.schemaName;
  const props: Record<string, { id: string; plan: string; type: string }> = {};
  const bd = (id: string, d: string) => pool.query(`update ${s()}.properties set business_date = $2 where id = $1`, [id, d]);

  async function setUp(name: string, country: "DE" | "AT", le: string) {
    const id = (await createProperty(pool, s(), { name, legalEntityId: le, country, timeZone: "Europe/Berlin", currency: "EUR" })).id;
    await bd(id, "2026-07-01");
    const type = (await createRoomType(pool, s(), { propertyId: id, code: "DBL", name: "Double", maxOccupancy: 4, maxAdults: 4, bedPlaces: 2, extraBeds: 1 })).id;
    await createRooms(pool, s(), { propertyId: id, roomTypeId: type, numbers: ["101", "102", "103", "104", "105", "106"] });
    const codes = await listTaxCodes(pool, s(), le);
    const room = await createService(pool, s(), { propertyId: id, code: "ROOM", name: "Room", defaultPrice: 0, taxCodeId: codes.find((c) => c.code === "ACC")!.id, revenueAccount: "8300", postingRhythm: "per_night", bookableOnline: false });
    const pay = await createPaymentPolicy(pool, s(), { propertyId: id, name: "Card", kind: "card_guarantee" });
    const cxl = await createCancellationPolicy(pool, s(), { propertyId: id, name: "Flex", freeUntilDays: 1, feeKind: "first_night", noShowFeeKind: "first_night" });
    const plan = (await createRatePlan(pool, s(), { propertyId: id, code: "RO", name: "Room only", kind: "base", roomTypeIds: [type], accommodationServiceId: room.id, paymentPolicyId: pay.id, cancellationPolicyId: cxl.id })).id;
    const dates = Array.from({ length: 50 }, (_, i) => new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10));
    await setRates(pool, s(), id, fd, dates.map((date) => ({ ratePlanId: plan, roomTypeId: type, date, price: 100 })));
    props[name] = { id, plan, type };
  }

  async function stay(property: string, guest: { country: string | null; postal?: string }, arrival: string, departure: string, adults: number, childAges: number[] = [], status = "checked_out") {
    const p = props[property]!;
    const g = (await createGuest(pool, s(), { firstName: "G", lastName: `${guest.country ?? "none"}-${arrival}`, countryOfResidence: guest.country, postalCode: guest.postal ?? null }, { userId: fd, propertyId: p.id })).id;
    const b = await createBooking(pool, s(), p.id, fd, { booker: { guestId: g }, walkIn: false, notes: "", reservations: [{ arrival, departure, roomTypeId: p.type, ratePlanId: p.plan, adults, childAges, primaryGuestId: g }] });
    const id = b.reservations[0]!.id;
    await pool.query(`update ${s()}.reservations set status = $2 where id = $1`, [id, status]);
    return id;
  }

  let refugee: string;

  beforeAll(async () => {
    pool = testPool(4);
    await resetTestDatabase(pool);
    await migrateControl(pool, controlMigrations());
    tenant = await provisionTenant(pool, { slug: "alpha", name: "Alpha" }, tenantMigrations());
    const le = (await createLegalEntity(pool, s(), { name: "Alpha GmbH", country: "DE" })).id;
    await applyTaxPreset(pool, s(), le, "DE");
    await setUp("Berlin", "DE", le);
    await setUp("Wien", "AT", le);
    // Berlin, July 2026
    await stay("Berlin", { country: "NL" }, "2026-07-25", "2026-08-06", 3);
    await stay("Berlin", { country: "DE", postal: "80331" }, "2026-07-10", "2026-07-12", 2);
    await stay("Berlin", { country: "AT", postal: "1010" }, "2026-07-30", "2026-08-02", 1, [8]);
    await stay("Berlin", { country: null }, "2026-07-05", "2026-07-06", 1);
    refugee = await stay("Berlin", { country: "UA" }, "2026-07-01", "2026-07-31", 2);
    await stay("Berlin", { country: "FR" }, "2026-07-14", "2026-07-16", 2, [], "cancelled");
    await setStatsExclusion(pool, s(), refugee, "Refugee accommodation");
    // Wien, July 2026
    await stay("Wien", { country: "DE", postal: "80331" }, "2026-07-02", "2026-07-04", 2);
    await stay("Wien", { country: "DE", postal: "10115" }, "2026-07-02", "2026-07-03", 1);
    await stay("Wien", { country: "DE" }, "2026-07-20", "2026-07-21", 1);
    await stay("Wien", { country: "AT", postal: "6900" }, "2026-07-08", "2026-07-10", 2);
    await stay("Wien", { country: "KZ" }, "2026-07-08", "2026-07-09", 1);
    await addPropertyClosure(pool, s(), props.Wien!.id, { from: "2026-07-27", to: "2026-07-31", reason: "Renovation" }, fd);
  });

  afterAll(async () => {
    await resetTestDatabase(pool);
    await pool.end();
  });

  it("German form for a demo month matches a hand count of persons by country", async () => {
    const { current } = await tourismReport(pool, s(), props.Berlin!.id, "2026-07");
    const by = Object.fromEntries(current.rows.filter((r) => r.arrivals || r.nights).map((r) => [r.key, [r.arrivals, r.nights]]));
    // NL: 3 persons, 7 nights in July; DE: 2 persons, 2 nights; AT: 2 persons, 2 nights; not stated: 1, 1
    expect(by).toEqual({ DE: [2, 4], NL: [3, 21], AT: [2, 4], unknown: [1, 1] });
    expect(current.totals).toEqual({ arrivals: 8, nights: 30 });
    expect(current.rows[0]!.key).toBe("DE");
    expect(current.excluded).toEqual([expect.objectContaining({ reservationId: refugee, reason: "Refugee accommodation" })]);
    expect(current.incomplete.map((i) => i.missing)).toEqual(["country"]);
    expect(current.capacity).toMatchObject({ bedPlaces: 12, extraBeds: 6, rooms: 6, openingDays: 31 });
    // August: the NL and AT stays go on, no new arrivals
    const aug = (await tourismReport(pool, s(), props.Berlin!.id, "2026-08")).current;
    expect(aug.totals).toEqual({ arrivals: 0, nights: 3 * 5 + 2 * 1 });
  });

  it("Austrian variant splits Germany by region and Austria by state", async () => {
    const { current } = await tourismReport(pool, s(), props.Wien!.id, "2026-07");
    const by = Object.fromEntries(current.rows.filter((r) => r.arrivals || r.nights).map((r) => [r.key, [r.arrivals, r.nights]]));
    expect(by).toEqual({ at_vorarlberg: [2, 4], de_bayern: [2, 4], de_berlin: [1, 1], de_unknown_region: [1, 1], cis: [1, 1] });
    expect(current.incomplete).toEqual([expect.objectContaining({ missing: "postal_code" })]);
    // closed 27 to 31 July
    expect(current.capacity.openingDays).toBe(26);
  });

  it("a frozen report cannot change; a correction creates a new version", async () => {
    await bd(props.Berlin!.id, "2026-08-03");
    expect(await submitTourismReport(pool, s(), props.Berlin!.id, "2026-07", fd)).toBe(1);
    await expect(pool.query(`update ${s()}.tourism_reports set data = '{}'`)).rejects.toThrow(/never changed/);
    // the refugee stay counted after all: the correction is version 2, version 1 stays as submitted
    await setStatsExclusion(pool, s(), refugee, null);
    expect(await submitTourismReport(pool, s(), props.Berlin!.id, "2026-07", fd)).toBe(2);
    const { versions } = await tourismReport(pool, s(), props.Berlin!.id, "2026-07");
    expect(versions.map((v) => [v.version, v.data.totals.arrivals])).toEqual([
      [2, 10],
      [1, 8],
    ]);
    await expect(submitTourismReport(pool, s(), props.Berlin!.id, "2026-09", fd)).rejects.toThrow(/once it has begun/);
  });

  it("the reminder appears on the deadline day until the month is submitted", async () => {
    const wien = props.Wien!.id;
    await setStatsSettings(pool, s(), wien, { identity: "AT-123", deadlineDay: 5 });
    await bd(wien, "2026-08-04");
    expect(await dueTourismReport(pool, s(), wien)).toBeNull();
    await bd(wien, "2026-08-05");
    expect(await dueTourismReport(pool, s(), wien)).toEqual({ month: "2026-07", deadline: "2026-08-05" });
    await submitTourismReport(pool, s(), wien, "2026-07", fd);
    expect(await dueTourismReport(pool, s(), wien)).toBeNull();
  });
});
